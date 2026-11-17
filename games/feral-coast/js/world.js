'use strict';
// Island generation: terrain, foliage, outposts, colliders and world raycasts.
FC.World = (function () {
  const SIZE = 720, HALF = SIZE / 2, RES = 240, CELL = SIZE / RES, N = RES + 1;
  const H = new Float32Array(N * N);

  const W = {
    SIZE, HALF, boxes: [], bushes: [], barrels: [], outposts: [], crates: [],
    start: { x: 0, z: 214, r: 14, y: 2 }, mapCanvas: null, bushMesh: null,
  };

  const OUTPOSTS = [
    { name: 'Saltmarsh Dock', x: -120, z: 140, r: 28, grunts: 4, heavies: 0, seed: 11 },
    { name: 'Cinder Quarry', x: 112, z: 122, r: 30, grunts: 4, heavies: 1, seed: 22 },
    { name: 'Radio Hill', x: -150, z: -30, r: 28, grunts: 5, heavies: 1, seed: 33 },
    { name: 'Old Cannery', x: 150, z: -50, r: 30, grunts: 5, heavies: 1, seed: 44 },
    { name: "Vael's Roost", x: 0, z: -185, r: 44, grunts: 7, heavies: 2, boss: true, seed: 55 },
  ];

  function rawHeight(x, z) {
    const d = Math.hypot(x, z * 1.08) / 340;
    const n = FC.fbm(x * 0.006 + 10, z * 0.006 - 4, 4);
    const coast = d + (n - 0.5) * 0.35;
    const land = 1 - FC.smoothstep(0.62, 0.92, coast);
    const hills = FC.fbm(x * 0.012, z * 0.012, 5);
    const mtn = Math.max(0, 1 - Math.hypot(x - 40, z + 40) / 150);
    return land * (2.2 + hills * hills * 26 + mtn * mtn * 48) - (1 - land) * 10;
  }

  function genHeights() {
    const flats = OUTPOSTS.concat([W.start]);
    for (const op of OUTPOSTS) op.y = FC.clamp(rawHeight(op.x, op.z), 3, 26);
    W.start.y = FC.clamp(rawHeight(W.start.x, W.start.z), 1.8, 4);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = -HALF + i * CELL, z = -HALF + j * CELL;
        let h = rawHeight(x, z);
        for (const op of flats) {
          const w = 1 - FC.smoothstep(op.r, op.r + 26, Math.hypot(x - op.x, z - op.z));
          if (w > 0) h = h + (op.y - h) * w;
        }
        H[j * N + i] = h;
      }
    }
  }

  function heightAt(x, z) {
    const fx = (x + HALF) / CELL, fz = (z + HALF) / CELL;
    if (fx < 0 || fz < 0 || fx >= RES || fz >= RES) return -15;
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const A = H[j * N + i], D = H[j * N + i + 1], B = H[(j + 1) * N + i], C = H[(j + 1) * N + i + 1];
    if (tx + tz <= 1) return A + (D - A) * tx + (B - A) * tz;
    return C + (B - C) * (1 - tx) + (D - C) * (1 - tz);
  }
  function slopeAt(x, z) {
    const e = 1.5;
    return Math.hypot(heightAt(x + e, z) - heightAt(x - e, z), heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
  }

  // ---------- spatial grid for round obstacles ----------
  const GC = 12; const grid = new Map();
  function gkey(i, j) { return i * 4096 + j; }
  function addCircle(x, z, r, data) {
    const c = { x, z, r, data };
    const k = gkey(Math.floor(x / GC), Math.floor(z / GC));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(c);
    return c;
  }
  function queryCircles(x, z, rad, cb) {
    const i0 = Math.floor((x - rad - 3) / GC), i1 = Math.floor((x + rad + 3) / GC);
    const j0 = Math.floor((z - rad - 3) / GC), j1 = Math.floor((z + rad + 3) / GC);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const arr = grid.get(gkey(i, j));
      if (arr) for (const c of arr) cb(c);
    }
  }

  // ---------- geometry helpers ----------
  function mergeParts(parts) {
    // parts: [{geo, color:[r,g,b], m: Matrix4}]
    let total = 0;
    const prepared = parts.map((p) => {
      const g = (p.geo.index ? p.geo.toNonIndexed() : p.geo.clone());
      g.applyMatrix4(p.m || new THREE.Matrix4());
      total += g.attributes.position.count;
      return { g, color: p.color };
    });
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
    let o = 0;
    for (const p of prepared) {
      const n = p.g.attributes.position.count;
      pos.set(p.g.attributes.position.array, o * 3);
      p.g.computeVertexNormals();
      nor.set(p.g.attributes.normal.array, o * 3);
      for (let i = 0; i < n; i++) { col[(o + i) * 3] = p.color[0]; col[(o + i) * 3 + 1] = p.color[1]; col[(o + i) * 3 + 2] = p.color[2]; }
      o += n;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    return geo;
  }
  const M = (x, y, z, rx, ry, rz, sx, sy, sz) => {
    const m = new THREE.Matrix4();
    m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0, 'YXZ')),
      new THREE.Vector3(sx || 1, sy || 1, sz || 1));
    return m;
  };

  function palmGeo() {
    const parts = [];
    for (let k = 0; k < 4; k++) {
      const y = k * 1.8;
      const off = Math.pow(y / 7, 2) * 1.3;
      parts.push({ geo: new THREE.CylinderGeometry(0.2 - k * 0.02, 0.24 - k * 0.02, 1.9, 6), color: [0.5 - k * 0.03, 0.38, 0.25], m: M(off, y + 0.95, 0, 0, 0, -0.08 * k) });
    }
    const leaf = new THREE.BoxGeometry(0.7, 0.05, 3.4); leaf.translate(0, 0, -1.7);
    for (let k = 0; k < 7; k++) {
      const g = k % 2 ? 0.48 : 0.56;
      parts.push({ geo: leaf, color: [0.2, g, 0.18], m: M(1.3, 7.2, 0, -0.45 - (k % 3) * 0.12, k * (Math.PI * 2 / 7), 0) });
    }
    parts.push({ geo: new THREE.IcosahedronGeometry(0.35, 0), color: [0.35, 0.25, 0.12], m: M(1.3, 6.9, 0) });
    return mergeParts(parts);
  }
  function jungleGeo() {
    return mergeParts([
      { geo: new THREE.CylinderGeometry(0.25, 0.45, 6, 6), color: [0.42, 0.32, 0.22], m: M(0, 3, 0) },
      { geo: new THREE.IcosahedronGeometry(2.8, 0), color: [0.16, 0.38, 0.15], m: M(0, 6.8, 0, 0, 0, 0, 1.1, 0.8, 1.1) },
      { geo: new THREE.IcosahedronGeometry(2.0, 0), color: [0.2, 0.45, 0.17], m: M(0.8, 8.4, 0.4, 0.4, 0.3, 0) },
      { geo: new THREE.IcosahedronGeometry(1.8, 0), color: [0.18, 0.42, 0.16], m: M(-1.2, 7.6, -0.6, 0.2, 0.9, 0) },
    ]);
  }
  function bushGeo() {
    return mergeParts([
      { geo: new THREE.IcosahedronGeometry(1.0, 0), color: [0.22, 0.48, 0.18], m: M(0, 0.55, 0, 0, 0, 0, 1.2, 0.8, 1.2) },
      { geo: new THREE.IcosahedronGeometry(0.75, 0), color: [0.26, 0.54, 0.2], m: M(0.6, 0.8, 0.3, 0.5, 0, 0) },
      { geo: new THREE.IcosahedronGeometry(0.7, 0), color: [0.2, 0.44, 0.16], m: M(-0.5, 0.7, -0.4, 0, 0.6, 0) },
    ]);
  }

  // ---------- terrain ----------
  function buildTerrain(scene) {
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, RES, RES);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v), z = pos.getZ(v);
      const i = Math.round((x + HALF) / CELL), j = Math.round((z + HALF) / CELL);
      const h = H[j * N + i];
      pos.setY(v, h);
      const c = groundColor(x, z, h);
      col[v * 3] = c[0]; col[v * 3 + 1] = c[1]; col[v * 3 + 2] = c[2];
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    scene.add(mesh);
  }
  function groundColor(x, z, h) {
    const n = FC.vnoise(x * 0.08, z * 0.08);
    if (h < -2) return [0.42, 0.45, 0.38];
    if (h < 0.6) return [0.74, 0.66, 0.47];
    if (h < 1.9) return [0.86, 0.78, 0.56];
    for (const op of OUTPOSTS.concat([W.start])) {
      const d = Math.hypot(x - op.x, z - op.z);
      if (d < op.r + 2) return [0.5 + n * 0.05, 0.41, 0.29];
    }
    const s = slopeAt(x, z);
    if (s > 0.85 || h > 46) return [0.47 + n * 0.06, 0.44, 0.39];
    if (h < 2.6) return [0.6, 0.66, 0.4];
    const g = 0.48 + n * 0.12 - h * 0.002;
    return [0.24 + n * 0.08, g, 0.17];
  }

  function buildSea(scene) {
    const water = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2),
      new THREE.MeshPhongMaterial({ color: 0x1d8fae, transparent: true, opacity: 0.82, shininess: 90, specular: 0x88bbdd }));
    water.position.y = 0;
    scene.add(water);
    W.water = water;
    // sky dome
    const sky = new THREE.SphereGeometry(1500, 24, 14);
    const sc = new Float32Array(sky.attributes.position.count * 3);
    for (let i = 0; i < sky.attributes.position.count; i++) {
      const y = sky.attributes.position.getY(i) / 1500;
      const t = FC.clamp(y, 0, 1);
      const top = [0.28, 0.52, 0.86], hor = [0.98, 0.84, 0.64];
      const k = Math.pow(t, 0.5);
      sc[i * 3] = FC.lerp(hor[0], top[0], k); sc[i * 3 + 1] = FC.lerp(hor[1], top[1], k); sc[i * 3 + 2] = FC.lerp(hor[2], top[2], k);
    }
    sky.setAttribute('color', new THREE.BufferAttribute(sc, 3));
    scene.add(new THREE.Mesh(sky, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })));
    const sun = new THREE.Mesh(new THREE.CircleGeometry(60, 24), new THREE.MeshBasicMaterial({ color: 0xfff1c8, fog: false }));
    sun.position.set(-900, 380, 600); sun.lookAt(0, 0, 0);
    scene.add(sun);
  }

  // ---------- props ----------
  function nearReserved(x, z, pad) {
    for (const op of OUTPOSTS) if (Math.hypot(x - op.x, z - op.z) < op.r + pad) return true;
    return Math.hypot(x - W.start.x, z - W.start.z) < W.start.r + pad + 6;
  }
  function scatter(scene) {
    const rng = FC.mulberry32(4242);
    const dummy = new THREE.Object3D();
    const place = (count, tries, minH, maxH, maxSlope, pad, extra) => {
      const out = [];
      for (let t = 0; t < tries && out.length < count; t++) {
        const x = (rng() * 2 - 1) * (HALF - 20), z = (rng() * 2 - 1) * (HALF - 20);
        const h = heightAt(x, z);
        if (h < minH || h > maxH) continue;
        if (nearReserved(x, z, pad)) continue;
        if (slopeAt(x, z) > maxSlope) continue;
        if (extra && !extra(x, z, h, rng)) continue;
        out.push({ x, z, h });
      }
      return out;
    };
    const palms = place(950, 20000, 0.9, 12, 0.9, 6, (x, z, h, r) => r() < (h < 6 ? 0.9 : 0.35));
    const jungle = place(750, 20000, 6, 44, 0.8, 6, (x, z, h, r) => FC.fbm(x * 0.02, z * 0.02, 2) > 0.45 && r() < 0.8);
    const bushes = place(1100, 16000, 1.4, 40, 0.9, 4);
    for (const op of OUTPOSTS) {
      for (let k = 0; k < 14; k++) {
        const a = rng() * Math.PI * 2, rr = op.r + 3 + rng() * 14;
        const x = op.x + Math.cos(a) * rr, z = op.z + Math.sin(a) * rr, h = heightAt(x, z);
        if (h > 1) bushes.push({ x, z, h });
      }
    }
    const rocks = place(320, 6000, 0.5, 60, 2, 4);

    const inst = (geo, list, scaleFn, colliderR, store) => {
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      const c = new THREE.Color();
      list.forEach((p, i) => {
        const s = scaleFn(p);
        dummy.position.set(p.x, p.h - 0.15, p.z);
        dummy.rotation.set(0, rng() * Math.PI * 2, 0);
        dummy.scale.set(s, s * (0.9 + rng() * 0.25), s);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        const v = 0.85 + rng() * 0.3;
        mesh.setColorAt(i, c.setRGB(v, v, v));
        p.s = s; p.i = i;
        if (colliderR) addCircle(p.x, p.z, colliderR * s, store ? p : null);
        if (store) store.push(p);
      });
      mesh.instanceMatrix.needsUpdate = true;
      scene.add(mesh);
      return mesh;
    };
    inst(palmGeo(), palms, () => 0.85 + rng() * 0.45, 0.35);
    inst(jungleGeo(), jungle, () => 0.8 + rng() * 0.5, 0.5);
    const bushStore = [];
    W.bushMesh = inst(bushGeo(), bushes, () => 0.8 + rng() * 0.6, 0, bushStore);
    W.bushes = bushStore;
    for (const b of W.bushes) { b.burnt = false; b.matrix = new THREE.Matrix4(); W.bushMesh.getMatrixAt(b.i, b.matrix); }
    W.bushGrid = new Map();
    for (const b of W.bushes) {
      const k = gkey(Math.floor(b.x / GC), Math.floor(b.z / GC));
      if (!W.bushGrid.has(k)) W.bushGrid.set(k, []);
      W.bushGrid.get(k).push(b);
    }
    const rockGeo = mergeParts([{ geo: new THREE.DodecahedronGeometry(1, 0), color: [0.52, 0.5, 0.46], m: M(0, 0.3, 0, 0, 0, 0, 1.3, 0.8, 1) }]);
    inst(rockGeo, rocks, () => 0.6 + rng() * 1.6, 1.0);
  }

  function bushesNear(x, z, r, cb) {
    const i0 = Math.floor((x - r) / GC), i1 = Math.floor((x + r) / GC);
    const j0 = Math.floor((z - r) / GC), j1 = Math.floor((z + r) / GC);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const arr = W.bushGrid.get(gkey(i, j));
      if (arr) for (const b of arr) if (!b.burnt && Math.hypot(b.x - x, b.z - z) < r) cb(b);
    }
  }
  function inBush(x, z) {
    let found = false;
    bushesNear(x, z, 1.9, () => { found = true; });
    return found;
  }
  function burnBush(b) {
    b.burnt = true;
    const m = new THREE.Matrix4().makeScale(0, 0, 0);
    W.bushMesh.setMatrixAt(b.i, m);
    W.bushMesh.instanceMatrix.needsUpdate = true;
  }

  // ---------- structures ----------
  const MAT = {};
  function mats() {
    const L = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
    MAT.wood = L(0x8a6644); MAT.darkWood = L(0x5e4430); MAT.metal = L(0x8b9096); MAT.rust = L(0x9a5a3a);
    MAT.sand = L(0xb8a77a); MAT.concrete = L(0x9d978c); MAT.crate = L(0x6f6a3e); MAT.barrel = L(0xb3261e);
    MAT.supply = L(0x2f7d4f); MAT.alarm = L(0xe2b42b); MAT.dark = L(0x2a2a2a); MAT.canvas = L(0x2c9c8f);
    MAT.pole = L(0xcfcfcf);
  }
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const roofGeo = new THREE.ConeGeometry(1, 1, 4); roofGeo.rotateY(Math.PI / 4);
  function addBox(scene, x, y, z, w, h, d, mat, collide) {
    const m = new THREE.Mesh(boxGeo, mat);
    m.scale.set(w, h, d); m.position.set(x, y + h / 2, z);
    scene.add(m);
    if (collide !== false) W.boxes.push({ minX: x - w / 2, maxX: x + w / 2, minY: y, maxY: y + h, minZ: z - d / 2, maxZ: z + d / 2 });
    return m;
  }
  function pointBlocked(x, z, pad) {
    for (const b of W.boxes) if (x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad) return true;
    return false;
  }
  function hut(scene, x, y, z, w, d, h, rotated) {
    if (rotated) { const t = w; w = d; d = t; }
    addBox(scene, x, y, z, w, h, d, MAT.wood);
    const r = new THREE.Mesh(roofGeo, MAT.rust);
    r.scale.set(w * 0.82, 1.6, d * 0.82); r.position.set(x, y + h + 0.8, z);
    scene.add(r);
    // door
    const door = new THREE.Mesh(boxGeo, MAT.darkWood);
    if (rotated) { door.scale.set(0.1, 2, 1.1); door.position.set(x + w / 2 + 0.03, y + 1, z); }
    else { door.scale.set(1.1, 2, 0.1); door.position.set(x, y + 1, z + d / 2 + 0.03); }
    scene.add(door);
  }
  function tower(scene, x, y, z) {
    for (const [dx, dz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) addBox(scene, x + dx, y, z + dz, 0.3, 5.5, 0.3, MAT.darkWood);
    addBox(scene, x, y + 5.5, z, 3.4, 0.3, 3.4, MAT.wood, false);
    addBox(scene, x, y + 5.8, z - 1.6, 3.4, 1, 0.15, MAT.wood, false);
    const r = new THREE.Mesh(roofGeo, MAT.rust); r.scale.set(2.8, 1.2, 2.8); r.position.set(x, y + 8, z); scene.add(r);
    for (const [dx, dz] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) addBox(scene, x + dx, y + 5.8, z + dz, 0.15, 1.6, 0.15, MAT.darkWood, false);
  }
  function makeFlag(scene, x, y, z, color) {
    addBox(scene, x, y, z, 0.18, 9, 0.18, MAT.pole);
    const flagMat = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide });
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.6, 6, 1), flagMat);
    flag.position.set(x + 1.4, y + 8, z);
    scene.add(flag);
    return flag;
  }
  function barrel(scene, x, y, z) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.1, 10), MAT.barrel);
    m.position.set(x, y + 0.55, z); scene.add(m);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.12, 10), MAT.alarm);
    band.position.set(x, y + 0.7, z); scene.add(band);
    W.barrels.push({ x, y, z, hp: 25, exploded: false, mesh: m, band });
  }

  function buildOutpost(scene, op) {
    const rng = FC.mulberry32(op.seed);
    const y = op.y;
    op.flag = makeFlag(scene, op.x, y, op.z, 0x8e1b1b);
    op.liberated = false;
    op.alarmTriggered = false; op.alarmSabotaged = false;
    // supply crate next to flag
    addBox(scene, op.x - 2.2, y, op.z + 1.5, 1.4, 0.9, 0.9, MAT.supply);
    op.supply = { x: op.x - 2.2, z: op.z + 1.5 };
    if (op.boss) {
      const s = 36, gap = 5;
      const wall = (x, z, w, d) => addBox(scene, x, y, z, w, 3.4, d, MAT.concrete);
      // north wall full, south / east / west with gates
      wall(op.x, op.z - s, s * 2, 1.2);
      wall(op.x - (s + gap) / 2, op.z + s, s - gap, 1.2); wall(op.x + (s + gap) / 2, op.z + s, s - gap, 1.2);
      wall(op.x + s, op.z - (s + gap) / 2, 1.2, s - gap); wall(op.x + s, op.z + (s + gap) / 2, 1.2, s - gap);
      wall(op.x - s, op.z - (s + gap) / 2, 1.2, s - gap); wall(op.x - s, op.z + (s + gap) / 2, 1.2, s - gap);
      hut(scene, op.x - 20, y, op.z - 22, 8, 6, 3.6, false);
      hut(scene, op.x + 20, y, op.z - 22, 8, 6, 3.6, false);
      hut(scene, op.x - 22, y, op.z + 14, 7, 5, 3.4, true);
      hut(scene, op.x + 22, y, op.z + 14, 7, 5, 3.4, true);
      addBox(scene, op.x, y, op.z - 14, 10, 5, 7, MAT.concrete); // command bunker
      tower(scene, op.x - 31, y, op.z - 31); tower(scene, op.x + 31, y, op.z - 31);
      tower(scene, op.x - 31, y, op.z + 31); tower(scene, op.x + 31, y, op.z + 31);
    } else {
      const nH = 2 + (rng() < 0.5 ? 1 : 0);
      for (let k = 0; k < nH; k++) {
        const a = (k / nH) * Math.PI * 2 + rng() * 0.6;
        hut(scene, op.x + Math.cos(a) * op.r * 0.5, y, op.z + Math.sin(a) * op.r * 0.5, 5 + rng() * 2, 4 + rng() * 2, 3.2, rng() < 0.5);
      }
      const ta = rng() * Math.PI * 2;
      tower(scene, op.x + Math.cos(ta) * op.r * 0.75, y, op.z + Math.sin(ta) * op.r * 0.75);
    }
    // sandbag walls
    const nS = op.boss ? 6 : 5;
    for (let k = 0; k < nS; k++) {
      const a = rng() * Math.PI * 2, rr = op.r * (op.boss ? 0.45 : 0.82);
      const x = op.x + Math.cos(a) * rr, z = op.z + Math.sin(a) * rr;
      if (pointBlocked(x, z, 2.5)) continue;
      if (Math.abs(Math.cos(a)) > Math.abs(Math.sin(a))) addBox(scene, x, y, z, 0.9, 1.0, 4, MAT.sand);
      else addBox(scene, x, y, z, 4, 1.0, 0.9, MAT.sand);
    }
    // crates and barrels
    for (let k = 0; k < 4; k++) {
      const a = rng() * Math.PI * 2, rr = 4 + rng() * op.r * 0.6;
      const x = op.x + Math.cos(a) * rr, z = op.z + Math.sin(a) * rr;
      if (pointBlocked(x, z, 1.5)) continue;
      addBox(scene, x, y, z, 1.2, 1.2, 1.2, MAT.crate);
      if (rng() < 0.5) addBox(scene, x + 0.1, y + 1.2, z, 1.0, 1.0, 1.0, MAT.crate);
    }
    const nB = op.boss ? 5 : 2 + Math.floor(rng() * 2);
    for (let k = 0; k < nB; k++) {
      for (let t = 0; t < 10; t++) {
        const a = rng() * Math.PI * 2, rr = 5 + rng() * op.r * 0.6;
        const x = op.x + Math.cos(a) * rr, z = op.z + Math.sin(a) * rr;
        if (pointBlocked(x, z, 1.2)) continue;
        barrel(scene, x, y, z); break;
      }
    }
    // alarm box
    for (let t = 0; t < 20; t++) {
      const a = rng() * Math.PI * 2, rr = 6 + rng() * op.r * 0.4;
      const x = op.x + Math.cos(a) * rr, z = op.z + Math.sin(a) * rr;
      if (pointBlocked(x, z, 1.5)) continue;
      addBox(scene, x, y, z, 0.2, 1.4, 0.2, MAT.dark);
      addBox(scene, x, y + 1.2, z, 0.7, 0.6, 0.35, MAT.alarm, false);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: 0x661111 }));
      bulb.position.set(x, y + 2.0, z); scene.add(bulb);
      op.alarm = { x, z, y, bulb };
      break;
    }
    // patrol points
    op.patrol = [];
    for (let t = 0; t < 200 && op.patrol.length < 10; t++) {
      const a = rng() * Math.PI * 2, rr = rng() * op.r * 0.9;
      const x = op.x + Math.cos(a) * rr, z = op.z + Math.sin(a) * rr;
      if (!pointBlocked(x, z, 1.2)) op.patrol.push({ x, z });
    }
  }

  function buildStart(scene) {
    const s = W.start, y = s.y;
    const tent = new THREE.Mesh(roofGeo, MAT.canvas);
    tent.scale.set(4, 2.6, 4); tent.position.set(s.x - 5, y + 1.3, s.z + 3); scene.add(tent);
    W.boxes.push({ minX: s.x - 7, maxX: s.x - 3, minY: y, maxY: y + 2.4, minZ: s.z + 1, maxZ: s.z + 5 });
    s.flag = makeFlag(scene, s.x + 4, y, s.z + 2, 0x23b38a);
    addBox(scene, s.x + 2, y, s.z - 3, 1.4, 0.9, 0.9, MAT.supply);
    s.supply = { x: s.x + 2, z: s.z - 3 };
    addBox(scene, s.x - 1, y, s.z + 6, 3, 0.4, 0.5, MAT.darkWood);
    s.fire = { x: s.x, y: y + 0.2, z: s.z };
  }

  function buildMap() {
    const px = 360, c = document.createElement('canvas');
    c.width = c.height = px;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(px, px);
    for (let j = 0; j < px; j++) for (let i = 0; i < px; i++) {
      const x = -HALF + (i + 0.5) * SIZE / px, z = -HALF + (j + 0.5) * SIZE / px;
      const h = heightAt(x, z);
      let r, g, b;
      if (h < 0) { const k = FC.clamp(-h / 12, 0, 1); r = 40 - 20 * k; g = 140 - 50 * k; b = 170 - 40 * k; }
      else if (h < 1.9) { r = 214; g = 196; b = 140; }
      else { const k = FC.clamp(h / 60, 0, 1); r = 70 + 90 * k; g = 120 + 30 * k; b = 55 + 80 * k; }
      const o = (j * px + i) * 4;
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    W.mapCanvas = c;
  }

  // ---------- raycasts ----------
  function rayTerrain(ox, oy, oz, dx, dy, dz, maxT) {
    let prevT = 0;
    const step = 1.2;
    for (let t = step; t <= maxT + step; t += step) {
      const tt = Math.min(t, maxT);
      const x = ox + dx * tt, y = oy + dy * tt, z = oz + dz * tt;
      if (y < heightAt(x, z)) {
        let a = prevT, b = tt;
        for (let k = 0; k < 6; k++) {
          const m = (a + b) / 2;
          if (oy + dy * m < heightAt(ox + dx * m, oz + dz * m)) b = m; else a = m;
        }
        return b;
      }
      prevT = tt;
      if (tt >= maxT) break;
    }
    return Infinity;
  }
  function raycast(ox, oy, oz, dx, dy, dz, maxT) {
    let best = rayTerrain(ox, oy, oz, dx, dy, dz, maxT), kind = best < Infinity ? 'terrain' : null;
    for (const b of W.boxes) {
      const t = FC.rayBox(ox, oy, oz, dx, dy, dz, b);
      if (t < best) { best = t; kind = 'box'; }
    }
    return { t: best, kind };
  }
  function los(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.01) return true;
    const r = raycast(ax, ay, az, dx / d, dy / d, dz / d, d - 0.3);
    return r.t >= d - 0.3;
  }

  // ---------- collision ----------
  function collide(pos, radius, feetY, height) {
    // circles
    queryCircles(pos.x, pos.z, radius, (c) => {
      const dx = pos.x - c.x, dz = pos.z - c.z, d = Math.hypot(dx, dz), m = c.r + radius;
      if (d < m && d > 1e-4) { pos.x = c.x + (dx / d) * m; pos.z = c.z + (dz / d) * m; }
    });
    for (const b of W.boxes) {
      if (feetY >= b.maxY - 0.45 || feetY + height <= b.minY) continue;
      const cx = FC.clamp(pos.x, b.minX, b.maxX), cz = FC.clamp(pos.z, b.minZ, b.maxZ);
      const dx = pos.x - cx, dz = pos.z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        pos.x = cx + (dx / d) * radius; pos.z = cz + (dz / d) * radius;
      } else {
        // inside: push out along smallest axis
        const pen = [pos.x - b.minX, b.maxX - pos.x, pos.z - b.minZ, b.maxZ - pos.z];
        const k = pen.indexOf(Math.min(...pen));
        if (k === 0) pos.x = b.minX - radius; else if (k === 1) pos.x = b.maxX + radius;
        else if (k === 2) pos.z = b.minZ - radius; else pos.z = b.maxZ + radius;
      }
    }
  }
  function groundAt(x, z, feetY, radius) {
    let g = heightAt(x, z);
    for (const b of W.boxes) {
      if (x > b.minX - radius * 0.5 && x < b.maxX + radius * 0.5 && z > b.minZ - radius * 0.5 && z < b.maxZ + radius * 0.5 && feetY >= b.maxY - 0.45) {
        if (b.maxY > g) g = b.maxY;
      }
    }
    return g;
  }

  function build(scene) {
    mats();
    genHeights();
    buildTerrain(scene);
    buildSea(scene);
    W.outposts = OUTPOSTS;
    for (const op of OUTPOSTS) buildOutpost(scene, op);
    buildStart(scene);
    scatter(scene);
    buildMap();
  }

  return Object.assign(W, {
    build, heightAt, slopeAt, raycast, los, collide, groundAt, inBush, bushesNear, burnBush,
    pointBlocked, queryCircles,
    landPoint(cx, cz, minR, maxR) {
      for (let t = 0; t < 60; t++) {
        const a = Math.random() * Math.PI * 2, r = FC.rand(minR, maxR);
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        if (heightAt(x, z) > 1.2 && !pointBlocked(x, z, 1)) return { x, z };
      }
      return { x: cx, z: cz };
    },
  });
})();
