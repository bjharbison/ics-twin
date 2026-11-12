/* ============================================================================
   grid-scene3d.js  ·  Grid substation twin — 3D yard model
   ----------------------------------------------------------------------------
   A procedural model of a small 12.47 kV distribution yard, assembled from
   Twin3D.parts. It is a RENDERER only: it owns no physics and reads one
   view-model per frame, so sim / live MQTT / replay all drive it identically.

     const yard = GridScene3D.build(scene, content);   // content = equipment group
     yard.update({ V:[a,b,c], I:[a,b,c], temp, breakerClosed, realKw }, dt);

   Layout, source to load (+X):
     source pole → dead-end structure → bus A → breaker 52-F1 → bus B
       → transformer XFMR-1 → bus C → feeder dead-end → feeder pole

   What is driven by state (nothing is animated in isolation):
     · flow beads on every conductor     speed ∝ mean phase current
     · breaker moving contacts + flags   breaker_status
     · downstream conductors dim         breaker open (voltage tag still holds)
     · transformer tank / radiator glow  transformer_temp (teal → amber → red)
     · cooling fans                      spin up with transformer_temp
     · live labels                       voltage, breaker, temp, current, power

   Requires THREE r128 and twin3d-kit.js loaded first. No build step.
============================================================================ */
(function (global) {
  'use strict';

  const PHASE_HEX = [0xf2a63b, 0x3bd6f2, 0xe04ff2];   // A amber · B cyan · C magenta
  const ZROW = [-30, 0, 30];                           // phase spacing across the yard
  const BUS_Y = 62;                                    // rigid bus height
  const X = { farSrc: -480, srcPole: -335, srcDE: -230, busA0: -214, brk: -110,
              busB1: -24, xf: 40, busC0: 96, busC1: 186, fdrDE: 200, fdrPole: 325, farFdr: 480 };

  function build(scene, content) {
    const T = global.THREE, K = global.Twin3D.parts, P = K.PALETTE;
    const env = new T.Group(); scene.add(env);          // context: not framed by CENTER

    /* ---------- materials ---------- */
    const galv = K.mat(P.galv, { metalness: 0.65, roughness: 0.42 });
    const steel = K.mat(P.steel, { metalness: 0.55, roughness: 0.5 });
    const dark = K.mat(P.dark, { metalness: 0.5, roughness: 0.55 });
    const conc = K.concreteMat();
    const porc = K.mat(P.porcelain, { metalness: 0.05, roughness: 0.35 });
    const wood = K.mat(0x5a4a3c, { metalness: 0, roughness: 0.9 });
    // one conductor material per phase and side of the breaker (up / down)
    const cond = PHASE_HEX.map(c => ({
      up: new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.55, metalness: 0.4, roughness: 0.5 }),
      down: new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.55, metalness: 0.4, roughness: 0.5 }),
    }));

    /* ---------- site ---------- */
    K.ground(scene, { pad: [540, 255], padCenter: [-10, -27.5] });
    K.fence(env, -280, 260, -155, 100, 24);

    // precast cable trench: control house → breaker → transformer
    const trench = K.concreteMat(0x8792a0);
    for (let x = -150; x <= 60; x += 10) K.box(env, 9.2, 1.2, 9, trench, x, 0.6, -66);
    for (let z = -96; z <= -76; z += 10) K.box(env, 9, 1.2, 9.2, trench, -150, 0.6, z);
    K.box(env, 9, 1.2, 34, trench, -110, 0.6, -46);
    K.box(env, 9, 1.2, 10, trench, 60, 0.6, -66);

    // control house sits behind the bus (−Z) with its windows facing the yard
    K.building(env, -150, -122, 76, 30, 40, { windows: 3, face: '+z' });

    // lightning masts + yard lights
    [[-262, 86], [242, -140]].forEach(([x, z]) => {
      K.box(env, 8, 2, 8, conc, x, 1, z);
      const m = new T.Mesh(new T.CylinderGeometry(0.5, 1.6, 150, 8), galv); m.position.set(x, 75, z); env.add(m);
    });
    const lamp = new T.MeshBasicMaterial({ color: 0xffe9bf, fog: false });
    [[-262, -140, -1], [242, 86, 1]].forEach(([x, z, dir]) => {
      K.rod(env, [x, 0, z], [x, 74, z], 1.1, galv, 8);
      K.rod(env, [x, 74, z], [x - Math.sign(x) * 14, 76, z - dir * 10], 0.8, galv, 6);
      const h = K.box(env, 7, 1.6, 4, lamp, x - Math.sign(x) * 14, 75, z - dir * 10); h.userData.noShadow = true;
      const pl = new T.PointLight(0xffe2b0, 0.55, 260, 2); pl.position.set(x - Math.sign(x) * 14, 72, z - dir * 10); env.add(pl);
    });

    /* ---------- reusable structures ---------- */
    // wood pole with crossarm + pin insulators; returns conductor attach height
    function pole(parent, x, h) {
      const p = new T.Mesh(new T.CylinderGeometry(1.7, 2.4, h, 10), wood); p.position.set(x, h / 2, 0); parent.add(p);
      K.box(parent, 4, 4, 86, wood, x, h - 12, 0);
      K.rod(parent, [x, h - 30, 0], [x, h - 12, 26], 0.7, galv, 6);
      K.rod(parent, [x, h - 30, 0], [x, h - 12, -26], 0.7, galv, 6);
      ZROW.forEach(z => { const i = K.insulator(8, 2.6, 3, porc); i.position.set(x, h - 10, z * 1.2); parent.add(i); });
      return h - 2;
    }
    // steel dead-end (A-frame legs + beam) with horizontal strain insulators
    function deadEnd(x, dir) {
      [-48, 48].forEach(z => {
        K.box(content, 12, 2, 12, conc, x, 1, z);
        K.rod(content, [x - 5, 2, z], [x, 92, z], 1.5, galv, 8);
        K.rod(content, [x + 5, 2, z], [x, 92, z], 1.5, galv, 8);
        for (let y = 18; y < 80; y += 18) K.rod(content, [x - 5 + 5 * (y / 90), y, z], [x + 5 - 5 * ((y + 14) / 90), y + 14, z], 0.5, galv, 5);
      });
      K.box(content, 5, 5, 104, galv, x, 89, 0);
      K.rod(content, [x, 92, -48], [x, 104, -48], 0.6, galv, 6);   // shield-wire peaks
      K.rod(content, [x, 92, 48], [x, 104, 48], 0.6, galv, 6);
      ZROW.forEach(z => {
        const i = K.insulator(13, 2.8, 5, porc);
        i.rotation.z = dir > 0 ? Math.PI / 2 : -Math.PI / 2;     // lie along ∓X
        i.position.set(x - dir * 1, 84, z); content.add(i);
        K.rod(content, [x, 86.5, z], [x, 84, z], 0.6, galv, 5);
      });
    }
    // post-insulator bus support: two legs, a beam, three posts
    function busSupport(x) {
      [-40, 40].forEach(z => { K.box(content, 9, 2, 9, conc, x, 1, z); K.box(content, 3.2, 34, 3.2, galv, x, 19, z); });
      K.box(content, 3.6, 3, 86, galv, x, 36, 0);
      ZROW.forEach((z, p) => {
        const i = K.insulator(22, 3.1, 5, porc); i.position.set(x, 37.5, z); content.add(i);
        K.box(content, 4.5, 2.6, 4.5, galv, x, BUS_Y - 1.2, z);   // bus clamp
      });
    }
    function busBar(p, x0, x1, m) {
      K.rod(content, [x0, BUS_Y, ZROW[p]], [x1, BUS_Y, ZROW[p]], 1.8, m, 14);
      return new T.LineCurve3(new T.Vector3(x0, BUS_Y, ZROW[p]), new T.Vector3(x1, BUS_Y, ZROW[p]));
    }

    /* ---------- source side ---------- */
    const yFar = pole(env, X.farSrc, 112);
    const ySrc = pole(env, X.srcPole, 118);
    deadEnd(X.srcDE, +1);
    [X.busA0 + 14, -150].forEach(busSupport);

    /* ---------- breaker 52-F1: three live-tank interrupters on one frame ---------- */
    const xb = X.brk, brk = { contacts: [], glass: [], flags: [] };
    [-14, 14].forEach(dx => [-40, 40].forEach(z => {
      K.box(content, 8, 2, 8, conc, xb + dx, 1, z); K.box(content, 3, 30, 3, steel, xb + dx, 17, z);
    }));
    [-14, 14].forEach(dx => K.box(content, 3.4, 3, 86, steel, xb + dx, 32, 0));
    [-40, 40].forEach(z => K.box(content, 31, 3, 3.4, steel, xb, 32, z));
    K.box(content, 16, 22, 56, K.mat(0x5d7390, { metalness: 0.5, roughness: 0.5 }), xb, 15, 0);   // mechanism cabinet
    K.box(content, 17, 1.2, 57, dark, xb, 26.6, 0);
    const glassMats = [];
    ZROW.forEach((z, p) => {
      [-14, 14].forEach(dx => {
        const i = K.insulator(24, 3.3, 6, porc); i.position.set(xb + dx, 33.5, z); content.add(i);
        K.box(content, 5.6, 7, 5.6, galv, xb + dx, BUS_Y, z);                       // terminal block
      });
      // interrupter: glass chamber, fixed contact (source side), moving contact (load side)
      const gm = new T.MeshStandardMaterial({ color: P.glass, emissive: 0x3bd6f2, emissiveIntensity: 0.12,
        transparent: true, opacity: 0.2, metalness: 0.1, roughness: 0.15, depthWrite: false });
      const g = K.rod(content, [xb - 11.4, BUS_Y, z], [xb + 11.4, BUS_Y, z], 4.4, gm, 20); g.userData.noShadow = true;
      glassMats.push(gm);
      [-11.4, 11.4].forEach(dx => K.rod(content, [xb + dx - 0.6, BUS_Y, z], [xb + dx + 0.6, BUS_Y, z], 4.8, galv, 20));
      const cm = new T.MeshStandardMaterial({ color: PHASE_HEX[p], emissive: PHASE_HEX[p], emissiveIntensity: 0.7, metalness: 0.5, roughness: 0.4 });
      K.rod(content, [xb - 11.4, BUS_Y, z], [xb - 1.5, BUS_Y, z], 1.9, cond[p].up, 10);            // fixed
      const mv = K.rod(content, [xb - 1.5, BUS_Y, z], [xb + 11.4, BUS_Y, z], 1.9, cm, 10);          // moving
      brk.contacts.push({ mesh: mv, mat: cm, x0: mv.position.x, p });
      K.rod(content, [xb + 6, 26, z], [xb + 6, BUS_Y - 4.6, z], 0.7, porc, 6);                      // insulated pull-rod
    });
    // position flags on three cabinet faces (same convention as the 2.5D view: green closed, red open)
    const flagMat = new T.MeshBasicMaterial({ color: P.ok, fog: false });
    [[xb, 18, -28.4, 9, 9, 0.8], [xb, 18, 28.4, 9, 9, 0.8], [xb + 8.4, 18, 0, 0.8, 9, 9]].forEach(([x, y, z, w, h, d]) => {
      const f = K.box(content, w, h, d, flagMat, x, y, z); f.userData.noShadow = true;
    });
    const arc = new T.PointLight(0xbfe9ff, 0, 170, 2); arc.position.set(xb, BUS_Y + 6, 0); content.add(arc);

    busSupport(-62);

    /* ---------- transformer XFMR-1 ---------- */
    const xt = X.xf;
    K.box(content, 104, 3, 124, conc, xt, 1.5, 0);                                   // containment pad
    [[0, 61], [0, -61]].forEach(([dx, dz]) => K.box(content, 104, 5, 3, conc, xt + dx, 4, dz));
    [[51, 0], [-51, 0]].forEach(([dx, dz]) => K.box(content, 3, 5, 124, conc, xt + dx, 4, dz));
    K.box(content, 62, 3, 10, dark, xt, 4.5, -22); K.box(content, 62, 3, 10, dark, xt, 4.5, 22);   // skid rails
    const tankMat = new T.MeshStandardMaterial({ color: 0x2f5876, emissive: 0x2fd4c4, emissiveIntensity: 0.2, metalness: 0.35, roughness: 0.5 });
    const radMat = new T.MeshStandardMaterial({ color: 0x2a465c, emissive: 0x2fd4c4, emissiveIntensity: 0.1, metalness: 0.45, roughness: 0.55 });
    K.box(content, 56, 46, 60, tankMat, xt, 29, 0);                                  // main tank
    K.box(content, 60, 2.6, 64, dark, xt, 53.3, 0);                                  // lid
    [-20, 0, 20].forEach(dz => { K.box(content, 1.6, 42, 3, tankMat, xt - 28.8, 29, dz); K.box(content, 1.6, 42, 3, tankMat, xt + 28.8, 29, dz); });
    // radiator banks on both sides, with headers and fans
    const fans = [];
    [-1, 1].forEach(s => {
      for (let i = 0; i < 11; i++) K.box(content, 1.5, 36, 13, radMat, xt - 22.5 + i * 4.5, 29, s * 38.5);
      [45, 13].forEach(y => {
        K.rod(content, [xt - 24, y, s * 33], [xt + 24, y, s * 33], 1.8, dark, 10);
        [-16, 16].forEach(dx => K.rod(content, [xt + dx, y, s * 30], [xt + dx, y, s * 33], 1.5, dark, 8));
      });
      [-12, 12].forEach(dx => {
        const f = new T.Group(); f.position.set(xt + dx, 29, s * 46.4);
        const ring = new T.Mesh(new T.TorusGeometry(8.6, 0.9, 8, 28), dark); f.add(ring);
        const spin = new T.Group(); f.add(spin);
        K.rod(spin, [0, 0, -1.2], [0, 0, 1.2], 2, galv, 12);
        for (let b = 0; b < 4; b++) {
          const bl = K.box(spin, 7.4, 2.6, 0.5, galv, 0, 0, 0);
          bl.rotation.z = b * Math.PI / 2; bl.rotation.x = 0.35; bl.translateX(4.4);
        }
        content.add(f); fans.push(spin);
      });
    });
    // conservator + Buchholz pipe + gauge
    K.rod(content, [xt, 78, -27], [xt, 78, 27], 7.5, radMat, 20);
    [-18, 18].forEach(dz => K.box(content, 3, 17, 3, dark, xt, 62.5, dz));
    K.rod(content, [xt - 9, 54.6, -22], [xt - 9, 70, -22], 1.1, galv, 8);
    K.rod(content, [xt - 9, 70, -22], [xt - 4, 74, -22], 1.1, galv, 8);
    const gauge = K.rod(content, [xt, 78, 27.2], [xt, 78, 28], 4, new T.MeshBasicMaterial({ color: 0xe8f1f8, fog: false }), 18); gauge.userData.noShadow = true;
    K.box(content, 5, 18, 16, K.mat(0x5d7390), xt + 31, 26, 14);                     // control cabinet
    // bushings: tall on the source side, short on the feeder side
    const hvTop = [], lvTop = [];
    ZROW.forEach((z, p) => {
      const zh = z * 0.72, zl = z * 0.6;
      const hv = K.insulator(30, 4.4, 8, porc); hv.position.set(xt - 20, 54.6, zh); content.add(hv);
      K.rod(content, [xt - 20, 84.6, zh], [xt - 20, 89, zh], 1.3, cond[p].down, 8);
      const lv = K.insulator(19, 3.8, 5, porc); lv.position.set(xt + 20, 54.6, zl); content.add(lv);
      K.rod(content, [xt + 20, 73.6, zl], [xt + 20, 77.5, zl], 1.3, cond[p].down, 8);
      hvTop.push([xt - 20, 89, zh]); lvTop.push([xt + 20, 77.5, zl]);
    });

    /* ---------- feeder side ---------- */
    [X.busC0 + 16, X.busC1 - 18].forEach(busSupport);
    deadEnd(X.fdrDE, -1);
    const yFdr = pole(env, X.fdrPole, 118);
    const yFarF = pole(env, X.farFdr, 112);

    /* ---------- conductors + flow paths (one continuous route per phase) ---------- */
    const flows = [];
    ZROW.forEach((z, p) => {
      const up = cond[p].up, dn = cond[p].down, zp = z * 1.2;
      const route = [];
      // far pole → source pole → dead-end (overhead spans with sag)
      route.push(K.cable(env, K.sagPts([X.farSrc, yFar, zp], [X.srcPole, ySrc, zp], 9), 0.8, up, 24).curve);
      route.push(K.cable(content, K.sagPts([X.srcPole, ySrc, zp], [X.srcDE - 14, 84, z], 7), 0.8, up, 24).curve);
      // jumper down to bus A
      route.push(K.cable(content, [[X.srcDE - 14, 84, z], [X.srcDE - 9, 72, z], [X.srcDE + 5, 63.5, z], [X.busA0, BUS_Y, z]], 0.9, up, 20).curve);
      route.push(busBar(p, X.busA0, xb - 14, up));
      route.push(new T.LineCurve3(new T.Vector3(xb - 14, BUS_Y, z), new T.Vector3(xb + 14, BUS_Y, z)));   // through the interrupter
      route.push(busBar(p, xb + 14, X.busB1, dn));
      // rise to HV bushing, (through the windings), drop from LV bushing to bus C
      route.push(K.cable(content, [[X.busB1, BUS_Y, z], [X.busB1 + 12, 64, z * 0.95], [hvTop[p][0] - 12, 84, hvTop[p][2] * 1.05], hvTop[p]], 0.9, dn, 20).curve);
      route.push(new T.LineCurve3(new T.Vector3(...hvTop[p]), new T.Vector3(...lvTop[p])));
      route.push(K.cable(content, [lvTop[p], [lvTop[p][0] + 12, 74, z * 0.72], [X.busC0 - 10, 63.5, z * 0.97], [X.busC0, BUS_Y, z]], 0.9, dn, 20).curve);
      route.push(busBar(p, X.busC0, X.busC1, dn));
      // jumper up to feeder dead-end, then overhead to the feeder poles
      route.push(K.cable(content, [[X.busC1, BUS_Y, z], [X.fdrDE - 5, 63.5, z], [X.fdrDE + 9, 72, z], [X.fdrDE + 14, 84, z]], 0.9, dn, 20).curve);
      route.push(K.cable(content, K.sagPts([X.fdrDE + 14, 84, z], [X.fdrPole, yFdr, zp], 7), 0.8, dn, 24).curve);
      route.push(K.cable(env, K.sagPts([X.fdrPole, yFdr, zp], [X.farFdr, yFarF, zp], 9), 0.8, dn, 24).curve);
      flows.push(K.flowBeads(content, route, { spacing: 26, size: 1.9 }));
    });

    /* ---------- live labels ---------- */
    const L = {
      src: K.label(content, 'Source · 12.47 kV', { at: [X.srcDE, 116, 0], leaderTo: [X.srcDE, 92, 0] }),
      brk: K.label(content, 'Breaker 52-F1', { at: [xb, 92, 0], leaderTo: [xb, 68, 0], accent: '#4fe08a' }),
      xf: K.label(content, 'XFMR-1 · transformer_temp', { at: [xt, 112, 0], leaderTo: [xt, 86, 0], accent: '#2fd4c4' }),
      fdr: K.label(content, 'Feeder F1 · load', { at: [X.fdrDE, 116, 0], leaderTo: [X.fdrDE, 92, 0] }),
    };
    global.Twin3D.enableShadows(content);
    global.Twin3D.enableShadows(env);

    /* ---------- per-frame: read the view-model, drive everything from it ---------- */
    const heat = new T.Color(), tankBase = new T.Color(0x2f5876), radBase = new T.Color(0x2a465c);
    let wasClosed = true, gap = 0, fanSpeed = 0, flash = 0;
    function update(vm, dt) {
      const closed = !!vm.breakerClosed;
      const iAvg = (vm.I[0] + vm.I[1] + vm.I[2]) / 3;
      const flow = K.clamp(iAvg / 350, 0, 1);

      // conductors: voltage presence holds on both sides; the load side only dims
      cond.forEach(c => { c.down.emissiveIntensity += ((closed ? 0.55 : 0.3) - c.down.emissiveIntensity) * Math.min(1, 6 * dt); });
      flows.forEach(f => { const on = flow > 0.02; f.setVisible(on); if (on) f.advance(flow * 150 * dt); });

      // breaker: contacts part, glass and flags change, brief arc on operation
      if (closed !== wasClosed) { flash = 1; wasClosed = closed; }
      flash = Math.max(0, flash - dt * 3.5);
      arc.intensity = flash * 3.2;
      gap += ((closed ? 0 : 9) - gap) * Math.min(1, 9 * dt);
      brk.contacts.forEach(c => {
        c.mesh.position.x = c.x0 + gap;
        const hex = closed ? PHASE_HEX[c.p] : P.red;
        c.mat.color.setHex(hex); c.mat.emissive.setHex(hex);
      });
      glassMats.forEach(g => {
        g.emissive.setHex(closed ? 0x3bd6f2 : P.red);
        g.emissiveIntensity = (closed ? 0.12 : 0.3) + flash * 1.4;
      });
      flagMat.color.setHex(closed ? P.ok : P.red);

      // transformer: heat ramp on tank + radiators, fans stage in as it warms
      heat.copy(K.ramp((vm.temp - 50) / 30));
      // tint the paint toward the ramp colour and add a restrained glow, so a hot
      // tank reads amber/red instead of washing out to white
      const hf = K.clamp((vm.temp - 50) / 30, 0, 1);
      const glow = 0.14 + hf * 0.42;
      tankMat.color.copy(tankBase).lerp(heat, 0.25 + hf * 0.45);
      radMat.color.copy(radBase).lerp(heat, 0.2 + hf * 0.4);
      tankMat.emissive.copy(heat); radMat.emissive.copy(heat);
      tankMat.emissiveIntensity += (glow - tankMat.emissiveIntensity) * Math.min(1, 3 * dt);
      radMat.emissiveIntensity = tankMat.emissiveIntensity * 0.6;
      fanSpeed += (K.clamp((vm.temp - 56) / 12, 0, 1) * 16 - fanSpeed) * Math.min(1, 1.5 * dt);
      fans.forEach(f => { f.rotation.z += fanSpeed * dt; });

      // labels
      const vAvg = (vm.V[0] + vm.V[1] + vm.V[2]) / 3;
      L.src.set((vAvg / 1000).toFixed(2) + ' kV ø-n', null);
      L.brk.set(closed ? 'CLOSED' : 'OPEN', closed ? '#4fe08a' : '#ff4d5e');
      L.xf.set(vm.temp.toFixed(1) + ' °C', vm.temp >= 80 ? '#ff4d5e' : vm.temp >= 70 ? '#f2c53b' : '#2fd4c4');
      L.fdr.set(iAvg.toFixed(0) + ' A · ' + (vm.realKw / 1000).toFixed(2) + ' MW', closed ? null : '#ff4d5e');
    }

    function setLabelScale(k) { Object.values(L).forEach(l => l.setScale(k)); }
    return { update, env, labels: L, setLabelScale };
  }

  global.GridScene3D = {
    build,
    // camera sits on the +Z side so the one-line reads source (left) → load (right)
    HOME: { az: 1.22, el: 0.4, r: 560, tx: -10, ty: 34, tz: 0 },
    VIEWS: {
      iso: { az: 1.22, el: 0.4, r: 560 }, front: { az: Math.PI / 2, el: 0.14, r: 660 },
      top: { az: Math.PI / 2, el: 1.33, r: 700 }, side: { az: 0, el: 0.2, r: 520 },
    },
  };
})(typeof window !== 'undefined' ? window : this);
