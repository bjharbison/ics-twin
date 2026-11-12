/* ============================================================================
   twin3d-kit.js  ·  ESP32 Fleet Digital Twins — shared 3D scaffolding
   ----------------------------------------------------------------------------
   Three reusable pieces every twin's 3D view needs, extracted from the grid twin
   so water / datacenter / pipeline / etc. inherit them instead of re-deriving:

     1) Twin3D.addLighting(scene)      — the BRIGHT baseline (fixes dark scenes)
     2) Twin3D.createOrbitNav(...)     — drag-orbit + nav pad (presets, zoom,
                                          rotate, RESET, CENTER-to-fit); touch
                                          orbit, pinch-zoom, shift-drag pan
     3) Twin3D.parts.*                 — procedural equipment parts (insulators,
                                          pipe runs, cables, flow beads, live
                                          labels, fence, ground, buildings)

   No build step. Requires THREE (r128) already loaded globally. Vanilla JS.

   ── Why this exists ─────────────────────────────────────────────────────────
   Default three.js scenes on this project keep coming out too dark: dim ambient,
   near-black PBR metals with nothing to catch, and fog that eats the far geometry.
   addLighting() is the corrected floor — start here, don't darken back out of it.

   ── Minimal usage ───────────────────────────────────────────────────────────
     <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
     <script src="twin3d-kit.js"></script>
     ...
     const scene   = new THREE.Scene();
     const camera  = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
     Twin3D.addLighting(scene);                 // ← bright baseline + fog

     const content = new THREE.Group();          // put EQUIPMENT here (not ground)
     scene.add(content);                         // CENTER frames this, not the grid
     // ... add busbars / tanks / pumps / racks to `content` ...

     const nav = Twin3D.createOrbitNav({
       THREE, camera,
       dom: document.getElementById('glWrap'),   // the element receiving pointer events
       navpadEl: document.getElementById('navpad'), // optional; auto-created if omitted
       focus: () => content,                     // what CENTER / initial fit frames
       // home: {az:-0.9, el:0.55, r:340, tx:10, ty:40, tz:0}, // optional custom home
     });

     function frame(){ nav.update(); renderer.render(scene, camera); requestAnimationFrame(frame); }
     // call nav.setVisible(true/false) when you toggle in/out of the 3D view.

   ── CSS ─────────────────────────────────────────────────────────────────────
   Twin3D.navpadCSS() returns the stylesheet string for the pad; inject once:
     const s=document.createElement('style'); s.textContent=Twin3D.navpadCSS();
     document.head.appendChild(s);
   (Uses the shared twin CSS vars: --panel,--line,--ink,--ink-dim,--phase-b.)
============================================================================ */
(function (global) {
  'use strict';
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  /* ---- 1) Lighting: the bright baseline ---------------------------------- */
  function addLighting(scene, opts = {}) {
    const T = global.THREE;
    const o = Object.assign({
      ambient: 1.15, hemi: 0.9, key: 1.35, fill: 0.55, rim: 0.55,
      fog: 0.0025, fogColor: 0x0a0e14,
      keyColor: 0xdcecff, fillColor: 0x9fc2ff, rimColor: 0x3bd6f2,
      ambientColor: 0x9fb4d0, hemiSky: 0xbfe0ff, hemiGround: 0x1a2536,
    }, opts);

    if (o.fog) scene.fog = new T.FogExp2(o.fogColor, o.fog);
    scene.add(new T.AmbientLight(o.ambientColor, o.ambient));
    scene.add(new T.HemisphereLight(o.hemiSky, o.hemiGround, o.hemi)); // sky/ground fill
    const key  = new T.DirectionalLight(o.keyColor,  o.key);  key.position.set(90, 150, 70);
    const fill = new T.DirectionalLight(o.fillColor, o.fill); fill.position.set(-60, 80, 90);
    const rim  = new T.DirectionalLight(o.rimColor,  o.rim);  rim.position.set(-90, 50, -70);
    scene.add(key, fill, rim);

    // Optional soft shadows from the key light. `shadows` is the half-extent
    // (world units) of the area that should receive them. Pair with
    // Twin3D.setupRenderer(renderer) and Twin3D.enableShadows(group).
    if (o.shadows) {
      const e = o.shadows;
      key.position.set(e * 0.55, e * 0.95, -e * 0.45);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      const c = key.shadow.camera;
      c.left = -e; c.right = e; c.top = e; c.bottom = -e; c.near = 1; c.far = e * 3.2;
      c.updateProjectionMatrix();
      key.shadow.bias = -0.0006;
      key.shadow.normalBias = 0.6;
      scene.add(key.target);
    }
    return { key, fill, rim };
  }

  /* Renderer defaults shared by every twin's 3D view. */
  function setupRenderer(renderer) {
    const T = global.THREE;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    return renderer;
  }

  /* Mark every opaque mesh under `root` as a shadow caster/receiver.
     Opt out per mesh with mesh.userData.noShadow = true. */
  function enableShadows(root) {
    root.traverse(m => {
      if (!m.isMesh || m.userData.noShadow) return;
      const mat = m.material;
      if (mat && mat.transparent) { m.receiveShadow = false; return; }
      m.castShadow = true; m.receiveShadow = true;
    });
  }

  /* Material helper: keep equipment metals light enough to catch the fill.
     Rule of thumb learned on the grid twin — nothing darker than ~#2c-#4a base. */
  function equipMaterial(color, extra = {}) {
    return new global.THREE.MeshStandardMaterial(
      Object.assign({ color, metalness: 0.45, roughness: 0.55 }, extra));
  }

  /* ---- 2) Orbit + nav pad ------------------------------------------------ */
  const DEFAULT_VIEWS = {
    iso:   { az: -0.9,          el: 0.55, r: 340 },
    front: { az: -Math.PI / 2,  el: 0.14, r: 330 },
    top:   { az: -Math.PI / 2,  el: 1.32, r: 360 },
    side:  { az: 0,             el: 0.20, r: 330 },
  };
  const DEFAULT_HOME = { az: -0.9, el: 0.55, r: 340, tx: 10, ty: 40, tz: 0 };

  function buildNavpad(el) {
    el.classList.add('navpad');
    el.innerHTML = `
      <div class="navrow">
        <button data-view="iso"   title="Isometric">ISO</button>
        <button data-view="front" title="Front elevation">FRONT</button>
        <button data-view="top"   title="Plan / top-down">TOP</button>
        <button data-view="side"  title="Side">SIDE</button>
      </div>
      <div class="navrow">
        <button data-nav="in"   title="Zoom in">＋</button>
        <button data-nav="out"  title="Zoom out">－</button>
        <button data-nav="rotl" title="Rotate left">↺</button>
        <button data-nav="rotr" title="Rotate right">↻</button>
        <button data-nav="center" title="Center model in view">CENTER</button>
        <button data-nav="reset"  title="Reset view" class="wide">RESET</button>
      </div>`;
  }

  function createOrbitNav(cfg) {
    const T = cfg.THREE || global.THREE;
    const camera = cfg.camera;
    const dom = cfg.dom;
    const rMin = cfg.rMin || 140, rMax = cfg.rMax || 620;
    const HOME = Object.assign({}, DEFAULT_HOME, cfg.home);
    const VIEWS = Object.assign({}, DEFAULT_VIEWS, cfg.views);
    const focus = cfg.focus || (() => null); // () => Object3D | Box3

    let orb = Object.assign({}, HOME);
    let target = null;                        // when set, ease orb toward it

    // nav pad element (create one if not supplied)
    let pad = cfg.navpadEl;
    if (!pad) { pad = document.createElement('div'); (cfg.mount || document.body).appendChild(pad); }
    buildNavpad(pad);

    function goView(v) { const p = VIEWS[v] || {}; target = Object.assign({}, orb, p); }
    function centerView() {
      const f = focus(); if (!f) return;
      const box = (f.isBox3) ? f.clone() : new T.Box3().setFromObject(f);
      if (box.isEmpty()) return;
      const c = box.getCenter(new T.Vector3());
      const sph = box.getBoundingSphere(new T.Sphere());
      // fit against the tighter of the vertical / horizontal field of view, so
      // CENTER also frames correctly on a narrow (phone) stage
      const vfov = T.MathUtils.degToRad(camera.fov);
      const fov = Math.min(vfov, 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect));
      const fit = sph.radius / Math.sin(fov / 2) * (cfg.fitMargin || 1.15);
      target = Object.assign({}, orb, { tx: c.x, ty: c.y, tz: c.z, r: clamp(fit, rMin, rMax) });
    }
    function nudge(k) {
      target = null;
      if (k === 'in')   orb.r = clamp(orb.r - 45, rMin, rMax);
      if (k === 'out')  orb.r = clamp(orb.r + 45, rMin, rMax);
      if (k === 'rotl') orb.az -= 0.28;
      if (k === 'rotr') orb.az += 0.28;
      if (k === 'reset') target = Object.assign({}, HOME);
    }

    // drag-orbit + wheel-zoom
    // Touch: one finger orbits, two fingers pinch-zoom. Mouse: drag orbits,
    // shift-drag (or right-drag) pans the look-at point across the ground.
    dom.style.touchAction = 'none';
    dom.addEventListener('contextmenu', e => e.preventDefault());
    let dragging = false, panning = false, px = 0, py = 0, pinch = 0;
    const touches = new Map();
    const pinchDist = () => {
      const p = [...touches.values()];
      return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
    };
    dom.addEventListener('pointerdown', e => {
      if (e.target.closest('.navpad')) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) { pinch = pinchDist(); dragging = false; return; }
      dragging = true; panning = e.shiftKey || e.button === 2;
      px = e.clientX; py = e.clientY; target = null;
    });
    window.addEventListener('pointermove', e => {
      if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2 && pinch) {
        const d = pinchDist();
        if (d > 0) { orb.r = clamp(orb.r * pinch / d, rMin, rMax); pinch = d; target = null; }
        return;
      }
      if (!dragging) return;
      const dx = e.clientX - px, dy = e.clientY - py;
      if (panning) {
        const k = orb.r * 0.0016, s = Math.sin(orb.az), c = Math.cos(orb.az);
        orb.tx += (-s * dx - c * dy) * k;
        orb.tz += ( c * dx - s * dy) * k;
      } else {
        orb.az -= dx * 0.006;
        orb.el = clamp(orb.el - dy * 0.005, 0.12, 1.35);
      }
      px = e.clientX; py = e.clientY;
    });
    const release = e => {
      touches.delete(e.pointerId);
      if (touches.size < 2) pinch = 0;
      if (touches.size === 0) dragging = false;
      else { const p = [...touches.values()][0]; px = p.x; py = p.y; dragging = true; panning = false; }
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    dom.addEventListener('wheel', e => {
      e.preventDefault(); target = null;
      orb.r = clamp(orb.r + e.deltaY * 0.4, rMin, rMax);
    }, { passive: false });

    // pad clicks
    pad.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.view) goView(b.dataset.view);
      else if (b.dataset.nav === 'center') centerView();
      else if (b.dataset.nav) nudge(b.dataset.nav);
    });

    // call once per frame
    function update() {
      if (target) {
        const k = 0.15; let done = true;
        for (const key of ['az', 'el', 'r', 'tx', 'ty', 'tz']) {
          orb[key] += (target[key] - orb[key]) * k;
          if (Math.abs(target[key] - orb[key]) > 0.002) done = false;
        }
        if (done) { Object.assign(orb, target); target = null; }
      }
      const { az, el, r, tx, ty, tz } = orb;
      camera.position.set(tx + r * Math.cos(el) * Math.cos(az),
                          ty + r * Math.sin(el),
                          tz + r * Math.cos(el) * Math.sin(az));
      camera.lookAt(tx, ty, tz);
    }

    return {
      update, goView, centerView, nudge, pad, orb,
      setVisible(on) { pad.classList.toggle('on', !!on); },
      setHome(h) { Object.assign(HOME, h); },
    };
  }

  function navpadCSS() {
    return `
.navpad{position:absolute;right:16px;bottom:14px;display:none;flex-direction:column;gap:7px;align-items:flex-end}
.navpad.on{display:flex}
.navrow{display:flex;gap:6px}
.navpad button{font-family:"IBM Plex Mono",monospace;font-size:11px;letter-spacing:.5px;
  min-width:34px;height:30px;padding:0 8px;cursor:pointer;color:var(--ink-dim,#7d8da0);
  background:rgba(15,21,30,.82);border:1px solid var(--line,#1e2a3a);border-radius:7px;
  backdrop-filter:blur(6px);transition:.12s}
.navpad button:hover{color:var(--ink,#dbe6f2);border-color:var(--phase-b,#3bd6f2);background:rgba(19,27,38,.92)}
.navpad button:active{transform:translateY(1px)}
.navpad button.wide{min-width:52px}`;
  }


  /* ---- 3) Parts library --------------------------------------------------
     Small procedural building blocks shared by every twin's 3D scene, so a new
     role assembles a plant from parts instead of re-deriving geometry.
     Everything here is plain three.js r128 primitives: no loaders, no assets. */
  const _geo = {};
  function geo(key, make) { return _geo[key] || (_geo[key] = make()); }

  const PALETTE = {
    galv: 0x8fa1b6, steel: 0x5b6f88, dark: 0x3a4a5f, concrete: 0x5f6a78,
    gravel: 0x2b3542, porcelain: 0xaab7c5, glass: 0x9fd8ee, ok: 0x4fe08a,
    warn: 0xf2c53b, red: 0xff4d5e, teal: 0x2fd4c4,
  };
  function mat(color, extra) {
    return new global.THREE.MeshStandardMaterial(
      Object.assign({ color, metalness: 0.45, roughness: 0.55 }, extra || {}));
  }
  function concreteMat(color) { return mat(color || PALETTE.concrete, { metalness: 0, roughness: 0.95 }); }

  function box(parent, w, h, d, m, x, y, z) {
    const T = global.THREE;
    const o = new T.Mesh(geo('box', () => new T.BoxGeometry(1, 1, 1)), m);
    o.scale.set(w, h, d); o.position.set(x || 0, y || 0, z || 0);
    if (parent) parent.add(o); return o;
  }
  /* cylinder between two points (any orientation) */
  function rod(parent, a, b, r, m, seg) {
    const T = global.THREE;
    const va = new T.Vector3(a[0], a[1], a[2]), vb = new T.Vector3(b[0], b[1], b[2]);
    const len = va.distanceTo(vb) || 0.001;
    const s = seg || 12;
    const o = new T.Mesh(geo('cyl' + s, () => new T.CylinderGeometry(1, 1, 1, s)), m);
    o.scale.set(r, len, r);
    o.position.copy(va).add(vb).multiplyScalar(0.5);
    o.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), vb.sub(va).normalize());
    if (parent) parent.add(o); return o;
  }

  /* Shedded insulator standing on +Y from the group's origin, total height h. */
  function insulator(h, r, sheds, m, capMat) {
    const T = global.THREE, g = new T.Group();
    const n = sheds || Math.max(3, Math.round(h / 5));
    const cap = capMat || mat(PALETTE.galv, { metalness: 0.7, roughness: 0.4 });
    const capH = Math.min(2.2, h * 0.1);
    rod(g, [0, 0, 0], [0, capH, 0], r * 0.62, cap);
    rod(g, [0, h - capH, 0], [0, h, 0], r * 0.62, cap);
    rod(g, [0, capH, 0], [0, h - capH, 0], r * 0.42, m);
    const step = (h - 2 * capH) / n;
    const shedGeo = geo('shed', () => new T.CylinderGeometry(0.5, 1, 1, 16));
    for (let i = 0; i < n; i++) {
      const s = new T.Mesh(shedGeo, m);
      s.scale.set(r, step * 0.55, r);
      s.position.y = capH + step * (i + 0.5);
      g.add(s);
    }
    return g;
  }

  /* Polyline pipe: straight runs, ball elbows, optional end flanges.
     Returns { group, curve } where curve is arc-length parameterised (0..1). */
  function pipeRun(parent, pts, r, m, opts) {
    const T = global.THREE, o = opts || {}, g = new T.Group();
    const path = new T.CurvePath();
    const ball = geo('ball', () => new T.SphereGeometry(1, 14, 10));
    for (let i = 0; i < pts.length - 1; i++) {
      rod(g, pts[i], pts[i + 1], r, m, 14);
      path.add(new T.LineCurve3(new T.Vector3(...pts[i]), new T.Vector3(...pts[i + 1])));
      if (i > 0) { const e = new T.Mesh(ball, m); e.scale.setScalar(r * 1.04); e.position.set(...pts[i]); g.add(e); }
    }
    if (o.flanges) {
      const fm = o.flangeMat || m;
      [[pts[0], pts[1]], [pts[pts.length - 1], pts[pts.length - 2]]].forEach(([p, q]) => {
        const d = new T.Vector3(q[0] - p[0], q[1] - p[1], q[2] - p[2]).normalize().multiplyScalar(r * 0.5);
        rod(g, p, [p[0] + d.x, p[1] + d.y, p[2] + d.z], r * 1.55, fm, 16);
      });
    }
    if (parent) parent.add(g);
    return { group: g, curve: path };
  }

  /* Smooth cable/conductor through points (Catmull-Rom). Returns { mesh, curve }. */
  function cable(parent, pts, r, m, segs) {
    const T = global.THREE;
    const curve = new T.CatmullRomCurve3(pts.map(p => new T.Vector3(p[0], p[1], p[2])), false, 'centripetal');
    const mesh = new T.Mesh(new T.TubeGeometry(curve, segs || 28, r, 7, false), m);
    if (parent) parent.add(mesh);
    return { mesh, curve };
  }
  /* A span that sags by `drop` at mid-point (overhead line between supports). */
  function sagPts(a, b, drop, n) {
    const out = [], k = n || 6;
    for (let i = 0; i <= k; i++) {
      const f = i / k;
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f - drop * 4 * f * (1 - f), a[2] + (b[2] - a[2]) * f]);
    }
    return out;
  }

  /* Flow beads riding a list of curves end-to-end. advance(dist) moves them by
     world units; setVisible hides them when nothing is flowing. */
  function flowBeads(parent, curves, opts) {
    const T = global.THREE, o = Object.assign({ spacing: 22, size: 1.7, color: 0xffffff }, opts || {});
    const lens = curves.map(c => c.getLength());
    const total = lens.reduce((a, b) => a + b, 0) || 1;
    const count = Math.max(2, Math.round(total / o.spacing));
    const m = new T.MeshBasicMaterial({ color: o.color, fog: false });
    const g = geo('bead', () => new T.SphereGeometry(1, 10, 8));
    const beads = [];
    for (let i = 0; i < count; i++) {
      const b = new T.Mesh(g, m); b.scale.setScalar(o.size); b.userData.noShadow = true;
      parent.add(b); beads.push(b);
    }
    let phase = 0;
    const v = new T.Vector3();
    function place() {
      for (let i = 0; i < count; i++) {
        let d = ((i / count + phase) % 1 + 1) % 1 * total, k = 0;
        while (k < lens.length - 1 && d > lens[k]) { d -= lens[k]; k++; }
        // use the return value: r128's CurvePath.getPoint ignores the target arg
        const pt = curves[k].getPointAt(Math.min(1, d / lens[k]), v);
        if (pt) beads[i].position.copy(pt);
      }
    }
    place();
    return {
      material: m, total,
      advance(dist) { phase = (phase + dist / total) % 1; place(); },
      setVisible(on) { for (const b of beads) b.visible = on; },
    };
  }

  /* Canvas-texture billboard: small caps title + live value. Redraws only when
     the text or colour changes, so calling set() every frame is free. */
  function label(parent, title, opts) {
    const T = global.THREE, o = Object.assign({ width: 0.2, accent: '#3bd6f2' }, opts || {});
    const W = 512, H = 144, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const tex = new T.CanvasTexture(cv); tex.minFilter = T.LinearFilter;
    // sizeAttenuation:false → constant on-screen size, so labels stay legible at
    // any zoom (and on a phone). `width` is a fraction of view height, roughly.
    const sp = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthTest: false,
      depthWrite: false, fog: false, sizeAttenuation: false }));
    sp.center.set(0.5, 0);                       // anchored at its bottom edge
    const setScale = k => sp.scale.set(o.width * k, o.width * k * H / W, 1);
    setScale(1); sp.renderOrder = 10; sp.userData.noShadow = true;
    let last = null;
    function draw(value, color) {
      const key = value + '|' + color; if (key === last) return; last = key;
      ctx.clearRect(0, 0, W, H);
      const r = 18;
      ctx.beginPath();
      ctx.moveTo(r, 4); ctx.lineTo(W - r, 4); ctx.quadraticCurveTo(W - 4, 4, W - 4, r);
      ctx.lineTo(W - 4, H - r); ctx.quadraticCurveTo(W - 4, H - 4, W - r, H - 4);
      ctx.lineTo(r, H - 4); ctx.quadraticCurveTo(4, H - 4, 4, H - r);
      ctx.lineTo(4, r); ctx.quadraticCurveTo(4, 4, r, 4); ctx.closePath();
      ctx.fillStyle = 'rgba(10,15,22,.86)'; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = color || o.accent; ctx.globalAlpha = 0.75; ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = color || o.accent; ctx.fillRect(4, 26, 7, H - 52);
      ctx.textBaseline = 'middle';
      ctx.font = '600 30px "IBM Plex Mono", ui-monospace, Menlo, monospace';
      ctx.fillStyle = '#8fa0b4'; ctx.fillText(title.toUpperCase(), 30, 44, W - 50);
      ctx.font = '600 50px "IBM Plex Mono", ui-monospace, Menlo, monospace';
      ctx.fillStyle = color || '#e6f0fa'; ctx.fillText(value, 30, 100, W - 50);
      tex.needsUpdate = true;
    }
    draw(o.value || '', o.color || null);
    if (o.at) sp.position.set(o.at[0], o.at[1], o.at[2]);
    if (o.leaderTo && parent) {
      const lm = new T.LineBasicMaterial({ color: 0x5f7892, transparent: true, opacity: 0.7, fog: false });
      const lg = new T.BufferGeometry().setFromPoints([
        new T.Vector3(o.at[0], o.at[1], o.at[2]), new T.Vector3(...o.leaderTo)]);
      parent.add(new T.Line(lg, lm));
    }
    if (parent) parent.add(sp);
    return { sprite: sp, set: draw, setScale };
  }

  /* Site ground: dark terrain + reference grid + a lighter surfaced pad. */
  function ground(scene, opts) {
    const T = global.THREE, o = Object.assign({ pad: [520, 280], padCenter: [0, 0], padColor: PALETTE.gravel, size: 2600 }, opts || {});
    const g = new T.Group();
    const terrain = new T.Mesh(new T.PlaneGeometry(o.size, o.size), new T.MeshStandardMaterial({ color: 0x121923, roughness: 1, metalness: 0 }));
    terrain.rotation.x = -Math.PI / 2; terrain.position.y = -0.3; terrain.receiveShadow = true; g.add(terrain);
    const grid = new T.GridHelper(o.size / 2, Math.round(o.size / 80), 0x2a3b52, 0x1a2636);
    grid.material.transparent = true; grid.material.opacity = 0.55; grid.position.y = -0.2; g.add(grid);
    const pad = new T.Mesh(new T.PlaneGeometry(o.pad[0], o.pad[1]), new T.MeshStandardMaterial({ color: o.padColor, roughness: 1, metalness: 0 }));
    pad.rotation.x = -Math.PI / 2; pad.position.set(o.padCenter[0], 0, o.padCenter[1]); pad.receiveShadow = true; g.add(pad);
    scene.add(g);
    return g;
  }

  /* Chain-link perimeter fence around a rectangle [x0,x1] x [z0,z1]. */
  function fence(parent, x0, x1, z0, z1, h, opts) {
    const T = global.THREE, o = opts || {}, g = new T.Group();
    const cv = document.createElement('canvas'); cv.width = cv.height = 32;
    const c = cv.getContext('2d'); c.strokeStyle = 'rgba(160,180,205,.9)'; c.lineWidth = 1.6;
    c.beginPath(); c.moveTo(0, 0); c.lineTo(32, 32); c.moveTo(32, 0); c.lineTo(0, 32); c.stroke();
    const post = mat(PALETTE.galv, { metalness: 0.6, roughness: 0.5 });
    const side = (ax, az, bx, bz) => {
      const len = Math.hypot(bx - ax, bz - az);
      const tex = new T.CanvasTexture(cv); tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.repeat.set(len / 5, h / 5);
      const m = new T.Mesh(new T.PlaneGeometry(len, h),
        new T.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.42, side: T.DoubleSide, depthWrite: false }));
      m.position.set((ax + bx) / 2, h / 2, (az + bz) / 2); m.rotation.y = -Math.atan2(bz - az, bx - ax);
      m.userData.noShadow = true; g.add(m);
      const n = Math.max(1, Math.round(len / 40));
      for (let i = 0; i <= n; i++) {
        const f = i / n, x = ax + (bx - ax) * f, z = az + (bz - az) * f;
        rod(g, [x, 0, z], [x, h + 1.5, z], 0.8, post, 8);
      }
      rod(g, [ax, h, az], [bx, h, bz], 0.5, post, 6);
    };
    side(x0, z0, x1, z0); side(x1, z0, x1, z1); side(x1, z1, x0, z1); side(x0, z1, x0, z0);
    if (o.gate) { // a pair of gate leaves, slightly ajar, drawn on the z0 side
      const gx = o.gate, gm = mat(PALETTE.steel);
      rod(g, [gx - 16, 0, z0], [gx - 16, h + 5, z0], 1.3, gm, 8);
      rod(g, [gx + 16, 0, z0], [gx + 16, h + 5, z0], 1.3, gm, 8);
    }
    if (parent) parent.add(g);
    return g;
  }

  /* Small utility building with lit windows (control house, ops building). */
  function building(parent, x, z, w, h, d, opts) {
    const T = global.THREE, o = opts || {}, g = new T.Group();
    box(g, w, h, d, mat(o.color || 0x55657a, { metalness: 0.1, roughness: 0.85 }), 0, h / 2, 0);
    box(g, w + 5, 2.4, d + 5, mat(0x3c4a5d, { metalness: 0.2, roughness: 0.8 }), 0, h + 1.2, 0);
    box(g, w + 2, 2, d + 2, concreteMat(), 0, 1, 0);
    const win = new T.MeshStandardMaterial({ color: 0x1b2836, emissive: o.glow || 0xf2c98a, emissiveIntensity: 0.85, roughness: 0.4 });
    const face = o.face === '+z' ? 1 : -1;
    const nWin = o.windows || 3;
    for (let i = 0; i < nWin; i++) {
      const wx = -w / 2 + w * (i + 0.5) / (nWin + 1);
      const m = box(g, w / (nWin + 1) * 0.55, h * 0.26, 0.6, win, wx, h * 0.62, face * (d / 2 + 0.2));
      m.userData.noShadow = true;
    }
    box(g, w * 0.11, h * 0.62, 0.7, mat(0x2c3948, { metalness: 0.4, roughness: 0.6 }), w / 2 - w * 0.14, h * 0.31 + 2, face * (d / 2 + 0.2));
    box(g, 12, 7, 9, mat(PALETTE.steel), -w / 2 + 12, h + 5.8, 0); // rooftop HVAC unit
    g.position.set(x, 0, z);
    if (parent) parent.add(g);
    return g;
  }

  /* Shared threshold ramp (teal -> amber -> red) as a THREE.Color. */
  function ramp(f) {
    const T = global.THREE, a = new T.Color(PALETTE.teal), b = new T.Color(PALETTE.warn), c = new T.Color(PALETTE.red);
    f = clamp(f, 0, 1);
    return f <= 0.5 ? a.lerp(b, f * 2) : b.lerp(c, (f - 0.5) * 2);
  }

  /* Scale factor for label sprites so they land at a sensible pixel width on
     any stage size: ~104 px on a phone up to ~175 px on a desktop. */
  function labelScale(w, h, fovDeg) {
    const px = clamp(w * 0.17, 104, 175);
    return px * 2 * Math.tan((fovDeg || 45) * Math.PI / 360) / (0.2 * h);
  }
  /* Pull a home/preset view back on narrow stages so the whole plant stays in frame. */
  function homeFor(home, aspect, wide) {
    return Object.assign({}, home, { r: home.r * Math.max(1, (wide || 1.55) / aspect) });
  }

  const parts = { PALETTE, mat, concreteMat, box, rod, insulator, pipeRun, cable, sagPts,
                  flowBeads, label, ground, fence, building, ramp, clamp };

  global.Twin3D = { addLighting, setupRenderer, enableShadows, equipMaterial,
                    createOrbitNav, navpadCSS, DEFAULT_VIEWS, DEFAULT_HOME,
                    labelScale, homeFor, parts };
})(typeof window !== 'undefined' ? window : this);
