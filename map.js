'use strict';

/**
 * MapModule — PLATEAU + OSM 地図モジュール
 *
 * 建物: Project PLATEAU 3D Tiles (国土交通省) — 那覇市 (47201) 2020年度
 *   - PLATEAU データカタログ API から tileset.json URL を動的取得
 *   - 取得失敗時はプロシージャル建物にフォールバック
 *   - データ参照: https://www.geospatial.jp/ckan/dataset/plateau-47201-naha-shi-2020
 *
 * 道路: OpenStreetMap (Overpass API)
 */
const MapModule = (function () {

  // ================================================================
  // 座標変換 — 原点: 那覇若狭地区 (那覇港北岸)
  // ================================================================
  const ORIGIN = { lat: 26.2165, lng: 127.6560 };
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
  // コース 1「那覇若狭サーキット」ウェイポイント
  // 那覇港北側〜若狭地区を周回するストリートサーキット
  // ================================================================
  const COURSE_LATLON = [
    [26.2175, 127.6520],  // スタート/フィニッシュ (西直線)
    [26.2205, 127.6530],  // 北西コーナー
    [26.2230, 127.6560],  // 北ヘアピン
    [26.2225, 127.6600],  // 北東直線
    [26.2200, 127.6640],  // 東セクション
    [26.2165, 127.6650],  // 東ヘアピン
    [26.2130, 127.6630],  // 南東コーナー
    [26.2110, 127.6590],  // 南ヘアピン
    [26.2125, 127.6550],  // 南西直線
    [26.2155, 127.6525],  // 最終コーナー
  ];
  const COURSE_WAYPOINTS = COURSE_LATLON.map(([lat, lng]) => project(lat, lng));

  // ================================================================
  // PLATEAU 3D Tiles 設定 — 那覇市 (47201)
  //
  // 無料公開データ:
  //   https://www.geospatial.jp/ckan/dataset/plateau-47201-naha-shi-2020
  // tileset.json URL は PLATEAU データカタログ API から動的取得:
  //   https://api.plateauview.mlit.go.jp/datacatalog/plateau-datasets
  // ================================================================
  const PLATEAU_CITY_CODES = ['47201'];  // 那覹市のみ (確実にデータが存在)

  /**
   * PLATEAU データカタログ API から那覹市建物 3D Tiles の
   * tileset.json URL を動的に取得する。3 段階フォールバック。
   *
   * REST API レスポンス構造 (フラット配列):
   *   [ { city_code, type_en, url, format, lod, ... }, ... ]
   *   - city_code : "47201" などの5桁市区町村コード
   *   - type_en   : "bldg" など英語種別
   *   - format    : "3D Tiles" または "MVT"
   *   - url       : tileset.json URL (3D Tiles) または {z}/{x}/{y}.mvt (MVT)
   */
  async function fetchPLATEAUCandidates() {
    const TIMEOUT_MS = 15000;  // 全件レスポンスは 2MB 超のため長めに設定
    const _race = (url, init) => Promise.race([
      fetch(url, Object.assign({ mode: 'cors' }, init)),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout ' + TIMEOUT_MS + 'ms')), TIMEOUT_MS)),
    ]);

    // --- 試行 1: GraphQL API (軽量 — 那覹市建物のみクエリ) ---
    try {
      if (window.debugLog) window.debugLog('PLATEAU-API', 'GraphQL 試行…', 'info');
      // types は配列で渡す (GraphQL schema: [String!])
      const query = `{datasets(input:{cityCode:"47201",types:["bldg"]}){id items{id name url}}}`;
      const res   = await _race('https://api.plateauview.mlit.go.jp/datacatalog/graphql', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body:    JSON.stringify({ query }),
      });
      if (window.debugLog) window.debugLog('PLATEAU-API', `GraphQL HTTP ${res.status}`, res.ok ? 'ok' : 'warn');
      if (res.ok) {
        const body  = await res.json();
        const items = ((body.data || {}).datasets || []).flatMap(d => d.items || []);
        const urls  = items.map(i => i.url).filter(u => u && u.endsWith('tileset.json'));
        if (window.debugLog) window.debugLog('PLATEAU-API', `GraphQL 結果: ${urls.length} 件`, urls.length ? 'ok' : 'warn');
        if (urls.length > 0) return urls;
      }
    } catch (e) {
      if (window.debugLog) window.debugLog('PLATEAU-API', `GraphQL 失敗: ${e.message}`, 'warn');
    }

    // --- 試行 2: REST API (全件取得 → フィルタ) ---
    try {
      if (window.debugLog) window.debugLog('PLATEAU-API', 'REST 試行…', 'info');
      const res = await _race('https://api.plateauview.mlit.go.jp/datacatalog/plateau-datasets');
      if (window.debugLog) window.debugLog('PLATEAU-API', `REST HTTP ${res.status}`, res.ok ? 'ok' : 'warn');
      if (res.ok) {
        const data = await res.json();
        const arr  = Array.isArray(data) ? data : (data.datasets || data.data || []);
        // 正しいフィールド名: city_code, type_en, format, url
        const urls = arr
          .filter(d => String(d.city_code || '').startsWith('47201')
                    && String(d.type_en  || '').toLowerCase().includes('bldg')
                    && String(d.format   || '').includes('3D Tiles'))
          .map(d => d.url)
          .filter(u => u && u.endsWith('tileset.json'));
        if (window.debugLog) window.debugLog('PLATEAU-API', `REST 結果: ${urls.length} 件`, urls.length ? 'ok' : 'warn');
        if (urls.length > 0) return urls;
      }
    } catch (e) {
      if (window.debugLog) window.debugLog('PLATEAU-API', `REST 失敗: ${e.message}`, 'warn');
    }

    // --- 試行 3: REST API ?limit=200 で末尾のみ取得 ---
    try {
      const res = await _race('https://api.plateauview.mlit.go.jp/datacatalog/plateau-datasets?limit=200&offset=0');
      if (res.ok) {
        const data = await res.json();
        const arr  = Array.isArray(data) ? data : (data.datasets || data.data || []);
        const urls = arr
          .filter(d => String(d.city_code || '').startsWith('47201')
                    && String(d.type_en  || '').toLowerCase().includes('bldg'))
          .map(d => d.url)
          .filter(u => u && u.endsWith('tileset.json'));
        if (urls.length > 0) return urls;
      }
    } catch (_) { /* 諦める */ }

    return [];
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
    const hasTf = Array.isArray(tile.transform) && tile.transform.length === 16;
    const tileMatrix = hasTf
      ? new THREE.Matrix4().fromArray(tile.transform)
      : new THREE.Matrix4();

    if (window.debugLog && depth <= 1) {
      if (hasTf) {
        // column-major: 平行移動は index 12,13,14
        const t = tile.transform;
        window.debugLog('TILESET', `depth=${depth} transform tx=(${t[12].toFixed(0)}, ${t[13].toFixed(0)}, ${t[14].toFixed(0)})`, 'info');
      } else {
        window.debugLog('TILESET', `depth=${depth} transform なし → identity`, 'warn');
      }
    }

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

    if (window.debugLog) {
      window.debugLog('B3DM', `ftJSONLen=${ftJSONLen} ftBinLen=${ftBinLen} btJSONLen=${btJSONLen} btBinLen=${btBinLen}`, 'info');
    }

    // RTC_CENTER 抽出（タイル内 GLB 頂点の相対中心）
    // RTC_CENTER はインライン配列 [x,y,z] またはバイナリ参照 {"byteOffset":N} の両形式がある
    let rtcMatrix = null;
    if (ftJSONLen > 0) {
      try {
        const ftText = new TextDecoder().decode(new Uint8Array(buffer, 28, ftJSONLen));
        if (window.debugLog) {
          window.debugLog('B3DM', `ftJSON: ${ftText.trim().substring(0, 120)}`, 'info');
        }
        const ftJSON = JSON.parse(ftText);
        let rtcCenter = null;

        if (Array.isArray(ftJSON.RTC_CENTER) && ftJSON.RTC_CENTER.length === 3) {
          // インライン形式: RTC_CENTER: [x, y, z]
          rtcCenter = ftJSON.RTC_CENTER;
          if (window.debugLog) window.debugLog('B3DM', `RTC_CENTER インライン: [${rtcCenter.map(v => v.toFixed(0)).join(', ')}]`, 'ok');
        } else if (ftJSON.RTC_CENTER && typeof ftJSON.RTC_CENTER.byteOffset === 'number') {
          // バイナリ参照形式: RTC_CENTER: {"byteOffset": N} → feature table binary に 3×float64
          const ftBinaryStart = 28 + ftJSONLen;
          const dataOffset    = ftBinaryStart + ftJSON.RTC_CENTER.byteOffset;
          const dv = new DataView(buffer);
          rtcCenter = [
            dv.getFloat64(dataOffset,      true),  // little-endian
            dv.getFloat64(dataOffset +  8, true),
            dv.getFloat64(dataOffset + 16, true),
          ];
          if (window.debugLog) window.debugLog('B3DM', `RTC_CENTER バイナリ@${dataOffset}: [${rtcCenter.map(v => v.toFixed(0)).join(', ')}]`, 'ok');
        } else {
          if (window.debugLog) window.debugLog('B3DM', 'RTC_CENTER なし', 'warn');
        }

        if (rtcCenter && rtcCenter.length === 3) {
          const [cx, cy, cz] = rtcCenter;
          rtcMatrix = new THREE.Matrix4().makeTranslation(cx, cy, cz);
        }
      } catch (e) {
        if (window.debugLog) window.debugLog('B3DM', `ftJSON パース失敗: ${e.message}`, 'error');
      }
    }

    const glbStart  = 28 + ftJSONLen + ftBinLen + btJSONLen + btBinLen;
    const glbBuffer = buffer.slice(glbStart);

    return new Promise((resolve, reject) => {
      gltfLoader.parse(glbBuffer, '', gltf => {
        const root = gltf.scene;

        // オブジェクト空間での頂点範囲をログ (変換前の座標系確認)
        if (window.debugLog) {
          const bb = new THREE.Box3().setFromObject(root);
          if (!bb.isEmpty()) {
            const c = bb.getCenter(new THREE.Vector3());
            const s = bb.getSize(new THREE.Vector3());
            window.debugLog('B3DM', `頂点中心(obj空間): (${c.x.toFixed(0)}, ${c.y.toFixed(0)}, ${c.z.toFixed(0)})`, 'info');
            window.debugLog('B3DM', `頂点範囲(obj空間): ${s.x.toFixed(0)}×${s.y.toFixed(0)}×${s.z.toFixed(0)} m`, 'info');
          } else {
            window.debugLog('B3DM', '頂点なし (空メッシュ)', 'warn');
          }
        }

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
    // PLATEAU の GLB は Draco 圧縮されているため DRACOLoader が必須
    if (window.THREE.DRACOLoader) {
      const dracoLoader = new THREE.DRACOLoader();
      dracoLoader.setDecoderPath(
        'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/libs/draco/',
      );
      gltfLoader.setDRACOLoader(dracoLoader);
      if (window.debugLog) window.debugLog('PLATEAU', 'DRACOLoader 設定完了', 'ok');
    } else {
      if (window.debugLog) window.debugLog('PLATEAU', 'DRACOLoader 未読み込み', 'warn');
    }
    const localFrame = buildECEFtoLocalMatrix();
    const errors     = [];

    // PLATEAU データカタログ API から動的に URL を取得
    if (onProgress) onProgress('PLATEAU カタログ検索中…');
    if (window.debugLog) window.debugLog('PLATEAU', 'データカタログ API を照会中…', 'info');
    const dynamicCandidates = await fetchPLATEAUCandidates();
    if (dynamicCandidates.length === 0) {
      throw new Error('PLATEAU データカタログ API に接続できませんでした (CORS / ネットワークエラー)');
    }
    if (window.debugLog)
      window.debugLog('PLATEAU', `カタログから ${dynamicCandidates.length} 件取得`, 'ok');
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
        // 座標系を自動判定:
        //   - 頂点中心の絶対値 < 100km → ECEF相対座標 (原点付近にセンタリング済み)
        //     → 回転のみ適用してENU軸に揃える (平行移動は不要)
        //   - 頂点中心の絶対値 ≥ 100km → ECEF絶対座標 → localFrame全体を適用
        let added = 0;
        const group = new THREE.Group();

        // サンプルタイルで座標系を判定
        const _sampleR = results.find(r => r.obj);
        let _isECEFRelative = false;
        if (_sampleR && _sampleR.obj) {
          const _sbb = new THREE.Box3().setFromObject(_sampleR.obj);
          if (!_sbb.isEmpty()) {
            const _sc = _sbb.getCenter(new THREE.Vector3());
            const _mag = Math.max(Math.abs(_sc.x), Math.abs(_sc.y), Math.abs(_sc.z));
            _isECEFRelative = _mag < 100000;
            if (window.debugLog) {
              window.debugLog('PLATEAU', `座標系: ${_isECEFRelative ? 'ECEF相対 → 回転のみ適用' : 'ECEF絶対 → フル変換'} (mag=${_mag.toFixed(0)} m)`, 'info');
            }
          }
        }

        // ECEF相対座標用: localFrameの回転部分のみ (平行移動ゼロ)
        // これで ECEF ベクトルが ENU 軸 (X=East, Y=Up, Z=South) に変換される
        const _rotFrame = localFrame.clone();
        _rotFrame.elements[12] = 0;  // tx = 0
        _rotFrame.elements[13] = 0;  // ty = 0
        _rotFrame.elements[14] = 0;  // tz = 0

        results.forEach(({ obj, transform }) => {
          if (!obj) return;
          if (_isECEFRelative) {
            // ECEF相対頂点: 回転のみでENU軸に整列 (平行移動はゼロ点が既に原点近く)
            obj.applyMatrix4(_rotFrame);
          } else {
            // ECEF絶対頂点: タイル変換 → ECEF→ENU
            obj.applyMatrix4(transform);
            obj.applyMatrix4(localFrame);
          }
          }
          group.add(obj);
          added++;
        });

        scene.add(group);

        // ワールド空間でのバウンディングボックスを計算してログ出力
        if (window.debugLog && added > 0) {
          group.updateMatrixWorld(true);
          const wBB = new THREE.Box3().setFromObject(group);
          if (!wBB.isEmpty()) {
            const wc = wBB.getCenter(new THREE.Vector3());
            const ws = wBB.getSize(new THREE.Vector3());
            window.debugLog('PLATEAU', `世界BBox中心: (${wc.x.toFixed(0)}, ${wc.y.toFixed(0)}, ${wc.z.toFixed(0)}) m`, 'info');
            window.debugLog('PLATEAU', `世界BBoxサイズ: ${ws.x.toFixed(0)}×${ws.y.toFixed(0)}×${ws.z.toFixed(0)} m`, 'info');
          }
        }

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
  // 那覹市若狭〜港周辺 (コース + 周囲 ~1km)
  const ROAD_BBOX = { south: 26.198, west: 127.638, north: 26.232, east: 127.675 };

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
