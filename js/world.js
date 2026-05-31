/*
 * world.js — The simulation. Owns organisms, food, the spatial grids, the RNG,
 * the user-tunable parameters, and the time-series statistics.
 *
 * One `step()` advances the whole ecosystem by a single tick. The render loop
 * may call step() many times per frame (sim-speed control); rendering is the
 * UI's concern and lives elsewhere, so the World is fully headless and can be
 * driven from Node for tuning/testing.
 */
(function (root) {
  'use strict';
  var TP = root.TP || (root.TP = {});
  var CONFIG = TP.CONFIG;
  var Genome = TP.Genome;
  var Organism = TP.Organism;

  function World(width, height, opts) {
    opts = opts || {};
    this.width = width;
    this.height = height;
    this.rng = new TP.RNG(opts.seed != null ? opts.seed : CONFIG.defaults.seed);

    this.params = Object.assign({}, CONFIG.defaults, opts.params || {});

    this.organisms = [];
    this.food = [];
    this._deadFoodPool = []; // reuse food objects to cut GC churn
    this.tick = 0;
    this.nextId = 1;
    this.foodGrid = new TP.SpatialHash(width, height, 64);
    this.orgGrid = new TP.SpatialHash(width, height, 90);
    this.dayPhase = 0;       // 0..1 across a day/night cycle
    this.daylight = 1;       // current light level (affects food spawn)

    // Lineage registry: founderId -> { birthTick, alive count, members... }.
    this.lineages = {};

    // Rolling statistics for the charts.
    this.history = {
      population: [], avgSpeed: [], avgSize: [], avgSensor: [],
      biodiversity: [], predatorRatio: [], avgDiet: []
    };
    this.species = 0;
    this.lastStats = null;

    this.events = []; // {type:'birth'|'death'|'extinction', ...} for audio/FX
    this._spawnBuffer = [];

    if (opts.populate !== false) this.seedInitial();
  }

  // ---- Setup ---------------------------------------------------------------

  World.prototype.resize = function (width, height) {
    this.width = width;
    this.height = height;
    this.foodGrid.configure(width, height, 64);
    this.orgGrid.configure(width, height, 90);
    // Clamp existing positions into the new bounds.
    for (var i = 0; i < this.organisms.length; i++) {
      var o = this.organisms[i];
      o.x = o.x % width; if (o.x < 0) o.x += width;
      o.y = o.y % height; if (o.y < 0) o.y += height;
    }
  };

  World.prototype.seedInitial = function () {
    var n = CONFIG.world.initialPop;
    for (var i = 0; i < n; i++) {
      var g = Genome.random(this.rng);
      this.addOrganism(g, this.rng.float() * this.width, this.rng.float() * this.height, null);
    }
    this.refillFood(this.foodCapacity());
  };

  // Deterministic head-start: advance the sim n ticks before the first frame is
  // drawn, so the pool opens already lively — foraging has begun to evolve and
  // the sparse founder population has started to bloom — instead of making the
  // viewer watch random brains flail. This is still pure evolution, just
  // pre-computed; it uses the same seeded RNG, so the run stays reproducible.
  World.prototype.burnIn = function (n) {
    if (!n) return;
    for (var i = 0; i < n; i++) this.step();
    this.sampleStats();
  };

  // ---- Core object creation -----------------------------------------------

  World.prototype.addOrganism = function (genome, x, y, parent) {
    var o = new Organism(this.nextId++, genome, x, y, this.rng);
    if (parent) {
      o.parentId = parent.id;
      o.generation = parent.generation + 1;
      o.lineageId = parent.lineageId;
    } else {
      o.lineageId = o.id;
      this.lineages[o.id] = { founder: o.id, birthTick: this.tick };
    }
    o.birthTick = this.tick;
    this.organisms.push(o);
    return o;
  };

  // Called by Organism.reproduce — defers actual insertion to end of tick so we
  // never mutate the organism array mid-iteration.
  World.prototype.spawnChild = function (genome, parent) {
    if (this.organisms.length + this._spawnBuffer.length >= CONFIG.world.hardCap) return null;
    var jitter = parent.size + 2;
    var child = new Organism(this.nextId++, genome,
      wrap(parent.x + this.rng.range(-jitter, jitter), this.width),
      wrap(parent.y + this.rng.range(-jitter, jitter), this.height),
      this.rng);
    child.parentId = parent.id;
    child.generation = parent.generation + 1;
    child.lineageId = parent.lineageId;
    child.birthTick = this.tick;
    this._spawnBuffer.push(child);
    this.events.push({ type: 'birth', hue: child.hue });
    return child;
  };

  World.prototype.canReproduce = function () {
    return (this.organisms.length + this._spawnBuffer.length) < CONFIG.world.hardCap;
  };

  // ---- Food ----------------------------------------------------------------

  World.prototype.foodCapacity = function () {
    var area = this.width * this.height;
    return Math.floor(area / CONFIG.world.foodAreaPer * this.params.density);
  };

  World.prototype.makeFood = function (x, y, energy) {
    var f = this._deadFoodPool.pop() || { x: 0, y: 0, vx: 0, vy: 0, energy: 1, alive: true };
    f.x = x; f.y = y;
    f.vx = this.rng.range(-1, 1) * CONFIG.world.foodDrift;
    f.vy = this.rng.range(-1, 1) * CONFIG.world.foodDrift;
    f.energy = energy == null ? 1 : energy;
    f.alive = true;
    this.food.push(f);
    return f;
  };

  World.prototype.refillFood = function (target) {
    while (this.food.length < target) {
      this.makeFood(this.rng.float() * this.width, this.rng.float() * this.height);
    }
  };

  // Drop food at a point (user click). `spread` jitters placement.
  World.prototype.dropFood = function (x, y, count, spread) {
    spread = spread || 18;
    for (var i = 0; i < count; i++) {
      this.makeFood(
        wrap(x + this.rng.range(-spread, spread), this.width),
        wrap(y + this.rng.range(-spread, spread), this.height),
        1.4
      );
    }
  };

  // ---- The tick ------------------------------------------------------------

  World.prototype.step = function () {
    this.tick++;

    // Day/night cycle gently modulates how much food the world produces.
    if (this.params.dayNight) {
      this.dayPhase = (this.tick % 3600) / 3600;
      this.daylight = 0.55 + 0.45 * Math.sin(this.dayPhase * Math.PI * 2 - Math.PI / 2);
    } else {
      this.daylight = 1;
    }

    // Rebuild spatial grids.
    this.foodGrid.clear();
    this.orgGrid.clear();
    var i, o;
    for (i = 0; i < this.food.length; i++) this.foodGrid.insert(this.food[i]);
    for (i = 0; i < this.organisms.length; i++) this.orgGrid.insert(this.organisms[i]);

    // Decay attack/eat flash from the previous frame.
    for (i = 0; i < this.organisms.length; i++) this.organisms[i].flash *= 0.82;

    // Step every organism (stable order -> determinism).
    var orgs = this.organisms;
    for (i = 0; i < orgs.length; i++) {
      o = orgs[i];
      if (o.alive) o.step(this);
    }

    // Drift food and cull eaten particles.
    var alive = [];
    for (i = 0; i < this.food.length; i++) {
      var f = this.food[i];
      if (!f.alive) { this._deadFoodPool.push(f); continue; }
      f.x = wrap(f.x + f.vx, this.width);
      f.y = wrap(f.y + f.vy, this.height);
      alive.push(f);
    }
    this.food = alive;

    // Spawn new food up to capacity, modulated by light & the user food rate.
    var cap = this.foodCapacity();
    var spawn = this.params.foodRate * this.params.density * this.daylight;
    var whole = Math.floor(spawn) + (this.rng.float() < (spawn - Math.floor(spawn)) ? 1 : 0);
    for (i = 0; i < whole && this.food.length < cap; i++) {
      this.makeFood(this.rng.float() * this.width, this.rng.float() * this.height);
    }

    // Commit newborns.
    if (this._spawnBuffer.length) {
      for (i = 0; i < this._spawnBuffer.length; i++) this.organisms.push(this._spawnBuffer[i]);
      this._spawnBuffer.length = 0;
    }

    // Remove the dead (and emit death events for FX).
    var survivors = [];
    for (i = 0; i < orgs.length; i++) {
      o = orgs[i];
      if (o.alive) survivors.push(o);
      else this.events.push({ type: 'death', hue: o.hue, x: o.x, y: o.y });
    }
    this.organisms = survivors;

    // Primordial soup: keep a dead world from staying dead, without overriding
    // selection in a healthy one. Only fires when life is nearly gone.
    if (this.params.spontaneous && this.organisms.length < CONFIG.world.spontaneousFloor) {
      if (this.rng.float() < CONFIG.world.spontaneousRate) {
        this.addOrganism(Genome.random(this.rng),
          this.rng.float() * this.width, this.rng.float() * this.height, null);
      }
    }

    if (this.tick % CONFIG.statsInterval === 0) this.sampleStats();
  };

  // ---- User actions --------------------------------------------------------

  // Mass extinction: kill a fraction of the population at random. Survivors
  // re-radiate to refill empty niches — a feature, not a gimmick.
  World.prototype.massExtinction = function (killFraction) {
    killFraction = killFraction == null ? 0.9 : killFraction;
    var before = this.organisms.length;
    var kept = [];
    for (var i = 0; i < this.organisms.length; i++) {
      if (this.rng.float() < killFraction) {
        this.organisms[i].alive = false;
      } else {
        kept.push(this.organisms[i]);
      }
    }
    this.organisms = kept;
    this.events.push({ type: 'extinction', killed: before - kept.length });
  };

  // Re-seed the entire world with a new seed/params (reproducible restart).
  World.prototype.reset = function (seed, params) {
    this.rng.setSeed(seed != null ? seed : this.rng.seedString);
    if (params) this.params = Object.assign({}, CONFIG.defaults, params);
    this.organisms = [];
    this.food = [];
    this._deadFoodPool = [];
    this._spawnBuffer = [];
    this.tick = 0;
    this.nextId = 1;
    this.lineages = {};
    for (var k in this.history) this.history[k].length = 0;
    this.seedInitial();
  };

  // Inject an exported genome as a new organism near a point (or centre).
  World.prototype.injectGenome = function (genome, x, y) {
    if (x == null) x = this.width * 0.5;
    if (y == null) y = this.height * 0.5;
    var o = this.addOrganism(Genome.clone(genome), x, y, null);
    o.energy = o.reproThreshold * 0.9;
    this.events.push({ type: 'inject', hue: o.hue });
    return o;
  };

  // ---- Statistics ----------------------------------------------------------

  World.prototype.sampleStats = function () {
    var orgs = this.organisms, n = orgs.length;
    var sumSpeed = 0, sumSize = 0, sumSensor = 0, sumDiet = 0, predators = 0;
    var oldestLineageAge = 0, oldestLineageId = null, maxGen = 0;

    for (var i = 0; i < n; i++) {
      var o = orgs[i];
      sumSpeed += o.maxSpeed;
      sumSize += o.size;
      sumSensor += o.sensorRange;
      sumDiet += o.diet;
      if (o.diet > 0.5) predators++;
      if (o.generation > maxGen) maxGen = o.generation;
      var lin = this.lineages[o.lineageId];
      if (lin) {
        var age = this.tick - lin.birthTick;
        if (age > oldestLineageAge) { oldestLineageAge = age; oldestLineageId = o.lineageId; }
      }
    }

    var biodiversity = this.computeSpecies();
    this.species = biodiversity;

    var prey = n - predators;
    var predRatio = prey > 0 ? predators / prey : (predators > 0 ? predators : 0);

    push(this.history.population, n);
    push(this.history.avgSpeed, n ? sumSpeed / n : 0);
    push(this.history.avgSize, n ? sumSize / n : 0);
    push(this.history.avgSensor, n ? sumSensor / n : 0);
    push(this.history.avgDiet, n ? sumDiet / n : 0);
    push(this.history.biodiversity, biodiversity);
    push(this.history.predatorRatio, predRatio);

    this.lastStats = {
      population: n,
      avgSpeed: n ? sumSpeed / n : 0,
      avgSize: n ? sumSize / n : 0,
      avgSensor: n ? sumSensor / n : 0,
      avgDiet: n ? sumDiet / n : 0,
      predators: predators,
      prey: prey,
      species: biodiversity,
      maxGen: maxGen,
      oldestLineageId: oldestLineageId,
      oldestLineageAge: oldestLineageAge,
      foodCount: this.food.length,
      tick: this.tick
    };
    return this.lastStats;
  };

  // Species richness via greedy genome clustering on the heritable body genes.
  // Two organisms belong to the same species if their genome distance is below
  // a threshold. Cheap, deterministic, and good enough to make speciation
  // legible on the charts.
  World.prototype.computeSpecies = function () {
    var THRESH = 0.2;
    var reps = []; // representative genomes of discovered species
    var orgs = this.organisms;
    for (var i = 0; i < orgs.length; i++) {
      var g = orgs[i].genome, found = false;
      for (var j = 0; j < reps.length; j++) {
        if (Genome.distance(g, reps[j]) < THRESH) { found = true; break; }
      }
      if (!found) {
        reps.push(g);
        if (reps.length >= 150) break; // safety cap on work
      }
    }
    return reps.length;
  };

  // Drain accumulated FX events (audio/visual layer consumes these).
  World.prototype.drainEvents = function () {
    var e = this.events;
    this.events = [];
    return e;
  };

  function wrap(v, max) { v = v % max; return v < 0 ? v + max : v; }
  function push(arr, v) {
    arr.push(v);
    if (arr.length > CONFIG.statsHistory) arr.shift();
  }

  TP.World = World;
})(typeof globalThis !== 'undefined' ? globalThis : this);
