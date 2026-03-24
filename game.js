'use strict';

(function () {
  // =====================================================================
  // SCENE SETUP
  // =====================================================================
  const canvas = document.getElementById('game-canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x7ec8e3);
  scene.fog = new THREE.FogExp2(0x9fd8e8, 0.004);

  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    800
  );

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  // =====================================================================
  // LIGHTING
  // =====================================================================
  scene.add(new THREE.AmbientLight(0xffeedd, 0.55));

  const sun = new THREE.DirectionalLight(0xfff8e0, 1.0);
  sun.position.set(80, 120, 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 500;
  sun.shadow.camera.left = -200;
  sun.shadow.camera.right = 200;
  sun.shadow.camera.top = 200;
  sun.shadow.camera.bottom = -200;
  scene.add(sun);

  // =====================================================================
  // TRACK DEFINITION (沖縄・西原町 inspired oval circuit)
  // =====================================================================
  const TRACK_WIDTH = 18;
  const TRACK_SEGMENTS = 240;
  const MAX_LAPS = 3;

  // Closed loop waypoints – a flowing oval with varied curves
  const rawWaypoints = [
    [0,   0, -110],
    [55,  0, -105],
    [100, 0,  -70],
    [120, 0,  -20],
    [115, 0,   40],
    [85,  0,   90],
    [40,  0,  115],
    [-10, 0,  110],
    [-65, 0,   85],
    [-100,0,   30],
    [-105,0,  -30],
    [-80, 0,  -85],
    [-35, 0, -110],
  ];

  const curve = new THREE.CatmullRomCurve3(
    rawWaypoints.map(p => new THREE.Vector3(p[0], p[1], p[2])),
    true,        // closed
    'catmullrom',
    0.5
  );

  // =====================================================================
  // TRACK GEOMETRY
  // =====================================================================
  function buildTrack() {
    const verts = [];
    const indices = [];
    const uvs = [];

    for (let i = 0; i < TRACK_SEGMENTS; i++) {
      const t  = i / TRACK_SEGMENTS;
      const pt = curve.getPoint(t);
      const tn = curve.getTangent(t);          // already normalised
      const nx = -tn.z;
      const nz =  tn.x;

      verts.push(
        pt.x + nx * TRACK_WIDTH * 0.5, 0.05, pt.z + nz * TRACK_WIDTH * 0.5,
        pt.x - nx * TRACK_WIDTH * 0.5, 0.05, pt.z - nz * TRACK_WIDTH * 0.5
      );
      uvs.push(0, t * 30,  1, t * 30);

      const b  = i * 2;
      const nb = ((i + 1) % TRACK_SEGMENTS) * 2;
      indices.push(b, b + 1, nb,  b + 1, nb + 1, nb);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mat = new THREE.MeshLambertMaterial({ color: 0x383838 });
    const road = new THREE.Mesh(geo, mat);
    road.receiveShadow = true;
    scene.add(road);

    // White edge lines
    [-1, 1].forEach(side => {
      const pts = [];
      for (let i = 0; i <= TRACK_SEGMENTS; i++) {
        const t  = (i % TRACK_SEGMENTS) / TRACK_SEGMENTS;
        const pt = curve.getPoint(t);
        const tn = curve.getTangent(t);
        pts.push(new THREE.Vector3(
          pt.x + (-tn.z) * side * (TRACK_WIDTH * 0.5 - 0.4),
          0.12,
          pt.z + tn.x  * side * (TRACK_WIDTH * 0.5 - 0.4)
        ));
      }
      const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
      scene.add(new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xffffff })));
    });

    // Dashed centre line
    for (let i = 0; i < TRACK_SEGMENTS; i += 2) {
      const pts = [];
      for (let j = 0; j <= 8; j++) {
        const t  = (i + j / 8) / TRACK_SEGMENTS;
        const pt = curve.getPoint(t % 1);
        pts.push(new THREE.Vector3(pt.x, 0.12, pt.z));
      }
      const lg = new THREE.BufferGeometry().setFromPoints(pts);
      scene.add(new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xffff88 })));
    }

    // Start / finish arch (at t = 0)
    const sfPt = curve.getPoint(0);
    const sfTn = curve.getTangent(0);
    const sfNx = -sfTn.z, sfNz = sfTn.x;
    const archMat = new THREE.MeshLambertMaterial({ color: 0xffffff });

    [-1, 1].forEach(side => {
      const pillar = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 6, 0.6),
        archMat
      );
      pillar.position.set(
        sfPt.x + sfNx * side * (TRACK_WIDTH * 0.5 + 0.5),
        3,
        sfPt.z + sfNz * side * (TRACK_WIDTH * 0.5 + 0.5)
      );
      pillar.castShadow = true;
      scene.add(pillar);
    });

    // Chequered strip across finish line
    for (let k = 0; k < 6; k++) {
      const t2 = (k / 6 - 0.5);
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(TRACK_WIDTH / 6, 0.04, 1.2),
        new THREE.MeshLambertMaterial({ color: k % 2 === 0 ? 0xffffff : 0x111111 })
      );
      strip.position.set(
        sfPt.x + sfNx * t2 * TRACK_WIDTH,
        0.04,
        sfPt.z + sfNz * t2 * TRACK_WIDTH
      );
      scene.add(strip);
    }
  }

  buildTrack();

  // =====================================================================
  // ENVIRONMENT
  // =====================================================================

  // Ground (grass)
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(800, 800),
    new THREE.MeshLambertMaterial({ color: 0x4a8c44 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Ocean (south-east of course, inspired by 西原マリンパーク)
  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 200),
    new THREE.MeshLambertMaterial({ color: 0x1a6fa0, transparent: true, opacity: 0.88 })
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(160, -0.3, 160);
  scene.add(ocean);

  // Helper: add a tree
  function addTree(x, z, h = 4.5) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.28, h * 0.45, 6),
      new THREE.MeshLambertMaterial({ color: 0x6b4226 })
    );
    trunk.position.y = h * 0.225;
    trunk.castShadow = true;
    g.add(trunk);

    [0, h * 0.22, h * 0.44].forEach((dy, i) => {
      const r  = (1 - i * 0.22) * (h * 0.22);
      const th = (1 - i * 0.18) * h * 0.55;
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(r, th, 7),
        new THREE.MeshLambertMaterial({ color: i === 0 ? 0x2d6a2d : i === 1 ? 0x3d7d3d : 0x4e9e4e })
      );
      cone.position.y = h * 0.38 + dy + th * 0.4;
      cone.castShadow = true;
      g.add(cone);
    });

    g.position.set(x, 0, z);
    scene.add(g);
  }

  // Helper: add a building
  function addBuilding(x, z, w, d, h, color) {
    const b = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color })
    );
    b.position.set(x, h / 2, z);
    b.castShadow = true;
    b.receiveShadow = true;
    scene.add(b);
  }

  // Scatter trees around track exterior
  const treeSeed = [
    [-135, -20], [-140, 30], [-125, 80], [-90, 120],
    [-40, 140], [10, 140], [60, 130], [100, 100],
    [140, 50], [145, -10], [130, -80], [90, -125],
    [40, -140], [-15, -140], [-65, -125], [-110, -95],
    [30, -50], [-30, 20], [50, 30], [-20, 70],
    [80, -50], [-70, -30], [-50, 60], [10, -70],
    [-90, 60], [70, 80], [120, 20], [-120, -60],
  ];
  treeSeed.forEach(([x, z]) => {
    addTree(x + (Math.random() - 0.5) * 8, z + (Math.random() - 0.5) * 8, 4 + Math.random() * 4);
  });

  // Simple buildings (inspired by 西原町の街並み)
  addBuilding(130,  -60, 12, 10, 8,  0xd4b896);
  addBuilding(145,  -40, 9,  8,  12, 0xc8a87a);
  addBuilding(135,    0, 14, 9,  6,  0xe8d5b7);
  addBuilding(-115, -60, 11, 10, 9,  0xbdbdbd);
  addBuilding(-125,  10, 9,  8,  7,  0xc4c0aa);
  addBuilding(-120,  60, 13, 11, 10, 0xd9c9b2);
  addBuilding(-50,  135, 10, 9,  8,  0xc9e0c0);
  addBuilding( 30,  135, 12, 10, 6,  0xe0d4c0);
  addBuilding( 90,  115, 10, 10, 9,  0xd8c8b8);

  // Roadside markers (orange cones approximated as small cylinders)
  for (let i = 0; i < TRACK_SEGMENTS; i += 15) {
    const t  = i / TRACK_SEGMENTS;
    const pt = curve.getPoint(t);
    const tn = curve.getTangent(t);
    const nx = -tn.z, nz = tn.x;
    const offset = TRACK_WIDTH * 0.5 + 1.2;
    [-1, 1].forEach(side => {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(0.3, 0.9, 6),
        new THREE.MeshLambertMaterial({ color: side === -1 ? 0xff6600 : 0xff6600 })
      );
      cone.position.set(pt.x + nx * side * offset, 0.45, pt.z + nz * side * offset);
      scene.add(cone);
    });
  }

  // =====================================================================
  // CAR — ブリーザー C
  // =====================================================================
  const carGroup = new THREE.Group();

  const bodyColor  = new THREE.MeshLambertMaterial({ color: 0x1155cc });
  const roofColor  = new THREE.MeshLambertMaterial({ color: 0x0d40aa });
  const wheelColor = new THREE.MeshLambertMaterial({ color: 0x111111 });
  const glassColor = new THREE.MeshLambertMaterial({ color: 0x88bbff, transparent: true, opacity: 0.7 });
  const lightColor = new THREE.MeshLambertMaterial({ color: 0xffeeaa });
  const brakeColor = new THREE.MeshLambertMaterial({ color: 0xff2222 });

  // Main body
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.75, 4.2), bodyColor);
  body.position.y = 0.55;
  body.castShadow = true;
  carGroup.add(body);

  // Cabin
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.62, 2.1), roofColor);
  cabin.position.set(0, 1.19, -0.15);
  cabin.castShadow = true;
  carGroup.add(cabin);

  // Windshield
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.54, 0.08), glassColor);
  windshield.position.set(0, 1.15, 0.91);
  windshield.rotation.x = 0.22;
  carGroup.add(windshield);

  // Rear window
  const rearWin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.54, 0.08), glassColor);
  rearWin.position.set(0, 1.15, -1.22);
  rearWin.rotation.x = -0.22;
  carGroup.add(rearWin);

  // Headlights
  [[0.6, 0.52, 2.07], [-0.6, 0.52, 2.07]].forEach(p => {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.22, 0.06), lightColor);
    hl.position.set(...p);
    carGroup.add(hl);
  });

  // Tail lights
  [[0.65, 0.55, -2.1], [-0.65, 0.55, -2.1]].forEach(p => {
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.18, 0.06), brakeColor);
    tl.position.set(...p);
    carGroup.add(tl);
  });

  // Wheels (4)
  const wheelPositions = [
    [-1.12, 0.34,  1.35],
    [ 1.12, 0.34,  1.35],
    [-1.12, 0.34, -1.35],
    [ 1.12, 0.34, -1.35],
  ];
  wheelPositions.forEach(([wx, wy, wz]) => {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.28, 12), wheelColor);
    w.rotation.z = Math.PI / 2;
    w.position.set(wx, wy, wz);
    w.castShadow = true;
    carGroup.add(w);
    // Hubcap
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.3, 8), new THREE.MeshLambertMaterial({ color: 0x888888 }));
    hub.rotation.z = Math.PI / 2;
    hub.position.set(wx, wy, wz);
    carGroup.add(hub);
  });

  scene.add(carGroup);

  // =====================================================================
  // CAR STATE
  // =====================================================================
  const startPt = curve.getPoint(0);
  const startTn = curve.getTangent(0);

  const car = {
    pos:     new THREE.Vector3(startPt.x, 0, startPt.z),
    heading: Math.atan2(startTn.x, startTn.z),
    speed:   0,
    // physics constants
    accel:     18,   // m/s²
    drag:       0.42, // drag coeff  (terminal ≈ 43 m/s ≈ 154 km/h)
    brakePower: 38,
    steerRate:  1.7, // rad/s at full grip
    // race state
    lap:             1,
    nextCheckpoint:  0,
    lapStartTime:    0,
    raceStartTime:   0,
    bestLapMs:       null,
    lapTimesMs:      [],
    finished:        false,
  };

  // Position car at start
  carGroup.position.copy(car.pos);
  carGroup.rotation.y = car.heading;

  // =====================================================================
  // CHECKPOINTS (evenly distributed around track)
  // =====================================================================
  const NUM_CPS = 12;
  const checkpoints = Array.from({ length: NUM_CPS }, (_, i) => {
    const t   = i / NUM_CPS;
    const pos = curve.getPoint(t);
    return { t, pos: new THREE.Vector3(pos.x, 0, pos.z) };
  });

  // =====================================================================
  // INPUT
  // =====================================================================
  const keys = { left: false, right: false, brake: false };

  document.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft')                  keys.left  = true;
    if (e.key === 'ArrowRight')                 keys.right = true;
    if (e.key === 'ArrowDown' || e.key === ' ') keys.brake = true;
  });
  document.addEventListener('keyup', e => {
    if (e.key === 'ArrowLeft')                  keys.left  = false;
    if (e.key === 'ArrowRight')                 keys.right = false;
    if (e.key === 'ArrowDown' || e.key === ' ') keys.brake = false;
  });

  function bindBtn(id, key) {
    const el = document.getElementById(id);
    const on  = e => { e.preventDefault(); keys[key] = true; };
    const off = e => { e.preventDefault(); keys[key] = false; };
    el.addEventListener('touchstart',  on,  { passive: false });
    el.addEventListener('touchend',    off, { passive: false });
    el.addEventListener('touchcancel', off, { passive: false });
    el.addEventListener('mousedown',   on);
    el.addEventListener('mouseup',     off);
    el.addEventListener('mouseleave',  off);
  }
  bindBtn('btn-left',  'left');
  bindBtn('btn-right', 'right');
  bindBtn('btn-brake', 'brake');

  // =====================================================================
  // GAME STATE MACHINE
  // =====================================================================
  let gameState = 'start'; // start | countdown | racing | finish

  document.getElementById('start-btn').addEventListener('click', startCountdown);
  document.getElementById('retry-btn').addEventListener('click', resetGame);

  function startCountdown() {
    document.getElementById('start-screen').style.display = 'none';
    gameState = 'countdown';

    let n = 3;
    const el = document.getElementById('countdown');
    el.style.display = 'flex';
    el.style.color   = '#ffffff';
    el.textContent   = n;

    const iv = setInterval(() => {
      n--;
      if (n > 0) {
        el.textContent = n;
      } else if (n === 0) {
        el.textContent = 'GO!';
        el.style.color = '#44ff88';
      } else {
        el.style.display = 'none';
        clearInterval(iv);
        gameState           = 'racing';
        car.raceStartTime   = performance.now();
        car.lapStartTime    = performance.now();
      }
    }, 1000);
  }

  function resetGame() {
    document.getElementById('finish-screen').style.display = 'none';

    // Reset car
    const sp = curve.getPoint(0);
    const st = curve.getTangent(0);
    car.pos.set(sp.x, 0, sp.z);
    car.heading       = Math.atan2(st.x, st.z);
    car.speed         = 0;
    car.lap           = 1;
    car.nextCheckpoint = 0;
    car.bestLapMs     = null;
    car.lapTimesMs    = [];
    car.finished      = false;

    carGroup.position.copy(car.pos);
    carGroup.rotation.y = car.heading;

    document.getElementById('lap').textContent  = '1';
    document.getElementById('best-time').textContent = 'BEST: --:--.---';
    document.getElementById('current-time').textContent = '00:00.000';
    document.getElementById('speed').textContent = '0';

    // Reset countdown styling
    const cdEl = document.getElementById('countdown');
    cdEl.style.color = '#ffffff';

    gameState = 'start';
    document.getElementById('start-screen').style.display = 'flex';
  }

  // =====================================================================
  // UTILITIES
  // =====================================================================
  function fmtTime(ms) {
    const m    = Math.floor(ms / 60000);
    const s    = Math.floor((ms % 60000) / 1000);
    const mili = Math.floor(ms % 1000);
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(mili).padStart(3,'0')}`;
  }

  // =====================================================================
  // UPDATE
  // =====================================================================
  function update(dt) {
    if (gameState !== 'racing') return;

    // --- Steering (scale with speed for realism) ---
    const steerFactor = Math.min(1, car.speed / 6);
    if (keys.left)  car.heading += car.steerRate * dt * steerFactor;
    if (keys.right) car.heading -= car.steerRate * dt * steerFactor;

    // --- Throttle / Brake (auto-accelerate when not braking) ---
    if (keys.brake) {
      car.speed -= car.brakePower * dt;
    } else {
      // net acceleration: thrust − aerodynamic drag
      car.speed += (car.accel - car.drag * car.speed) * dt;
    }
    car.speed = Math.max(0, car.speed);

    // --- Move ---
    car.pos.x += Math.sin(car.heading) * car.speed * dt;
    car.pos.z += Math.cos(car.heading) * car.speed * dt;
    carGroup.position.copy(car.pos);
    carGroup.rotation.y = car.heading;

    // Spin wheels proportional to speed
    const wheelSpinDelta = car.speed * dt * 1.2;
    carGroup.children.forEach((c, i) => {
      // wheels are index 7–10 (after body/cabin/windshield/rear/hl×2/tl×2)
      if (c.geometry && c.geometry.type === 'CylinderGeometry' && c.rotation.z !== 0) {
        c.rotation.x += wheelSpinDelta;
      }
    });

    // --- Checkpoint / Lap detection ---
    const cp   = checkpoints[car.nextCheckpoint];
    const dist = car.pos.distanceTo(cp.pos);
    if (dist < 14) {
      const isFinishLine = car.nextCheckpoint === 0;
      car.nextCheckpoint = (car.nextCheckpoint + 1) % NUM_CPS;

      if (isFinishLine) {
        const lapMs = performance.now() - car.lapStartTime;
        car.lapTimesMs.push(lapMs);

        if (car.bestLapMs === null || lapMs < car.bestLapMs) {
          car.bestLapMs = lapMs;
          document.getElementById('best-time').textContent = 'BEST: ' + fmtTime(lapMs);
        }
        car.lapStartTime = performance.now();

        if (car.lap >= MAX_LAPS) {
          finishRace();
          return;
        }
        car.lap++;
        document.getElementById('lap').textContent = car.lap;
      }
    }

    // --- HUD ---
    const kmh = Math.round(car.speed * 3.6);
    document.getElementById('speed').textContent = kmh;
    const lapElapsed = performance.now() - car.lapStartTime;
    document.getElementById('current-time').textContent = fmtTime(lapElapsed);
  }

  function finishRace() {
    car.finished = true;
    car.speed    = 0;
    gameState    = 'finish';

    const totalMs = performance.now() - car.raceStartTime;
    document.getElementById('finish-total').textContent = 'タイム: ' + fmtTime(totalMs);
    document.getElementById('finish-best').textContent  =
      car.bestLapMs !== null ? 'ベストラップ: ' + fmtTime(car.bestLapMs) : '';
    document.getElementById('finish-laps').textContent  =
      car.lapTimesMs.map((t, i) => `LAP ${i + 1}: ${fmtTime(t)}`).join('\n');

    document.getElementById('finish-screen').style.display = 'flex';
  }

  // =====================================================================
  // CAMERA — smooth third-person follow
  // =====================================================================
  const _camTarget = new THREE.Vector3();
  const _camPos    = new THREE.Vector3();

  function updateCamera() {
    const dist = 12;
    const h    = 5;
    _camPos.set(
      car.pos.x - Math.sin(car.heading) * dist,
      car.pos.y + h,
      car.pos.z - Math.cos(car.heading) * dist
    );
    camera.position.lerp(_camPos, 0.1);
    _camTarget.set(car.pos.x, car.pos.y + 1.5, car.pos.z);
    camera.lookAt(_camTarget);
  }

  // =====================================================================
  // RENDER LOOP
  // =====================================================================
  let lastTime = performance.now();

  function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    const dt  = Math.min((now - lastTime) / 1000, 0.05);
    lastTime  = now;
    update(dt);
    updateCamera();
    renderer.render(scene, camera);
  }

  animate();
})();
