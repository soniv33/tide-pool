/*
 * ui.js — Wires the DOM controls, the inspector panel, and pointer interaction
 * to the simulation. Holds no simulation logic of its own; it reads and writes
 * the shared `app` state object created in main.js.
 */
(function (root) {
  'use strict';
  var TP = root.TP || (root.TP = {});
  var $ = function (id) { return document.getElementById(id); };

  function UI(app) {
    this.app = app;
    this.selected = null;
    this._toastTimer = null;
    this.bind();
  }

  UI.prototype.bind = function () {
    var app = this.app, self = this;
    var world = app.world;

    // ---- Transport -------------------------------------------------------
    var btnPlay = $('btnPlay');
    btnPlay.onclick = function () {
      app.paused = !app.paused;
      btnPlay.textContent = app.paused ? '► Play' : '❚❚ Pause';
      btnPlay.classList.toggle('primary', !app.paused);
    };
    $('btnReset').onclick = function () { app.restart($('inSeed').value); self.toast('world reseeded'); };

    var rngSpeed = $('rngSpeed');
    rngSpeed.oninput = function () { app.simSpeed = +rngSpeed.value; $('valSpeed').textContent = rngSpeed.value + '×'; };

    $('btnApplySeed').onclick = function () { app.restart($('inSeed').value); self.toast('seed “' + $('inSeed').value + '”'); };
    $('inSeed').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('btnApplySeed').click(); });

    // ---- Live parameter sliders -----------------------------------------
    // Values are shown as plain words (with the exact number in parentheses) so
    // it's always obvious what a setting means without knowing the model's units.
    bindSlider('rngFood', 'valFood', function (v) { world.params.foodRate = v; },
      function (v) { return word(v, [[0.01, 'none'], [4, 'scarce'], [9, 'normal'], [16, 'plenty'], [99, 'lush']], v.toFixed(1)); });
    bindSlider('rngMut', 'valMut', function (v) { world.params.mutationMult = v; },
      function (v) { return word(v, [[0.01, 'frozen'], [0.6, 'slow'], [1.6, 'normal'], [3, 'fast'], [99, 'wild']], v.toFixed(1) + '×'); });
    bindSlider('rngDensity', 'valDensity', function (v) { world.params.density = v; },
      function (v) { return word(v, [[0.7, 'sparse'], [1.4, 'normal'], [2, 'packed'], [99, 'teeming']], v.toFixed(1) + '×'); });

    // Map a value to the first label whose threshold it falls under, annotated
    // with the raw number so power users still see the exact setting.
    function word(v, table, raw) {
      for (var i = 0; i < table.length; i++) if (v < table[i][0]) return table[i][1] + ' (' + raw + ')';
      return table[table.length - 1][1] + ' (' + raw + ')';
    }

    function bindSlider(rngId, valId, apply, fmt) {
      var el = $(rngId);
      el.oninput = function () { var v = +el.value; apply(v); $(valId).textContent = fmt(v); };
    }

    // ---- Toggles ---------------------------------------------------------
    $('chkPredation').onchange = function () { world.params.predation = this.checked; };
    $('chkSexual').onchange = function () { world.params.sexual = this.checked; };
    $('chkDayNight').onchange = function () { world.params.dayNight = this.checked; };
    $('chkSpont').onchange = function () { world.params.spontaneous = this.checked; };
    $('chkAudio').onchange = function () { app.audio.setEnabled(this.checked); };

    $('selColor').onchange = function () { app.renderer.colorMode = this.value; };

    // ---- Big red buttons -------------------------------------------------
    $('btnExtinction').onclick = function () {
      world.massExtinction(0.9);
      self.toast('mass extinction — ' + world.organisms.length + ' survivors');
    };

    // ---- Inspector close / export / inject -------------------------------
    $('btnCloseInsp').onclick = function () { self.select(null); };
    $('btnExportSel').onclick = function () { self.exportSelected(); };
    $('btnInjectSel').onclick = function () { $('fileInject').click(); };
    $('fileInject').onchange = function (e) { self.loadGenomeFile(e.target.files[0]); e.target.value = ''; };

    // ---- Pointer interaction on the canvas -------------------------------
    var canvas = app.renderer.canvas;
    var dropping = false;
    canvas.addEventListener('pointerdown', function (e) {
      var p = pos(e);
      var hit = app.renderer.pick(world, p.x, p.y);
      if (hit) { self.select(hit); dropping = false; }
      else { dropping = true; world.dropFood(p.x, p.y, 5); }
    });
    canvas.addEventListener('pointermove', function (e) {
      if (dropping && (e.buttons & 1)) { var p = pos(e); world.dropFood(p.x, p.y, 2, 10); }
    });
    root.addEventListener('pointerup', function () { dropping = false; });

    function pos(e) {
      var r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    // ---- Keyboard shortcuts ---------------------------------------------
    root.addEventListener('keydown', function (e) {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); btnPlay.click(); }
      else if (e.key === 'x' || e.key === 'X') $('btnExtinction').click();
      else if (e.key === 'Escape') self.select(null);
    });

    // Sync every slider's word-label to its starting value, and apply that value
    // to the world, so the panel and simulation agree from the first frame.
    ['rngFood', 'rngMut', 'rngDensity'].forEach(function (id) { $(id).oninput(); });
    rngSpeed.oninput();
  };

  // ---- Selection & inspector ---------------------------------------------

  UI.prototype.select = function (org) {
    this.selected = org;
    this.app.renderer.selected = org;
    var panel = $('inspector');
    if (!org) { panel.classList.add('hidden'); return; }
    panel.classList.remove('hidden');
    $('inspName').textContent = 'organism #' + org.id;
    this.renderGenes(org);
    TP.drawBrain($('brainCanvas'), org.genome);
    this.refreshInspector();
  };

  UI.prototype.refreshInspector = function () {
    var o = this.selected;
    if (!o) return;
    if (!o.alive) { $('inspName').textContent = 'organism #' + o.id + ' (deceased)'; }
    $('inspEnergy').textContent = o.energy.toFixed(0) + ' / ' + o.reproThreshold.toFixed(0);
    $('inspAge').textContent = o.age;
    $('inspOff').textContent = o.offspring;
    $('inspGenN').textContent = o.generation;
    $('inspLin').textContent = '#' + o.lineageId;
    $('inspDiet').textContent = o.diet < 0.33 ? 'herbivore' : o.diet > 0.66 ? 'predator' : 'omnivore';
  };

  UI.prototype.renderGenes = function (o) {
    var box = $('inspGenes');
    box.innerHTML = '';
    var genes = TP.CONFIG.genes;
    for (var i = 0; i < genes.length; i++) {
      var spec = genes[i];
      var norm = o.genome[i];
      var real = spec.min + (spec.max - spec.min) * norm;
      var row = document.createElement('div');
      row.className = 'gene';
      var val = spec.name === 'hue' ? Math.round(real) + '°' :
                (spec.max <= 1.001 ? real.toFixed(2) : real.toFixed(1));
      row.innerHTML = '<span class="gn">' + spec.name + '</span>' +
        '<span class="gbar"><i style="width:' + (norm * 100).toFixed(0) + '%"></i></span>' +
        '<span class="gv">' + val + '</span>';
      box.appendChild(row);
    }
  };

  // ---- Export / inject ----------------------------------------------------

  UI.prototype.exportSelected = function () {
    var o = this.selected;
    if (!o) return;
    var json = TP.Genome.toJSON(o.genome, {
      id: o.id, generation: o.generation, lineage: o.lineageId,
      hue: Math.round(o.hue), savedAtTick: this.app.world.tick, seed: this.app.world.rng.seedString
    });
    var blob = new Blob([json], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'tidepool-organism-' + o.id + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    this.toast('exported organism #' + o.id);
  };

  UI.prototype.loadGenomeFile = function (file) {
    if (!file) return;
    var self = this, reader = new FileReader();
    reader.onload = function () {
      try {
        var genome = TP.Genome.fromJSON(reader.result);
        var o = self.app.world.injectGenome(genome);
        self.select(o);
        self.toast('injected genome (' + genome.length + ' genes)');
      } catch (err) {
        self.toast('inject failed: ' + err.message);
      }
    };
    reader.readAsText(file);
  };

  // ---- HUD + toast --------------------------------------------------------

  UI.prototype.updateHUD = function (stats, fps) {
    if (!stats) return;
    $('hudPop').textContent = stats.population;
    $('hudSpecies').textContent = stats.species;
    $('hudPred').textContent = stats.predators + ':' + stats.prey;
    $('hudGen').textContent = stats.maxGen;
    $('hudLineage').textContent = stats.oldestLineageId != null
      ? '#' + stats.oldestLineageId + ' (' + Math.round(stats.oldestLineageAge / 60) + 'ky)'
      : '—';
    $('hudFood').textContent = stats.foodCount;
    $('hudTick').textContent = stats.tick;
    $('hudFps').textContent = fps.toFixed(0);
    var d = this.app.world.daylight;
    $('hudDay').textContent = !this.app.world.params.dayNight ? '—' : d > 0.75 ? 'day' : d < 0.45 ? 'night' : 'dusk';
  };

  UI.prototype.toast = function (msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 2200);
  };

  TP.UI = UI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
