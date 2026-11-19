'use strict';
// Decodes the embedded CC0 GLB models / textures and builds reusable rigs and instancing geometry.
FC.Assets = (function () {
  const gltf = {}, tex = {}, statics = {};
  let loader = null;

  function b64ToBuf(b64) {
    const bin = atob(b64), n = bin.length, u = new Uint8Array(n);
    for (let i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }

  async function load(onProgress) {
    loader = new THREE.GLTFLoader();
    loader.setMeshoptDecoder(THREE.MeshoptDecoder);
    await THREE.MeshoptDecoder.ready;
    const names = Object.keys(window.FC_ASSETS.models);
    const texNames = Object.keys(window.FC_ASSETS.textures);
    const total = names.length + texNames.length;
    let done = 0;
    for (const n of names) {
      gltf[n] = await new Promise((res, rej) => loader.parse(b64ToBuf(window.FC_ASSETS.models[n]), '', res, rej));
      done++; if (onProgress) onProgress(done / total);
      await new Promise((r) => setTimeout(r, 0));
    }
    const tl = new THREE.TextureLoader();
    for (const k of texNames) {
      const t = await tl.loadAsync(window.FC_ASSETS.textures[k]);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      tex[k] = t;
      done++; if (onProgress) onProgress(done / total);
    }
    // characters: measure true height in idle pose once
    for (const n of names) {
      const g = gltf[n];
      g.clipMap = {};
      for (const c of g.animations) {
        const short = c.name.split('|').pop();
        // prefer the "Armature|Name" clips (some files hold duplicates)
        if (!g.clipMap[short] || c.name.includes('|')) g.clipMap[short] = c;
      }
    }
  }

  // Convert any (quantized / interleaved) geometry to plain float position/normal/uv.
  function toFloat(src) {
    const g0 = src.index ? src.toNonIndexed() : src;
    const out = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) {
      const a = g0.getAttribute(name);
      if (!a) continue;
      const n = a.count, s = a.itemSize, arr = new Float32Array(n * s);
      for (let i = 0; i < n; i++) {
        arr[i * s] = a.getX(i);
        if (s > 1) arr[i * s + 1] = a.getY(i);
        if (s > 2) arr[i * s + 2] = a.getZ(i);
      }
      out.setAttribute(name, new THREE.BufferAttribute(arr, s));
    }
    if (!out.getAttribute('uv')) out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(out.getAttribute('position').count * 2), 2));
    if (!out.getAttribute('normal')) out.computeVertexNormals();
    return out;
  }

  function litMaterial(m) {
    // Unlit / basic materials from the packs -> lit standard material that takes shadows
    const p = {
      color: m.color ? m.color.clone() : new THREE.Color(1, 1, 1), map: m.map || null,
      roughness: m.roughness !== undefined ? Math.max(0.55, m.roughness) : 0.85, metalness: Math.min(0.2, m.metalness || 0),
      side: m.side, transparent: m.transparent, alphaTest: m.alphaTest,
    };
    return new THREE.MeshStandardMaterial(p);
  }

  // Merged geometry (with groups) + materials for an instanced static prop, normalised so that
  // its base sits on y=0 and it is centred on x/z.
  function staticModel(name) {
    if (statics[name]) return statics[name];
    const scene = gltf[name].scene;
    scene.updateMatrixWorld(true);
    const geos = [], mats = [], matIndex = new Map();
    const parts = [];
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      const base = toFloat(o.geometry);
      base.applyMatrix4(o.matrixWorld);
      if (ms.length === 1) parts.push({ g: base, m: ms[0] });
      else {
        for (const grp of o.geometry.groups) {
          const sub = base.clone();
          const idx = []; for (let i = grp.start; i < grp.start + grp.count; i++) idx.push(i);
          sub.setIndex(idx);
          parts.push({ g: toFloat(sub), m: ms[grp.materialIndex] });
        }
      }
    });
    for (const p of parts) {
      let mi = matIndex.get(p.m);
      if (mi === undefined) { mi = mats.length; mats.push(litMaterial(p.m)); matIndex.set(p.m, mi); }
      geos.push({ g: p.g, mi });
    }
    // merge per material so one group per material
    const byMat = mats.map(() => []);
    for (const p of geos) byMat[p.mi].push(p.g);
    const merged = THREE.BufferGeometryUtils.mergeGeometries(byMat.map((list) => THREE.BufferGeometryUtils.mergeGeometries(list, false)), true);
    merged.computeBoundingBox();
    const bb = merged.boundingBox;
    merged.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
    merged.computeBoundingBox(); merged.computeBoundingSphere();
    const size = merged.boundingBox.getSize(new THREE.Vector3());
    statics[name] = { geometry: merged, materials: mats, size };
    return statics[name];
  }

  // A single (non-instanced) mesh group of a static model, scaled so its largest horizontal size or height matches.
  function propMesh(name, opts) {
    const s = staticModel(name);
    const mesh = new THREE.Mesh(s.geometry, opts && opts.materials ? opts.materials : s.materials);
    mesh.castShadow = true; mesh.receiveShadow = true;
    if (opts && opts.height) mesh.scale.setScalar(opts.height / s.size.y);
    if (opts && opts.length) mesh.scale.setScalar(opts.length / Math.max(s.size.x, s.size.z));
    return mesh;
  }

  return { load, gltf, tex, staticModel, propMesh, toFloat };
})();

