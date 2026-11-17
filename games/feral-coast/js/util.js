'use strict';
// Shared helpers: seeded RNG, value noise, math.
window.FC = window.FC || {};
(function (FC) {
  FC.mulberry32 = function (seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  FC.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  FC.lerp = (a, b, t) => a + (b - a) * t;
  FC.smoothstep = (a, b, x) => {
    const t = FC.clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  FC.wrapAngle = (a) => {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  };
  FC.rand = (a, b) => a + Math.random() * (b - a);
  FC.pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  // Yaw such that forward (-sin y, -cos y) points along (dx, dz).
  FC.yawTo = (dx, dz) => Math.atan2(-dx, -dz);
  FC.turnTowards = (cur, target, maxStep) => {
    const d = FC.wrapAngle(target - cur);
    if (Math.abs(d) <= maxStep) return target;
    return cur + Math.sign(d) * maxStep;
  };

  // ---- value noise ----
  const rng = FC.mulberry32(9127);
  const perm = new Uint8Array(512);
  const p = [];
  for (let i = 0; i < 256; i++) p.push(i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) vals[i] = rng();
  function lattice(ix, iz) { return vals[perm[perm[ix & 255] + (iz & 255)]]; }
  FC.vnoise = function (x, z) {
    const xi = Math.floor(x), zi = Math.floor(z);
    const xf = x - xi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
    const a = lattice(xi, zi), b = lattice(xi + 1, zi);
    const c = lattice(xi, zi + 1), d = lattice(xi + 1, zi + 1);
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  };
  FC.fbm = function (x, z, oct) {
    oct = oct || 4;
    let s = 0, amp = 0.5, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) {
      s += amp * FC.vnoise(x * f + i * 17.3, z * f - i * 9.1);
      norm += amp; amp *= 0.5; f *= 2.03;
    }
    return s / norm;
  };

  // ---- ray primitives ----
  // returns t or Infinity
  FC.raySphere = function (ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
    const lx = ox - cx, ly = oy - cy, lz = oz - cz;
    const b = lx * dx + ly * dy + lz * dz;
    const c = lx * lx + ly * ly + lz * lz - r * r;
    const disc = b * b - c;
    if (disc < 0) return Infinity;
    const t = -b - Math.sqrt(disc);
    return t >= 0 ? t : Infinity;
  };
  // vertical cylinder from y0 to y1
  FC.rayCyl = function (ox, oy, oz, dx, dy, dz, cx, cz, r, y0, y1) {
    const lx = ox - cx, lz = oz - cz;
    const a = dx * dx + dz * dz;
    if (a < 1e-8) return Infinity;
    const b = lx * dx + lz * dz;
    const c = lx * lx + lz * lz - r * r;
    const disc = b * b - a * c;
    if (disc < 0) return Infinity;
    const t = (-b - Math.sqrt(disc)) / a;
    if (t < 0) return Infinity;
    const y = oy + dy * t;
    return y >= y0 && y <= y1 ? t : Infinity;
  };
  FC.rayBox = function (ox, oy, oz, dx, dy, dz, b) {
    let tmin = 0, tmax = Infinity;
    const o = [ox, oy, oz], d = [dx, dy, dz];
    const mn = [b.minX, b.minY, b.minZ], mx = [b.maxX, b.maxY, b.maxZ];
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) {
        if (o[i] < mn[i] || o[i] > mx[i]) return Infinity;
      } else {
        let t1 = (mn[i] - o[i]) / d[i], t2 = (mx[i] - o[i]) / d[i];
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return Infinity;
      }
    }
    return tmin;
  };
})(window.FC);
