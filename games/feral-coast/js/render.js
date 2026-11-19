'use strict';
// Rendering: per-viewport post-processing (bloom, grading, vignette, damage desaturation) and quality presets.
FC.Render = (function () {
  let renderer, scene;
  const views = []; // per player { composer, bloom, grade, w, h }
  let quality = 'high';

  const GradeShader = {
    uniforms: {
      tDiffuse: { value: null }, uVignette: { value: 0.35 }, uSat: { value: 1.12 }, uDamage: { value: 0 },
      uWarm: { value: new THREE.Vector3(1.03, 1.0, 0.95) }, uDown: { value: 0 }, uFlash: { value: 0 },
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float uVignette, uSat, uDamage, uDown, uFlash; uniform vec3 uWarm; varying vec2 vUv;
      void main(){
        vec4 c = texture2D(tDiffuse, vUv);
        float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
        c.rgb = mix(vec3(l), c.rgb, uSat * (1.0 - uDown * 0.85));
        c.rgb *= uWarm;
        c.rgb = mix(c.rgb, vec3(l) * vec3(1.6, 0.45, 0.4), uDamage * 0.45);
        float v = smoothstep(0.95, 0.25, length(vUv - 0.5) * (1.0 + uDamage * 0.5));
        c.rgb *= mix(1.0, v, uVignette + uDamage * 0.4);
        c.rgb += uFlash;
        gl_FragColor = c;
      }`,
  };

  function init(r, s) {
    renderer = r; scene = s;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  // Per-viewport composers. High: N8AO ambient occlusion (renders the scene) + bloom + grade + SMAA.
  // Medium: plain render (MSAA) + grade. Built lazily per quality level.
  function build(cam, q) {
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: q === 'high' ? 0 : 4 });
    const composer = new THREE.EffectComposer(renderer, rt);
    const v = { composer, q, w: 0, h: 0 };
    if (q === 'high' && THREE.N8AOPass) {
      try {
        v.ao = new THREE.N8AOPass(scene, cam, 2, 2);
        Object.assign(v.ao.configuration, { aoRadius: 2.2, distanceFalloff: 1.2, intensity: 2.2, aoSamples: 12, denoiseSamples: 6, halfRes: true, gammaCorrection: false });
        composer.addPass(v.ao);
      } catch (e) { v.ao = null; }
    }
    if (!v.ao) { v.rp = new THREE.RenderPass(scene, cam); composer.addPass(v.rp); }
    if (q === 'high') { v.bloom = new THREE.UnrealBloomPass(new THREE.Vector2(256, 256), 0.3, 0.55, 0.9); composer.addPass(v.bloom); }
    v.grade = new THREE.ShaderPass(GradeShader); composer.addPass(v.grade);
    composer.addPass(new THREE.OutputPass());
    if (q === 'high' && THREE.SMAAPass) { v.smaa = new THREE.SMAAPass(2, 2); composer.addPass(v.smaa); }
    return v;
  }
  function ensure(i, cam, w, h) {
    const pr = renderer.getPixelRatio();
    let v = views[i];
    if (!v || v.q !== quality) {
      if (v) v.composer.dispose();
      v = views[i] = build(cam, quality);
    }
    if (v.rp) v.rp.camera = cam;
    if (v.ao) v.ao.camera = cam;
    if (v.w !== w || v.h !== h) {
      v.w = w; v.h = h;
      v.composer.setPixelRatio(pr);
      v.composer.setSize(w, h);
    }
    return v;
  }

  // Render one viewport rect (CSS px, top-left origin) for camera cam.
  function renderView(i, cam, rect, H, fx) {
    const y = H - rect.y - rect.h;
    renderer.setViewport(rect.x, y, rect.w, rect.h);
    renderer.setScissor(rect.x, y, rect.w, rect.h);
    renderer.setScissorTest(true);
    if (quality === 'low') {
      renderer.setRenderTarget(null);
      renderer.render(scene, cam);
      return;
    }
    const v = ensure(i, cam, Math.max(1, Math.floor(rect.w)), Math.max(1, Math.floor(rect.h)));
    const u = v.grade.uniforms;
    u.uDamage.value = fx ? fx.damage : 0;
    u.uDown.value = fx ? fx.down : 0;
    u.uFlash.value = fx ? fx.flash : 0;
    u.uSat.value = 1.1 - (FC.Env.night || 0) * 0.15;
    u.uWarm.value.set(1.03 + (FC.Env.night || 0) * -0.08, 1.0, 0.95 + (FC.Env.night || 0) * 0.12);
    // EffectComposer renders its final pass to the default framebuffer using the current viewport
    v.composer.render();
  }

  return {
    init, renderView,
    get quality() { return quality; },
    setQuality(q) {
      quality = q;
      renderer.shadowMap.enabled = q !== 'low';
      renderer.setPixelRatio(Math.min(q === 'high' ? 1.5 : 1, window.devicePixelRatio || 1));
      for (const v of views) v.w = 0;
      if (FC.Env.setQuality) FC.Env.setQuality(q);
      if (FC.Foliage.setQuality) FC.Foliage.setQuality(q);
      scene.traverse((o) => { if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((m) => { m.needsUpdate = true; }); } });
    },
  };
})();