// ---------------------------------------------------------------------------------------------
// Animated character rig: clones a skinned GLB, scales it, tints it and crossfades clips.
const _tintCache = new Map();
FC.Rig = class {
  constructor(name, opts) {
    opts = opts || {};
    const src = FC.Assets.gltf[name];
    this.name = name;
    this.root = new THREE.Group();
    this.model = THREE.SkeletonUtils.clone(src.scene);
    this.root.add(this.model);
    FC.Rig.all.push(this);
    this.model.rotation.y = opts.faceMinusZ ? 0 : Math.PI; // packs face +Z, game forward is -Z
    const h = opts.height || 1.8;
    const m = FC.Rig.measure(name);
    const k = h / m.h;
    this.model.scale.setScalar(k);
    this.model.position.y = -m.minY * k;           // feet on the ground
    this.baseY = this.model.position.y;
    this.size = { h, len: m.len * k, wid: m.wid * k }; // world-space body dimensions
    this.clips = src.clipMap;
    this.mixer = new THREE.AnimationMixer(this.model);
    this.current = null; this.currentName = '';
    this.meshes = [];
    const tint = opts.tint || null, key = name + JSON.stringify(tint || {});
    this.model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true;
        o.frustumCulled = false;
        if (opts.hide && opts.hide.some((h2) => o.name.includes(h2))) o.visible = false;
        const swap = (m) => {
          const ck = key + m.uuid;
          if (_tintCache.has(ck)) return _tintCache.get(ck);
          const nm = new THREE.MeshStandardMaterial({ color: m.color.clone(), map: m.map || null, roughness: 0.8, metalness: 0.05 });
          if (tint && tint[m.name] !== undefined) nm.color.set(tint[m.name]);
          if (opts.emissiveFlash) nm.userData.flash = true;
          _tintCache.set(ck, nm);
          return nm;
        };
        o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
        this.meshes.push(o);
      }
    });
    this.hand = this.model.getObjectByName(opts.hand || 'Wrist.R');
    this.head = this.model.getObjectByName('Head');
    this.lod = 0; this.accum = 0;
  }
  has(clip) { return !!this.clips[clip]; }
  play(clip, o) {
    o = o || {};
    if (!this.clips[clip]) return;
    const speed = o.speed || 1;
    if (this.currentName === clip) { this.current.timeScale = speed; return; }
    const a = this.mixer.clipAction(this.clips[clip]);
    a.reset();
    a.timeScale = speed;
    if (o.once) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; } else a.setLoop(THREE.LoopRepeat, Infinity);
    a.play();
    if (this.current) this.current.crossFadeTo(a, o.fade === undefined ? 0.22 : o.fade, false);
    this.current = a; this.currentName = clip;
  }
  // Updates the mixer; far-away rigs tick less often.
  update(dt, dist) {
    this.accum += dt;
    const step = !this.model.visible ? 0.25 : dist > 160 ? 0.2 : dist > 70 ? 0.066 : 0;
    if (this.accum >= step) { this.mixer.update(this.accum); this.accum = 0; }
  }
  handWorld(target) {
    if (this.hand) { this.hand.getWorldPosition(target); return target; }
    return this.root.getWorldPosition(target).add(new THREE.Vector3(0, 1.3, 0));
  }
  setVisible(v) { this.root.visible = v; }
};
// Measures each source model once in its idle pose (the packs use very different native scales:
// e.g. the worker is ~4.8 units tall, the adventurers ~1.8), so every rig can be scaled to real size.
FC.Rig.measured = {};
FC.Rig.measure = function (name) {
  if (FC.Rig.measured[name]) return FC.Rig.measured[name];
  const src = FC.Assets.gltf[name];
  const model = THREE.SkeletonUtils.clone(src.scene);
  const c = src.clipMap;
  const idle = c.Idle || c.Man_Idle || c.Idle_Neutral || c.Idle_Gun || src.animations[0];
  const mixer = new THREE.AnimationMixer(model);
  if (idle) { mixer.clipAction(idle).play(); mixer.update(0.05); }
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model, true);
  const size = box.getSize(new THREE.Vector3());
  mixer.stopAllAction();
  const m = { h: Math.max(0.01, size.y), minY: box.min.y, len: Math.max(size.x, size.z), wid: Math.min(size.x, size.z) };
  FC.Rig.measured[name] = m;
  return m;
};

