'use strict';
// Vegetation: instanced CC0 trees / bushes / rocks in streaming super-chunks, wind-swayed,
// plus a recycled pool of dense grass patches around each camera.
FC.Foliage = (function () {
  const SC = 200;              // super-chunk size (m)
  const groups = [];           // { cx, cz, meshes: [] }
  const windUniforms = { uTime: { value: 0 }, uWind: { value: 1 } };
  const bushes = []; const bushGrid = new Map(); const BG = 12;
  let bushMeshes = [];
  let grassPool = [], grassGeo, grassMat;
  const GRASS_CELL = 24, GRASS_PER = 1400;

  function windPatch(mat, strength, isGrass) {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = windUniforms.uTime; sh.uniforms.uWind = windUniforms.uWind;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
          #else
            vec2 ip = vec2(0.0);
          #endif
          float hgt = max(0.0, transformed.y);
          float ph = uTime * ${isGrass ? '2.3' : '1.3'} + ip.x * 0.07 + ip.y * 0.05;
          float bend = hgt * hgt * ${strength.toFixed(4)} * uWind;
          transformed.x += (sin(ph) * 0.7 + sin(ph * 2.7) * 0.3) * bend;
          transformed.z += cos(ph * 0.8) * bend * 0.6;`);
    };
    mat.customProgramCacheKey = () => 'wind' + strength + (isGrass ? 'g' : '');
  }

  const TYPES = {
    palm: { model: 'palm', h: [7, 11], wind: 0.0045, collide: 0.35 },
    oak: { model: 'oak', h: [6, 10], wind: 0.0025, collide: 0.45 },
    fat: { model: 'treeFat', h: [5, 8], wind: 0.003, collide: 0.45 },
    bush: { model: 'bush', h: [1.1, 1.7], wind: 0.06, bush: true },
    bushL: { model: 'bushLarge', h: [1.4, 2.2], wind: 0.04, bush: true },
    rock: { model: 'rock', h: [0.8, 3.2], wind: 0, collideRock: true },
    rockT: { model: 'rockTall', h: [2.5, 6], wind: 0, collideRock: true },
    stump: { model: 'stump', h: [0.4, 0.8], wind: 0 },
    flower: { model: 'flower', h: [0.35, 0.6], wind: 0.6 },
    log: { model: 'log', h: [0.5, 0.7], wind: 0 },
  };

  function build(scene) {
    const W = FC.World;
    const rng = FC.mulberry32(4242);
    const lists = {}; for (const k in TYPES) lists[k] = [];
    const place = (type, count, tries, test) => {
      let n = 0;
      for (let t = 0; t < tries && n < count; t++) {
        const x = (rng() * 2 - 1) * (W.HALF - 30), z = (rng() * 2 - 1) * (W.HALF - 30);
        const h = W.heightAt(x, z);
        if (W.roadAt(x, z) > 0.05 || W.isReserved(x, z, 5)) continue;
        if (!test(x, z, h, W.slopeAt(x, z))) continue;
        lists[type].push({ x, z, y: h, s: FC.lerp(TYPES[type].h[0], TYPES[type].h[1], rng()), r: rng() * Math.PI * 2 });
        n++;
      }
    };
    const forest = (x, z) => FC.fbm(x * 0.012 + 5, z * 0.012 - 2, 3);
    place('palm', 2600, 60000, (x, z, h, s) => h > 0.8 && h < 16 && s < 0.7 && rng() < (h < 7 ? 0.85 : 0.3));
    place('oak', 2200, 60000, (x, z, h, s) => h > 8 && h < 90 && s < 0.7 && forest(x, z) > 0.5);
    place('fat', 1300, 40000, (x, z, h, s) => h > 5 && h < 60 && s < 0.6 && forest(x, z) > 0.42);
    place('bush', 2600, 40000, (x, z, h, s) => h > 1.5 && h < 80 && s < 0.8);
    place('bushL', 1400, 30000, (x, z, h, s) => h > 2 && h < 70 && s < 0.7 && forest(x, z) > 0.38);
    place('rock', 700, 20000, (x, z, h, s) => h > 0.4 && h < 140 && rng() < 0.5 + s);
    place('rockT', 220, 20000, (x, z, h, s) => h > 15 && s > 0.45);
    place('stump', 300, 10000, (x, z, h, s) => h > 3 && h < 50 && s < 0.5);
    place('flower', 1500, 20000, (x, z, h, s) => h > 2.5 && h < 40 && s < 0.4);
    place('log', 200, 8000, (x, z, h, s) => h > 3 && h < 40 && s < 0.4);
    // concealment bushes around outposts for stealth approaches
    for (const op of W.outposts) {
      for (let k = 0; k < 22; k++) {
        const a = rng() * Math.PI * 2, rr = op.r + 4 + rng() * 16;
        const x = op.x + Math.cos(a) * rr, z = op.z + Math.sin(a) * rr, h = W.heightAt(x, z);
        if (h > 1 && W.roadAt(x, z) < 0.05) lists[rng() < 0.6 ? 'bush' : 'bushL'].push({ x, z, y: h, s: FC.rand(1.3, 2.0), r: rng() * 6 });
      }
    }

    const dummy = new THREE.Object3D();
    for (const key in TYPES) {
      const T = TYPES[key], sm = FC.Assets.staticModel(T.model);
      const mats = sm.materials.map((m) => {
        const c = m.clone();
        if (T.wind) windPatch(c, T.wind / Math.max(0.5, sm.size.y), false);
        return c;
      });
      // bucket into super-chunks
      const buckets = new Map();
      for (const p of lists[key]) {
        const k = Math.floor(p.x / SC) + ',' + Math.floor(p.z / SC);
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push(p);
        if (T.collide) W.addCircle(p.x, p.z, T.collide * p.s / T.h[0]);
        if (T.collideRock && p.s > 1.4) W.addCircle(p.x, p.z, p.s * 0.45);
      }
      for (const [k, list] of buckets) {
        const mesh = new THREE.InstancedMesh(sm.geometry, mats, list.length);
        const col = new THREE.Color();
        list.forEach((p, i) => {
          const sc = p.s / sm.size.y;
          dummy.position.set(p.x, p.y - 0.12, p.z);
          dummy.rotation.set(0, p.r, 0);
          dummy.scale.set(sc, sc * FC.rand(0.9, 1.1), sc);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          const v = FC.rand(0.82, 1.12);
          mesh.setColorAt(i, col.setRGB(v, v * FC.rand(0.95, 1.05), v));
          if (T.bush) { p.mesh = mesh; p.i = i; p.burnt = false; addBush(p); }
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.castShadow = !T.bush && key !== 'flower';
        mesh.receiveShadow = true;
        const [gx, gz] = k.split(',').map(Number);
        mesh.userData.center = new THREE.Vector3((gx + 0.5) * SC, 0, (gz + 0.5) * SC);
        mesh.userData.far = T.h[1] > 4 ? 900 : key === 'flower' ? 160 : 380;
        scene.add(mesh);
        groups.push(mesh);
      }
    }
    buildGrass(scene);
  }

  function addBush(b) {
    bushes.push(b);
    const k = Math.floor(b.x / BG) * 8192 + Math.floor(b.z / BG);
    if (!bushGrid.has(k)) bushGrid.set(k, []);
    bushGrid.get(k).push(b);
  }
  function bushesNear(x, z, r, cb) {
    for (let i = Math.floor((x - r) / BG); i <= Math.floor((x + r) / BG); i++) {
      for (let j = Math.floor((z - r) / BG); j <= Math.floor((z + r) / BG); j++) {
        const arr = bushGrid.get(i * 8192 + j);
        if (arr) for (const b of arr) if (!b.burnt && Math.hypot(b.x - x, b.z - z) < r + b.s * 0.4) cb(b);
      }
    }
  }
  function inBush(x, z) { let f = false; bushesNear(x, z, 1.3, () => { f = true; }); return f; }
  function burnBush(b) {
    b.burnt = true;
    b.mesh.setMatrixAt(b.i, new THREE.Matrix4().makeScale(0, 0, 0));
    b.mesh.instanceMatrix.needsUpdate = true;
  }

  // ---------------- grass ----------------
  function buildGrass(scene) {
    // a blade: two crossed tapered quads, vertex colours dark root -> light tip
    const pos = [], col = [];
    const blade = (ang) => {
      const c = Math.cos(ang) * 0.06, s = Math.sin(ang) * 0.06;
      const v = [[-c, 0, -s], [c, 0, s], [0, 1, 0]];
      for (const p of v) pos.push(...p);
      col.push(0.18, 0.3, 0.1, 0.18, 0.3, 0.1, 0.62, 0.78, 0.35);
    };
    blade(0); blade(Math.PI / 3); blade(-Math.PI / 3);
    grassGeo = new THREE.BufferGeometry();
    grassGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    grassGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
    grassGeo.computeVertexNormals();
    // normals pointing up look best for grass lighting
    const n = grassGeo.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
    grassMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide });
    windPatch(grassMat, 0.12, true);
    for (let i = 0; i < 40; i++) {
      const m = new THREE.InstancedMesh(grassGeo, grassMat, GRASS_PER);
      m.count = 0; m.visible = false; m.receiveShadow = true; m.frustumCulled = true;
      m.userData.cell = null;
      scene.add(m);
      grassPool.push(m);
    }
  }
  function fillGrass(m, ci, cj, density) {
    const W = FC.World;
    const rng = FC.mulberry32(ci * 73856093 ^ cj * 19349663);
    const dummy = new THREE.Object3D();
    let n = 0;
    const target = Math.floor(GRASS_PER * density);
    for (let t = 0; t < target * 2 && n < target; t++) {
      const x = (ci + rng()) * GRASS_CELL, z = (cj + rng()) * GRASS_CELL;
      const h = W.heightAt(x, z);
      if (h < 2.4 || h > 95 || W.roadAt(x, z) > 0.2 || W.groundMaskAt(x, z) > 0.4) continue;
      if (W.slopeAt(x, z) > 0.55) continue;
      const patch = FC.fbm(x * 0.05, z * 0.05, 2);
      if (patch < 0.35) continue;
      const s = 0.35 + rng() * 0.55 * patch * 1.4;
      dummy.position.set(x, h - 0.05, z);
      dummy.rotation.set(0, rng() * 6.28, 0);
      dummy.scale.set(1 + rng(), s, 1 + rng());
      dummy.updateMatrix();
      m.setMatrixAt(n++, dummy.matrix);
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    m.userData.cell = ci + ',' + cj;
  }

  let quality = 'high';
  // Called once per frame with every camera position: streams grass cells.
  function updateStreaming(positions) {
    if (quality === 'low') { for (const m of grassPool) m.visible = false; return; }
    const R = quality === 'high' ? 52 : 36, density = quality === 'high' ? 1 : 0.5;
    const need = new Set();
    for (const p of positions) {
      const i0 = Math.floor((p.x - R) / GRASS_CELL), i1 = Math.floor((p.x + R) / GRASS_CELL);
      const j0 = Math.floor((p.z - R) / GRASS_CELL), j1 = Math.floor((p.z + R) / GRASS_CELL);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const cx = (i + 0.5) * GRASS_CELL, cz = (j + 0.5) * GRASS_CELL;
        if (Math.hypot(cx - p.x, cz - p.z) < R + GRASS_CELL * 0.7) need.add(i + ',' + j);
      }
    }
    const have = new Map();
    for (const m of grassPool) if (m.userData.cell) have.set(m.userData.cell, m);
    const free = grassPool.filter((m) => !m.userData.cell || !need.has(m.userData.cell));
    let budget = 3; // regenerate at most a few cells per frame
    for (const key of need) {
      if (have.has(key)) { have.get(key).visible = true; continue; }
      if (!budget || !free.length) continue;
      const m = free.pop(); budget--;
      const [i, j] = key.split(',').map(Number);
      fillGrass(m, i, j, density);
      m.visible = true;
    }
    for (const m of free) { if (m.userData.cell && !need.has(m.userData.cell)) m.visible = false; }
  }

  // Per-view distance culling of the big instanced groups.
  function prepareView(cam) {
    for (const m of groups) {
      const c = m.userData.center;
      const d = Math.hypot(c.x - cam.position.x, c.z - cam.position.z) - SC * 0.71;
      m.visible = d < m.userData.far;
    }
  }

  return {
    build, prepareView, updateStreaming, bushesNear, inBush, burnBush,
    setQuality(q) { quality = q; },
    setTime(t, wind) { windUniforms.uTime.value = t; windUniforms.uWind.value = wind; },
    get bushes() { return bushes; },
  };
})();
