/*
 * audio.js — Optional, very subtle Web Audio ambience.
 *
 * Births, deaths, and extinctions emit soft sine "blips" whose pitch follows the
 * organism's hue, so a thriving reef gently shimmers and an extinction lands as a
 * low swell. Off by default (created only on first user enable, to satisfy
 * browser autoplay rules). Heavily rate-limited so it never becomes noise.
 */
(function (root) {
  'use strict';
  var TP = root.TP || (root.TP = {});

  function Audio() {
    this.ctx = null;
    this.enabled = false;
    this.master = null;
    this._budget = 0;        // limits blips per frame
    this._lastFrame = 0;
  }

  Audio.prototype.setEnabled = function (on) {
    this.enabled = on;
    if (on && !this.ctx) {
      var AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) { this.enabled = false; return; }
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.16;
      this.master.connect(this.ctx.destination);
    }
    if (on && this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  };

  Audio.prototype._blip = function (freq, dur, gain, type) {
    if (!this.ctx) return;
    var t = this.ctx.currentTime;
    var osc = this.ctx.createOscillator();
    var g = this.ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.02);
  };

  // Consume the world's event queue and sonify it.
  Audio.prototype.play = function (events, frame) {
    if (!this.enabled || !this.ctx) return;
    if (frame !== this._lastFrame) { this._budget = 4; this._lastFrame = frame; }
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (e.type === 'extinction') {
        // a low, ominous swell
        this._blip(70, 1.4, 0.5, 'sine');
        this._blip(104, 1.1, 0.3, 'triangle');
      } else if (e.type === 'inject') {
        this._blip(660, 0.5, 0.4, 'triangle');
      } else if (this._budget > 0) {
        var hue = e.hue || 0;
        var freq = 220 + (hue / 360) * 660;      // pitch from colour
        if (e.type === 'birth') { this._blip(freq * 2, 0.12, 0.10, 'sine'); this._budget--; }
        else if (e.type === 'death') { this._blip(freq * 0.5, 0.18, 0.06, 'sine'); this._budget--; }
      }
    }
  };

  TP.Audio = Audio;
})(typeof globalThis !== 'undefined' ? globalThis : this);
