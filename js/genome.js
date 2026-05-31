/*
 * genome.js — Genome helpers: creation, mutation, crossover, decoding.
 *
 * A genome is just a Float64Array of length CONFIG.GENOME_LEN. We keep the
 * representation "dumb" (a plain typed array) and put all the behaviour in
 * these stateless helper functions so genomes are trivial to clone, export to
 * JSON, and re-inject.
 */
(function (root) {
  'use strict';
  var TP = root.TP || (root.TP = {});
  var CONFIG = TP.CONFIG;
  var GENES = CONFIG.genes;
  var NCORE = CONFIG.NCORE;
  var LEN = CONFIG.GENOME_LEN;

  var Genome = {};

  // A fresh random genome: body genes uniform in 0..1, brain weights ~N(0, .8).
  Genome.random = function (rng) {
    var g = new Float64Array(LEN);
    for (var i = 0; i < NCORE; i++) g[i] = rng.float();
    for (var j = NCORE; j < LEN; j++) g[j] = rng.gauss() * 0.8;
    return g;
  };

  Genome.clone = function (g) {
    return Float64Array.from(g);
  };

  // Decode a normalised core gene (by index) into its real-world value.
  Genome.gene = function (g, index) {
    var spec = GENES[index];
    return spec.min + (spec.max - spec.min) * g[index];
  };

  // Decode by gene name (slower; used by UI, not the hot loop).
  Genome.geneByName = function (g, name) {
    for (var i = 0; i < GENES.length; i++) {
      if (GENES[i].name === name) return Genome.gene(g, i);
    }
    return undefined;
  };

  // Hue (0..360) is driven by the neutral "hue" marker gene. Because the marker
  // is under no direct selection, it drifts via mutation and lineages slowly
  // separate into visible colour bands — neutral drift made visible.
  Genome.hue = function (g) {
    var idx = GENES.length - 1; // hue is the last core gene
    return g[idx] * 360;
  };

  // Produce a mutated child genome. perGeneSd comes from the organism's own
  // (evolvable) mutationRate gene, scaled by the global mutation multiplier.
  Genome.mutate = function (g, rng, globalMult) {
    var child = Float64Array.from(g);
    var sd = (GENES[6].min + (GENES[6].max - GENES[6].min) * g[6]) * (globalMult || 1);
    // Body genes: gaussian step, clamped to 0..1.
    for (var i = 0; i < NCORE; i++) {
      child[i] = clamp01(child[i] + rng.gauss() * sd);
    }
    // Brain weights: larger steps (weights live on ~unit scale), soft-clamped.
    var brainSd = sd * 3;
    for (var j = NCORE; j < LEN; j++) {
      var v = child[j] + rng.gauss() * brainSd;
      child[j] = v < -8 ? -8 : v > 8 ? 8 : v;
    }
    return child;
  };

  // Sexual reproduction: uniform crossover then mutation.
  Genome.crossover = function (a, b, rng, globalMult) {
    var child = new Float64Array(LEN);
    for (var i = 0; i < LEN; i++) child[i] = rng.float() < 0.5 ? a[i] : b[i];
    return Genome.mutate(child, rng, globalMult);
  };

  // Crude genetic "distance" used for species clustering: only the heritable
  // body genes matter for niche, so we compare those (weighted) plus the hue.
  Genome.distance = function (a, b) {
    var d = 0;
    for (var i = 0; i < NCORE; i++) {
      var dx = a[i] - b[i];
      d += dx * dx;
    }
    return Math.sqrt(d);
  };

  Genome.toJSON = function (g, meta) {
    return JSON.stringify(Object.assign({
      format: 'tide-pool-genome',
      version: 1,
      length: g.length,
      genome: Array.prototype.slice.call(g)
    }, meta || {}));
  };

  Genome.fromJSON = function (str) {
    var obj = typeof str === 'string' ? JSON.parse(str) : str;
    var arr = obj.genome || obj;
    if (!arr || arr.length !== LEN) {
      throw new Error('Genome length mismatch (expected ' + LEN + ', got ' + (arr && arr.length) + ')');
    }
    return Float64Array.from(arr);
  };

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  TP.Genome = Genome;
})(typeof globalThis !== 'undefined' ? globalThis : this);
