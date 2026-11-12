/* ============================================================================
   water-scene3d.js  ·  Water treatment twin — 3D plant model
   ----------------------------------------------------------------------------
   A procedural model of the small plant the water twin simulates, assembled
   from Twin3D.parts. RENDERER only: no physics here, one view-model per frame.

     const plant = WaterScene3D.build(scene, content);
     plant.update({ naoh, flow, tank, pump, pressure, demand, alarms }, dt);

   Process, left to right (+X):
     raw-water well → intake pump P-101 → flow meter → NaOH injection + mixer
       → storage tank T-1 → pressure point → distribution main → district

   What is driven by state:
     · pump shaft + status ring/beacon    pump_state
     · inlet beads                         flow_rate (plant throughput)
     · NaOH dosing beads + line colour     naoh_ppm × flow_rate, dose thresholds
     · tank water body, float, colour      tank_level (low < 40 %)
     · pressure gauge needle               pressure (derived)
     · outlet / district beads             district draw (30 + 20·demand) while
                                           the tank holds water. The district
                                           keeps drawing with the pump off,
                                           which is exactly why the tank drains.
     · alarm beacon on the ops building    any active process alarm

   TARGET SPEC: the water role has no firmware yet, so this layout and its tag
   set are provisional, same as the rest of the water twin.

   Requires THREE r128 and twin3d-kit.js loaded first. No build step.
============================================================================ */
(function (global) {
  'use strict';

  const TANK_R = 50, TANK_H = 120, TANK_Y = 4;        // storage tank, on a 4-unit ring beam
  const PIPE_Y = 30, OUT_Y = 16;

  function build(scene, content) {
    const T = global.THREE, K = global.Twin3D.parts, P = K.PALETTE;
    const env = new T.Group(); scene.add(env);

    /* ---------- materials ---------- */
    const galv = K.mat(P.galv, { metalness: 0.65, roughness: 0.42 });
    const steel = K.mat(P.steel, { metalness: 0.55, roughness: 0.5 });
    const dark = K.mat(P.dark, { metalness: 0.5, roughness: 0.55 });
    const conc = K.concreteMat();
    const pipeMat = K.mat(0x3f7f96, { metalness: 0.5, roughness: 0.45 });     // process water: blue-green
    const flange = K.mat(0x7f93a8, { metalness: 0.7, roughness: 0.4 });
    const rawMat = K.mat(0x4d6a63, { metalness: 0.4, roughness: 0.6 });       // raw water side
    const doseMat = new T.MeshStandardMaterial({ color: 0x8a7bf2, emissive: 0x8a7bf2, emissiveIntensity: 0.45, metalness: 0.3, roughness: 0.5 });
    const safety = K.mat(0xe8b23d, { metalness: 0.3, roughness: 0.6 });

    /* ---------- site ---------- */
    K.ground(scene, { pad: [470, 330], padCenter: [-65, 0] });
    K.fence(env, -295, 165, -160, 160, 22);
    // road + district lots outside the fence
    const road = new T.Mesh(new T.PlaneGeometry(26, 420), new T.MeshStandardMaterial({ color: 0x1c2531, roughness: 1 }));
    road.rotation.x = -Math.PI / 2; road.position.set(196, 0.05, 0); road.receiveShadow = true; env.add(road);
    for (let z = -190; z <= 190; z += 28) { const d = K.box(env, 1.2, 0.1, 12, new T.MeshBasicMaterial({ color: 0x8696a8, fog: true }), 196, 0.12, z); d.userData.noShadow = true; }

    // pipe stanchion
    function stand(x, y, z) { K.box(content, 6, 1.5, 6, conc, x, 0.75, z); K.box(content, 2, y - 4.5, 2, galv, x, (y - 3) / 2, z); K.box(content, 7, 1.4, 2.4, galv, x, y - 4.2, z); }

    /* ---------- raw-water well ---------- */
    const WX = -262, WZ = 110;
    K.box(content, 46, 14, 46, conc, WX, 7, WZ);
    K.box(content, 38, 1, 38, dark, WX, 14.1, WZ);
    const rawWater = K.box(content, 36, 0.6, 36, new T.MeshStandardMaterial({ color: 0x2c6f78, emissive: 0x0e3138, emissiveIntensity: 0.6, roughness: 0.2, metalness: 0.2 }), WX, 14.5, WZ);
    rawWater.userData.noShadow = true;
    [[-21, -21], [21, -21], [21, 21], [-21, 21]].forEach(([dx, dz]) => K.rod(content, [WX + dx, 14, WZ + dz], [WX + dx, 24, WZ + dz], 0.6, safety, 6));
    [[-21, -21, 21, -21], [21, -21, 21, 21], [21, 21, -21, 21], [-21, 21, -21, -21]].forEach(([a, b, c, d]) =>
      K.rod(content, [WX + a, 23.5, WZ + b], [WX + c, 23.5, WZ + d], 0.5, safety, 6));

    /* ---------- intake pump skid P-101 (end-suction pump, motor on the +X end) ---------- */
    const PX = -190, PZ = 110, SHAFT_Y = 19;
    K.box(content, 84, 3, 38, conc, PX + 16, 1.5, PZ);                                   // plinth
    K.box(content, 72, 3, 24, dark, PX + 16, 4.5, PZ);                                   // baseplate
    // volute casing + suction / discharge nozzles
    K.rod(content, [PX - 5, SHAFT_Y, PZ], [PX + 5, SHAFT_Y, PZ], 12.5, pipeMat, 28);
    K.rod(content, [PX - 6.5, SHAFT_Y, PZ], [PX - 5, SHAFT_Y, PZ], 8, flange, 20);
    K.box(content, 12, 7, 20, dark, PX, 9.5, PZ);
    K.rod(content, [PX, SHAFT_Y + 6, PZ - 8], [PX, PIPE_Y - 2, PZ - 8], 4.6, pipeMat, 16);
    K.rod(content, [PX, PIPE_Y - 2.6, PZ - 8], [PX, PIPE_Y - 1.2, PZ - 8], 7, flange, 20);
    // bearing frame, coupling (spins), guard, motor
    K.rod(content, [PX + 5, SHAFT_Y, PZ], [PX + 15, SHAFT_Y, PZ], 5.2, steel, 16);
    K.box(content, 8, 9, 10, steel, PX + 10, 10.5, PZ);
    const spin = new T.Group(); spin.position.set(PX + 19, SHAFT_Y, PZ); content.add(spin);
    K.rod(spin, [-4, 0, 0], [4, 0, 0], 3.6, galv, 12);
    for (let i = 0; i < 4; i++) { const b = K.box(spin, 2.2, 1.6, 9, flange, 0, 0, 0); b.rotation.x = i * Math.PI / 4; }
    for (let a = 0.25; a < Math.PI - 0.2; a += 0.3) {                                    // open guard hoops
      K.rod(content, [PX + 15.5, SHAFT_Y + Math.sin(a) * 6.2, PZ + Math.cos(a) * 6.2], [PX + 22.5, SHAFT_Y + Math.sin(a) * 6.2, PZ + Math.cos(a) * 6.2], 0.35, safety, 5);
    }
    const motorMat = K.mat(0x3d6f9e, { metalness: 0.45, roughness: 0.5 });
    K.rod(content, [PX + 23, SHAFT_Y, PZ], [PX + 51, SHAFT_Y, PZ], 10, motorMat, 24);
    for (let x = PX + 26; x <= PX + 48; x += 3.6) K.rod(content, [x, SHAFT_Y, PZ], [x + 1.1, SHAFT_Y, PZ], 10.9, motorMat, 24);   // cooling fins
    K.rod(content, [PX + 51, SHAFT_Y, PZ], [PX + 57, SHAFT_Y, PZ], 10.6, dark, 24);       // fan cowl
    K.box(content, 10, 6, 9, steel, PX + 36, SHAFT_Y + 12, PZ);                           // terminal box
    K.box(content, 22, 8, 18, dark, PX + 37, 8, PZ);
    // run-status ring on the motor + stack light
    const runMat = new T.MeshBasicMaterial({ color: P.ok, fog: false });
    const ring = K.rod(content, [PX + 23.2, SHAFT_Y, PZ], [PX + 25, SHAFT_Y, PZ], 11.3, runMat, 28); ring.userData.noShadow = true;
    K.rod(content, [PX + 58, 3, PZ + 14], [PX + 58, 40, PZ + 14], 0.8, galv, 8);
    const beaconPump = new T.Mesh(new T.SphereGeometry(3, 14, 10), runMat); beaconPump.position.set(PX + 58, 42, PZ + 14); beaconPump.userData.noShadow = true; content.add(beaconPump);
    // local control panel
    K.box(content, 3, 22, 16, K.mat(0x5d7390), PX + 16, 14, PZ + 26); K.box(content, 5, 3, 5, conc, PX + 16, 1.5, PZ + 26);

    /* ---------- process piping: well → pump → flow meter → injection → mixer → tank ---------- */
    const suction = K.pipeRun(content, [[WX + 14, 8, WZ], [WX + 30, 8, WZ], [WX + 30, SHAFT_Y, WZ], [PX - 6, SHAFT_Y, PZ]], 4.2, rawMat, { flanges: true, flangeMat: flange });
    const discharge = K.pipeRun(content, [[PX, PIPE_Y - 1, PZ - 8], [PX, PIPE_Y, PZ - 8], [PX, PIPE_Y, 0], [-TANK_R - 1, PIPE_Y, 0]], 4, pipeMat, { flanges: true, flangeMat: flange });
    [[PX, 70], [PX, 28]].forEach(([x, z]) => stand(x, PIPE_Y, z));
    [[-165, 0], [-88, 0]].forEach(([x, z]) => stand(x, PIPE_Y, z));
    // magnetic flow meter on the riser run
    const FMZ = 50;
    K.rod(content, [PX, PIPE_Y, FMZ - 7], [PX, PIPE_Y, FMZ + 7], 6.6, K.mat(0x2f6fb0, { metalness: 0.4, roughness: 0.45 }), 22);
    [-8, 8].forEach(d => K.rod(content, [PX, PIPE_Y, FMZ + d - 0.7], [PX, PIPE_Y, FMZ + d + 0.7], 7.6, flange, 22));
    K.rod(content, [PX, PIPE_Y + 6, FMZ], [PX, PIPE_Y + 11, FMZ], 1.6, steel, 8);
    K.box(content, 8, 7, 6, K.mat(0xd7e0ea, { metalness: 0.2, roughness: 0.5 }), PX, PIPE_Y + 14, FMZ);
    // static mixer just downstream of the injection quill
    const IX = -140;
    K.rod(content, [IX + 12, PIPE_Y, 0], [IX + 44, PIPE_Y, 0], 5.6, K.mat(0x4d93ad, { metalness: 0.5, roughness: 0.4 }), 20);
    for (let x = IX + 14; x <= IX + 42; x += 7) K.rod(content, [x, PIPE_Y, 0], [x + 1, PIPE_Y, 0], 6.5, flange, 20);
    // tank inlet nozzle
    K.rod(content, [-TANK_R - 3, PIPE_Y, 0], [-TANK_R - 1.6, PIPE_Y, 0], 6.4, flange, 20);

    /* ---------- NaOH dosing skid: bunded tank, metering pump, dosing line to the quill ---------- */
    const DX = -140, DZ = -100;
    K.box(content, 78, 2, 56, conc, DX, 1, DZ);
    [[0, 28, 78, 3], [0, -28, 78, 3]].forEach(([dx, dz, w, d]) => K.box(content, w, 7, d, conc, DX + dx, 5.5, DZ + dz));
    [[39, 0, 3, 56], [-39, 0, 3, 56]].forEach(([dx, dz, w, d]) => K.box(content, w, 7, d, conc, DX + dx, 5.5, DZ + dz));
    const polyMat = new T.MeshStandardMaterial({ color: 0xb9b0ff, transparent: true, opacity: 0.34, roughness: 0.3, metalness: 0, depthWrite: false, side: T.DoubleSide });
    const chem = new T.MeshStandardMaterial({ color: 0x7767e6, emissive: 0x3a2f9c, emissiveIntensity: 0.55, roughness: 0.3, metalness: 0.1 });
    const tx = DX - 14;
    const liq = new T.Mesh(new T.CylinderGeometry(16.4, 16.4, 34, 28), chem); liq.position.set(tx, 2 + 17, DZ); content.add(liq);
    const shellD = new T.Mesh(new T.CylinderGeometry(17.5, 17.5, 48, 28, 1, true), polyMat); shellD.position.set(tx, 2 + 24, DZ); shellD.userData.noShadow = true; content.add(shellD);
    const dome = new T.Mesh(new T.SphereGeometry(17.5, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2), polyMat); dome.scale.y = 0.42; dome.position.set(tx, 50, DZ); dome.userData.noShadow = true; content.add(dome);
    [8, 26, 44].forEach(y => { const b = new T.Mesh(new T.TorusGeometry(17.7, 0.5, 6, 32), dark); b.rotation.x = Math.PI / 2; b.position.set(tx, y, DZ); content.add(b); });
    K.rod(content, [tx, 57, DZ], [tx, 60, DZ], 3.4, dark, 14);                           // fill cap
    // metering pump
    const mx = DX + 20, mz = DZ + 10;
    K.box(content, 14, 3, 12, dark, mx, 3.5, mz);
    K.box(content, 9, 9, 8, K.mat(0x4a57c9, { metalness: 0.4, roughness: 0.5 }), mx - 1, 9.5, mz);
    K.rod(content, [mx + 3.5, 9.5, mz], [mx + 8, 9.5, mz], 3.6, K.mat(0xd7e0ea, { metalness: 0.2, roughness: 0.4 }), 14);   // dosing head
    K.pipeRun(content, [[tx + 16, 6, DZ + 8], [mx + 6, 6, DZ + 8], [mx + 6, 6.5, mz]], 1, doseMat);                       // tank → pump
    const dose = K.pipeRun(content, [[mx + 6, 13, mz], [mx + 6, 46, mz], [IX, 46, mz], [IX, 46, 0], [IX, PIPE_Y + 3, 0]], 1.1, doseMat);
    [[IX, -60], [IX, -24]].forEach(([x, z]) => { K.box(content, 5, 1.5, 5, conc, x, 0.75, z); K.rod(content, [x, 1.5, z], [x, 45, z], 0.8, galv, 6); });
    K.rod(content, [IX, PIPE_Y + 3, 0], [IX, PIPE_Y + 7, 0], 2.2, flange, 12);                                            // injection quill
    // hazard diamond on the bund wall
    const haz = K.box(content, 9, 9, 0.5, new T.MeshBasicMaterial({ color: 0xf2c53b, fog: false }), DX + 10, 6, DZ + 29.9); haz.rotation.z = Math.PI / 4; haz.userData.noShadow = true;

    /* ---------- storage tank T-1 ---------- */
    K.rod(content, [0, 0, 0], [0, TANK_Y, 0], TANK_R + 6, conc, 48);
    const shellMat = new T.MeshStandardMaterial({ color: 0x8fb3cc, metalness: 0.5, roughness: 0.35, transparent: true, opacity: 0.2, side: T.DoubleSide, depthWrite: false });
    const shell = new T.Mesh(new T.CylinderGeometry(TANK_R, TANK_R, TANK_H, 56, 1, true), shellMat);
    shell.position.y = TANK_Y + TANK_H / 2; shell.userData.noShadow = true; shell.renderOrder = 3; content.add(shell);
    [0, 0.25, 0.5, 0.75, 1].forEach(f => {
      const r = new T.Mesh(new T.TorusGeometry(TANK_R + 0.4, f === 0 || f === 1 ? 1.5 : 0.8, 8, 64), galv);
      r.rotation.x = Math.PI / 2; r.position.y = TANK_Y + TANK_H * f; content.add(r);
    });
    for (let i = 0; i < 16; i++) {                                                       // shell plate seams
      const a = i / 16 * Math.PI * 2 + 0.1;
      K.rod(content, [Math.cos(a) * (TANK_R + 0.3), TANK_Y, Math.sin(a) * (TANK_R + 0.3)], [Math.cos(a) * (TANK_R + 0.3), TANK_Y + TANK_H, Math.sin(a) * (TANK_R + 0.3)], 0.45, galv, 5);
    }
    const roofMat = new T.MeshStandardMaterial({ color: 0x7f97ad, metalness: 0.5, roughness: 0.45, transparent: true, opacity: 0.42, depthWrite: false, side: T.DoubleSide });
    const roof = new T.Mesh(new T.ConeGeometry(TANK_R + 1.5, 13, 56, 1, true), roofMat); roof.position.y = TANK_Y + TANK_H + 6.5; roof.userData.noShadow = true; roof.renderOrder = 4; content.add(roof);
    K.rod(content, [0, TANK_Y + TANK_H + 12, 0], [0, TANK_Y + TANK_H + 16, 0], 3.2, galv, 14);                            // vent
    // water body + surface
    const waterMat = new T.MeshStandardMaterial({ color: 0x3bd6f2, emissive: 0x113a44, emissiveIntensity: 0.65, metalness: 0.15, roughness: 0.25, transparent: true, opacity: 0.72 });
    const water = new T.Mesh(new T.CylinderGeometry(TANK_R - 1.6, TANK_R - 1.6, 1, 48), waterMat);
    water.userData.noShadow = true; water.renderOrder = 1; content.add(water);
    const surfMat = new T.MeshBasicMaterial({ color: 0x9aefff, transparent: true, opacity: 0.55, fog: false });
    const surface = new T.Mesh(new T.CircleGeometry(TANK_R - 1.6, 48), surfMat); surface.rotation.x = -Math.PI / 2; surface.userData.noShadow = true; surface.renderOrder = 2; content.add(surface);
    // external ladder with safety cage (back-right of the tank)
    const la = -2.2, lx = Math.cos(la), lz = Math.sin(la), tx2 = -lz, tz2 = lx;
    [-2.6, 2.6].forEach(o => K.rod(content, [lx * (TANK_R + 3) + tx2 * o, TANK_Y, lz * (TANK_R + 3) + tz2 * o], [lx * (TANK_R + 3) + tx2 * o, TANK_Y + TANK_H + 8, lz * (TANK_R + 3) + tz2 * o], 0.6, safety, 6));
    for (let y = TANK_Y + 6; y < TANK_Y + TANK_H + 6; y += 6) K.rod(content, [lx * (TANK_R + 3) - tx2 * 2.6, y, lz * (TANK_R + 3) - tz2 * 2.6], [lx * (TANK_R + 3) + tx2 * 2.6, y, lz * (TANK_R + 3) + tz2 * 2.6], 0.35, safety, 5);
    // level gauge board facing the default camera: scale, normal band, low mark, float
    const ga = 1.0, gx = Math.cos(ga) * (TANK_R + 2.2), gz = Math.sin(ga) * (TANK_R + 2.2);
    const board = new T.Group(); board.position.set(gx, TANK_Y, gz); board.rotation.y = -ga + Math.PI / 2; content.add(board);
    K.box(board, 9, TANK_H, 0.8, K.mat(0x1a2430, { metalness: 0.2, roughness: 0.7 }), 0, TANK_H / 2, 0);
    const tick = new T.MeshBasicMaterial({ color: 0xcfdbe8, fog: false });
    for (let i = 0; i <= 10; i++) { const t = K.box(board, i % 5 === 0 ? 7 : 4, 0.7, 0.3, tick, i % 5 === 0 ? 0 : -1.5, TANK_H * i / 10, 0.6); t.userData.noShadow = true; }
    const band = K.box(board, 2.4, TANK_H * 0.10, 0.3, new T.MeshBasicMaterial({ color: P.ok, fog: false }), 3.2, TANK_H * 0.65, 0.6); band.userData.noShadow = true;
    const lowMark = K.box(board, 9, 1.2, 0.35, new T.MeshBasicMaterial({ color: P.red, fog: false }), 0, TANK_H * 0.40, 0.65); lowMark.userData.noShadow = true;
    const floatMat = new T.MeshBasicMaterial({ color: 0x3bd6f2, fog: false });
    const float = K.box(board, 12, 3, 1.6, floatMat, 0, 0, 1.2); float.userData.noShadow = true;

    /* ---------- outlet: isolation valve, pressure point, distribution main, district ---------- */
    K.rod(content, [TANK_R + 1.6, OUT_Y, 0], [TANK_R + 3, OUT_Y, 0], 6.4, flange, 20);
    const outlet = K.pipeRun(content, [[TANK_R + 1, OUT_Y, 0], [196, OUT_Y, 0]], 4, pipeMat, { flangeMat: flange });
    [[78, 0], [150, 0]].forEach(([x, z]) => stand(x, OUT_Y, z));
    // gate valve with handwheel
    const VX = 76;
    K.box(content, 9, 11, 9, K.mat(0x356f8a, { metalness: 0.5, roughness: 0.45 }), VX, OUT_Y, 0);
    [-5.2, 5.2].forEach(d => K.rod(content, [VX + d - 0.7, OUT_Y, 0], [VX + d + 0.7, OUT_Y, 0], 6.6, flange, 20));
    K.rod(content, [VX, OUT_Y + 5, 0], [VX, OUT_Y + 16, 0], 1.1, galv, 8);
    const wheel = new T.Mesh(new T.TorusGeometry(5, 0.8, 8, 24), K.mat(0xd94a4a, { metalness: 0.3, roughness: 0.5 })); wheel.rotation.x = Math.PI / 2; wheel.position.set(VX, OUT_Y + 16, 0); content.add(wheel);
    // pressure gauge + transmitter
    const GX = 112, GY = OUT_Y + 22;
    K.rod(content, [GX, OUT_Y + 3, 0], [GX, GY - 8, 0], 1, galv, 8);
    K.rod(content, [GX, GY, -1.2], [GX, GY, 1.2], 9, dark, 28);
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    (function drawDial(c) {
      c.fillStyle = '#eef4fa'; c.beginPath(); c.arc(128, 128, 122, 0, 7); c.fill();
      c.translate(128, 128);
      // zones: red < 30, amber 30-45, green above (0..80 psi over 270°)
      const ang = p => (-225 + p / 80 * 270) * Math.PI / 180;
      [[0, 30, '#ff4d5e'], [30, 45, '#f2c53b'], [45, 80, '#4fe08a']].forEach(([a, b, col]) => {
        c.strokeStyle = col; c.lineWidth = 16; c.beginPath(); c.arc(0, 0, 98, ang(a), ang(b)); c.stroke();
      });
      c.strokeStyle = '#1a2430'; c.lineWidth = 5;
      for (let p = 0; p <= 80; p += 10) { const a = ang(p); c.beginPath(); c.moveTo(Math.cos(a) * 80, Math.sin(a) * 80); c.lineTo(Math.cos(a) * 108, Math.sin(a) * 108); c.stroke(); }
      c.fillStyle = '#1a2430'; c.font = '600 30px monospace'; c.textAlign = 'center'; c.fillText('psi', 0, 62);
    })(cv.getContext('2d'));
    const faceMat = new T.MeshBasicMaterial({ map: new T.CanvasTexture(cv), fog: false });
    [1, -1].forEach(s => {                                       // readable from both sides
      const f = new T.Mesh(new T.CircleGeometry(8.2, 32), faceMat); f.position.set(GX, GY, s * 1.35); if (s < 0) f.rotation.y = Math.PI; f.userData.noShadow = true; content.add(f);
    });
    const needleMat = new T.MeshBasicMaterial({ color: 0x1a2430, fog: false });
    const needles = [1, -1].map(s => {
      const g = new T.Group(); g.position.set(GX, GY, s * 1.5); if (s < 0) g.rotation.y = Math.PI; content.add(g);
      const n = new T.Group(); g.add(n);
      const b = K.box(n, 7, 0.9, 0.3, needleMat, 2.6, 0, 0); b.userData.noShadow = true;
      return n;
    });
    // district: header along the road, three service laterals, three houses
    const HX = 196, houseX = 252, lots = [-78, 0, 78];
    const header = K.pipeRun(content, [[HX, OUT_Y, -78], [HX, OUT_Y, 78]], 3.2, pipeMat);
    const laterals = lots.map(z => K.pipeRun(content, [[HX, OUT_Y, z], [houseX - 18, OUT_Y, z], [houseX - 18, 6, z]], 1.8, pipeMat));
    const houseMat = [0x6b7a8c, 0x75808f, 0x66748a].map(c => K.mat(c, { metalness: 0.05, roughness: 0.9 }));
    const roofH = K.mat(0x3e4b5e, { metalness: 0.1, roughness: 0.8 });
    const winMat = new T.MeshStandardMaterial({ color: 0x1b2836, emissive: 0xf2c98a, emissiveIntensity: 0.8, roughness: 0.4 });
    lots.forEach((z, i) => {
      K.box(content, 36, 20, 30, houseMat[i], houseX, 10, z);
      const r = new T.Mesh(new T.ConeGeometry(27.5, 13, 4, 1), roofH); r.rotation.y = Math.PI / 4; r.scale.set(1, 1, 0.84); r.position.set(houseX, 26.5, z); content.add(r);
      [-8, 8].forEach(dx => { const w = K.box(content, 6, 6, 0.6, winMat, houseX + dx, 11, z + 15.2); w.userData.noShadow = true; });
      const w2 = K.box(content, 0.6, 6, 7, winMat, houseX - 18.2, 11, z - 5); w2.userData.noShadow = true;
      K.box(content, 5, 10, 0.7, roofH, houseX, 5, z + 15.2);
    });
    const leaf = K.mat(0x2f6b55, { metalness: 0, roughness: 0.95 }), trunk = K.mat(0x4a3d32, { metalness: 0, roughness: 0.95 });
    [[230, -40], [276, 38], [232, 118], [280, -120], [300, 0]].forEach(([x, z], i) => {
      K.rod(env, [x, 0, z], [x, 9, z], 1.4, trunk, 6);
      const c = new T.Mesh(new T.ConeGeometry(9 + (i % 2) * 2, 24, 8), leaf); c.position.set(x, 21, z); env.add(c);
    });

    /* ---------- operations building + alarm beacon ---------- */
    K.building(env, -70, -128, 70, 30, 40, { windows: 3, face: '+z' });
    K.rod(env, [-42, 32, -128], [-42, 44, -128], 0.9, galv, 8);
    const alarmMat = new T.MeshBasicMaterial({ color: 0x35404d, fog: false });
    const alarmLamp = new T.Mesh(new T.SphereGeometry(4, 16, 12), alarmMat); alarmLamp.position.set(-42, 47, -128); alarmLamp.userData.noShadow = true; env.add(alarmLamp);
    const alarmLight = new T.PointLight(0xff4d5e, 0, 320, 2); alarmLight.position.set(-42, 52, -128); env.add(alarmLight);

    /* ---------- flow beads ---------- */
    // Beads are slightly fatter than the pipe they ride, so each one shows as a
    // bright band travelling along the outside of the pipe wall.
    const inBeads = K.flowBeads(content, [suction.curve, discharge.curve], { spacing: 22, size: 4.9, color: 0xeaf6ff });
    const outBeads = K.flowBeads(content, [outlet.curve], { spacing: 22, size: 4.7, color: 0xeaf6ff });
    const latBeads = laterals.map((l, i) => K.flowBeads(content,
      [new T.LineCurve3(new T.Vector3(HX, OUT_Y, 0), new T.Vector3(HX, OUT_Y, lots[i])), l.curve].filter(c => c.getLength() > 0.5),
      { spacing: 20, size: 3.7, color: 0xeaf6ff }));
    const doseBeads = K.flowBeads(content, [dose.curve], { spacing: 12, size: 1.9, color: 0xf1eeff });

    /* ---------- live labels ---------- */
    const L = {
      pump: K.label(content, 'Intake pump P-101', { at: [PX + 20, 62, PZ], leaderTo: [PX + 20, 34, PZ], accent: '#4fe08a' }),
      flow: K.label(content, 'flow_rate', { at: [PX, 78, FMZ - 26], leaderTo: [PX, PIPE_Y + 18, FMZ] }),
      naoh: K.label(content, 'NaOH dosing · naoh_ppm', { at: [DX - 6, 80, DZ], leaderTo: [DX - 6, 60, DZ], accent: '#8a7bf2' }),
      tank: K.label(content, 'Storage T-1 · tank_level', { at: [0, TANK_Y + TANK_H + 30, 0], leaderTo: [0, TANK_Y + TANK_H + 16, 0] }),
      pres: K.label(content, 'pressure · derived', { at: [GX + 8, GY + 28, 0], leaderTo: [GX, GY + 9, 0] }),
      dist: K.label(content, 'District draw', { at: [houseX, 58, 0], leaderTo: [houseX, 34, 0] }),
    };
    function setLabelScale(k) { Object.values(L).forEach(l => l.setScale(k)); }

    global.Twin3D.enableShadows(content);
    global.Twin3D.enableShadows(env);

    /* ---------- per-frame ---------- */
    let spinSpeed = 0, clock = 0, level = 0.65;
    function update(vm, dt) {
      clock += dt;
      const on = vm.pump === 1 || vm.pump === true;
      const flowing = vm.flow > 2;
      const low = vm.tank < 40;
      const draw = vm.tank > 0.5 ? 30 + 20 * K.clamp(vm.demand, 0, 1) : 0;      // district draw, same law as physics()

      // pump: shaft spins with throughput, ring + stack light show run state
      spinSpeed += ((on ? 6 + 14 * K.clamp(vm.flow / 50, 0, 1) : 0) - spinSpeed) * Math.min(1, 2.5 * dt);
      spin.rotation.x += spinSpeed * dt;
      runMat.color.setHex(on ? P.ok : P.red);

      // water in: beads ride well → pump → tank at a speed set by flow_rate
      inBeads.setVisible(flowing); if (flowing) inBeads.advance(K.clamp(vm.flow / 46, 0, 1.4) * 110 * dt);
      // water out: the district keeps drawing while the tank has water
      const drawing = draw > 0;
      outBeads.setVisible(drawing); latBeads.forEach(b => b.setVisible(drawing));
      if (drawing) { const d = draw / 40 * 95 * dt; outBeads.advance(d); latBeads.forEach(b => b.advance(d * 0.8)); }

      // NaOH: bead rate follows the dose being delivered; line colour follows the dose band
      const dosing = flowing && vm.naoh > 25;
      doseBeads.setVisible(dosing);
      if (dosing) doseBeads.advance(K.clamp(vm.naoh / 100, 0, 3) * K.clamp(vm.flow / 46, 0, 1.4) * 55 * dt);
      const doseHex = vm.naoh >= 200 ? P.red : (vm.naoh >= 120 || vm.naoh < 80) ? P.warn : 0x8a7bf2;
      doseMat.color.setHex(doseHex); doseMat.emissive.setHex(doseHex);
      doseMat.emissiveIntensity = dosing ? 0.5 : 0.18;

      // tank: water body, surface shimmer, float on the gauge board
      level += (K.clamp(vm.tank / 100, 0.004, 1) - level) * Math.min(1, 8 * dt);
      const h = TANK_H * level;
      water.scale.y = h; water.position.y = TANK_Y + h / 2;
      surface.position.y = TANK_Y + h + 0.15;
      surfMat.opacity = 0.5 + 0.08 * Math.sin(clock * 2.1);
      waterMat.color.setHex(low ? 0xff4d5e : 0x3bd6f2); waterMat.emissive.setHex(low ? 0x3a1116 : 0x113a44);
      surfMat.color.setHex(low ? 0xffa0a8 : 0x9aefff);
      float.position.y = h; floatMat.color.setHex(low ? P.red : vm.tank < 55 ? P.warn : 0x3bd6f2);

      // pressure needle: 0..80 psi over 270°
      const a = (225 - K.clamp(vm.pressure, 0, 80) / 80 * 270) * Math.PI / 180;
      needles.forEach(n => { n.rotation.z += (a - n.rotation.z) * Math.min(1, 6 * dt); });

      // alarm beacon: flashes while any process alarm is active
      const alarming = vm.alarms > 0, blink = alarming && Math.sin(clock * 7) > 0;
      alarmMat.color.setHex(alarming ? (blink ? 0xff4d5e : 0x5a1d24) : 0x2f8f5c);
      alarmLight.intensity = blink ? 1.6 : 0;

      // labels
      L.pump.set(on ? 'RUNNING' : 'STOPPED', on ? '#4fe08a' : '#ff4d5e');
      L.flow.set(vm.flow.toFixed(1) + ' L/min', flowing ? null : '#ff4d5e');
      L.naoh.set(vm.naoh.toFixed(1) + ' ppm', vm.naoh >= 200 ? '#ff4d5e' : (vm.naoh >= 120 || vm.naoh < 80) ? '#f2c53b' : '#b7adff');
      L.tank.set(vm.tank.toFixed(1) + ' %', low ? '#ff4d5e' : vm.tank < 55 ? '#f2c53b' : null);
      L.pres.set(vm.pressure.toFixed(1) + ' psi', vm.pressure < 30 ? '#ff4d5e' : vm.pressure < 45 ? '#f2c53b' : null);
      L.dist.set(draw.toFixed(0) + ' L/min', drawing ? null : '#ff4d5e');
    }

    return { update, env, labels: L, setLabelScale };
  }

  global.WaterScene3D = {
    build,
    FOCUS: [[-285, 0, -130], [272, 140, 135]],
    // camera on the +Z side so the process reads intake (left) → district (right)
    HOME: { az: 1.3, el: 0.4, r: 540, tx: -10, ty: 40, tz: 0 },
    VIEWS: {
      iso: { az: 1.3, el: 0.4, r: 540 }, front: { az: Math.PI / 2, el: 0.14, r: 680 },
      top: { az: Math.PI / 2, el: 1.33, r: 760 }, side: { az: 0, el: 0.2, r: 560 },
    },
  };
})(typeof window !== 'undefined' ? window : this);
