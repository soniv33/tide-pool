/*
 * render.js — Canvas2D presentation of the world.
 *
 * The bioluminescent look comes from three cheap tricks:
 *   1. Instead of clearing the canvas each frame we paint a translucent dark
 *      rectangle over it, so everything leaves a fading motion trail.
 *   2. Organisms and food are drawn with 'lighter' (additive) compositing, so
 *      overlapping glows blend and brighten like real bioluminescence.
 *   3. Each organism is a soft halo + a bright core, coloured from its genome,
 *      so lineages separate into visible colour bands as they drift.
 */
(function (root) {
  'use strict';
  var TP = root.TP || (root.TP = {});

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.colorMode = 'genome';
    this.selected = null;
    this.dpr = Math.min(root.devicePixelRatio || 1, 2);
  }

  Renderer.prototype.resize = function (w, h) {
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Prime the background once so the first frames aren't transparent.
    this.ctx.fillStyle = '#02060c';
    this.ctx.fillRect(0, 0, w, h);
  };

  // Map an organism to an [h, s, l] colour according to the current mode.
  Renderer.prototype._hsl = function (o, world) {
    switch (this.colorMode) {
      case 'diet':
        // herbivore (green/cyan) -> predator (red/magenta)
        return 'hsl(' + (170 - o.diet * 190) + ',85%,58%)';
      case 'lineage':
        return 'hsl(' + ((o.lineageId * 47) % 360) + ',75%,60%)';
      case 'energy':
        var e = Math.max(0, Math.min(1, o.energy / o.reproThreshold));
        return 'hsl(' + (210 + e * 130) + ',85%,' + (38 + e * 30) + '%)';
      default:
        return 'hsl(' + o.hue.toFixed(0) + ',80%,60%)';
    }
  };

  Renderer.prototype.draw = function (world) {
    var ctx = this.ctx, W = world.width, H = world.height;

    // 1) Fade previous frame (trail length). Slightly bluer at night.
    var night = 1 - (world.daylight != null ? world.daylight : 1);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(2,7,13,' + (0.20 - night * 0.07).toFixed(3) + ')';
    ctx.fillRect(0, 0, W, H);

    // 2) Additive glow pass for food + organisms.
    ctx.globalCompositeOperation = 'lighter';

    // Food: faint drifting plankton.
    var food = world.food;
    ctx.fillStyle = 'rgba(90,150,170,0.5)';
    for (var i = 0; i < food.length; i++) {
      var f = food[i];
      ctx.beginPath();
      ctx.arc(f.x, f.y, 1.5, 0, 6.2832);
      ctx.fill();
    }

    // Organisms: halo + core.
    var orgs = world.organisms;
    for (var j = 0; j < orgs.length; j++) {
      var o = orgs[j];
      var col = this._hsl(o, world);
      var r = o.size;
      var flash = o.flash || 0;

      // soft halo
      ctx.globalAlpha = 0.18 + flash * 0.25;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(o.x, o.y, r * 2.3, 0, 6.2832);
      ctx.fill();

      // body
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(o.x, o.y, r, 0, 6.2832);
      ctx.fill();

      // bright nucleus (hints heading)
      ctx.globalAlpha = 0.9 + flash * 0.1;
      ctx.fillStyle = 'rgba(235,255,255,0.9)';
      var hx = Math.cos(o.heading), hy = Math.sin(o.heading);
      ctx.beginPath();
      ctx.arc(o.x + hx * r * 0.35, o.y + hy * r * 0.35, Math.max(1, r * 0.35), 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 3) Selection overlay (normal compositing).
    if (this.selected && this.selected.alive) {
      var s = this.selected;
      ctx.globalCompositeOperation = 'source-over';
      // sensor range
      ctx.strokeStyle = 'rgba(120,230,230,0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.sensorRange, 0, 6.2832);
      ctx.stroke();
      // selection ring
      ctx.strokeStyle = 'rgba(235,255,255,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size + 4, 0, 6.2832);
      ctx.stroke();
      // heading vector
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x + Math.cos(s.heading) * (s.size + 12), s.y + Math.sin(s.heading) * (s.size + 12));
      ctx.stroke();
    }
  };

  // Find the organism under a click (in world coords), within a small radius.
  Renderer.prototype.pick = function (world, x, y) {
    var best = null, bestD = Infinity;
    var orgs = world.organisms;
    for (var i = 0; i < orgs.length; i++) {
      var o = orgs[i];
      var dx = o.x - x, dy = o.y - y;
      var d = dx * dx + dy * dy;
      var rr = (o.size + 8) * (o.size + 8);
      if (d < rr && d < bestD) { bestD = d; best = o; }
    }
    return best;
  };

  TP.Renderer = Renderer;

  /*
   * drawBrain — paint an organism's neural-net weights as two heatmaps:
   * the input->hidden matrix (W1) and the hidden->output matrix (W2).
   * Red = excitatory (+), blue = inhibitory (-), brightness = magnitude.
   */
  TP.drawBrain = function (canvas, genome) {
    var ctx = canvas.getContext('2d');
    var O = TP.CONFIG.brainOffsets, B = TP.CONFIG.brain;
    var W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    function cell(v, x, y, w, h) {
      var m = Math.min(1, Math.abs(v) / 3);
      if (v >= 0) ctx.fillStyle = 'rgba(255,' + (90 - m * 60) + ',' + (110 - m * 80) + ',' + (0.15 + m * 0.85) + ')';
      else ctx.fillStyle = 'rgba(' + (90 - m * 60) + ',170,255,' + (0.15 + m * 0.85) + ')';
      ctx.fillRect(x, y, w - 1, h - 1);
    }

    // Layout: W1 block on the left (~62% width), W2 block on the right.
    var gap = 10;
    var w1w = Math.floor((W - gap) * 0.66);
    var cw1 = w1w / B.nIn, ch1 = H / B.nHid;
    for (var h = 0; h < B.nHid; h++)
      for (var i = 0; i < B.nIn; i++)
        cell(genome[O.W1 + h * B.nIn + i], i * cw1, h * ch1, cw1, ch1);

    var x0 = w1w + gap;
    var w2w = W - x0;
    var cw2 = w2w / B.nOut, ch2 = H / B.nHid;
    for (var hh = 0; hh < B.nHid; hh++)
      for (var o = 0; o < B.nOut; o++)
        cell(genome[O.W2 + o * B.nHid + hh], x0 + o * cw2, hh * ch2, cw2, ch2);
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
