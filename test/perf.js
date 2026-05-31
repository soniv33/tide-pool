'use strict';
// Stress test: push toward the hard cap and time steps; report directional drift.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = { Math, console, Float64Array, Array, JSON, Object, Infinity, isNaN, Date };
ctx.globalThis = ctx; vm.createContext(ctx);
for (const f of ['rng','config','genome','brain','spatial','organism','world'])
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','js',f+'.js'),'utf8'), ctx, {filename:f});

const world = new ctx.TP.World(1280, 800, { seed: 'perf', params: { foodRate: 6 } });
// Warm up to a big population.
for (let t=0;t<2500;t++) world.step();
console.log('warmup pop:', world.organisms.length, 'food:', world.food.length);

const N = 600;
const start = Date.now();
for (let t=0;t<N;t++) world.step();
const ms = (Date.now()-start)/N;
console.log(`avg step: ${ms.toFixed(3)} ms  (pop ~${world.organisms.length}) -> ~${(1000/ms).toFixed(0)} steps/s`);
console.log(`budget @60fps = 16.7ms/frame -> ~${Math.floor(16.7/ms)} sim steps per frame possible`);

const s = world.sampleStats();
console.log('size/speed/sensor/diet:', s.avgSize.toFixed(2), s.avgSpeed.toFixed(2), s.avgSensor.toFixed(1), s.avgDiet.toFixed(2), 'species:', s.species, 'gen:', s.maxGen);
