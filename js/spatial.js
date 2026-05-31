/*
 * spatial.js — Uniform spatial hash grid for fast neighbour queries.
 *
 * The world is toroidal (wraps at the edges), so the grid wraps too. We rebuild
 * the grid every tick (cheap: just bucketing points) and query a 3x3 block of
 * cells around a position. This turns the otherwise O(n^2) "nearest food /
 * nearest organism" searches into roughly O(n), which is what lets us hold
 * hundreds of organisms at 60fps.
 */
(function (root) {
  'use strict';
  var TP = root.TP || (root.TP = {});

  function SpatialHash(width, height, cellSize) {
    this.configure(width, height, cellSize);
  }

  SpatialHash.prototype.configure = function (width, height, cellSize) {
    this.width = width;
    this.height = height;
    this.cell = cellSize;
    this.cols = Math.max(1, Math.ceil(width / cellSize));
    this.rows = Math.max(1, Math.ceil(height / cellSize));
    this.buckets = new Array(this.cols * this.rows);
    for (var i = 0; i < this.buckets.length; i++) this.buckets[i] = [];
  };

  SpatialHash.prototype.clear = function () {
    var b = this.buckets;
    for (var i = 0; i < b.length; i++) if (b[i].length) b[i].length = 0;
  };

  SpatialHash.prototype._index = function (x, y) {
    var cx = Math.floor(x / this.cell) % this.cols;
    var cy = Math.floor(y / this.cell) % this.rows;
    if (cx < 0) cx += this.cols;
    if (cy < 0) cy += this.rows;
    return cy * this.cols + cx;
  };

  // Insert any object that has .x and .y.
  SpatialHash.prototype.insert = function (obj) {
    this.buckets[this._index(obj.x, obj.y)].push(obj);
  };

  // Visit every object within `range` of (x,y), accounting for wrap. The
  // callback receives (obj, wrappedDx, wrappedDy, distSq). We pass deltas so
  // callers don't recompute wrapped geometry.
  SpatialHash.prototype.forNeighbors = function (x, y, range, cb) {
    var cell = this.cell, cols = this.cols, rows = this.rows;
    var W = this.width, H = this.height;
    var reach = Math.ceil(range / cell);
    var ccx = Math.floor(x / cell);
    var ccy = Math.floor(y / cell);
    var rangeSq = range * range;
    var halfW = W * 0.5, halfH = H * 0.5;

    for (var gx = -reach; gx <= reach; gx++) {
      for (var gy = -reach; gy <= reach; gy++) {
        var cx = (ccx + gx) % cols; if (cx < 0) cx += cols;
        var cy = (ccy + gy) % rows; if (cy < 0) cy += rows;
        var bucket = this.buckets[cy * cols + cx];
        for (var k = 0; k < bucket.length; k++) {
          var o = bucket[k];
          // Shortest signed delta on a torus.
          var dx = o.x - x;
          if (dx > halfW) dx -= W; else if (dx < -halfW) dx += W;
          var dy = o.y - y;
          if (dy > halfH) dy -= H; else if (dy < -halfH) dy += H;
          var d2 = dx * dx + dy * dy;
          if (d2 <= rangeSq) cb(o, dx, dy, d2);
        }
      }
    }
  };

  TP.SpatialHash = SpatialHash;
})(typeof globalThis !== 'undefined' ? globalThis : this);
