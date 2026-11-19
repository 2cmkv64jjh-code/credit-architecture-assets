'use strict';
// Environment: physical sky, sun/moon lighting with shadows, day/night cycle, fog, stars, weather, ocean.
FC.Env = (function () {
  const E = {
    hour: 7.5, daySeconds: 1200, // a full day lasts 20 real minutes
    sunDir: new THREE.Vector3(), night: 0, rain: 0, rainTarget: 0, rainTimer: 300,
  };
  let scene, sky, sun, hemi, amb, stars, water, waterMat;
  const fogDay = new THREE.Color(0xb8cad6), fogDusk = new THREE.Color(0xe0a676), fogNight = new THREE.Color(0x0d1626), fogRain = new THREE.Color(0x7d8a93);

  function init(sc, quality) {
    scene = sc;
    sky = new THREE.Sky();
    sky.scale.setScalar(9000);
    sky.material.uniforms.turbidity.value = 5;
    sky.material.uniforms.rayleigh.value = 1.4;
    sky.material.uniforms.mieCoefficient.value = 0.004;
    sky.material.uniforms.mieDirectionalG.value = 0.82;
    scene.add(sky);

    sun = new THREE.DirectionalLight(0xffffff, 3);
    sun.castShadow = true;
    const S = 70;
    Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 700 });
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.06;
    scene.add(sun); scene.add(sun.target);
    hemi = new THREE.HemisphereLight(0xdfe8f0, 0x5a5a3a, 0.9);
    scene.add(hemi);
    amb = new THREE.AmbientLight(0xffffff, 0.08);
    scene.add(amb);
    scene.fog = new THREE.FogExp2(fogDay.getHex(), 0.0011);

    // stars
    const n = 1500, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, r = 4000;
      const s = Math.sqrt(1 - u * u);
      pos[i * 3] = Math.cos(t) * s * r; pos[i * 3 + 1] = Math.abs(u) * r; pos[i * 3 + 2] = Math.sin(t) * s * r;
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    scene.add(stars);
    buildWater();
    buildRain();
    setQuality(quality);
  }

  function setQuality(q) {
    if (!sun) return;
    sun.castShadow = q !== 'low';
    const s = q === 'high' ? 2048 : 1024;
    if (sun.shadow.mapSize.x !== s) {
      sun.shadow.mapSize.set(s, s);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
  }

  // ---------------- rain streaks (a box of falling lines that follows each camera) ----------------
  let rain, rainMat;
  function buildRain() {
    const n = 2600, pos = new Float32Array(n * 6), seed = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const x = FC.rand(-22, 22), y = FC.rand(0, 26), z = FC.rand(-22, 22);
      pos.set([x, y, z, x - 0.08, y + 0.75, z], i * 6);
      seed[i * 2] = seed[i * 2 + 1] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    rainMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uAmount: { value: 0 }, uColor: { value: new THREE.Color(0.75, 0.8, 0.88) } },
      transparent: true, depthWrite: false,
      vertexShader: `attribute float seed; uniform float uTime; varying float vA;
        void main(){ vec3 p = position; float fall = mod(p.y - uTime * (20.0 + seed * 6.0), 26.0) - 6.0; p.y = fall + (position.y - floor(position.y)) * 0.0;
          vA = step(seed, 1.0); gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
      fragmentShader: `uniform float uAmount; uniform vec3 uColor; varying float vA; void main(){ gl_FragColor = vec4(uColor, 0.35 * uAmount); }`,
    });
    rain = new THREE.LineSegments(g, rainMat);
    rain.frustumCulled = false; rain.renderOrder = 3;
    scene.add(rain);
  }

  // ---------------- ocean ----------------
  function buildWater() {
    const W = FC.World;
    // height texture for shoreline foam / depth tint
    const px = 512, data = new Uint8Array(px * px * 4);
    for (let j = 0; j < px; j++) for (let i = 0; i < px; i++) {
      const x = -W.HALF + (i + 0.5) * W.SIZE / px, z = -W.HALF + (j + 0.5) * W.SIZE / px;
      const h = FC.clamp(W.heightAt(x, z), -30, 10);
      const v = Math.round(((h + 30) / 40) * 255);
      const o = (j * px + i) * 4; data[o] = v; data[o + 1] = v; data[o + 2] = v; data[o + 3] = 255;
    }
    const ht = new THREE.DataTexture(data, px, px, THREE.RGBAFormat);
    ht.magFilter = THREE.LinearFilter; ht.minFilter = THREE.LinearFilter; ht.needsUpdate = true;
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(1, 1, 1) },
      uSkyColor: { value: new THREE.Color(0.5, 0.7, 0.9) }, uDeep: { value: new THREE.Color(0x0b3f5c) }, uShallow: { value: new THREE.Color(0x2fb8b0) },
      uHeight: { value: ht }, uWorld: { value: W.SIZE }, uNight: { value: 0 }, uRain: { value: 0 },
    }]);
    waterMat = new THREE.ShaderMaterial({
      uniforms, fog: true, transparent: true,
      vertexShader: `
        #include <fog_pars_vertex>
        uniform float uTime; varying vec3 vW; varying float vSwell;
        void main(){
          vec4 w = modelMatrix * vec4(position,1.0);
          float sw = sin(w.x*0.03 + uTime*0.8)*0.18 + sin(w.z*0.045 - uTime*1.1)*0.14;
          w.y += sw; vSwell = sw; vW = w.xyz;
          vec4 mvPosition = viewMatrix * w;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        #include <fog_pars_fragment>
        uniform float uTime, uWorld, uNight, uRain; uniform vec3 uSunDir, uSunColor, uSkyColor, uDeep, uShallow; uniform sampler2D uHeight;
        varying vec3 vW; varying float vSwell;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
        float waves(vec2 p){
          float t = uTime;
          return n2(p*0.35 + vec2(t*0.25, t*0.12))*0.5 + n2(p*0.9 - vec2(t*0.35, -t*0.2))*0.3 + n2(p*2.3 + vec2(t*0.6, t*0.4))*0.2;
        }
        void main(){
          vec2 p = vW.xz;
          float e = 0.25;
          float h0 = waves(p), hx = waves(p+vec2(e,0.0)), hz = waves(p+vec2(0.0,e));
          float rough = 0.55 + uRain*0.6;
          vec3 N = normalize(vec3(-(hx-h0)/e*rough, 1.0, -(hz-h0)/e*rough));
          vec3 V = normalize(cameraPosition - vW);
          float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0)*0.85 + 0.05;
          vec2 uv = (p + uWorld*0.5) / uWorld;
          float th = texture2D(uHeight, uv).r*40.0 - 30.0;      // terrain height under the water
          float depth = clamp(-th, 0.0, 30.0);
          vec3 base = mix(uShallow, uDeep, smoothstep(0.0, 14.0, depth));
          base *= mix(1.0, 0.18, uNight);
          vec3 R = reflect(-V, N);
          vec3 refl = uSkyColor;
          vec3 H = normalize(uSunDir + V);
          float spec = pow(max(dot(N, H), 0.0), 220.0) * 6.0 * step(0.0, uSunDir.y);
          vec3 col = mix(base, refl, fres) + uSunColor*spec;
          // shoreline foam
          float foamBand = smoothstep(1.6, 0.0, depth) * (0.55 + 0.45*sin(depth*5.0 - uTime*2.2 + n2(p*0.3)*6.0));
          float foam = clamp(foamBand * smoothstep(0.35, 0.75, n2(p*1.7 + uTime*0.3)) * 1.4, 0.0, 1.0);
          col = mix(col, vec3(0.92,0.95,0.95)*mix(1.0,0.25,uNight), foam);
          float alpha = mix(0.55, 0.94, smoothstep(0.0, 5.0, depth));
          gl_FragColor = vec4(col, max(alpha, foam));
          #include <fog_fragment>
        }`,
    });
    const geo = new THREE.PlaneGeometry(9000, 9000, 160, 160).rotateX(-Math.PI / 2);
    water = new THREE.Mesh(geo, waterMat);
    water.renderOrder = 2;
    scene.add(water);
  }

  const tmpC = new THREE.Color();
  function update(dt, G) {
    E.hour = (E.hour + (dt * 24) / E.daySeconds) % 24;
    // sun path
    const t = (E.hour - 6) / 12; // 0 at sunrise, 1 at sunset
    const elev = Math.sin(t * Math.PI) * 1.15 - 0.05;
    const az = Math.PI * 0.15 + t * Math.PI;
    E.sunDir.set(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev) * 0.6 - 0.35).normalize();
    const day = FC.smoothstep(-0.12, 0.18, E.sunDir.y);
    E.night = 1 - day;
    const dusk = FC.clamp(1 - Math.abs(E.sunDir.y - 0.05) / 0.25, 0, 1) * day;

    // weather
    E.rainTimer -= dt;
    if (E.rainTimer <= 0) { E.rainTarget = E.rainTarget > 0 ? 0 : (Math.random() < 0.55 ? 1 : 0); E.rainTimer = E.rainTarget ? FC.rand(90, 180) : FC.rand(240, 480); }
    E.rain += (E.rainTarget - E.rain) * Math.min(1, dt * 0.15);

    sky.material.uniforms.sunPosition.value.copy(E.sunDir).multiplyScalar(1000);
    sky.material.uniforms.turbidity.value = 5 + E.rain * 12;
    sky.material.uniforms.rayleigh.value = 1.4 + E.rain * 2;
    const moonDir = tmpV.copy(E.sunDir).negate();
    if (day > 0.02) {
      sun.intensity = 3.2 * day * (1 - E.rain * 0.6);
      sun.color.setRGB(1, 0.86 + 0.14 * (1 - dusk), 0.7 + 0.3 * (1 - dusk));
      E.lightDir = E.sunDir;
    } else {
      sun.intensity = 0.35 * (1 - E.rain * 0.5);
      sun.color.setRGB(0.55, 0.65, 1.0);
      E.lightDir = moonDir.y > 0.1 ? moonDir : tmpV2.set(0.3, 0.8, 0.2).normalize();
    }
    E.lightDirC = (E.lightDirC || new THREE.Vector3()).copy(E.lightDir);
    hemi.intensity = 0.25 + 0.75 * day * (1 - E.rain * 0.3);
    hemi.color.setRGB(0.6 + 0.3 * day, 0.65 + 0.28 * day, 0.8 + 0.12 * day);
    amb.intensity = 0.06 + 0.04 * E.night;

    tmpC.copy(fogDay).lerp(fogDusk, dusk * 0.8).lerp(fogNight, E.night).lerp(fogRain, E.rain * 0.7 * (1 - E.night * 0.7));
    scene.fog.color.copy(tmpC);
    scene.fog.density = 0.0008 + E.rain * 0.0022 + E.night * 0.0006;
    stars.material.opacity = FC.clamp(E.night * 1.2 - 0.2, 0, 1) * (1 - E.rain);

    const u = waterMat.uniforms;
    u.uTime.value += dt;
    u.uSunDir.value.copy(E.sunDir);
    u.uSunColor.value.copy(sun.color).multiplyScalar(day);
    u.uSkyColor.value.copy(tmpC).lerp(new THREE.Color(0.45, 0.65, 0.9), 0.4 * day);
    u.uNight.value = E.night * 0.8;
    u.uRain.value = E.rain;
    if (FC.Foliage) FC.Foliage.setTime(u.uTime.value, 1 + E.rain * 1.8);
    rainMat.uniforms.uTime.value = u.uTime.value;
    rainMat.uniforms.uAmount.value = FC.smoothstep(0.1, 0.8, E.rain);
    rainMat.uniforms.uColor.value.setRGB(0.75, 0.8, 0.88).multiplyScalar(1 - E.night * 0.7);
    rain.visible = E.rain > 0.1;
  }
  const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();

  // Called before rendering each viewport: centre the shadow frustum on that camera.
  const fwd = new THREE.Vector3();
  function prepareView(cam) {
    cam.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
    const cx = cam.position.x + fwd.x * 35, cz = cam.position.z + fwd.z * 35;
    const cy = FC.World.heightAt(cx, cz);
    const texel = (140 / sun.shadow.mapSize.x);
    const sx = Math.round(cx / texel) * texel, sz = Math.round(cz / texel) * texel;
    sun.target.position.set(sx, cy, sz);
    sun.position.set(sx + E.lightDirC.x * 300, cy + E.lightDirC.y * 300, sz + E.lightDirC.z * 300);
    sun.target.updateMatrixWorld();
    sky.position.copy(cam.position);
    rain.position.copy(cam.position);
    stars.position.copy(cam.position);
    water.position.x = Math.round(cam.position.x / 50) * 50;
    water.position.z = Math.round(cam.position.z / 50) * 50;
  }

  return Object.assign(E, {
    init, update, prepareView, setQuality,
    get isNight() { return E.night > 0.6; },
    clock() { const h = Math.floor(E.hour), m = Math.floor((E.hour - h) * 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; },
  });
})();
