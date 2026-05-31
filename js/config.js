/*
 * config.js — All tunable constants and the genome layout for TIDE POOL.
 *
 * The genome is a single flat numeric vector. The first NCORE entries are the
 * "body plan" genes (stored normalised 0..1 and mapped to real ranges on
 * demand). Everything after that is the raw weight vector of the organism's
 * brain. Keeping it one contiguous vector makes mutation, crossover, export,
 * and re-injection trivial.
 */
(function (root) {
  'use strict';
  var TP = root.TP || (root.TP = {});

  // ---- Brain shape -------------------------------------------------------
  // Inputs (8): food sin, food cos, food proximity,
  //             org sin, org cos, org proximity, org relative size,
  //             own energy level.
  // Hidden (8) tanh neurons. Outputs (3): turn, thrust, attack-drive.
  var BRAIN = { nIn: 8, nHid: 8, nOut: 3 };
  var W1 = BRAIN.nIn * BRAIN.nHid;   // 64
  var B1 = BRAIN.nHid;               // 8
  var W2 = BRAIN.nHid * BRAIN.nOut;  // 24
  var B2 = BRAIN.nOut;               // 3
  var BRAIN_LEN = W1 + B1 + W2 + B2; // 99

  // ---- Core "body" genes -------------------------------------------------
  // Each stored 0..1 in the genome; .min/.max define the real-world meaning.
  var GENES = [
    { name: 'size',           min: 3,    max: 11 },   // radius in px
    { name: 'maxSpeed',       min: 0.4,  max: 3.0 },  // px / tick
    { name: 'sensorRange',    min: 40,   max: 175 },  // px
    { name: 'metabolism',     min: 0.5,  max: 1.8 },  // cost multiplier
    { name: 'diet',           min: 0,    max: 1 },    // 0 herbivore .. 1 predator
    { name: 'reproThreshold', min: 60,   max: 210 },  // energy to split
    { name: 'mutationRate',   min: 0.01, max: 0.25 }, // per-gene mutation sd
    { name: 'hue',            min: 0,    max: 1 }      // neutral marker -> colour
  ];
  var NCORE = GENES.length; // 8

  TP.CONFIG = {
    brain: BRAIN,
    genes: GENES,
    NCORE: NCORE,
    GENOME_LEN: NCORE + BRAIN_LEN,

    // Offsets of each weight block inside the genome vector.
    brainOffsets: {
      W1: NCORE,
      B1: NCORE + W1,
      W2: NCORE + W1 + B1,
      B2: NCORE + W1 + B1 + W2,
      nW1: W1, nB1: B1, nW2: W2, nB2: B2
    },

    // ---- Energy economy (per simulation tick at 1x) ----------------------
    economy: {
      existCost: 0.05,       // base upkeep, scaled by metabolism * size^sizeCostExp
      sizeCostExp: 1.7,      // super-linear size cost -> bounds the size arms race
      moveCostK: 0.022,      // movement cost coefficient (speed^2 scaled)
      crowdCost: 0.010,      // extra upkeep per crowding neighbour
      foodEnergy: 28,        // energy in one food particle (herbivore at diet 0)
      eatRadiusBonus: 7,     // base feeding radius (size adds only weakly)
      predationRate: 15,     // max energy drained from prey per tick
      predationMinSizeAdv: 1.15, // attacker must be this much bigger than prey
      startEnergyFrac: 0.55, // newborn / spontaneous energy = frac * reproThreshold
      attackThreshold: 0.0   // brain attack output must exceed this to attack
    },

    // ---- World / food ----------------------------------------------------
    world: {
      initialPop: 280,
      hardCap: 640,          // perf ceiling: no reproduction above this
      foodAreaPer: 2600,     // 1 unit of food capacity per N px^2 (x density)
      foodDrift: 0.12,       // food particle wander speed
      spontaneousFloor: 6,   // below this pop, spawn fresh "primordial" cells
      spontaneousRate: 0.25  // expected primordial births per tick when below floor
    },

    // ---- Defaults for the user-controlled parameters ---------------------
    defaults: {
      foodRate: 8,           // food particles spawned per tick (x density)
      mutationMult: 1.0,     // global multiplier on every genome's mutation rate
      density: 1.0,          // scales food capacity & spawn
      predation: true,
      sexual: false,         // optional crossover reproduction
      dayNight: true,
      spontaneous: true,
      seed: 'tide-pool'
    },

    // How often (ticks) to push a sample into the time-series charts.
    statsInterval: 12,
    statsHistory: 320        // samples kept per series
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
