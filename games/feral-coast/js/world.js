'use strict';
// Isla Brava: terrain heightfield + chunked meshes, road network, points of interest, structures,
// colliders and spatially-hashed world raycasts.
FC.World = (function () {
  const SIZE = 1600, HALF = SIZE / 2, RES = 512, CELL = SIZE / RES, N = RES + 1;
  const H = new Float32Array(N * N);       // final heights
  const ROAD = new Float32Array(N * N);    // 0..1 road mask
  const GROUND = new Float32Array(N * N);  // 0..1 packed-dirt mask (camps / outposts / villages)

  const W = {
    SIZE, HALF, CELL, boxes: [], barrels: [], outposts: [], villages: [], towers: [], roads: [],
    ladders: [], shops: [], collectibles: [], mapCanvas: null, start: null, chunks: [],
  };

  // ------------------------------------------------------------------ points of interest
  const OUTPOSTS = [
    { name: 'Saltmarsh Dock', x: -160, z: 470, r: 28, grunts: 4, heavies: 0, snipers: 0, seed: 11 },
    { name: 'Cinder Quarry', x: 230, z: 455, r: 30, grunts: 4, heavies: 1, snipers: 0, seed: 22 },
    { name: 'Mangrove Pumpworks', x: -430, z: 240, r: 28, grunts: 5, heavies: 0, snipers: 1, seed: 33 },
    { name: 'Old Cannery', x: 470, z: 200, r: 30, grunts: 5, heavies: 1, snipers: 0, seed: 44 },
    { name: 'Sawtooth Lumberyard', x: -150, z: 160, r: 32, grunts: 5, heavies: 1, snipers: 1, seed: 66 },
    { name: 'Ridge Battery', x: 140, z: 40, r: 30, grunts: 6, heavies: 1, snipers: 1, seed: 77 },
    { name: 'Sulfur Springs', x: -470, z: -250, r: 30, grunts: 6, heavies: 1, snipers: 1, seed: 88 },
    { name: 'Black Pier', x: 470, z: -320, r: 30, grunts: 6, heavies: 2, snipers: 1, seed: 99 },
    { name: 'Gullet Pass', x: -90, z: -300, r: 32, grunts: 6, heavies: 2, snipers: 1, seed: 111 },
    { name: "Vael's Roost", x: 60, z: -540, r: 48, grunts: 9, heavies: 3, snipers: 2, boss: true, seed: 55 },
  ];
  const VILLAGES = [
    { name: 'Palmhaven', x: -330, z: 420, r: 26, link: 0 },
    { name: 'Tidewater', x: 360, z: 360, r: 26, link: 1 },
    { name: 'Cloudrest', x: -360, z: -60, r: 24, link: 4 },
    { name: 'Ironbark', x: 330, z: -110, r: 24, link: 5 },
  ];
  const TOWERS = [
    { name: 'Spire Delta', x: 40, z: 300 },
    { name: 'Spire Kestrel', x: -300, z: -170 },
    { name: 'Spire Halyard', x: 300, z: -250 },
  ];
  W.start = { name: 'Driftwood Camp', x: 30, z: 560, r: 18 };

  // ------------------------------------------------------------------ height function
  function rawHeight(x, z) {
    const wx = x + (FC.fbm(x * 0.0021 + 3, z * 0.0021, 3) - 0.5) * 300;
    const wz = z + (FC.fbm(x * 0.0021 - 7, z * 0.0021 + 5, 3) - 0.5) * 300;
    const d = Math.hypot(wx / 660, wz / 640);
    const land = 1 - FC.smoothstep(0.8, 1.0, d);
    const hills = FC.fbm(x * 0.006, z * 0.006, 5);
    const ridgeN = FC.fbm(x * 0.0045 + 40, z * 0.0045 - 12, 4);
    const ridge = 1 - Math.abs(ridgeN * 2 - 1);
    const md = Math.hypot((x - 10) / 420, (z + 160) / 330);
    const mtn = Math.pow(Math.max(0, 1 - md), 1.4);
    const small = FC.fbm(x * 0.03, z * 0.03, 3) * 2.5;
    return land * (2.2 + hills * hills * 26 + mtn * (25 + ridge * 85) + small) - (1 - land) * 16;
  }

  function idx(i, j) { return j * N + i; }

  function genHeights() {
    const flats = [];
    for (const op of OUTPOSTS) { op.y = FC.clamp(rawHeight(op.x, op.z), 3.5, 70); flats.push({ x: op.x, z: op.z, r: op.r + 4, y: op.y, f: 30 }); }
    for (const v of VILLAGES) { v.y = FC.clamp(rawHeight(v.x, v.z), 3, 50); flats.push({ x: v.x, z: v.z, r: v.r, y: v.y, f: 26 }); }
    for (const t of TOWERS) { t.y = FC.clamp(rawHeight(t.x, t.z), 4, 90); flats.push({ x: t.x, z: t.z, r: 10, y: t.y, f: 18 }); }
    const s = W.start; s.y = FC.clamp(rawHeight(s.x, s.z), 2.2, 4); flats.push({ x: s.x, z: s.z, r: s.r, y: s.y, f: 22 });
    for (let j = 0; j < N; j++) {
      const z = -HALF + j * CELL;
      for (let i = 0; i < N; i++) {
        const x = -HALF + i * CELL;
        let h = rawHeight(x, z), g = 0;
        for (const f of flats) {
          const dx = x - f.x, dz = z - f.z;
          if (Math.abs(dx) > f.r + f.f || Math.abs(dz) > f.r + f.f) continue;
          const d = Math.hypot(dx, dz);
          const w = 1 - FC.smoothstep(f.r, f.r + f.f, d);
          if (w > 0) h += (f.y - h) * w;
          g = Math.max(g, 1 - FC.smoothstep(f.r - 2, f.r + 3, d));
        }
        H[idx(i, j)] = h; GROUND[idx(i, j)] = g;
      }
    }
  }

  // ------------------------------------------------------------------ roads
  function buildRoads() {
    const nodes = [W.start].concat(VILLAGES, OUTPOSTS, TOWERS);
    // Prim MST + a few loop edges
    const inTree = [0], edges = [];
    while (inTree.length < nodes.length) {
      let best = null, bd = 1e9;
      for (const a of inTree) for (let b = 0; b < nodes.length; b++) {
        if (inTree.includes(b)) continue;
        const d = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].z - nodes[b].z);
        if (d < bd) { bd = d; best = [a, b]; }
      }
      edges.push(best); inTree.push(best[1]);
    }
    const has = (a, b) => edges.some((e) => (e[0] === a && e[1] === b) || (e[0] === b && e[1] === a));
    for (let a = 0; a < nodes.length; a++) {
      const ds = nodes.map((n, b) => ({ b, d: Math.hypot(nodes[a].x - n.x, nodes[a].z - n.z) })).filter((o) => o.b !== a).sort((p, q) => p.d - q.d);
      const c = ds[1];
      if (c && c.d < 330 && !has(a, c.b)) edges.push([a, c.b]);
    }
    const rng = FC.mulberry32(777);
    for (const [a, b] of edges) {
      const A = nodes[a], B = nodes[b];
      const d = Math.hypot(B.x - A.x, B.z - A.z), n = Math.max(2, Math.ceil(d / 9));
      const px = -(B.z - A.z) / d, pz = (B.x - A.x) / d;
      const seed = rng() * 100, amp = Math.min(70, d * 0.14);
      const pts = [];
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const off = (FC.fbm(seed + t * 3.1, seed * 0.7, 3) - 0.5) * 2 * amp * Math.sin(t * Math.PI);
        const x = FC.lerp(A.x, B.x, t) + px * off, z = FC.lerp(A.z, B.z, t) + pz * off;
        pts.push({ x, z, y: heightRaw(x, z) });
      }
      // smooth heights, keep above water
      for (let pass = 0; pass < 3; pass++) {
        for (let k = 1; k < pts.length - 1; k++) pts[k].y = (pts[k - 1].y + pts[k].y * 2 + pts[k + 1].y) / 4;
      }
      for (const p of pts) p.y = Math.max(p.y, 1.1);
      let len = 0; for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z);
      W.roads.push({ pts, len, a: A, b: B });
    }
    // carve into heightfield
    const RW = 3.4, BL = 9;
    const best = new Float32Array(N * N), target = new Float32Array(N * N);
    for (const road of W.roads) {
      const P = road.pts;
      for (let k = 0; k < P.length - 1; k++) {
        const a = P[k], b = P[k + 1];
        const minx = Math.min(a.x, b.x) - RW - BL, maxx = Math.max(a.x, b.x) + RW + BL;
        const minz = Math.min(a.z, b.z) - RW - BL, maxz = Math.max(a.z, b.z) + RW + BL;
        const i0 = Math.max(0, Math.floor((minx + HALF) / CELL)), i1 = Math.min(RES, Math.ceil((maxx + HALF) / CELL));
        const j0 = Math.max(0, Math.floor((minz + HALF) / CELL)), j1 = Math.min(RES, Math.ceil((maxz + HALF) / CELL));
        const sx = b.x - a.x, sz = b.z - a.z, sl = sx * sx + sz * sz || 1;
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const x = -HALF + i * CELL, z = -HALF + j * CELL;
          const t = FC.clamp(((x - a.x) * sx + (z - a.z) * sz) / sl, 0, 1);
          const d = Math.hypot(x - (a.x + sx * t), z - (a.z + sz * t));
          const w = 1 - FC.smoothstep(RW, RW + BL, d);
          const id = idx(i, j);
          if (w > best[id]) { best[id] = w; target[id] = a.y + (b.y - a.y) * t; }
          const rm = 1 - FC.smoothstep(RW - 1.2, RW + 1.2, d);
          if (rm > ROAD[id]) ROAD[id] = rm;
        }
      }
    }
    for (let id = 0; id < N * N; id++) if (best[id] > 0) H[id] += (target[id] - H[id]) * best[id];
  }
  function heightRaw(x, z) { return sample(x, z); }

  function sample(x, z) {
    const fx = (x + HALF) / CELL, fz = (z + HALF) / CELL;
    if (fx < 0 || fz < 0 || fx >= RES || fz >= RES) return -20;
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const A = H[idx(i, j)], D = H[idx(i + 1, j)], B = H[idx(i, j + 1)], C = H[idx(i + 1, j + 1)];
    if (tx + tz <= 1) return A + (D - A) * tx + (B - A) * tz;
    return C + (B - C) * (1 - tx) + (D - C) * (1 - tz);
  }
  const heightAt = sample;
  function slopeAt(x, z) {
    const e = 2;
    return Math.hypot(sample(x + e, z) - sample(x - e, z), sample(x, z + e) - sample(x, z - e)) / (2 * e);
  }
  function maskAt(arr, x, z) {
    const i = FC.clamp(Math.round((x + HALF) / CELL), 0, RES), j = FC.clamp(Math.round((z + HALF) / CELL), 0, RES);
    return arr[idx(i, j)];
  }

  // ------------------------------------------------------------------ terrain meshes
  function terrainMaterial() {
    const T = FC.Assets.tex;
    const noise = makeNoiseTexture();
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { tGrass: { value: T.grass }, tDirt: { value: T.dirt }, tRock: { value: T.stone }, tGravel: { value: T.gravel }, tNoise: { value: noise } });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 splat;\nvarying vec4 vSplat;\nvarying vec3 vWP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = splat;\nvWP = (modelMatrix * vec4(transformed,1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tGrass, tDirt, tRock, tGravel, tNoise;\nvarying vec4 vSplat;\nvarying vec3 vWP;')
        .replace('#include <map_fragment>', `
          vec2 uvw = vWP.xz;
          float macro = texture2D(tNoise, uvw * 0.0035).r;
          float micro = texture2D(tNoise, uvw * 0.05).r;
          vec3 g1 = texture2D(tGrass, uvw * 0.22).rgb;
          vec3 g2 = texture2D(tGrass, uvw * 0.061 + 0.37).rgb;
          vec3 grass = mix(g1, g2, 0.45) * mix(vec3(0.82, 0.95, 0.62), vec3(1.08, 1.0, 0.72), macro);
          vec3 dirt = texture2D(tDirt, uvw * 0.25).rgb * vec3(1.05, 0.95, 0.85);
          vec3 rock = texture2D(tRock, vec2(uvw.x + vWP.y, uvw.y + vWP.y * 0.7) * 0.12).rgb * (0.8 + macro * 0.4);
          vec3 sandT = texture2D(tGravel, uvw * 0.3).rgb;
          vec3 sand = mix(vec3(0.86, 0.78, 0.58), sandT * vec3(1.25, 1.12, 0.9), 0.35) * (0.92 + micro * 0.16);
          float wet = smoothstep(1.2, -0.4, vWP.y);
          sand *= mix(1.0, 0.62, wet);
          vec4 s = vSplat / max(0.001, dot(vSplat, vec4(1.0)));
          vec3 terr = sand * s.x + grass * s.y + dirt * s.z + rock * s.w;
          diffuseColor.rgb *= terr * (0.9 + micro * 0.2);
        `);
    };
    return mat;
  }
  function makeNoiseTexture() {
    const s = 256, c = document.createElement('canvas'); c.width = c.height = s;
    const ctx = c.getContext('2d'), img = ctx.createImageData(s, s);
    for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
      const v = FC.fbm(i / 18, j / 18, 4); // tileable enough at this scale for variation
      const o = (j * s + i) * 4; img.data[o] = img.data[o + 1] = img.data[o + 2] = Math.round(v * 255); img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  function buildTerrain(scene) {
    const mat = terrainMaterial();
    const CH = 32, NC = RES / CH;
    for (let cj = 0; cj < NC; cj++) for (let ci = 0; ci < NC; ci++) {
      let maxH = -1e9;
      for (let j = cj * CH; j <= (cj + 1) * CH; j += 4) for (let i = ci * CH; i <= (ci + 1) * CH; i += 4) maxH = Math.max(maxH, H[idx(i, j)]);
      if (maxH < -12) continue;
      const V = CH + 1, n = V * V;
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), spl = new Float32Array(n * 4);
      for (let lj = 0; lj < V; lj++) for (let li = 0; li < V; li++) {
        const i = ci * CH + li, j = cj * CH + lj, v = lj * V + li;
        const x = -HALF + i * CELL, z = -HALF + j * CELL, h = H[idx(i, j)];
        pos[v * 3] = x; pos[v * 3 + 1] = h; pos[v * 3 + 2] = z;
        const hl = H[idx(Math.max(0, i - 1), j)], hr = H[idx(Math.min(RES, i + 1), j)];
        const hd = H[idx(i, Math.max(0, j - 1))], hu = H[idx(i, Math.min(RES, j + 1))];
        const nx = hl - hr, nz = hd - hu, ny = 2 * CELL, nl = Math.hypot(nx, ny, nz);
        nor[v * 3] = nx / nl; nor[v * 3 + 1] = ny / nl; nor[v * 3 + 2] = nz / nl;
        const slope = Math.hypot(hr - hl, hu - hd) / (2 * CELL);
        const sand = 1 - FC.smoothstep(1.6, 3.2, h + FC.vnoise(x * 0.05, z * 0.05) * 1.2);
        const rock = Math.max(FC.smoothstep(0.62, 1.0, slope), FC.smoothstep(95, 120, h));
        const dirt = Math.max(ROAD[idx(i, j)], GROUND[idx(i, j)] * 0.85, FC.smoothstep(0.62, 0.8, FC.fbm(x * 0.02 + 9, z * 0.02, 2)) * 0.5);
        const grass = Math.max(0, 1 - sand - rock - dirt);
        spl[v * 4] = sand * (1 - rock); spl[v * 4 + 1] = grass; spl[v * 4 + 2] = dirt * (1 - sand * 0.6); spl[v * 4 + 3] = rock;
      }
      const index = [];
      for (let lj = 0; lj < CH; lj++) for (let li = 0; li < CH; li++) {
        const a = lj * V + li, d = a + 1, b = a + V, c = b + 1;
        index.push(a, b, d, b, c, d);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('splat', new THREE.BufferAttribute(spl, 4));
      geo.setIndex(index);
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, mat);
      m.receiveShadow = true; m.castShadow = true;
      scene.add(m);
      W.chunks.push(m);
    }
  }

  // ------------------------------------------------------------------ box spatial hash
  const BG = 32, bgrid = new Map();
  let stamp = 0;
  function bkey(i, j) { return i * 8192 + j; }
  function indexBox(b) {
    for (let i = Math.floor(b.minX / BG); i <= Math.floor(b.maxX / BG); i++) {
      for (let j = Math.floor(b.minZ / BG); j <= Math.floor(b.maxZ / BG); j++) {
        const k = bkey(i, j);
        if (!bgrid.has(k)) bgrid.set(k, []);
        bgrid.get(k).push(b);
      }
    }
  }
  function boxesIn(minx, minz, maxx, maxz, cb) {
    stamp++;
    for (let i = Math.floor(minx / BG); i <= Math.floor(maxx / BG); i++) {
      for (let j = Math.floor(minz / BG); j <= Math.floor(maxz / BG); j++) {
        const arr = bgrid.get(bkey(i, j));
        if (!arr) continue;
        for (const b of arr) { if (b._s === stamp) continue; b._s = stamp; cb(b); }
      }
    }
  }
  function addCollider(b) { W.boxes.push(b); indexBox(b); return b; }

  // round obstacles (trees, rocks)
  const GC = 12, cgrid = new Map();
  function gkey(i, j) { return i * 8192 + j; }
  function addCircle(x, z, r) {
    const k = gkey(Math.floor(x / GC), Math.floor(z / GC));
    if (!cgrid.has(k)) cgrid.set(k, []);
    cgrid.get(k).push({ x, z, r });
  }
  function queryCircles(x, z, rad, cb) {
    const i0 = Math.floor((x - rad - 3) / GC), i1 = Math.floor((x + rad + 3) / GC);
    const j0 = Math.floor((z - rad - 3) / GC), j1 = Math.floor((z + rad + 3) / GC);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const arr = cgrid.get(gkey(i, j));
      if (arr) for (const c of arr) cb(c);
    }
  }

  // ------------------------------------------------------------------ structure helpers
  const MAT = {};
  function mats() {
    const T = FC.Assets.tex;
    const S = (o) => new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.85, metalness: 0 }, o));
    MAT.wood = S({ map: T.wood, color: 0xb79a7a });
    MAT.plank = S({ map: T.wood, color: 0x8f6f52 });
    MAT.metal = S({ map: T.metal, color: 0xa8aeb4, roughness: 0.55, metalness: 0.4 });
    MAT.rust = S({ map: T.metal, color: 0xb0704a, roughness: 0.7, metalness: 0.3 });
    MAT.concrete = S({ map: T.concrete, color: 0xc7c2b8 });
    MAT.wall = S({ map: T.wall, color: 0xb9b2a5 });
    MAT.sand = S({ color: 0xbca878, roughness: 1 });
    MAT.thatch = S({ map: T.bark, color: 0xd6b56e, roughness: 1 });
    MAT.dark = S({ color: 0x2a2a2a });
    MAT.alarm = S({ color: 0xe2b42b, roughness: 0.5 });
    MAT.red = S({ color: 0x9c1a14, roughness: 0.6 });
    MAT.teal = S({ color: 0x23b38a, roughness: 0.6 });
    MAT.tower = S({ map: T.metal, color: 0x8d1f1a, roughness: 0.6, metalness: 0.4 });
    MAT.white = S({ color: 0xdedad2, roughness: 0.6, metalness: 0.2 });
    MAT.bulbOff = new THREE.MeshStandardMaterial({ color: 0x331111, emissive: 0x220000 });
    MAT.lamp = new THREE.MeshStandardMaterial({ color: 0xffe2a0, emissive: 0xffc070, emissiveIntensity: 3 });
  }
  const boxGeoCache = new Map();
  function texBoxGeo(w, h, d, scale) {
    const k = [w, h, d, scale].map((v) => v.toFixed(2)).join(',');
    if (boxGeoCache.has(k)) return boxGeoCache.get(k);
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * dims[f][0] / scale, uv.getY(i) * dims[f][1] / scale);
    }
    boxGeoCache.set(k, g);
    return g;
  }
  function addBox(scene, x, y, z, w, h, d, mat, collide, scale) {
    const m = new THREE.Mesh(texBoxGeo(w, h, d, scale || 2), mat);
    m.position.set(x, y + h / 2, z);
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    if (collide !== false) addCollider({ minX: x - w / 2, maxX: x + w / 2, minY: y, maxY: y + h, minZ: z - d / 2, maxZ: z + d / 2 });
    return m;
  }
  function beam(scene, a, b, r, mat) {
    const len = a.distanceTo(b);
    const m = new THREE.Mesh(texBoxGeo(r, len, r, 2), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    m.castShadow = true;
    scene.add(m);
    return m;
  }
  const roofGeo = new THREE.ConeGeometry(1, 1, 4); roofGeo.rotateY(Math.PI / 4);
  function pointBlocked(x, z, pad) {
    let hit = false;
    boxesIn(x - pad - 1, z - pad - 1, x + pad + 1, z + pad + 1, (b) => {
      if (x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad) hit = true;
    });
    return hit;
  }
  function hut(scene, x, y, z, w, d, h, rotated, roofMat, wallMat) {
    if (rotated) { const t = w; w = d; d = t; }
    addBox(scene, x, y, z, w, h, d, wallMat || MAT.wood);
    // stilts/base
    addBox(scene, x, y - 0.4, z, w + 0.4, 0.5, d + 0.4, MAT.plank, false);
    const r = new THREE.Mesh(roofGeo, roofMat || MAT.rust);
    r.scale.set(w * 0.84, 1.7, d * 0.84); r.position.set(x, y + h + 0.85, z);
    r.castShadow = true; scene.add(r);
    const door = new THREE.Mesh(texBoxGeo(1.1, 2.1, 0.12, 2), MAT.plank);
    const win = (px, py, pz, ry) => { const m = new THREE.Mesh(texBoxGeo(0.9, 0.7, 0.1, 2), MAT.dark); m.position.set(px, py, pz); m.rotation.y = ry; scene.add(m); };
    if (rotated) { door.rotation.y = Math.PI / 2; door.position.set(x + w / 2 + 0.05, y + 1.05, z); win(x - w / 2 - 0.05, y + 1.8, z, Math.PI / 2); }
    else { door.position.set(x, y + 1.05, z + d / 2 + 0.05); win(x + w / 4, y + 1.8, z - d / 2 - 0.05, 0); win(x - w / 4, y + 1.8, z - d / 2 - 0.05, 0); }
    scene.add(door);
  }
  function watchtower(scene, x, y, z) {
    for (const [dx, dz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) addBox(scene, x + dx, y, z + dz, 0.3, 6, 0.3, MAT.plank);
    addBox(scene, x, y + 6, z, 3.6, 0.3, 3.6, MAT.wood, false);
    for (const [dx, dz, w, d] of [[0, -1.7, 3.6, 0.12], [0, 1.7, 3.6, 0.12], [-1.7, 0, 0.12, 3.6], [1.7, 0, 0.12, 3.6]]) addBox(scene, x + dx, y + 6.3, z + dz, w, 1, d, MAT.plank, false);
    const r = new THREE.Mesh(roofGeo, MAT.thatch); r.scale.set(3.2, 1.3, 3.2); r.position.set(x, y + 9, z); r.castShadow = true; scene.add(r);
    for (const [dx, dz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) addBox(scene, x + dx, y + 6.3, z + dz, 0.14, 2.1, 0.14, MAT.plank, false);
    return { x, y: y + 6.3, z };
  }
  function lampPost(scene, x, y, z) {
    addBox(scene, x, y, z, 0.15, 4, 0.15, MAT.dark, false);
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), MAT.lamp);
    b.position.set(x, y + 4.1, z); scene.add(b);
    W.lamps.push(b);
  }
  W.lamps = [];
  function makeFlag(scene, x, y, z, color) {
    addBox(scene, x, y, z, 0.18, 10, 0.18, MAT.white);
    const flagMat = new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.9 });
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.7, 10, 2), flagMat);
    flag.position.set(x + 1.5, y + 9, z);
    flag.castShadow = true;
    scene.add(flag);
    return flag;
  }
  function prop(scene, name, x, y, z, opts) {
    const m = FC.Assets.propMesh(name, opts);
    m.position.set(x, y, z);
    if (opts && opts.rot !== undefined) m.rotation.y = opts.rot;
    scene.add(m);
    if (opts && opts.collide) {
      m.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(m);
      const pad = opts.collidePad || 0;
      addCollider({ minX: bb.min.x + pad, maxX: bb.max.x - pad, minY: bb.min.y, maxY: bb.max.y, minZ: bb.min.z + pad, maxZ: bb.max.z - pad });
    }
    return m;
  }
  function barrel(scene, x, y, z) {
    const mesh = prop(scene, 'barrel', x, y, z, { height: 1.15, materials: [W.barrelMat] });
    W.barrels.push({ x, y, z, hp: 25, exploded: false, mesh });
  }
  function shopAt(x, z, y, kind) { W.shops.push({ x, z, y, kind }); }

  function buildOutpost(scene, op) {
    const rng = FC.mulberry32(op.seed);
    const y = op.y;
    op.flag = makeFlag(scene, op.x, y, op.z, 0x8e1b1b);
    op.liberated = false; op.alarmTriggered = false; op.alarmSabotaged = false;
    op.supply = { x: op.x - 2.6, z: op.z + 1.8 };
    prop(scene, 'chest', op.supply.x, y, op.supply.z, { length: 1.3, collide: true });
    op.lookouts = [];
    if (op.boss) {
      const s = 38, gap = 6;
      const wall = (x, z, w, d) => addBox(scene, x, y, z, w, 4, d, MAT.wall, true, 3);
      wall(op.x, op.z - s, s * 2, 1.4);
      wall(op.x - (s + gap) / 2, op.z + s, s - gap, 1.4); wall(op.x + (s + gap) / 2, op.z + s, s - gap, 1.4);
      wall(op.x + s, op.z - (s + gap) / 2, 1.4, s - gap); wall(op.x + s, op.z + (s + gap) / 2, 1.4, s - gap);
      wall(op.x - s, op.z - (s + gap) / 2, 1.4, s - gap); wall(op.x - s, op.z + (s + gap) / 2, 1.4, s - gap);
      hut(scene, op.x - 22, y, op.z - 24, 9, 7, 3.8, false, MAT.rust, MAT.concrete);
      hut(scene, op.x + 22, y, op.z - 24, 9, 7, 3.8, false, MAT.rust, MAT.concrete);
      hut(scene, op.x - 24, y, op.z + 16, 8, 6, 3.4, true, MAT.rust, MAT.wood);
      hut(scene, op.x + 24, y, op.z + 16, 8, 6, 3.4, true, MAT.rust, MAT.wood);
      addBox(scene, op.x, y, op.z - 15, 12, 5.5, 8, MAT.concrete, true, 3);
      prop(scene, 'dish', op.x + 3, y + 5.5, op.z - 15, { height: 4 });
      prop(scene, 'hangar', op.x + 18, y, op.z + 2, { length: 13, rot: Math.PI / 2, collide: true, collidePad: 0.5 });
      for (const [dx, dz] of [[-33, -33], [33, -33], [-33, 33], [33, 33]]) op.lookouts.push(watchtower(scene, op.x + dx, y, op.z + dz));
      for (const [dx, dz] of [[-10, 30], [10, 30], [-30, 0], [30, -10]]) lampPost(scene, op.x + dx, y, op.z + dz);
    } else {
      const nH = 2 + (rng() < 0.6 ? 1 : 0);
      for (let k = 0; k < nH; k++) {
        const a = (k / nH) * Math.PI * 2 + rng() * 0.6;
        hut(scene, op.x + Math.cos(a) * op.r * 0.52, y, op.z + Math.sin(a) * op.r * 0.52, 5.5 + rng() * 2, 4.5 + rng() * 2, 3.3, rng() < 0.5, rng() < 0.5 ? MAT.rust : MAT.metal, rng() < 0.3 ? MAT.concrete : MAT.wood);
      }
      const ta = rng() * Math.PI * 2;
      op.lookouts.push(watchtower(scene, op.x + Math.cos(ta) * op.r * 0.78, y, op.z + Math.sin(ta) * op.r * 0.78));
      if (rng() < 0.6) {
        const ga = ta + Math.PI * 0.8;
        prop(scene, 'generator', op.x + Math.cos(ga) * op.r * 0.6, y, op.z + Math.sin(ga) * op.r * 0.6, { length: 2.2, collide: true });
      }
      for (let k = 0; k < 3; k++) {
        const a = rng() * Math.PI * 2, rr = op.r * 0.7;
        const x = op.x + Math.cos(a) * rr, z = op.z + Math.sin(a) * rr;
        if (!pointBlocked(x, z, 1.5)) lampPost(scene, x, y, z);
      }
    }
    // sandbags
    for (let k = 0; k < (op.boss ? 8 : 5); k++) {
      const a = rng() * Math.PI * 2, rr = op.r * (op.boss ? 0.45 : 0.84);
      const x = op.x + Math.cos(a) * rr, z = op.z + Math.sin(a) * rr;
      if (pointBlocked(x, z, 2.6)) continue;
      if (Math.abs(Math.cos(a)) > Math.abs(Math.sin(a))) addBox(scene, x, y, z, 0.9, 1.0, 4, MAT.sand);
      else addBox(scene, x, y, z, 4, 1.0, 0.9, MAT.sand);
    }
    // fence fragments
    for (let k = 0; k < 6; k++) {
      const a = rng() * Math.PI * 2, rr = op.r + 2;
      const x = op.x + Math.cos(a) * rr, z = op.z + Math.sin(a) * rr;
      if (!pointBlocked(x, z, 1)) prop(scene, 'fence', x, sample(x, z), z, { length: 3, rot: -a + Math.PI / 2 });
    }
    // crates / barrels / tents
    for (let k = 0; k < 5; k++) {
      const a = rng() * Math.PI * 2, rr = 4 + rng() * op.r * 0.6;
      const x = op.x + Math.cos(a) * rr, z = op.z + Math.sin(a) * rr;
      if (pointBlocked(x, z, 1.5)) continue;
      addBox(scene, x, y, z, 1.2, 1.2, 1.2, MAT.plank, true, 1.2);
      if (rng() < 0.5) addBox(scene, x + 0.1, y + 1.2, z, 1.0, 1.0, 1.0, MAT.plank, true, 1.0);
    }
    for (let k = 0; k < 2; k++) {
      const a = rng() * Math.PI * 2, rr = op.r * 0.35;
      const x = op.x + Math.cos(a) * rr, z = op.z + Math.sin(a) * rr;
      if (!pointBlocked(x, z, 2.5)) prop(scene, 'tent', x, y, z, { length: 3.6, rot: rng() * 6, collide: true, collidePad: 0.4 });
    }
    const nB = op.boss ? 6 : 2 + Math.floor(rng() * 2);
    for (let k = 0; k < nB; k++) {
      for (let t = 0; t < 12; t++) {
        const a = rng() * Math.PI * 2, rr = 5 + rng() * op.r * 0.6;
        const x = op.x + Math.cos(a) * rr, z = op.z + Math.sin(a) * rr;
        if (pointBlocked(x, z, 1.2)) continue;
        barrel(scene, x, y, z); break;
      }
    }
    // alarm
    for (let t = 0; t < 30; t++) {
      const a = rng() * Math.PI * 2, rr = 6 + rng() * op.r * 0.4;
      const x = op.x + Math.cos(a) * rr, z = op.z + Math.sin(a) * rr;
      if (pointBlocked(x, z, 1.6)) continue;
      addBox(scene, x, y, z, 0.2, 1.4, 0.2, MAT.dark);
      addBox(scene, x, y + 1.2, z, 0.7, 0.6, 0.35, MAT.alarm, false);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), MAT.bulbOff.clone());
      bulb.position.set(x, y + 2.0, z); scene.add(bulb);
      op.alarm = { x, z, y, bulb };
      break;
    }
    op.patrol = [];
    for (let t = 0; t < 300 && op.patrol.length < 12; t++) {
      const a = rng() * Math.PI * 2, rr = rng() * op.r * 0.9;
      const x = op.x + Math.cos(a) * rr, z = op.z + Math.sin(a) * rr;
      if (!pointBlocked(x, z, 1.2)) op.patrol.push({ x, z });
    }
  }

  function buildVillage(scene, v) {
    const rng = FC.mulberry32(Math.round(v.x * 13 + v.z));
    const y = v.y;
    const n = 5;
    v.homes = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rng() * 0.4, rr = v.r * 0.65;
      const x = v.x + Math.cos(a) * rr, z = v.z + Math.sin(a) * rr;
      hut(scene, x, y + 0.6, z, 5 + rng() * 1.5, 4 + rng() * 1.5, 2.8, rng() < 0.5, MAT.thatch, MAT.plank);
      v.homes.push({ x, z });
    }
    prop(scene, 'campfire', v.x, y, v.z, { length: 1.6 });
    v.fire = { x: v.x, y: y + 0.3, z: v.z };
    v.shop = { x: v.x + 4, z: v.z - 3 };
    prop(scene, 'chest', v.shop.x, y, v.shop.z, { length: 1.3, collide: true });
    for (let k = 0; k < 4; k++) {
      const a = rng() * Math.PI * 2, rr = v.r * 0.3;
      prop(scene, 'log', v.x + Math.cos(a) * rr, y, v.z + Math.sin(a) * rr, { length: 2, rot: a });
    }
    lampPost(scene, v.x + 6, y, v.z + 5);
    v.wander = [];
    for (let t = 0; t < 100 && v.wander.length < 8; t++) {
      const a = rng() * Math.PI * 2, rr = rng() * v.r;
      const x = v.x + Math.cos(a) * rr, z = v.z + Math.sin(a) * rr;
      if (!pointBlocked(x, z, 1)) v.wander.push({ x, z });
    }
  }

  function buildTower(scene, t) {
    const y = t.y, h = 36, s = 2.2;
    t.h = h; t.hacked = false;
    const legs = [[-s, -s], [s, -s], [s, s], [-s, s]];
    for (const [dx, dz] of legs) {
      const m = new THREE.Mesh(texBoxGeo(0.35, h, 0.35, 2), MAT.tower);
      m.position.set(t.x + dx, y + h / 2, t.z + dz); m.castShadow = true; scene.add(m);
    }
    addCollider({ minX: t.x - s - 0.2, maxX: t.x + s + 0.2, minY: y, maxY: y + h, minZ: t.z - s - 0.2, maxZ: t.z + s + 0.2 });
    for (let k = 0; k < h; k += 6) {
      for (let e = 0; e < 4; e++) {
        const a = legs[e], b = legs[(e + 1) % 4];
        beam(scene, new THREE.Vector3(t.x + a[0], y + k, t.z + a[1]), new THREE.Vector3(t.x + b[0], y + k + 6, t.z + b[1]), 0.15, k % 12 ? MAT.white : MAT.tower);
      }
    }
    addBox(scene, t.x, y + h, t.z, 6, 0.35, 6, MAT.metal);
    for (const [dx, dz, w, d] of [[0, -3, 6, 0.1], [-3, 0, 0.1, 6], [3, 0, 0.1, 6]]) addBox(scene, t.x + dx, y + h + 0.35, t.z + dz, w, 1.1, d, MAT.metal, false);
    prop(scene, 'dish', t.x - 1.5, y + h + 0.35, t.z - 1.5, { height: 3 });
    const blink = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), new THREE.MeshStandardMaterial({ color: 0xff3020, emissive: 0xff2010, emissiveIntensity: 4 }));
    blink.position.set(t.x, y + h + 6, t.z); scene.add(blink);
    addBox(scene, t.x, y + h + 0.35, t.z, 0.15, 5.6, 0.15, MAT.dark, false);
    t.blink = blink;
    // ladder on +z face
    const lz = t.z + s + 0.45;
    for (const dx of [-0.35, 0.35]) addBox(scene, t.x + dx, y, lz, 0.08, h + 1.2, 0.08, MAT.dark, false);
    for (let k = 0.4; k < h + 1; k += 0.45) addBox(scene, t.x, y + k, lz, 0.7, 0.05, 0.05, MAT.dark, false);
    W.ladders.push({ x: t.x, z: lz + 0.35, y0: y, y1: y + h + 0.35, exit: { x: t.x, z: t.z + 1.2 }, face: 0 });
    t.console = { x: t.x + 1.6, z: t.z - 1.6, y: y + h + 0.35 };
    addBox(scene, t.console.x, t.console.y, t.console.z, 0.8, 1.1, 0.5, MAT.dark);
    t.screen = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.4), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff3322, emissiveIntensity: 1.5 }));
    t.screen.position.set(t.console.x, t.console.y + 0.85, t.console.z + 0.26); scene.add(t.screen);
  }

  function buildStart(scene) {
    const s = W.start, y = s.y;
    prop(scene, 'tent', s.x - 6, y, s.z + 4, { length: 4.2, rot: 0.4, collide: true, collidePad: 0.5 });
    prop(scene, 'tent', s.x + 7, y, s.z + 5, { length: 3.6, rot: -0.5, collide: true, collidePad: 0.5 });
    s.flag = makeFlag(scene, s.x + 3, y, s.z - 4, 0x23b38a);
    s.supply = { x: s.x + 2, z: s.z + 3 };
    prop(scene, 'chest', s.supply.x, y, s.supply.z, { length: 1.3, collide: true });
    prop(scene, 'campfire', s.x - 1, y, s.z - 1, { length: 1.6 });
    prop(scene, 'log', s.x - 3, y, s.z - 2, { length: 2.2, rot: 1.2 });
    prop(scene, 'log', s.x + 1, y, s.z - 3.5, { length: 2.2, rot: 0.2 });
    s.fire = { x: s.x - 1, y: y + 0.3, z: s.z - 1 };
    lampPost(scene, s.x + 5, y, s.z - 1);
  }

  function buildMap() {
    const px = 512, c = document.createElement('canvas');
    c.width = c.height = px;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(px, px);
    for (let j = 0; j < px; j++) for (let i = 0; i < px; i++) {
      const x = -HALF + (i + 0.5) * SIZE / px, z = -HALF + (j + 0.5) * SIZE / px;
      const h = sample(x, z);
      let r, g, b;
      if (h < 0) { const k = FC.clamp(-h / 14, 0, 1); r = 52 - 30 * k; g = 150 - 60 * k; b = 172 - 40 * k; }
      else if (h < 2.2) { r = 222; g = 204; b = 150; }
      else {
        const k = FC.clamp(h / 110, 0, 1), sl = slopeAt(x, z);
        const shade = FC.clamp(1 - (sample(x + 3, z + 3) - h) * 0.08, 0.7, 1.25);
        r = (78 + 110 * k) * shade; g = (128 + 40 * k) * shade; b = (64 + 90 * k) * shade;
        if (sl > 0.8) { r = 130 * shade; g = 122 * shade; b = 112 * shade; }
      }
      const o = (j * px + i) * 4;
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    ctx.strokeStyle = 'rgba(120,84,50,0.9)'; ctx.lineWidth = 2;
    const k = px / SIZE;
    for (const r of W.roads) {
      ctx.beginPath();
      r.pts.forEach((p, i) => { const X = (p.x + HALF) * k, Y = (p.z + HALF) * k; if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
      ctx.stroke();
    }
    W.mapCanvas = c;
  }

  // ------------------------------------------------------------------ raycasts / collision
  function rayTerrain(ox, oy, oz, dx, dy, dz, maxT) {
    let prevT = 0;
    const step = 1.5;
    for (let t = step; ; t += step) {
      const tt = Math.min(t, maxT);
      const x = ox + dx * tt, y = oy + dy * tt, z = oz + dz * tt;
      if (y < sample(x, z)) {
        let a = prevT, b = tt;
        for (let k = 0; k < 6; k++) { const m = (a + b) / 2; if (oy + dy * m < sample(ox + dx * m, oz + dz * m)) b = m; else a = m; }
        return b;
      }
      prevT = tt;
      if (tt >= maxT) return Infinity;
    }
  }
  function raycast(ox, oy, oz, dx, dy, dz, maxT) {
    let best = rayTerrain(ox, oy, oz, dx, dy, dz, maxT), kind = best < Infinity ? 'terrain' : null;
    const ex = ox + dx * Math.min(maxT, best), ez = oz + dz * Math.min(maxT, best);
    boxesIn(Math.min(ox, ex), Math.min(oz, ez), Math.max(ox, ex), Math.max(oz, ez), (b) => {
      const t = FC.rayBox(ox, oy, oz, dx, dy, dz, b);
      if (t < best && t <= maxT) { best = t; kind = 'box'; }
    });
    return { t: best, kind };
  }
  function los(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.01) return true;
    const r = raycast(ax, ay, az, dx / d, dy / d, dz / d, d - 0.3);
    return r.t >= d - 0.3;
  }
  function collide(pos, radius, feetY, height) {
    queryCircles(pos.x, pos.z, radius, (c) => {
      const dx = pos.x - c.x, dz = pos.z - c.z, d = Math.hypot(dx, dz), m = c.r + radius;
      if (d < m && d > 1e-4) { pos.x = c.x + (dx / d) * m; pos.z = c.z + (dz / d) * m; }
    });
    let hit = false;
    boxesIn(pos.x - radius - 1, pos.z - radius - 1, pos.x + radius + 1, pos.z + radius + 1, (b) => {
      if (feetY >= b.maxY - 0.45 || feetY + height <= b.minY) return;
      const cx = FC.clamp(pos.x, b.minX, b.maxX), cz = FC.clamp(pos.z, b.minZ, b.maxZ);
      const dx = pos.x - cx, dz = pos.z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) return;
      hit = true;
      if (d2 > 1e-8) { const d = Math.sqrt(d2); pos.x = cx + (dx / d) * radius; pos.z = cz + (dz / d) * radius; }
      else {
        const pen = [pos.x - b.minX, b.maxX - pos.x, pos.z - b.minZ, b.maxZ - pos.z];
        const k = pen.indexOf(Math.min(...pen));
        if (k === 0) pos.x = b.minX - radius; else if (k === 1) pos.x = b.maxX + radius;
        else if (k === 2) pos.z = b.minZ - radius; else pos.z = b.maxZ + radius;
      }
    });
    return hit;
  }
  function groundAt(x, z, feetY, radius) {
    let g = sample(x, z);
    boxesIn(x - radius - 1, z - radius - 1, x + radius + 1, z + radius + 1, (b) => {
      if (x > b.minX - radius * 0.5 && x < b.maxX + radius * 0.5 && z > b.minZ - radius * 0.5 && z < b.maxZ + radius * 0.5 && feetY >= b.maxY - 0.45 && b.maxY > g) g = b.maxY;
    });
    return g;
  }
  function nearestRoadPoint(x, z) {
    let best = null, bd = 1e9;
    for (const r of W.roads) for (let k = 0; k < r.pts.length; k++) {
      const p = r.pts[k], d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bd) { bd = d; best = { road: r, k, p }; }
    }
    return best;
  }

  function build(scene) {
    mats();
    W.barrelMat = [new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.5, metalness: 0.3 })];
    // barrel model may have several materials; use red for all of them
    const bm = FC.Assets.staticModel('barrel');
    W.barrelMat = bm.materials.map(() => W.barrelMat[0]);
    genHeights();
    buildRoads();
    buildTerrain(scene);
    W.outposts = OUTPOSTS; W.villages = VILLAGES; W.towers = TOWERS;
    for (const op of OUTPOSTS) buildOutpost(scene, op);
    for (const v of VILLAGES) buildVillage(scene, v);
    for (const t of TOWERS) buildTower(scene, t);
    buildStart(scene);
    buildMap();
  }

  return Object.assign(W, {
    build, heightAt, slopeAt, raycast, los, collide, groundAt, pointBlocked, queryCircles, addCircle,
    roadAt: (x, z) => maskAt(ROAD, x, z), groundMaskAt: (x, z) => maskAt(GROUND, x, z), nearestRoadPoint, boxesIn,
    isReserved(x, z, pad) {
      for (const op of OUTPOSTS) if (Math.hypot(x - op.x, z - op.z) < op.r + pad) return true;
      for (const v of VILLAGES) if (Math.hypot(x - v.x, z - v.z) < v.r + pad) return true;
      for (const t of TOWERS) if (Math.hypot(x - t.x, z - t.z) < 8 + pad) return true;
      return Math.hypot(x - W.start.x, z - W.start.z) < W.start.r + pad;
    },
    landPoint(cx, cz, minR, maxR) {
      for (let t = 0; t < 80; t++) {
        const a = Math.random() * Math.PI * 2, r = FC.rand(minR, maxR);
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        if (sample(x, z) > 1.2 && !pointBlocked(x, z, 1)) return { x, z };
      }
      return { x: cx, z: cz };
    },
  });
})();
