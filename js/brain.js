/*
 * brain.js — The evolvable feedforward neural network.
 *
 * Weights are not stored here; they live inside the organism's genome vector.
 * The Brain is a thin "view" over that vector that runs the forward pass. This
 * keeps a single source of truth (the genome) for mutation and export, while
 * the network is just an interpretation of those numbers.
 *
 * Architecture: nIn -> nHid (tanh) -> nOut (tanh). No hidden recurrence; pure
 * reactive control. All behaviour is therefore a product of evolution acting on
 * these weights — nothing about seeking food or hunting is hard-coded.
 */
(function (root) {
  'use strict';
  var TP = root.TP || (root.TP = {});
  var CONFIG = TP.CONFIG;
  var B = CONFIG.brain;
  var O = CONFIG.brainOffsets;

  function Brain(genome) {
    this.g = genome; // shares the organism's genome buffer
    this.hidden = new Float64Array(B.nHid);
    this.out = new Float64Array(B.nOut);
  }

  // inputs: Float array of length B.nIn (already normalised to ~[-1,1]).
  // Returns this.out (reused buffer): [turn, thrust, attack], each in [-1,1].
  Brain.prototype.forward = function (inputs) {
    var g = this.g, hid = this.hidden, out = this.out;
    var nIn = B.nIn, nHid = B.nHid, nOut = B.nOut;

    for (var h = 0; h < nHid; h++) {
      var sum = g[O.B1 + h];
      var base = O.W1 + h * nIn;
      for (var i = 0; i < nIn; i++) sum += inputs[i] * g[base + i];
      hid[h] = Math.tanh(sum);
    }
    for (var o = 0; o < nOut; o++) {
      var s = g[O.B2 + o];
      var b2 = O.W2 + o * nHid;
      for (var k = 0; k < nHid; k++) s += hid[k] * g[b2 + k];
      out[o] = Math.tanh(s);
    }
    return out;
  };

  TP.Brain = Brain;
})(typeof globalThis !== 'undefined' ? globalThis : this);
