/*
 * headless.js — Run the TIDE POOL simulation core in Node (no DOM) to verify
 * the energy economy produces a living, evolving ecosystem before any rendering
 * exists. Loads the browser scripts into one shared VM context.
 *
 *   node test/headless.js [seed] [ticks]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = { Math, console, Float64Array, Array, JSON, Object, Infinity, isNaN };
ctx.globalThis = ctx;
vm.createContext(ctx);

const files = ['rng', 'config', 'genome', 'brain', 'spatial', 'organism', 'world'];
for (const f of files) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8');
  vm.runInContext(src, ctx, { filename: f + '.js' });
}

const seed = process.argv[2] || 'reef-01';
const ticks = parseInt(process.argv[3] || '6000', 10);

const world = new ctx.TP.World(1200, 800, { seed });
console.log(`seed=${seed}  ticks=${ticks}  genomeLen=${ctx.TP.CONFIG.GENOME_LEN}\n`);

const header = ['tick', 'pop', 'food', 'species', 'gen', 'avgDiet', 'pred', 'avgAge', 'avgEng', 'lineageAge'];
console.log(header.map(s => s.padStart(9)).join(''));

let extinctFired = false;
for (let t = 1; t <= ticks; t++) {
  world.step();
  if (t === Math.floor(ticks * 0.6) && !extinctFired) {
    world.massExtinction(0.9);
    extinctFired = true;
  }
  if (t % Math.floor(ticks / 24) === 0 || t === 1) {
    const s = world.sampleStats();
    let avgAge = 0, avgEng = 0;
    for (const o of world.organisms) { avgAge += o.age; avgEng += o.energy; }
    const n = world.organisms.length || 1;
    const row = [
      t, s.population, s.foodCount, s.species, s.maxGen,
      s.avgDiet.toFixed(2), s.predators, (avgAge / n).toFixed(0),
      (avgEng / n).toFixed(0), s.oldestLineageAge
    ];
    console.log(row.map(v => String(v).padStart(9)).join(''));
  }
  if (world.organisms.length === 0 && !world.params.spontaneous) {
    console.log('  >>> total extinction at tick', t);
    break;
  }
}

// Quick sanity assertions.
const finalPop = world.organisms.length;
console.log('\nfinal population:', finalPop, '| max generation:', world.lastStats.maxGen);
if (finalPop < 5) console.log('WARN: population collapsed.');
if (world.lastStats.maxGen < 5) console.log('WARN: very few generations — little evolution happening.');
