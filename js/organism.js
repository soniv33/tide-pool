/*
 * organism.js — A single living agent.
 *
 * An organism is a body (decoded from its genome), a brain (a view over the
 * same genome), and some run-time state (position, energy, age, lineage). Its
 * per-tick behaviour is: sense -> think -> act -> pay energy costs -> maybe eat,
 * attack, reproduce, or die. There is deliberately NO fitness function: who
 * lives and who reproduces falls out entirely of the energy economy.
 */
(function (root) {
  'use strict';
  var TP = root.TP || (root.TP = {});
  var CONFIG = TP.CONFIG;
  var Genome = TP.Genome;
  var Brain = TP.Brain;
  var ECON = CONFIG.economy;

  function Organism(id, genome, x, y, rng) {
    this.id = id;
    this.genome = genome;
    this.brain = new Brain(genome);
    this.x = x;
    this.y = y;
    this.heading = rng.range(0, Math.PI * 2);
    this.vx = 0;
    this.vy = 0;

    // Decode body genes once (these never change within a lifetime).
    this.size = Genome.gene(genome, 0);
    this.maxSpeed = Genome.gene(genome, 1);
    this.sensorRange = Genome.gene(genome, 2);
    this.metabolism = Genome.gene(genome, 3);
    this.diet = Genome.gene(genome, 4);
    this.reproThreshold = Genome.gene(genome, 5);
    this.hue = Genome.hue(genome);

    this.energy = this.reproThreshold * ECON.startEnergyFrac;
    this.age = 0;
    this.offspring = 0;
    this.alive = true;

    // Lineage bookkeeping (filled in by the World on birth).
    this.generation = 0;
    this.parentId = null;
    this.lineageId = id;     // founder id of this organism's dynasty
    this.birthTick = 0;
    this.flash = 0;          // visual pulse on attack/eat (decays in render)

    // Reusable input buffer for the brain (avoids per-tick allocation).
    this._in = new Float64Array(CONFIG.brain.nIn);
  }

  // Run one simulation tick. `world` provides the spatial grids, food list,
  // RNG, parameters, and a sink for newborns.
  Organism.prototype.step = function (world) {
    var W = world.width, H = world.height;

    // ---- SENSE: nearest food and nearest other organism within range -----
    var fdx = 0, fdy = 0, fd2 = Infinity, food = null;
    world.foodGrid.forNeighbors(this.x, this.y, this.sensorRange, function (o, dx, dy, d2) {
      if (d2 < fd2) { fd2 = d2; fdx = dx; fdy = dy; food = o; }
    });

    var odx = 0, ody = 0, od2 = Infinity, other = null, crowd = 0;
    var self = this;
    var crowdR2 = 22 * 22;
    world.orgGrid.forNeighbors(this.x, this.y, this.sensorRange, function (o, dx, dy, d2) {
      if (o === self || !o.alive) return;
      if (d2 < crowdR2) crowd++;              // local crowding (folded in here)
      if (d2 < od2) { od2 = d2; odx = dx; ody = dy; other = o; }
    });

    // ---- Encode senses into brain inputs (orientation-invariant) ---------
    var inp = this._in;
    var hx = Math.cos(this.heading), hy = Math.sin(this.heading);
    if (food) {
      var fd = Math.sqrt(fd2) || 1e-6;
      var fnx = fdx / fd, fny = fdy / fd;
      // sin = cross product with heading, cos = dot product with heading.
      inp[0] = hx * fny - hy * fnx;          // food: left/right
      inp[1] = hx * fnx + hy * fny;          // food: ahead/behind
      inp[2] = 1 - fd / this.sensorRange;    // food: proximity
    } else { inp[0] = 0; inp[1] = 0; inp[2] = 0; }

    if (other) {
      var od = Math.sqrt(od2) || 1e-6;
      var onx = odx / od, ony = ody / od;
      inp[3] = hx * ony - hy * onx;          // org: left/right
      inp[4] = hx * onx + hy * ony;          // org: ahead/behind
      inp[5] = 1 - od / this.sensorRange;    // org: proximity
      inp[6] = Math.tanh((other.size - this.size) * 0.6); // relative size
    } else { inp[3] = 0; inp[4] = 0; inp[5] = 0; inp[6] = 0; }

    inp[7] = Math.tanh(this.energy / this.reproThreshold); // own energy

    // ---- THINK -----------------------------------------------------------
    var out = this.brain.forward(inp);
    var turn = out[0];
    var thrust = (out[1] + 1) * 0.5;   // 0..1
    var attackDrive = out[2];

    // ---- ACT: steer & move (with a little inertia for smooth motion) -----
    this.heading += turn * 0.35;
    var targetSpeed = thrust * this.maxSpeed;
    var tvx = Math.cos(this.heading) * targetSpeed;
    var tvy = Math.sin(this.heading) * targetSpeed;
    this.vx += (tvx - this.vx) * 0.35;
    this.vy += (tvy - this.vy) * 0.35;
    this.x += this.vx;
    this.y += this.vy;
    // Toroidal wrap.
    if (this.x < 0) this.x += W; else if (this.x >= W) this.x -= W;
    if (this.y < 0) this.y += H; else if (this.y >= H) this.y -= H;

    var speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);

    // ---- PAY: existence + movement + crowding costs ----------------------
    var sizeFactor = this.size / 5;
    var cost = ECON.existCost * this.metabolism * Math.pow(sizeFactor, ECON.sizeCostExp)
             + ECON.moveCostK * speed * speed * sizeFactor * this.metabolism
             + ECON.crowdCost * crowd;
    this.energy -= cost;

    // ---- EAT food (herbivory; efficiency falls off as diet -> predator) --
    // Feeding radius is only weakly tied to body size, so evolution doesn't
    // simply inflate size to eat better — size is paid for, and is mainly an
    // advantage for predation. This keeps herbivores small and numerous.
    var eatR = ECON.eatRadiusBonus + this.size * 0.3;
    if (food && fd2 < eatR * eatR) {
      if (food.alive) {
        food.alive = false;
        this.energy += ECON.foodEnergy * food.energy * (1 - this.diet);
        this.flash = 1;
      }
    }

    // ---- ATTACK / PREDATION ---------------------------------------------
    if (world.params.predation && other && attackDrive > ECON.attackThreshold && other.alive) {
      var contact = this.size + other.size;
      if (od2 < contact * contact && this.size > other.size * ECON.predationMinSizeAdv) {
        var drain = Math.min(other.energy + 1, ECON.predationRate);
        other.energy -= drain;
        // Predation efficiency scales with how carnivorous the attacker is.
        this.energy += drain * this.diet;
        this.flash = 1;
        other.flash = 1;
        if (other.energy <= 0) other.alive = false;
      }
    }

    // ---- DIE -------------------------------------------------------------
    if (this.energy <= 0) {
      this.alive = false;
      return;
    }

    // ---- REPRODUCE (asexual split, or sexual crossover if enabled) -------
    if (this.energy >= this.reproThreshold && world.canReproduce()) {
      this.reproduce(world, other, od2);
    }

    this.age++;
  };

  Organism.prototype.reproduce = function (world, mate, mateD2) {
    var rng = world.rng;
    var childGenome;

    if (world.params.sexual && mate && mate.alive &&
        mateD2 < (this.sensorRange * 0.5) * (this.sensorRange * 0.5) &&
        mate.energy > mate.reproThreshold * 0.4) {
      // Pay a shared cost; child mixes both genomes.
      childGenome = TP.Genome.crossover(this.genome, mate.genome, rng, world.params.mutationMult);
      this.energy *= 0.5;
      mate.energy *= 0.75;
      mate.offspring++;
    } else {
      // Asexual fission: split energy in half with the mutated daughter cell.
      childGenome = TP.Genome.mutate(this.genome, rng, world.params.mutationMult);
      this.energy *= 0.5;
    }

    var child = world.spawnChild(childGenome, this);
    if (child) {
      child.energy = this.energy; // daughter inherits the post-split half
      this.offspring++;
    }
  };

  TP.Organism = Organism;
})(typeof globalThis !== 'undefined' ? globalThis : this);
