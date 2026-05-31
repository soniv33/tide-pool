/*
 * rng.js — Deterministic, seedable pseudo-random number generator.
 *
 * Everything stochastic in TIDE POOL (genome init, mutation, food placement,
 * spawn positions, extinctions) routes through a single RNG instance so that a
 * given seed reproduces a given run as closely as floating-point allows.
 *
 * Algorithm: mulberry32 — tiny, fast, good statistical quality for a toy sim.
 */
(function (root) {
  'use strict';
  var TP = root.TP || (root.TP = {});

  // Hash an arbitrary string seed into a 32-bit integer (xfnv1a-ish).
  function hashSeed(str) {
    str = String(str);
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function RNG(seed) {
    this.setSeed(seed);
  }

  RNG.prototype.setSeed = function (seed) {
    this.seedString = (seed === undefined || seed === null || seed === '') ? 'tide-pool' : seed;
    this._state = hashSeed(this.seedString);
    this._gaussCache = null;
  };

  // Uniform float in [0, 1).
  RNG.prototype.float = function () {
    var t = (this._state += 0x6D2B79F5) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Uniform float in [min, max).
  RNG.prototype.range = function (min, max) {
    return min + (max - min) * this.float();
  };

  // Integer in [0, n).
  RNG.prototype.int = function (n) {
    return Math.floor(this.float() * n);
  };

  // Standard normal (mean 0, sd 1) via Box–Muller, cached in pairs.
  RNG.prototype.gauss = function () {
    if (this._gaussCache !== null) {
      var g = this._gaussCache;
      this._gaussCache = null;
      return g;
    }
    var u = 0, v = 0;
    while (u === 0) u = this.float();
    while (v === 0) v = this.float();
    var mag = Math.sqrt(-2.0 * Math.log(u));
    this._gaussCache = mag * Math.sin(2.0 * Math.PI * v);
    return mag * Math.cos(2.0 * Math.PI * v);
  };

  // true with probability p.
  RNG.prototype.chance = function (p) {
    return this.float() < p;
  };

  // Random element of an array.
  RNG.prototype.pick = function (arr) {
    return arr[this.int(arr.length)];
  };

  TP.RNG = RNG;
})(typeof globalThis !== 'undefined' ? globalThis : this);
