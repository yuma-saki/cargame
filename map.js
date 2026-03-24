'use strict';

/**
 * MapModule — OSM地図モジュール
 * OpenStreetMap (Overpass API) で西原マリンパーク周辺の
 * 道路・建物・水域データをフェッチして Three.js シーンを構築する。
 */
const MapModule = (function () {

  // ================================================================
  // 座標変換 — 原点: 西原マリンパーク付近
  // ================================================================
  const ORIGIN = { lat: 26.2290, lng: 127.7980 };
  // 緯度 1 度 = 約 111,000 m
  // 経度 1 度 = 111,000 * cos(緯度) ≒ 99,650 m (at 26°N)
  const LAT_M = 111000;
  const LNG_M = 111000 * Math.cos(ORIGIN.lat * Math.PI / 180);

  /**
   * WGS84 の lat/lng を Three.js の XZ 平面座標 (meters) に変換する。
   * X: 東が正、Z: 南が正（Three.js の慣例に合わせて北を -Z にする）
   */
  function project(lat, lng) {
    return {
      x: (lng - ORIGIN.lng) * LNG_M,
      z: -(lat - ORIGIN.lat) * LAT_M,
    };
  }

  // ================================================================
  // コース 1「港周回」ウェイポイント
  // 西原マリンパーク周辺を約 1.2 km 周回する初心者コース
  // ================================================================
  const COURSE_LATLON = [
    [26.2318, 127.7970], // S/F ライン — 公園入口付近
    [26.2328, 127.7988], // 北東コーナー
    [26.2320, 127.8005], // 東ストレート
    [26.2305, 127.8015], // 南東ターン
    [26.2288, 127.8010], // 南ストレート
    [26.2274, 127.7995], // 海岸沿い
    [26.2268, 127.7975], // 南西コーナー
    [26.2278, 127.7960], // 西ストレート
    [26.2295, 127.7955], // 北西ターン
    [26.2310, 127.7963], // スタートへ戻る
  ];

  /** Three.js の XZ 座標に変換済みのコースウェイポイント */
  const COURSE_WAYPOINTS = COURSE_LATLON.map(([lat, lng]) => project(lat, lng));

  // ================================================================
  // Overpass API フェッチ
  // ================================================================
  const BBOX = {
    south: 26.218, west: 127.782,
    north: 26.248, east: 127.815,
  };

  async function fetchOSMData(onProgress) {
    const bbox = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
    // 道路・水域・土地利用・建物を一括取得
    const query = `
[out:json][timeout:40];
(
  way["highway"]["highway"!~"^(footway|cycleway|path|pedestrian|steps|bridleway|proposed|construction)$"](${bbox});
  way["natural"~"^(water|bay|coastline)$"](${bbox});
  way["waterway"~"^(river|stream|canal)$"](${bbox});
  way["landuse"~"^(grass|meadow|park|recreation_ground|farmland|forest|orchard)$"](${bbox});
  way["leisure"~"^(park|garden|pitch)$"](${bbox});
  way["building"](${bbox});
);
out body;
>;
out skel qt;
    `.trim();

    if (onProgress) onProgress('Overpass API に接続中...');

    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query),
    });
    if (!res.ok) throw new Error('Overpass HTTP ' + res.status);

    if (onProgress) onProgress('データを解析中...');
    return res.json();
  }

  // ================================================================
  // OSM JSON パース
  // ================================================================
  function parseOSM(data) {
    const nodes = {};
    const ways  = [];
    data.elements.forEach(el => {
      if (el.type === 'node') nodes[el.id] = el;
      else if (el.type === 'way') ways.push(el);
    });
    return { nodes, ways };
  }

  // ================================================================
  // 道路幅 (m) と色
  // ================================================================
  const WIDTHS = {
    motorway: 14, motorway_link: 8,
    trunk: 12, trunk_link: 7,
    primary: 10, primary_link: 6,
    secondary: 9,  secondary_link: 5,
    tertiary: 7,   tertiary_link: 4,
    unclassified: 6, residential: 6,
    service: 4, living_street: 5, road: 6,
  };
  const ROAD_COLORS = {
    motorway: 0x6666aa, trunk: 0x7777aa,
    primary: 0x585860, secondary: 0x505055,
    tertiary: 0x484848, residential: 0x424242,
    service: 0x3c3c3c,
  };
  const ROAD_DEFAULT_COLOR = 0x404040;

  // ================================================================
  // メッシュビルダー — 道路 (矩形ストリップ)
  // ================================================================
  function buildRoadMesh(scene, pts, width, color) {
    if (pts.length < 2) return;
    const verts = [], idxs = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i], p1 = pts[i + 1];
      const dx = p1.x - p0.x, dz = p1.z - p0.z;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len < 0.3) continue;
      const hw = width / 2;
      const nx = (-dz / len) * hw, nz = (dx / len) * hw;
      const b = verts.length / 3;
      verts.push(
        p0.x + nx, 0.04, p0.z + nz,
        p0.x - nx, 0.04, p0.z - nz,
        p1.x + nx, 0.04, p1.z + nz,
        p1.x - nx, 0.04, p1.z - nz,
      );
      idxs.push(b, b + 1, b + 2,  b + 1, b + 3, b + 2);
    }
    if (!verts.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(idxs);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // ================================================================
  // メッシュビルダー — ポリゴン (水域・土地・建物)
  // ================================================================
  function buildPolygon(scene, pts, color, extrudeH, yOfs) {
    if (pts.length < 3) return;
    try {
      const shape = new THREE.Shape();
      shape.moveTo(pts[0].x, pts[0].z);
      for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i].x, pts[i].z);
      shape.closePath();

      const geo = extrudeH > 0
        ? new THREE.ExtrudeGeometry(shape, { depth: extrudeH, bevelEnabled: false })
        : new THREE.ShapeGeometry(shape);

      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = yOfs || 0.01;
      if (extrudeH > 0) mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
    } catch (_) { /* 不正ポリゴンは無視 */ }
  }

  // ================================================================
  // シーン構築 — OSM データを Three.js に変換
  // ================================================================
  function buildOSMScene(scene, data, onProgress) {
    if (onProgress) onProgress('道路を描画中...');
    const { nodes, ways } = parseOSM(data);
    let cnt = { roads: 0, water: 0, green: 0, bldg: 0 };

    ways.forEach(way => {
      const tags = way.tags || {};
      const pts  = way.nodes
        .map(id => nodes[id])
        .filter(Boolean)
        .map(n => project(n.lat, n.lon));

      // --- 道路 ---
      if (tags.highway) {
        const type  = tags.highway;
        const width = WIDTHS[type] || 5;
        const color = ROAD_COLORS[type] || ROAD_DEFAULT_COLOR;
        buildRoadMesh(scene, pts, width, color);
        cnt.roads++;

      // --- 水域・湾 ---
      } else if (tags.natural === 'water' || tags.natural === 'bay') {
        buildPolygon(scene, pts, 0x1a6fa0, 0, -0.05);
        cnt.water++;
      } else if (tags.waterway) {
        buildRoadMesh(scene, pts, 4, 0x2a80b0);
        cnt.water++;

      // --- 土地利用 (公園・農地・森林) ---
      } else if (tags.landuse || tags.leisure) {
        const c = (tags.landuse === 'farmland') ? 0x8ab46e
                : (tags.landuse === 'forest' || tags.landuse === 'orchard') ? 0x3a7a30
                : 0x5a9e52;
        buildPolygon(scene, pts, c, 0, 0.005);
        cnt.green++;

      // --- 建物 ---
      } else if (tags.building) {
        const rawH = tags['building:height'] || tags.height;
        const h    = rawH ? parseFloat(rawH) : (3 + Math.random() * 7);
        if (!isNaN(h) && h > 0) {
          buildPolygon(scene, pts, 0xc8b89a, h, 0.02);
          cnt.bldg++;
        }
      }
    });

    console.log('[OSM] 描画完了:', cnt);
    return cnt;
  }

  // ================================================================
  // Public API
  // ================================================================
  return {
    project,
    fetchOSMData,
    buildOSMScene,
    COURSE_WAYPOINTS,
    ORIGIN,
    BBOX,
  };

})();