// Simple first-person / third-person weapon props built from primitives.
FC.GunProps = (function () {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const dark = new THREE.MeshStandardMaterial({ color: 0x22252a, roughness: 0.5, metalness: 0.6 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a3b24, roughness: 0.8 });
  function part(g, w, h, d, x, y, z, m) { const o = new THREE.Mesh(box, m); o.scale.set(w, h, d); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; }
  // Real CC0 gun models (Quaternius Toon Shooter Game Kit). Barrels point down -X in the source files;
  // here they are turned to point down -Z, scaled to `len` metres, the muzzle placed at z=front and
  // the top of the gun at y=top, matching the frame the viewmodels and hand attachments expect.
  function model(key, len, front, top) {
    const g = new THREE.Group();
    if (!FC.Assets.gltf[key]) return g;
    const s = FC.Assets.staticModel(key);
    const m = new THREE.Mesh(s.geometry, s.materials);
    const k = len / s.size.x;
    m.scale.setScalar(k); m.rotation.y = -Math.PI / 2;
    m.position.set(0, top - s.size.y * k, front + len / 2);
    m.castShadow = true;
    g.add(m);
    return g;
  }
  // upright models (knife blade along +Y): laid down along -Z
  function upright(key, len) {
    const g = new THREE.Group();
    if (!FC.Assets.gltf[key]) return g;
    const s = FC.Assets.staticModel(key);
    const m = new THREE.Mesh(s.geometry, s.materials);
    m.scale.setScalar(len / s.size.y); m.rotation.x = -Math.PI / 2;
    m.position.set(0, 0, 0.05);
    g.add(m);
    return g;
  }
  function small(key, h) {
    const g = new THREE.Group();
    if (!FC.Assets.gltf[key]) return g;
    const s = FC.Assets.staticModel(key);
    const m = new THREE.Mesh(s.geometry, s.materials);
    m.scale.setScalar(h / s.size.y); m.position.y = -h / 2;
    g.add(m);
    return g;
  }
  const rifle = () => model('gunAK', 0.97, -0.70, 0.06);
  const pistol = () => model('gunPistol', 0.24, -0.15, 0.04);
  const shotgun = () => model('gunShotgun', 1.0, -0.76, 0.05);
  const sniper = () => model('gunSniper', 1.15, -0.88, 0.13);
  return { rifle, pistol, shotgun, sniper, model, upright, small, part, box, dark, wood };
})();

// Every live rig, for per-view distance + frustum culling (skinned meshes have frustumCulled=false
// because their bind-pose bounds are wrong once animated, so culling happens on the whole model).
FC.Rig.all = [];
FC.Rig.cull = (function () {
  const fr = new THREE.Frustum(), m = new THREE.Matrix4(), sph = new THREE.Sphere(), cp = new THREE.Vector3();
  return function (cam, maxDist) {
    m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    fr.setFromProjectionMatrix(m);
    cam.getWorldPosition(cp);
    const md2 = maxDist * maxDist, all = FC.Rig.all;
    for (let i = all.length - 1; i >= 0; i--) {
      const r = all[i];
      if (!r.root.parent) { if (r._attached && (r._detT = (r._detT || 0) + 1) > 120) all.splice(i, 1); continue; }
      r._attached = true; r._detT = 0;
      const e = r.root.matrixWorld.elements;
      sph.center.set(e[12], e[13] + 1, e[14]);
      sph.radius = Math.max(2, (r.size ? Math.max(r.size.h, r.size.len) : 2) * 0.8);
      const d2 = sph.center.distanceToSquared(cp);
      const vis = d2 < md2 && fr.intersectsSphere(sph);
      r.model.visible = vis;
      if (vis) r._seenT = 0;
    }
  };
})();
