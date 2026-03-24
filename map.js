'use strict';

/**
 * MapModule — PLATEAU + OSM 地図モジュール
 *
 * 建物: Project PLATEAU 3D Tiles (国土交通省)
 *   - `3d-tiles-renderer` ライブラリで ECEF 座標系から ENU ローカル座標へ変換
 *   - G空間情報センター / plateau.geospatial.jp から tileset.json を取得
 *   - 対象 URL は PLATEAU_CANDIDATES を参照・更新してください
 *     https://www.geospatial.jp/ckan/dataset?q=plateau+沖縄
 *
 * 道路: OpenStreetMap (Overpass API)  ※暫定。将来 PLATEAU 交通モデルへ移行予定
 */
const MapModule = (function () {

  // ================================================================
  // 座標変換 — 原点: 西原マリンパーク付近
  // ================================================================
  const ORIGIN = { lat: 26.2290, lng: 127.7980 };
  const LAT_M  = 111000;
  const LNG_M  = 111000 * Math.cos(ORIGIN.lat * Math.PI / 180);

  /** WGS84 lat/lng → Three.js XZ ローカル座標 (meters / East=+X, South=+Z) */
  function project(lat, lng) {
    return {
      x: (lng - ORIGIN.lng) * LNG_M,
      z: -(lat - ORIGIN.lat) * LAT_M,
    };
  }

  // ================================================================
  // コース 1「港周回」ウェイポイント
  // ================================================================
  const COURSE_LATLON = [
    [26.2318, 127.7970],
    [26.2328, 127.7988],
    [26.2320, 127.8005],
    [26.2305, 127.8015],
    [26.2288, 127.8010],
    [26.2274, 127.7995],
    [26.2268, 127.7975],
    [26.2278, 127.7960],
    [26.2295, 127.7955],
    [26.2310, 127.7963],
  ];
  const COURSE_WAYPOINTS = COURSE_LATLON.map(([lat, lng]) => project(lat, lng));

  // ================================================================
  // PLATEAU 3D Tiles 設定
  //
  // G空間情報センターで対象都市の tileset.json URL を確認してください:
  //   https://www.geospatial.jp/ckan/dataset?q=plateau+西原+沖縄
  //
  // URL 形式の例 (年度・都市コードにより異なる):
  //   https://plateau.geospatial.jp/opt/{city-code}-{city-name}-{year}/bldg/tileset.json
  // ================================================================
  const PLATEAU_CANDIDATES = [
    // 西原町 (47213) — データが公開され次第 URL を確定してください
    'https://plateau.geospatial.jp/opt/47213_nishihara-town_2023_bldg_2_op/tileset.json',
    // フォールバック: 那覇市 (47201)
    'https://plateau.geospatial.jp/opt/47201_naha-city_2023_bldg_2_op/tileset.json',
    // フォールバック: 沖縄市 (47211)
    'https://plateau.geospatial.jp/opt/47211_okinawa-city_2022_bldg_2_op/tileset.json',
  ];

  // ================================================================
  // ECEF → ENU ローカル座標変換行列
  //
  // Three.js はローカル右手座標系 (X=East, Y=Up, Z=South) を使用。
  // PLATEAU 3D Tiles は ECEF (地心直交座標) で格納されているため、
  // 原点付近の ENU フレームへ変換する 4x4 行列を生成する。
  // ================================================================
  function buildECEFtoLocalMatrix() {
    const lat    = ORIGIN.lat * Math.PI / 180;
    const lng    = ORIGIN.lng * Math.PI / 180;
    const cosLat = Math.cos(lat), sinLat = Math.sin(lat);
    const cosLng = Math.cos(lng), sinLng = Math.sin(lng);

    // WGS84 楕円体パラメータ
    const a  = 6378137.0;
    const e2 = 0.00669437999014;
    const N  = a / Math.sqrt(1 - e2 * sinLat * sinLat);

    // 原点の ECEF 座標
    const x0 = N * cosLat * cosLng;
    const y0 = N * cosLat * sinLng;
    const z0 = N * (1 - e2) * sinLat;

    // ENU 基底ベクトル (ECEF 空間内)
    //   East  E = [-sinLng,              cosLng,             0      ]
    //   North N = [-sinLat*cosLng,       -sinLat*sinLng,     cosLat ]
    //   Up    U = [ cosLat*cosLng,        cosLat*sinLng,     sinLat ]
    const Ex = -sinLng,            Ey = cosLng,             Ez = 0;
    const Nx = -sinLat * cosLng,   Ny = -sinLat * sinLng,   Nz = cosLat;
    const Ux =  cosLat * cosLng,   Uy =  cosLat * sinLng,   Uz = sinLat;

    // 平行移動 t = -R^T * origin
    const tx = -(Ex * x0 + Ey * y0 + Ez * z0);   // East offset
    const ty = -(Ux * x0 + Uy * y0 + Uz * z0);   // Up offset
    const tz =  (Nx * x0 + Ny * y0 + Nz * z0);   // South offset (-North)

    // 変換行列 (ECEF → local)
    //   row0 → local_X (East)
    //   row1 → local_Y (Up)
    //   row2 → local_Z (South = -North)
    const M = new THREE.Matrix4();
    M.set(
       Ex,  Ey,  Ez, tx,
       Ux,  Uy,  Uz, ty,
      -Nx, -Ny, -Nz, tz,
        0,   0,   0,  1,
    );
    return M;
  }

  // ================================================================
  // PLATEAU 建物 3D Tiles 読み込み
  // ================================================================
  async function loadPLATEAUBuildings(scene, camera, renderer, onProgress) {
    // 3d-tiles-renderer UMD ビルドが window.TilesRenderers を公開
    const TilesLib = window.TilesRenderers;
    if (!TilesLib || !TilesLib.TilesRenderer) {
      throw new Error('3d-tiles-renderer ライブラリが読み込まれていません');
    }
    const { TilesRenderer, GLTFExtensionsPlugin } = TilesLib;

    const localFrame = buildECEFtoLocalMatrix();
    const errors     = [];

    for (const url of PLATEAU_CANDIDATES) {
      const label = url.split('/').slice(-4, -1).join('/');
      try {
        if (onProgress) onProgress(`PLATEAU データ取得中: ${label}…`);

        const tr = new TilesRenderer(url);

        // Draco 圧縮 GLTF に対応
        if (GLTFExtensionsPlugin) {
          const DracoLib = window.THREE_DRACOLoader || window.DRACOLoader;
          if (DracoLib) {
            const draco = new DracoLib();
            draco.setDecoderPath(
              'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/libs/draco/',
            );
            tr.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco }));
          }
        }

        tr.setCamera(camera);
        tr.setResolutionFromRenderer(camera, renderer);

        // ECEF → ローカル変換をグループ行列に設定
        tr.group.matrix.copy(localFrame);
        tr.group.matrixAutoUpdate = false;

        scene.add(tr.group);

        // tileset.json が読み込まれるまで最大 8 秒待機
        await Promise.race([
          new Promise(resolve => {
            tr.addEventListener('load-tile-set', resolve, { once: true });
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('tileset 取得タイムアウト (8s)')), 8000),
          ),
        ]);

        console.log('[PLATEAU] 読み込み成功:', url);
        return tr; // 成功したらリターン

      } catch (e) {
        console.warn('[PLATEAU] 失敗:', label, '—', e.message);
        errors.push(`${label}: ${e.message}`);
      }
    }

    throw new Error('全 PLATEAU ソース失敗:\n' + errors.join('\n'));
  }

  // ================================================================
  // 道路データ取得 (OpenStreetMap / Overpass API)
  // ※ PLATEAU 道路 CityGML のブラウザリアルタイム解析が困難なため暫定使用
  // ================================================================
  const ROAD_BBOX = { south: 26.218, west: 127.782, north: 26.248, east: 127.815 };

  async function fetchRoadData(onProgress) {
    if (onProgress) onProgress('道路データ取得中 (OpenStreetMap)…');
    const { south, west, north, east } = ROAD_BBOX;
    const bbox  = `${south},${west},${north},${east}`;
    const query = `[out:json][timeout:40];(way["highway"]["highway"!~"^(footway|cycleway|path|pedestrian|steps|bridleway)$"](${bbox}););out body;>;out skel qt;`;
    const res   = await fetch('https://overpass-api.de/api/interpreter', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    'data=' + encodeURIComponent(query),
    });
    if (!res.ok) throw new Error('Overpass HTTP ' + res.status);
    return res.json();
  }

  // ================================================================
  // 道路メッシュ描画
  // ================================================================
  const ROAD_WIDTHS = {
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

  function buildRoads(scene, osmData, onProgress) {
    if (onProgress) onProgress('道路を描画中…');
    const nodes = {}, ways = [];
    osmData.elements.forEach(el => {
      if (el.type === 'node') nodes[el.id] = el;
      else if (el.type === 'way') ways.push(el);
    });

    let count = 0;
    ways.forEach(way => {
      const tags = way.tags || {};
      if (!tags.highway) return;
      const pts = way.nodes
        .map(id => nodes[id]).filter(Boolean)
        .map(n => project(n.lat, n.lon));
      if (pts.length < 2) return;
      _buildRoadMesh(scene, pts, ROAD_WIDTHS[tags.highway] || 5, ROAD_COLORS[tags.highway] || 0x404040);
      count++;
    });
    console.log('[OSM Roads] 道路描画:', count, '本');
  }

  function _buildRoadMesh(scene, pts, width, color) {
    const verts = [], idxs = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i], p1 = pts[i + 1];
      const dx = p1.x - p0.x, dz = p1.z - p0.z;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len < 0.3) continue;
      const hw = width / 2;
      const nx = (-dz / len) * hw, nz = (dx / len) * hw;
      const b  = verts.length / 3;
      verts.push(
        p0.x + nx, 0.04, p0.z + nz,  p0.x - nx, 0.04, p0.z - nz,
        p1.x + nx, 0.04, p1.z + nz,  p1.x - nx, 0.04, p1.z - nz,
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
  // Public API
  // ================================================================
  return {
    project,
    COURSE_WAYPOINTS,
    ORIGIN,
    loadPLATEAUBuildings,
    fetchRoadData,
    buildRoads,
  };

})();
