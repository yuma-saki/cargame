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
  // 沖縄県の対象市町村コード (PLATEAU データカタログ検索用)
  const PLATEAU_CITY_CODES = ['47201', '47211', '47213'];

  /**
   * PLATEAU データカタログ API から沖縄県建物 3D Tiles の
   * tileset.json URL を動的に取得する。
   * API が使えない場合は空配列を返す。
   */
  async function fetchPLATEAUCandidates() {
    try {
      const res = await Promise.race([
        fetch('https://api.plateauview.mlit.go.jp/datacatalog/plateau-datasets'),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000)),
      ]);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const datasets = await res.json();

      const candidates = [];
      (Array.isArray(datasets) ? datasets : (datasets.datasets || [])).forEach(ds => {
        const cityCode = String(ds.cityCode || ds.city_code || '');
        if (!PLATEAU_CITY_CODES.some(c => cityCode.startsWith(c))) return;
        // 建物 (bldg) データセットのみ
        const items = ds.items || ds.data || [];
        items.forEach(item => {
          const type = String(item.type || item.datasetType || '');
          if (type.toLowerCase().includes('bldg') || type.toLowerCase().includes('building')) {
            const url = item.url || item.tileset_url || '';
            if (url.endsWith('tileset.json')) candidates.push(url);
          }
        });
      });
      return candidates;
    } catch (_) {
      return [];
    }
  }

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
  // PLATEAU 建物 3D Tiles 読み込み (Three.js GLTFLoader による自前実装)
  // ================================================================

  /**
   * tileset.json ツリーを走査してコンテンツ URL とタイル変換行列を収集する。
   * depth > maxDepth に達したら子を無視（ブラウザ負荷軽減）。
   */
  function _collectTiles(tile, baseUrl, parentTransform, out, depth, maxDepth) {
    const tileMatrix = tile.transform
      ? new THREE.Matrix4().fromArray(tile.transform)
      : new THREE.Matrix4();
    const worldMatrix = parentTransform.clone().multiply(tileMatrix);

    if (tile.content && tile.content.uri) {
      const tileUrl = new URL(tile.content.uri, baseUrl).href;
      out.push({ url: tileUrl, transform: worldMatrix.clone() });
    }
    if (depth < maxDepth && Array.isArray(tile.children)) {
      tile.children.forEach(c =>
        _collectTiles(c, baseUrl, worldMatrix, out, depth + 1, maxDepth),
      );
    }
  }

  /**
   * B3DM バッファを解析して Three.js Object3D を返す。
   * B3DM ヘッダ (28 バイト):
   *   [0..3]   magic "b3dm"
   *   [4..7]   version
   *   [8..11]  byteLength
   *   [12..15] featureTableJSONByteLength
   *   [16..19] featureTableBinaryByteLength
   *   [20..23] batchTableJSONByteLength
   *   [24..27] batchTableBinaryByteLength
   *   [28..]   featureTableJSON | featureTableBinary | batchTableJSON | batchTableBinary | GLB
   */
  function _parseB3DM(buffer, gltfLoader) {
    const view      = new DataView(buffer);
    const ftJSONLen = view.getUint32(12, true);
    const ftBinLen  = view.getUint32(16, true);
    const btJSONLen = view.getUint32(20, true);
    const btBinLen  = view.getUint32(24, true);

    // RTC_CENTER 抽出（タイル内 GLB 頂点の相対中心）
    let rtcMatrix = null;
    if (ftJSONLen > 0) {
      try {
        const ftText = new TextDecoder().decode(new Uint8Array(buffer, 28, ftJSONLen));
        const ftJSON = JSON.parse(ftText);
        if (Array.isArray(ftJSON.RTC_CENTER) && ftJSON.RTC_CENTER.length === 3) {
          const [cx, cy, cz] = ftJSON.RTC_CENTER;
          rtcMatrix = new THREE.Matrix4().makeTranslation(cx, cy, cz);
        }
      } catch (_) { /* JSON パース失敗は無視 */ }
    }

    const glbStart  = 28 + ftJSONLen + ftBinLen + btJSONLen + btBinLen;
    const glbBuffer = buffer.slice(glbStart);

    return new Promise((resolve, reject) => {
      gltfLoader.parse(glbBuffer, '', gltf => {
        const root = gltf.scene;
        if (rtcMatrix) root.applyMatrix4(rtcMatrix);
        resolve(root);
      }, reject);
    });
  }

  /** GLB バッファを直接 GLTFLoader でパースして Object3D を返す */
  function _parseGLB(buffer, gltfLoader) {
    return new Promise((resolve, reject) => {
      gltfLoader.parse(buffer, '', gltf => resolve(gltf.scene), reject);
    });
  }

  /**
   * 単一タイル URL を fetch → B3DM / GLB を解析して Object3D を返す。
   * 失敗時は null を返す（全体の読み込みを止めない）。
   */
  async function _loadTile(url, gltfLoader) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = await res.arrayBuffer();

      const magic = new TextDecoder().decode(new Uint8Array(buffer, 0, 4));
      if (magic === 'b3dm') return await _parseB3DM(buffer, gltfLoader);
      if (magic === 'glTF') return await _parseGLB(buffer, gltfLoader);
      throw new Error(`未対応フォーマット: "${magic}"`);
    } catch (e) {
      if (window.debugLog) window.debugLog('PLATEAU', `タイルスキップ: ${e.message}`, 'warn');
      return null;
    }
  }

  async function loadPLATEAUBuildings(scene, camera, renderer, onProgress) {
    if (!window.THREE || !window.THREE.GLTFLoader) {
      throw new Error('GLTFLoader が読み込まれていません');
    }
    const gltfLoader = new THREE.GLTFLoader();
    const localFrame = buildECEFtoLocalMatrix();
    const errors     = [];

    // PLATEAU データカタログ API から動的に URL を取得
    if (onProgress) onProgress('PLATEAU カタログ検索中…');
    if (window.debugLog) window.debugLog('PLATEAU', 'データカタログ API を照会中…', 'info');
    const dynamicCandidates = await fetchPLATEAUCandidates();
    if (dynamicCandidates.length > 0) {
      if (window.debugLog)
        window.debugLog('PLATEAU', `カタログから ${dynamicCandidates.length} 件取得`, 'ok');
    } else {
      if (window.debugLog)
        window.debugLog('PLATEAU', 'カタログ取得失敗 — 静的 URL にフォールバック', 'warn');
    }

    if (dynamicCandidates.length === 0) {
      throw new Error('データカタログから利用可能な PLATEAU データが見つかりませんでした');
    }
    const allCandidates = dynamicCandidates;

    for (const tilesetUrl of allCandidates) {
      const label = tilesetUrl.split('/').slice(-4, -1).join('/');
      try {
        if (onProgress) onProgress(`PLATEAU データ取得中: ${label}…`);
        if (window.debugLog) window.debugLog('PLATEAU', `試行: ${label}`, 'info');

        // 1. tileset.json を取得（タイムアウト付き）
        const tilesetRes = await Promise.race([
          fetch(tilesetUrl),
          new Promise((_, rej) =>
            setTimeout(() => rej(new Error('tileset.json タイムアウト (8s)')), 8000),
          ),
        ]);
        if (!tilesetRes.ok) throw new Error(`HTTP ${tilesetRes.status}`);
        const tileset = await tilesetRes.json();

        if (window.debugLog) window.debugLog('PLATEAU', `tileset.json 取得成功: ${label}`, 'ok');

        // 2. コンテンツ URL を収集 (depth ≤ 1 に限定)
        const tiles = [];
        _collectTiles(tileset.root, tilesetUrl, new THREE.Matrix4(), tiles, 0, 1);

        if (window.debugLog)
          window.debugLog('PLATEAU', `タイル収集: ${tiles.length} 件`, 'info');

        // 3. タイルを並列ロード（最大 20 件）
        const limited = tiles.slice(0, 20);
        const results = await Promise.all(
          limited.map(({ url, transform }) =>
            _loadTile(url, gltfLoader).then(obj => ({ obj, transform })),
          ),
        );

        // 4. シーンに追加
        let added = 0;
        const group = new THREE.Group();
        group.matrix.copy(localFrame);
        group.matrixAutoUpdate = false;

        results.forEach(({ obj, transform }) => {
          if (!obj) return;
          obj.applyMatrix4(transform);
          group.add(obj);
          added++;
        });

        scene.add(group);

        console.log('[PLATEAU] 読み込み成功:', label, '/ 追加:', added);
        if (window.debugLog)
          window.debugLog('PLATEAU', `✓ 建物追加: ${added} / ${limited.length} タイル`, 'ok');
        return; // 成功したら終了

      } catch (e) {
        console.warn('[PLATEAU] 失敗:', label, '—', e.message);
        if (window.debugLog) window.debugLog('PLATEAU', `✗ ${label} — ${e.message}`, 'error');
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

    const typeCounts = {};
    let count = 0;
    ways.forEach(way => {
      const tags = way.tags || {};
      if (!tags.highway) return;
      const pts = way.nodes
        .map(id => nodes[id]).filter(Boolean)
        .map(n => project(n.lat, n.lon));
      if (pts.length < 2) return;
      _buildRoadMesh(scene, pts, ROAD_WIDTHS[tags.highway] || 5, ROAD_COLORS[tags.highway] || 0x404040);
      typeCounts[tags.highway] = (typeCounts[tags.highway] || 0) + 1;
      count++;
    });
    console.log('[OSM Roads] 道路描画:', count, '本');
    if (window.debugLog) {
      window.debugLog('OSM', `道路メッシュ生成: 計 ${count} 本`, 'ok');
      const top = Object.entries(typeCounts)
        .sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([t, n]) => `${t}:${n}`).join('  ');
      if (top) window.debugLog('OSM', `内訳 → ${top}`, 'info');
    }
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
  // プロシージャル建物 (PLATEAU 取得失敗時のフォールバック)
  // 西原マリンパーク周辺のコース沿いに簡易建物を配置
  // ================================================================
  function buildProceduralBuildings(scene) {
    // 建物の素材 (沖縄コンクリート風カラー)
    const mats = [
      new THREE.MeshLambertMaterial({ color: 0xd6cfc4 }),  // コンクリート
      new THREE.MeshLambertMaterial({ color: 0xbfb8ad }),  // 薄茶
      new THREE.MeshLambertMaterial({ color: 0xe8e0d5 }),  // 白系
      new THREE.MeshLambertMaterial({ color: 0xc8bfb4 }),  // グレー
      new THREE.MeshLambertMaterial({ color: 0xd4c9a8 }),  // 砂色
    ];
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x8a9070 });

    // シード付き疑似乱数 (再現性を保つ)
    let _seed = 12345;
    function rnd() {
      _seed = (_seed * 1664525 + 1013904223) & 0xffffffff;
      return ((_seed >>> 0) / 0xffffffff);
    }

    // コース中心付近に市街ブロックを配置
    // COURSE_WAYPOINTS の重心をベース座標とする
    const cx = COURSE_WAYPOINTS.reduce((s, p) => s + p.x, 0) / COURSE_WAYPOINTS.length;
    const cz = COURSE_WAYPOINTS.reduce((s, p) => s + p.z, 0) / COURSE_WAYPOINTS.length;

    // コースの AABB を取得
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    COURSE_WAYPOINTS.forEach(p => {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    });
    const spanX = maxX - minX + 200;
    const spanZ = maxZ - minZ + 200;

    // グリッド間隔
    const GRID_STEP  = 35;
    const ROAD_CLEAR = 18; // 道路中心からこの距離以内はスキップ

    const group = new THREE.Group();
    let count = 0;

    for (let gi = -Math.ceil(spanX / 2 / GRID_STEP); gi <= Math.ceil(spanX / 2 / GRID_STEP); gi++) {
      for (let gj = -Math.ceil(spanZ / 2 / GRID_STEP); gj <= Math.ceil(spanZ / 2 / GRID_STEP); gj++) {
        const bx = cx + gi * GRID_STEP + (rnd() - 0.5) * 10;
        const bz = cz + gj * GRID_STEP + (rnd() - 0.5) * 10;

        // コースウェイポイントに近すぎる場所はスキップ
        let tooClose = false;
        for (const wp of COURSE_WAYPOINTS) {
          const dx = bx - wp.x, dz = bz - wp.z;
          if (dx * dx + dz * dz < ROAD_CLEAR * ROAD_CLEAR) { tooClose = true; break; }
        }
        if (tooClose) continue;

        // 建物サイズ
        const w = 6 + rnd() * 18;
        const d = 6 + rnd() * 18;
        const h = 4 + rnd() * (rnd() > 0.85 ? 30 : 12); // たまに高層

        // 本体
        const geo  = new THREE.BoxGeometry(w, h, d);
        const mesh = new THREE.Mesh(geo, mats[Math.floor(rnd() * mats.length)]);
        mesh.position.set(bx, h / 2, bz);
        mesh.castShadow    = true;
        mesh.receiveShadow = true;
        group.add(mesh);

        // 屋上パラペット
        const roofGeo  = new THREE.BoxGeometry(w + 0.4, 0.5, d + 0.4);
        const roofMesh = new THREE.Mesh(roofGeo, roofMat);
        roofMesh.position.set(bx, h + 0.25, bz);
        group.add(roofMesh);

        count++;
      }
    }

    scene.add(group);
    if (window.debugLog)
      window.debugLog('BUILD', `プロシージャル建物生成: ${count} 棟`, 'ok');
    return count;
  }

  // ================================================================
  // Public API
  // ================================================================
  return {
    project,
    COURSE_WAYPOINTS,
    ORIGIN,
    loadPLATEAUBuildings,
    buildProceduralBuildings,
    fetchRoadData,
    buildRoads,
  };

})();
