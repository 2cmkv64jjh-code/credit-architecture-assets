'use strict';
// Particle systems (fire, smoke, blood, sparks) and bullet tracers.
FC.FX = (function () {
  const MAX = 2500;
  const VERT = `
    attribute float aAlpha; attribute float aSize; attribute vec3 aColor;
    uniform float uScale; varying vec3 vColor; varying float vAlpha;
    void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0);
      gl_PointSize = aSize * uScale / max(0.1, -mv.z);
      gl_Position = projectionMatrix * mv; vColor = aColor; vAlpha = aAlpha; }`;
  const FRAG = `
    varying vec3 vColor; varying float vAlpha;
    void main(){ float d = length(gl_PointCoord - 0.5);
      float a = smoothstep(0.5, 0.1, d) * vAlpha; if (a < 0.01) discard;
      gl_FragColor = vec4(vColor, a); }`;

  const systems = [];
  function makeSystem(scene, blending) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(MAX * 3), col = new Float32Array(MAX * 3), al = new Float32Array(MAX), sz = new Float32Array(MAX);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(al, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
    geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 } }, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, blending,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    scene.add(pts);
    const sys = { geo, mat, pos, col, al, sz, n: 0, p: [] };
    systems.push(sys);
    return sys;
  }
  let add, norm, tracerGeo, tracerArr, tracers = [];

  function init(scene) {
    add = makeSystem(scene, THREE.AdditiveBlending);
    norm = makeSystem(scene, THREE.NormalBlending);
    tracerArr = new Float32Array(200 * 6);
    tracerGeo = new THREE.BufferGeometry();
    tracerGeo.setAttribute('position', new THREE.BufferAttribute(tracerArr, 3));
    tracerGeo.setDrawRange(0, 0);
    const lines = new THREE.LineSegments(tracerGeo, new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    lines.frustumCulled = false;
    scene.add(lines);
  }

  function spawn(sys, o) {
    if (sys.p.length >= MAX) return;
    sys.p.push({
      x: o.x, y: o.y, z: o.z, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0,
      life: 0, max: o.life || 1, s0: o.s0 || 1, s1: o.s1 === undefined ? o.s0 : o.s1,
      c0: o.c0, c1: o.c1 || o.c0, a0: o.a0 === undefined ? 1 : o.a0, a1: o.a1 || 0, g: o.g || 0, drag: o.drag || 0,
    });
  }
  const R = FC.rand;

  function update(dt) {
    for (const sys of systems) {
      const p = sys.p;
      for (let i = p.length - 1; i >= 0; i--) {
        const q = p[i];
        q.life += dt;
        if (q.life >= q.max) { p[i] = p[p.length - 1]; p.pop(); continue; }
        q.vy -= q.g * dt;
        const dr = 1 - q.drag * dt;
        q.vx *= dr; q.vy *= dr; q.vz *= dr;
        q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      }
      for (let i = 0; i < p.length; i++) {
        const q = p[i], t = q.life / q.max;
        sys.pos[i * 3] = q.x; sys.pos[i * 3 + 1] = q.y; sys.pos[i * 3 + 2] = q.z;
        sys.col[i * 3] = q.c0[0] + (q.c1[0] - q.c0[0]) * t;
        sys.col[i * 3 + 1] = q.c0[1] + (q.c1[1] - q.c0[1]) * t;
        sys.col[i * 3 + 2] = q.c0[2] + (q.c1[2] - q.c0[2]) * t;
        sys.al[i] = q.a0 + (q.a1 - q.a0) * t;
        sys.sz[i] = q.s0 + (q.s1 - q.s0) * t;
      }
      sys.n = p.length;
      sys.geo.setDrawRange(0, p.length);
      for (const k of ['position', 'aColor', 'aAlpha', 'aSize']) sys.geo.attributes[k].needsUpdate = true;
    }
    // tracers
    let n = 0;
    for (let i = tracers.length - 1; i >= 0; i--) {
      tracers[i].t -= dt;
      if (tracers[i].t <= 0) tracers.splice(i, 1);
    }
    for (const tr of tracers) {
      if (n >= 200) break;
      tracerArr.set(tr.a, n * 6); tracerArr.set(tr.b, n * 6 + 3); n++;
    }
    tracerGeo.setDrawRange(0, n * 2);
    tracerGeo.attributes.position.needsUpdate = true;
  }

  function setView(heightPx, fovDeg) {
    const s = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
    for (const sys of systems) sys.mat.uniforms.uScale.value = s;
  }

  return {
    init, update, setView,
    tracer(a, b) {
      // draw a shortened streak so it reads as a moving bullet
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const k = 0.35 + Math.random() * 0.3;
      tracers.push({ a: [a.x + dx * (k - 0.3), a.y + dy * (k - 0.3), a.z + dz * (k - 0.3)], b: [a.x + dx * k, a.y + dy * k, a.z + dz * k], t: 0.05 });
    },
    fire(x, y, z, scale) {
      scale = scale || 1;
      spawn(add, { x: x + R(-0.6, 0.6) * scale, y: y + R(0, 0.3), z: z + R(-0.6, 0.6) * scale, vx: R(-0.3, 0.3), vy: R(1.5, 3.2), vz: R(-0.3, 0.3),
        life: R(0.5, 0.9), s0: R(0.9, 1.5) * scale, s1: 0.2, c0: [1, 0.75, 0.3], c1: [0.9, 0.2, 0.02], a0: 0.9, a1: 0 });
    },
    smoke(x, y, z, scale) {
      scale = scale || 1;
      spawn(norm, { x: x + R(-0.4, 0.4), y, z: z + R(-0.4, 0.4), vx: R(-0.4, 0.4), vy: R(1.2, 2.2), vz: R(-0.4, 0.4),
        life: R(2, 3.5), s0: 1 * scale, s1: 4 * scale, c0: [0.25, 0.23, 0.22], c1: [0.55, 0.53, 0.5], a0: 0.45, a1: 0, drag: 0.3 });
    },
    muzzle(x, y, z) {
      spawn(add, { x, y, z, life: 0.06, s0: 0.7, s1: 0.3, c0: [1, 0.85, 0.5], c1: [1, 0.5, 0.1], a0: 1, a1: 0 });
    },
    impact(x, y, z, kind) {
      if (kind === 'blood') {
        for (let i = 0; i < 8; i++) spawn(norm, { x, y, z, vx: R(-2, 2), vy: R(0, 3), vz: R(-2, 2), g: 9, life: R(0.3, 0.6), s0: 0.18, s1: 0.1, c0: [0.6, 0.05, 0.05], c1: [0.35, 0.02, 0.02], a0: 0.9, a1: 0.2 });
      } else if (kind === 'spark') {
        for (let i = 0; i < 6; i++) spawn(add, { x, y, z, vx: R(-4, 4), vy: R(0, 4), vz: R(-4, 4), g: 12, life: R(0.15, 0.35), s0: 0.1, s1: 0.04, c0: [1, 0.9, 0.5], c1: [1, 0.4, 0.1] });
      } else {
        for (let i = 0; i < 6; i++) spawn(norm, { x, y, z, vx: R(-1.2, 1.2), vy: R(0.5, 2.2), vz: R(-1.2, 1.2), g: 5, life: R(0.4, 0.8), s0: 0.25, s1: 0.6, c0: [0.55, 0.47, 0.35], c1: [0.65, 0.6, 0.5], a0: 0.7, a1: 0 });
      }
    },
    explosion(x, y, z) {
      spawn(add, { x, y: y + 1, z, life: 0.25, s0: 10, s1: 14, c0: [1, 0.95, 0.7], c1: [1, 0.5, 0.1], a0: 1, a1: 0 });
      for (let i = 0; i < 50; i++) spawn(add, { x, y: y + 0.5, z, vx: R(-8, 8), vy: R(2, 12), vz: R(-8, 8), g: 6, drag: 1.5, life: R(0.4, 1.0), s0: R(1, 2.4), s1: 0.3, c0: [1, 0.8, 0.35], c1: [0.8, 0.15, 0.0] });
      for (let i = 0; i < 25; i++) spawn(norm, { x: x + R(-1.5, 1.5), y: y + 1, z: z + R(-1.5, 1.5), vx: R(-2, 2), vy: R(2, 5), vz: R(-2, 2), drag: 0.6, life: R(2.5, 4.5), s0: 2, s1: 7, c0: [0.15, 0.13, 0.12], c1: [0.45, 0.43, 0.4], a0: 0.6, a1: 0 });
      for (let i = 0; i < 20; i++) spawn(add, { x, y: y + 0.5, z, vx: R(-14, 14), vy: R(4, 14), vz: R(-14, 14), g: 18, life: R(0.5, 1.2), s0: 0.15, s1: 0.05, c0: [1, 0.9, 0.5], c1: [1, 0.3, 0] });
    },
    glow(x, y, z, size, c, life) {
      spawn(add, { x, y, z, life: life || 0.05, s0: size, s1: size, c0: c, a0: 0.9, a1: 0.6 });
    },
  };
})();
