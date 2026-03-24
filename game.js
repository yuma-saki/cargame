'use strict';

(function () {

  // ================================================================
  // ローディング UI
  // ================================================================
  const loadingEl  = document.getElementById('loading-screen');
  const loadMsgEl  = document.getElementById('loading-msg');
  const startEl    = document.getElementById('start-screen');

  function setLoading(msg) {
    if (loadMsgEl) loadMsgEl.textContent = msg || '';
  }
  function hideLoading() {
    if (loadingEl) loadingEl.style.display = 'none';
    if (startEl)   startEl.style.display   = 'flex';
  }

  // ================================================================
  // THREE.js シーン
  // ================================================================
  const canvas   = document.getElementById('game-canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type    = THREE.PCFSoftShadowMap;

  const scene  = new THREE.Scene();
  scene.background = new THREE.Color(0x7ec8e3);
  scene.fog        = new THREE.FogExp2(0x9fd8e8, 0.0035);

  const camera = new THREE.PerspectiveCamera(
    60, window.innerWidth / window.innerHeight, 0.1, 1200,
  );

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  // ================================================================
  // ライティング
  // ================================================================
  scene.add(new THREE.AmbientLight(0xffeedd, 0.55));

  const sun = new THREE.DirectionalLight(0xfff8e0, 1.05);
  sun.position.set(80, 150, 80);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near   = 1;
  sun.shadow.camera.far    = 600;
  sun.shadow.camera.left   = -300;
  sun.shadow.camera.right  = 300;
  sun.shadow.camera.top    = 300;
  sun.shadow.camera.bottom = -300;
  scene.add(sun);

  // ================================================================
  // コース — MapModule の実座標ウェイポイントを使用
  // ================================================================
  const TRACK_WIDTH    = 16;   // meters
  const TRACK_SEGMENTS = 300;
  const MAX_LAPS       = 3;

  const curve = new THREE.CatmullRomCurve3(
    MapModule.COURSE_WAYPOINTS.map(p => new THREE.Vector3(p.x, 0, p.z)),
    true,        // closed loop
    'catmullrom',
    0.5,
  );

  // ================================================================
  // コース（走行ライン）オーバーレイ描画
  // ================================================================
  function buildCourseOverlay() {
    const verts = [], idxs = [], uvs = [];

    for (let i = 0; i < TRACK_SEGMENTS; i++) {
      const t  = i / TRACK_SEGMENTS;
      const pt = curve.getPoint(t);
      const tn = curve.getTangent(t);
      const nx = -tn.z, nz = tn.x;
      const hw = TRACK_WIDTH / 2;

      verts.push(
        pt.x + nx * hw, 0.05, pt.z + nz * hw,
        pt.x - nx * hw, 0.05, pt.z - nz * hw,
      );
      uvs.push(0, t * 40,  1, t * 40);

      const b  = i * 2;
      const nb = ((i + 1) % TRACK_SEGMENTS) * 2;
      idxs.push(b, b + 1, nb,  b + 1, nb + 1, nb);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs,   2));
    geo.setIndex(idxs);
    geo.computeVertexNormals();

    // 路面 (OSM 道路より少し上)
    const roadMesh = new THREE.Mesh(
      geo,
      new THREE.MeshLambertMaterial({ color: 0x383838 }),
    );
    roadMesh.receiveShadow = true;
    scene.add(roadMesh);

    // サイドライン (白)
    [-1, 1].forEach(side => {
      const pts = [];
      for (let i = 0; i <= TRACK_SEGMENTS; i++) {
        const t  = (i % TRACK_SEGMENTS) / TRACK_SEGMENTS;
        const pt = curve.getPoint(t);
        const tn = curve.getTangent(t);
        pts.push(new THREE.Vector3(
          pt.x + (-tn.z) * side * (TRACK_WIDTH / 2 - 0.5),
          0.12,
          pt.z +  tn.x  * side * (TRACK_WIDTH / 2 - 0.5),
        ));
      }
      scene.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0xffffff }),
      ));
    });

    // センター破線 (黄)
    for (let i = 0; i < TRACK_SEGMENTS; i += 2) {
      const pts = [];
      for (let j = 0; j <= 8; j++) {
        const t  = (i + j / 8) / TRACK_SEGMENTS;
        const pt = curve.getPoint(t % 1);
        pts.push(new THREE.Vector3(pt.x, 0.12, pt.z));
      }
      scene.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0xffff66 }),
      ));
    }

    // スタート/フィニッシュアーチ
    const sfPt = curve.getPoint(0);
    const sfTn = curve.getTangent(0);
    const sfNx = -sfTn.z, sfNz = sfTn.x;
    const archMat = new THREE.MeshLambertMaterial({ color: 0xffffff });

    [-1, 1].forEach(side => {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.7, 7, 0.7), archMat);
      pillar.position.set(
        sfPt.x + sfNx * side * (TRACK_WIDTH / 2 + 0.8),
        3.5,
        sfPt.z + sfNz * side * (TRACK_WIDTH / 2 + 0.8),
      );
      pillar.castShadow = true;
      scene.add(pillar);
    });

    // チェッカーフラッグストリップ
    for (let k = 0; k < 6; k++) {
      const t2   = (k / 6 - 0.5);
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(TRACK_WIDTH / 6, 0.04, 1.5),
        new THREE.MeshLambertMaterial({ color: k % 2 === 0 ? 0xffffff : 0x111111 }),
      );
      strip.position.set(
        sfPt.x + sfNx * t2 * TRACK_WIDTH,
        0.06,
        sfPt.z + sfNz * t2 * TRACK_WIDTH,
      );
      scene.add(strip);
    }

    // コーンマーカー (15 セグメントごと)
    for (let i = 0; i < TRACK_SEGMENTS; i += 15) {
      const t  = i / TRACK_SEGMENTS;
      const pt = curve.getPoint(t);
      const tn = curve.getTangent(t);
      const offset = TRACK_WIDTH / 2 + 1.4;
      [-1, 1].forEach(side => {
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(0.3, 0.9, 6),
          new THREE.MeshLambertMaterial({ color: 0xff6600 }),
        );
        cone.position.set(
          pt.x + (-tn.z) * side * offset,
          0.45,
          pt.z +  tn.x  * side * offset,
        );
        scene.add(cone);
      });
    }
  }

  buildCourseOverlay();

  // ================================================================
  // 背景環境 (OSM なしでも動く基本レイヤー)
  // ================================================================
  function buildBaseEnvironment() {
    // 芝生の地面
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1200, 1200),
      new THREE.MeshLambertMaterial({ color: 0x4a8c44 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.15;
    ground.receiveShadow = true;
    scene.add(ground);

    // 海 (東側 = 正の X 方向 / Nakagusuku Bay)
    const ocean = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 500),
      new THREE.MeshLambertMaterial({ color: 0x1565a0, transparent: true, opacity: 0.88 }),
    );
    ocean.rotation.x = -Math.PI / 2;
    // 西原マリンパーク原点から東南 250 m 付近に配置
    ocean.position.set(280, -0.25, 280);
    scene.add(ocean);

    // 沖縄らしい空の色を強調するフォグ
    scene.fog = new THREE.FogExp2(0x9fd8e8, 0.003);
  }

  buildBaseEnvironment();

  // ================================================================
  // フォールバック環境 (OSM 取得失敗時)
  // ================================================================
  function buildFallbackEnvironment() {
    // 簡易ツリー
    function addTree(x, z, h) {
      h = h || 4.5 + Math.random() * 4;
      const g = new THREE.Group();
      g.add(Object.assign(
        new THREE.Mesh(
          new THREE.CylinderGeometry(0.22, 0.28, h * 0.4, 6),
          new THREE.MeshLambertMaterial({ color: 0x6b4226 }),
        ), { position: new THREE.Vector3(0, h * 0.2, 0) },
      ));
      [0, h * 0.2, h * 0.42].forEach((dy, i) => {
        const r  = (1 - i * 0.22) * h * 0.22;
        const th = (1 - i * 0.18) * h * 0.55;
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(r, th, 7),
          new THREE.MeshLambertMaterial({ color: [0x2d6a2d, 0x3d7d3d, 0x4e9e4e][i] }),
        );
        cone.position.y = h * 0.35 + dy + th * 0.4;
        g.add(cone);
      });
      g.position.set(x, 0, z);
      scene.add(g);
    }

    // コース外周にツリーを配置
    const wp = MapModule.COURSE_WAYPOINTS;
    wp.forEach(p => {
      for (let k = 0; k < 3; k++) {
        const angle  = Math.random() * Math.PI * 2;
        const radius = TRACK_WIDTH + 5 + Math.random() * 40;
        addTree(p.x + Math.cos(angle) * radius, p.z + Math.sin(angle) * radius);
      }
    });
  }

  // ================================================================
  // 車 — ブリーザー C
  // ================================================================
  const carGroup = new THREE.Group();
  scene.add(carGroup);

  const mBody  = new THREE.MeshLambertMaterial({ color: 0x1155cc });
  const mRoof  = new THREE.MeshLambertMaterial({ color: 0x0d40aa });
  const mWheel = new THREE.MeshLambertMaterial({ color: 0x111111 });
  const mHub   = new THREE.MeshLambertMaterial({ color: 0x888888 });
  const mGlass = new THREE.MeshLambertMaterial({ color: 0x88bbff, transparent: true, opacity: 0.7 });
  const mLight = new THREE.MeshLambertMaterial({ color: 0xffeeaa });
  const mBrake = new THREE.MeshLambertMaterial({ color: 0xff2222 });

  function addMesh(geo, mat, px, py, pz, rx, ry, rz) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(px || 0, py || 0, pz || 0);
    if (rx) m.rotation.x = rx;
    if (ry) m.rotation.y = ry;
    if (rz) m.rotation.z = rz;
    m.castShadow   = true;
    m.receiveShadow = true;
    carGroup.add(m);
    return m;
  }

  addMesh(new THREE.BoxGeometry(2.1, 0.75, 4.2), mBody,  0,    0.55,  0);
  addMesh(new THREE.BoxGeometry(1.75, 0.62, 2.1), mRoof, 0,    1.19, -0.15);
  addMesh(new THREE.BoxGeometry(1.6, 0.54, 0.08), mGlass, 0,  1.15,  0.92, 0.22);
  addMesh(new THREE.BoxGeometry(1.6, 0.54, 0.08), mGlass, 0,  1.15, -1.22, -0.22);
  [[0.62, 0.52, 2.09], [-0.62, 0.52, 2.09]].forEach(([x, y, z]) =>
    addMesh(new THREE.BoxGeometry(0.45, 0.22, 0.06), mLight, x, y, z));
  [[0.65, 0.55, -2.12], [-0.65, 0.55, -2.12]].forEach(([x, y, z]) =>
    addMesh(new THREE.BoxGeometry(0.38, 0.18, 0.06), mBrake, x, y, z));

  const WHEEL_POS = [[-1.12, 0.34, 1.35], [1.12, 0.34, 1.35], [-1.12, 0.34, -1.35], [1.12, 0.34, -1.35]];
  WHEEL_POS.forEach(([wx, wy, wz]) => {
    addMesh(new THREE.CylinderGeometry(0.34, 0.34, 0.28, 12), mWheel, wx, wy, wz, 0, 0, Math.PI / 2);
    addMesh(new THREE.CylinderGeometry(0.14, 0.14, 0.3,  8),  mHub,   wx, wy, wz, 0, 0, Math.PI / 2);
  });

  // ================================================================
  // 車の物理状態
  // ================================================================
  const startPt = curve.getPoint(0);
  const startTn = curve.getTangent(0);

  const car = {
    pos:     new THREE.Vector3(startPt.x, 0, startPt.z),
    heading: Math.atan2(startTn.x, startTn.z),
    speed:   0,
    // 物理定数
    accel:     18,   // m/s²（推力）
    drag:       0.42, // 空気抵抗係数 → 終端速度 ≈ 43 m/s ≈ 154 km/h
    brakePower: 38,
    steerRate:  1.7,
    // レース状態
    lap:           1,
    nextCP:        0,
    lapStart:      0,
    raceStart:     0,
    bestLapMs:     null,
    lapTimes:      [],
    finished:      false,
  };

  carGroup.position.copy(car.pos);
  carGroup.rotation.y = car.heading;

  // ================================================================
  // チェックポイント
  // ================================================================
  const NUM_CPS   = 12;
  const checkpoints = Array.from({ length: NUM_CPS }, (_, i) => {
    const pt = curve.getPoint(i / NUM_CPS);
    return new THREE.Vector3(pt.x, 0, pt.z);
  });

  // ================================================================
  // 入力
  // ================================================================
  const keys = { left: false, right: false, brake: false };

  document.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft')                           keys.left  = true;
    if (e.key === 'ArrowRight')                          keys.right = true;
    if (e.key === 'ArrowDown' || e.key === ' ')          keys.brake = true;
  });
  document.addEventListener('keyup', e => {
    if (e.key === 'ArrowLeft')                           keys.left  = false;
    if (e.key === 'ArrowRight')                          keys.right = false;
    if (e.key === 'ArrowDown' || e.key === ' ')          keys.brake = false;
  });

  function bindBtn(id, key) {
    const el  = document.getElementById(id);
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

  // ================================================================
  // ゲームステートマシン
  // ================================================================
  let gameState = 'start';

  document.getElementById('start-btn').addEventListener('click', startCountdown);
  document.getElementById('retry-btn').addEventListener('click', resetGame);

  function startCountdown() {
    document.getElementById('start-screen').style.display = 'none';
    gameState = 'countdown';
    let n  = 3;
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
        gameState    = 'racing';
        car.raceStart = performance.now();
        car.lapStart  = performance.now();
      }
    }, 1000);
  }

  function resetGame() {
    document.getElementById('finish-screen').style.display = 'none';
    const sp = curve.getPoint(0);
    const st = curve.getTangent(0);
    car.pos.set(sp.x, 0, sp.z);
    car.heading    = Math.atan2(st.x, st.z);
    car.speed      = 0;
    car.lap        = 1;
    car.nextCP     = 0;
    car.bestLapMs  = null;
    car.lapTimes   = [];
    car.finished   = false;
    carGroup.position.copy(car.pos);
    carGroup.rotation.y = car.heading;
    document.getElementById('lap').textContent       = '1';
    document.getElementById('best-time').textContent = 'BEST: --:--.---';
    document.getElementById('current-time').textContent = '00:00.000';
    document.getElementById('speed').textContent     = '0';
    document.getElementById('countdown').style.color = '#ffffff';
    gameState = 'start';
    document.getElementById('start-screen').style.display = 'flex';
  }

  // ================================================================
  // ユーティリティ
  // ================================================================
  function fmtTime(ms) {
    const m    = Math.floor(ms / 60000);
    const s    = Math.floor((ms % 60000) / 1000);
    const mili = Math.floor(ms % 1000);
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(mili).padStart(3,'0')}`;
  }

  // ================================================================
  // 更新ループ
  // ================================================================
  function update(dt) {
    if (gameState !== 'racing') return;

    // ステアリング (速度に応じてスケール)
    const sf = Math.min(1, car.speed / 6);
    if (keys.left)  car.heading += car.steerRate * dt * sf;
    if (keys.right) car.heading -= car.steerRate * dt * sf;

    // 自動加速 / ブレーキ
    if (keys.brake) {
      car.speed -= car.brakePower * dt;
    } else {
      car.speed += (car.accel - car.drag * car.speed) * dt;
    }
    car.speed = Math.max(0, car.speed);

    // 移動
    car.pos.x += Math.sin(car.heading) * car.speed * dt;
    car.pos.z += Math.cos(car.heading) * car.speed * dt;
    carGroup.position.copy(car.pos);
    carGroup.rotation.y = car.heading;

    // チェックポイント判定
    const cpPos  = checkpoints[car.nextCP];
    if (car.pos.distanceTo(cpPos) < 15) {
      const isFinish = car.nextCP === 0;
      car.nextCP = (car.nextCP + 1) % NUM_CPS;

      if (isFinish) {
        const lapMs = performance.now() - car.lapStart;
        car.lapTimes.push(lapMs);
        if (car.bestLapMs === null || lapMs < car.bestLapMs) {
          car.bestLapMs = lapMs;
          document.getElementById('best-time').textContent = 'BEST: ' + fmtTime(lapMs);
        }
        car.lapStart = performance.now();
        if (car.lap >= MAX_LAPS) { finishRace(); return; }
        car.lap++;
        document.getElementById('lap').textContent = car.lap;
      }
    }

    // HUD 更新
    document.getElementById('speed').textContent = Math.round(car.speed * 3.6);
    document.getElementById('current-time').textContent = fmtTime(performance.now() - car.lapStart);
  }

  function finishRace() {
    car.finished = true;
    car.speed    = 0;
    gameState    = 'finish';
    const total  = performance.now() - car.raceStart;
    document.getElementById('finish-total').textContent =
      'タイム: ' + fmtTime(total);
    document.getElementById('finish-best').textContent =
      car.bestLapMs !== null ? 'ベストラップ: ' + fmtTime(car.bestLapMs) : '';
    document.getElementById('finish-laps').textContent =
      car.lapTimes.map((t, i) => `LAP ${i + 1}: ${fmtTime(t)}`).join('\n');
    document.getElementById('finish-screen').style.display = 'flex';
  }

  // ================================================================
  // カメラ (スムーズ第三者視点)
  // ================================================================
  const _camDst = new THREE.Vector3();
  const _lookAt = new THREE.Vector3();

  function updateCamera() {
    _camDst.set(
      car.pos.x - Math.sin(car.heading) * 14,
      car.pos.y + 5.5,
      car.pos.z - Math.cos(car.heading) * 14,
    );
    camera.position.lerp(_camDst, 0.1);
    _lookAt.set(car.pos.x, car.pos.y + 1.5, car.pos.z);
    camera.lookAt(_lookAt);
  }

  // ================================================================
  // レンダーループ
  // ================================================================
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

  // ================================================================
  // 非同期初期化 — OSM データ取得
  // ================================================================
  async function init() {
    try {
      setLoading('地図データを取得中 (Overpass API)…');
      const osmData = await MapModule.fetchOSMData(setLoading);

      setLoading('道路・建物を構築中…');
      MapModule.buildOSMScene(scene, osmData, setLoading);

    } catch (err) {
      console.warn('[OSM] 取得失敗。フォールバック環境を使用します:', err.message);
      buildFallbackEnvironment();
    }

    hideLoading();
    animate();
  }

  init();

})();
