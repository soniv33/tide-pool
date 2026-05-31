/*
 * charts.js — Minimal time-series sparkline charts drawn on small canvases.
 *
 * Each chart reads directly from world.history ring buffers. We keep the drawing
 * dead simple (auto-scaled polylines on a translucent grid) — these are glanceable
 * trend lines, not analytical plots.
 */
(function (root) {
  'use strict';
  var TP = root.TP || (root.TP = {});

  function setup(canvas) {
    var dpr = Math.min(root.devicePixelRatio || 1, 2);
    var rect = canvas.getBoundingClientRect();
    var w = rect.width || 226, h = rect.height || 56;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }

  function clearBg(c) {
    c.ctx.clearRect(0, 0, c.w, c.h);
    c.ctx.strokeStyle = 'rgba(120,220,230,0.08)';
    c.ctx.lineWidth = 1;
    for (var i = 1; i < 3; i++) {
      var y = (c.h / 3) * i;
      c.ctx.beginPath(); c.ctx.moveTo(0, y); c.ctx.lineTo(c.w, y); c.ctx.stroke();
    }
  }

  // Draw one auto-scaled series. opts: {color, min, max, fill}
  function line(c, data, opts) {
    var n = data.length;
    if (n < 2) return;
    var min = opts.min, max = opts.max;
    if (min == null || max == null) {
      min = Infinity; max = -Infinity;
      for (var i = 0; i < n; i++) { if (data[i] < min) min = data[i]; if (data[i] > max) max = data[i]; }
    }
    if (max - min < 1e-6) { max = min + 1; }
    var pad = 4;
    var sx = c.w / (n - 1);
    var sy = (c.h - pad * 2) / (max - min);
    var ctx = c.ctx;
    ctx.beginPath();
    for (var j = 0; j < n; j++) {
      var x = j * sx;
      var y = c.h - pad - (data[j] - min) * sy;
      if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = opts.color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (opts.fill) {
      ctx.lineTo(c.w, c.h); ctx.lineTo(0, c.h); ctx.closePath();
      ctx.fillStyle = opts.fill;
      ctx.fill();
    }
  }

  function Charts(ids) {
    this.pop = setup(document.getElementById(ids.pop));
    this.traits = setup(document.getElementById(ids.traits));
    this.bio = setup(document.getElementById(ids.bio));
    this.pred = setup(document.getElementById(ids.pred));
  }

  Charts.prototype.draw = function (world) {
    var h = world.history;

    // Population (filled area).
    clearBg(this.pop);
    line(this.pop, h.population, { color: '#38e6d0', fill: 'rgba(56,230,208,0.12)', min: 0 });

    // Traits: three normalised series on one axis (each scaled to its gene range).
    clearBg(this.traits);
    line(this.traits, h.avgSpeed, { color: '#6ad0ff', min: 0.4, max: 3.0 });
    line(this.traits, h.avgSize, { color: '#ffd27a', min: 3, max: 11 });
    line(this.traits, h.avgSensor, { color: '#c79bff', min: 40, max: 175 });

    // Biodiversity.
    clearBg(this.bio);
    line(this.bio, h.biodiversity, { color: '#9affc0', fill: 'rgba(120,255,180,0.10)', min: 0 });

    // Predator:prey ratio.
    clearBg(this.pred);
    line(this.pred, h.predatorRatio, { color: '#ff7da0', fill: 'rgba(255,93,115,0.10)', min: 0 });
  };

  TP.Charts = Charts;
})(typeof globalThis !== 'undefined' ? globalThis : this);
