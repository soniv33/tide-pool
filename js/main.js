/*
 * main.js — Boot the world, own the animation loop, and glue the pieces
 * together. The loop is time-budgeted: at high sim speeds it runs as many ticks
 * as fit in a frame's worth of milliseconds, so the UI never locks up even with
 * hundreds of organisms running at 50×.
 */
(function (root) {
  'use strict';
  var TP = root.TP;

  function boot() {
    var canvas = document.getElementById('world');
    var w = root.innerWidth, h = root.innerHeight;

    var world = new TP.World(w, h, { seed: TP.CONFIG.defaults.seed });
    var renderer = new TP.Renderer(canvas);
    renderer.resize(w, h);
    var charts = new TP.Charts({ pop: 'chartPop', traits: 'chartTraits', bio: 'chartBio', pred: 'chartPred' });
    var audio = new TP.Audio();

    // Shared application state handed to the UI.
    var app = {
      world: world, renderer: renderer, charts: charts, audio: audio,
      paused: false, simSpeed: 1,
      restart: function (seed) {
        world.reset(seed);
        if (ui) ui.select(null);
      },
      toast: function (m) { if (ui) ui.toast(m); }
    };

    var ui = new TP.UI(app);

    // Keep canvas + world sized to the window.
    root.addEventListener('resize', function () {
      var W = root.innerWidth, H = root.innerHeight;
      renderer.resize(W, H);
      world.resize(W, H);
    });

    // ---- The loop --------------------------------------------------------
    var FRAME_BUDGET = 12;       // ms/frame we're willing to spend on stepping
    var lastStatTick = -1;
    var fps = 60, lastT = performance.now(), frameCount = 0, fpsAccum = 0;

    function frame(now) {
      // Step the simulation (budgeted).
      if (!app.paused) {
        var start = performance.now();
        var steps = 0;
        while (steps < app.simSpeed) {
          world.step();
          steps++;
          if (performance.now() - start > FRAME_BUDGET) break; // protect framerate
        }
      }

      // Render the world every frame regardless (trails keep flowing).
      renderer.draw(world);

      // Sonify whatever happened since last frame.
      var events = world.drainEvents();
      if (events.length) audio.play(events, now | 0);

      // FPS (smoothed).
      var dt = now - lastT; lastT = now;
      fpsAccum += dt; frameCount++;
      if (fpsAccum > 400) { fps = 1000 / (fpsAccum / frameCount); fpsAccum = 0; frameCount = 0; }

      // Throttle the heavier UI/chart updates to stat samples or ~every frame.
      var stats = world.lastStats || world.sampleStats();
      ui.updateHUD(stats, fps);
      ui.refreshInspector();
      if (world.tick !== lastStatTick) { charts.draw(world); lastStatTick = world.tick; }

      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    // Expose for debugging / console tinkering.
    root.TIDEPOOL = app;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
