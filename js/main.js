import {
  CESIUM_ION_TOKEN,
  HISTORICAL_MAP_FALLBACK_BOUNDS
} from "./config/constants.js";
import { state } from "./state.js";
import { setStatus } from "./ui/status.js";
import { tryLoadSheet } from "./data/sheets.js";
import {
  setupSearchBox,
  setupFilterPanel,
  setupYearFilterBar
} from "./filters/filters.js?v=99";
import { setupInfoPanel, showPinInfo, hidePinInfo, resetCameraZoomState, closePhotoLightboxIfOpen } from "./info-panel.js";
import { setupHomeButton } from "./ui/home.js";
import { setupArchiveList } from "./ui/archive-list.js";
import { setupAboutSheet } from "./ui/about.js?v=2";
import { setupPointCloudModal, clearPointCloudModal } from "./pointcloud/viewer.js";
import { mountCustomToolbarButtons } from "./ui/toolbar.js";
import { initHistoricalMaps, syncMapDisplayMode, setupMapGeometrySwitcher } from "./imagery/historical-maps.js?v=135";
import { refreshPinsForMapMode } from "./pins/pins.js";
import { invalidatePinHeightCache } from "./pins/pin-heights.js";
import {
  setupModeSwitcher,
  syncModeAfterDataLoad,
  syncMemoryTownAppearance
} from "./modes/mode-switcher.js";
import { handleMemoryEntityClick, isMemoryEntity, renderMemoryPins } from "./memory/memory-pins.js";
import { setupCameraCapture } from "./memory/camera-capture.js";

const GOOGLE_3D_TILES_TIMEOUT_MS = 45000;
/** 山谷視点でタイル実体が出るまで地球を残す上限 */
const GOOGLE_3D_DISTRICT_PAINT_TIMEOUT_MS = 15000;
/** 視点に中身のあるタイルが載っているとみなす最低枚数 */
const GOOGLE_3D_MIN_CONTENT_TILES = 3;
/** 地区付近とみなすカメラ高度（これ未満で描画判定する） */
const GOOGLE_3D_DISTRICT_MAX_HEIGHT_M = 12000;

let google3dMonitorGeneration = 0;
let google3dRemoveListeners = null;

function configureGlobeForGoogle3DTiles(viewer) {
  viewer.scene.globe.show = false;
  viewer.scene.globe.depthTestAgainstTerrain = false;
}

function configureGlobeForFallback(viewer) {
  viewer.scene.globe.show = true;
  viewer.scene.globe.depthTestAgainstTerrain = true;
  if (typeof viewer.scene.setTerrain === "function" && Cesium.Terrain && Cesium.Terrain.fromWorldTerrain) {
    viewer.scene.setTerrain(Cesium.Terrain.fromWorldTerrain());
  } else if (typeof Cesium.createWorldTerrainAsync === "function") {
    Cesium.createWorldTerrainAsync().then(function (provider) {
      viewer.terrainProvider = provider;
    }).catch(function (err) {
      console.warn("World Terrain の読み込みに失敗:", err);
    });
  }
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise(function (resolve, reject) {
    const timer = window.setTimeout(function () {
      reject(new Error(message));
    }, timeoutMs);
    promise.then(function (value) {
      window.clearTimeout(timer);
      resolve(value);
    }).catch(function (err) {
      window.clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * 端末・回線が厳しいほど Google Earth 3D をさらに低LODにする。
 * （OSM 建物モデルは使わない）
 */
function needsExtraLightGoogleEarth() {
  const ua = navigator.userAgent || "";
  const isIos = /iPhone|iPad|iPod/i.test(ua)
    || (navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1);
  const isAndroid = /Android/i.test(ua);
  const narrow = Math.min(window.innerWidth || 0, window.innerHeight || 0) < 768;
  const touch = ("ontouchstart" in window) || (navigator.maxTouchPoints || 0) > 0;
  const conn = navigator.connection;
  const saveData = !!(conn && (conn.saveData || /2g/i.test(conn.effectiveType || "")));
  return saveData || isIos || (isAndroid && (narrow || touch)) || (touch && narrow);
}

function getTilesWithContentReady(tileset) {
  const stats = tileset && tileset.statistics;
  if (!stats) return 0;
  if (typeof stats.numberOfTilesWithContentReady === "number") {
    return stats.numberOfTilesWithContentReady;
  }
  if (typeof stats.numberOfLoadedTilesTotal === "number") {
    return stats.numberOfLoadedTilesTotal;
  }
  return 0;
}

function hasMeaningfulTilesetContent(tileset) {
  return getTilesWithContentReady(tileset) >= GOOGLE_3D_MIN_CONTENT_TILES;
}

/** 山谷周辺の近接視点か（地球俯瞰での「描画成功」誤判定を避ける） */
function isCameraNearDistrictView(viewer) {
  if (!viewer || !viewer.camera) return false;
  const carto = viewer.camera.positionCartographic;
  if (!carto) return false;
  if (carto.height > GOOGLE_3D_DISTRICT_MAX_HEIGHT_M) return false;
  const lon = Cesium.Math.toDegrees(carto.longitude);
  const lat = Cesium.Math.toDegrees(carto.latitude);
  const b = HISTORICAL_MAP_FALLBACK_BOUNDS;
  const pad = 0.08;
  return lon >= b.west - pad && lon <= b.east + pad
    && lat >= b.south - pad && lat <= b.north + pad;
}

/** Google Earth 3D を意図的に粗くして軽量化する設定 */
function getGoogleEarthLightOptions() {
  const minSide = Math.min(window.innerWidth || 0, window.innerHeight || 0);
  const dpr = window.devicePixelRatio || 1;
  const extraLight = needsExtraLightGoogleEarth();
  const largeDesktop = minSide >= 1024 && dpr >= 1.25;
  // 値が大きいほど低LOD。細部モデルを捨てて全体の立体感を優先
  const sse = extraLight ? 64 : (largeDesktop ? 48 : 40);
  const cacheMb = extraLight ? 64 : (largeDesktop ? 96 : 128);
  return {
    onlyUsingWithGoogleGeocoder: true,
    maximumScreenSpaceError: sse,
    skipLevelOfDetail: true,
    immediatelyLoadDesiredLevelOfDetail: false,
    loadSiblings: false,
    preloadWhenHidden: false,
    preferLeaves: false,
    dynamicScreenSpaceError: true,
    dynamicScreenSpaceErrorFactor: 24,
    cullRequestsWhileMovingMultiplier: 60,
    cacheBytes: cacheMb * 1024 * 1024
  };
}

function configureGoogle3DTileset(tileset) {
  const opts = getGoogleEarthLightOptions();
  tileset.maximumScreenSpaceError = opts.maximumScreenSpaceError;
  if ("skipLevelOfDetail" in tileset) {
    tileset.skipLevelOfDetail = opts.skipLevelOfDetail;
  }
  if ("immediatelyLoadDesiredLevelOfDetail" in tileset) {
    tileset.immediatelyLoadDesiredLevelOfDetail = opts.immediatelyLoadDesiredLevelOfDetail;
  }
  if ("loadSiblings" in tileset) {
    tileset.loadSiblings = opts.loadSiblings;
  }
  if ("preloadWhenHidden" in tileset) {
    tileset.preloadWhenHidden = opts.preloadWhenHidden;
  }
  if ("preferLeaves" in tileset) {
    tileset.preferLeaves = opts.preferLeaves;
  }
  if ("dynamicScreenSpaceError" in tileset) {
    tileset.dynamicScreenSpaceError = opts.dynamicScreenSpaceError;
  }
  if ("dynamicScreenSpaceErrorFactor" in tileset) {
    tileset.dynamicScreenSpaceErrorFactor = opts.dynamicScreenSpaceErrorFactor;
  }
  if ("cullRequestsWhileMovingMultiplier" in tileset) {
    tileset.cullRequestsWhileMovingMultiplier = opts.cullRequestsWhileMovingMultiplier;
  }
  if ("cacheBytes" in tileset) {
    tileset.cacheBytes = opts.cacheBytes;
  }
}

function stopGoogle3DPaintMonitor() {
  google3dMonitorGeneration++;
  if (typeof google3dRemoveListeners === "function") {
    google3dRemoveListeners();
    google3dRemoveListeners = null;
  }
}

function removeGoogle3DTileset() {
  stopGoogle3DPaintMonitor();
  if (state.google3dTileset && state.viewer) {
    state.viewer.scene.primitives.remove(state.google3dTileset);
  }
  state.google3dTileset = null;
  state.google3dTilesPainted = false;
  state.usesGoogle3DTiles = false;
}

function markGoogle3DTilesPainted() {
  if (!state.google3dTileset || state.google3dTilesPainted) return;
  state.google3dTilesPainted = true;
  if (!state.historicalMapActive && state.mapGeometryMode !== "2d") {
    configureGlobeForGoogle3DTiles(state.viewer);
  }
  syncMapDisplayMode();
  syncMemoryTownAppearance();
  refreshPinsAfterMapGeometryReady();
  state.viewer.scene.requestRender();
}

/**
 * 起動時の地球俯瞰ではタイルが出ても地球は残す。
 * 山谷へ飛んだあとに実体が見えたら地球を隠し、出なければ平面地図へ切替。
 */
function startGoogle3DPaintMonitor(tileset) {
  stopGoogle3DPaintMonitor();
  const generation = google3dMonitorGeneration;
  let districtSince = null;
  let fallbackStarted = false;

  function isActive() {
    return generation === google3dMonitorGeneration
      && state.google3dTileset === tileset
      && state.usesGoogle3DTiles;
  }

  function tryMarkPainted() {
    if (!isActive() || state.google3dTilesPainted) return;
    if (!isCameraNearDistrictView(state.viewer)) return;
    if (!hasMeaningfulTilesetContent(tileset)) return;
    stopGoogle3DPaintMonitor();
    markGoogle3DTilesPainted();
  }

  function tryFallbackIfStalled() {
    if (!isActive() || state.google3dTilesPainted || fallbackStarted) return;
    if (!state.appMode || state.historicalMapActive || state.mapGeometryMode === "2d") return;
    if (!isCameraNearDistrictView(state.viewer)) {
      districtSince = null;
      return;
    }
    if (districtSince == null) {
      districtSince = Date.now();
      return;
    }
    if (Date.now() - districtSince < GOOGLE_3D_DISTRICT_PAINT_TIMEOUT_MS) return;
    if (hasMeaningfulTilesetContent(tileset)) {
      markGoogle3DTilesPainted();
      stopGoogle3DPaintMonitor();
      return;
    }

    fallbackStarted = true;
    console.warn("山谷視点で Google 3D Tiles が描画されないため地球画像のみに切り替えます");
    removeGoogle3DTileset();
    setStatus("Google 3D が重いため平面地図に切り替えます...");
    loadFallbackGlobe()
      .then(function () {
        setStatus("平面地図で表示しています", "ok");
      })
      .catch(function (err) {
        console.warn("平面地図への切り替えに失敗:", err);
      });
  }

  const removeVisible = tileset.tileVisible.addEventListener(tryMarkPainted);
  const removeInitial = tileset.initialTilesLoaded.addEventListener(tryMarkPainted);
  const removeMove = state.viewer.camera.moveEnd.addEventListener(function () {
    tryMarkPainted();
    tryFallbackIfStalled();
  });
  const pollId = window.setInterval(function () {
    tryMarkPainted();
    tryFallbackIfStalled();
  }, 1000);

  google3dRemoveListeners = function () {
    removeVisible();
    removeInitial();
    removeMove();
    window.clearInterval(pollId);
  };

  tryMarkPainted();
}

function applyMainViewerPerformanceTweaks(viewer) {
  const dpr = window.devicePixelRatio || 1;
  const cssPixels = (window.innerWidth || 0) * (window.innerHeight || 0);
  // ピンの見た目を優先しつつ、Google Earth では必要最小限に抑える
  if (needsExtraLightGoogleEarth()) {
    viewer.resolutionScale = dpr >= 3 ? 0.65 : 0.75;
  } else if (dpr >= 2 || cssPixels >= 2.2e6) {
    viewer.resolutionScale = dpr >= 2.5 ? 0.8 : 0.9;
  } else if (dpr >= 1.5) {
    viewer.resolutionScale = 0.95;
  } else {
    viewer.resolutionScale = 1;
  }
  const scene = viewer.scene;
  if (typeof scene.fxaa === "boolean") {
    scene.fxaa = false;
  }
  if (typeof scene.msaaSamples === "number") {
    scene.msaaSamples = 1;
  }
  if (typeof scene.fog !== "undefined" && scene.fog) {
    scene.fog.enabled = true;
    if (typeof scene.fog.density === "number") {
      scene.fog.density = 0.0002;
    }
  }
}

function refreshPinsAfterMapGeometryReady() {
  invalidatePinHeightCache();
  if (state.appMode === "memory") {
    renderMemoryPins(state.filteredMemoryPhotos);
  } else if (state.appMode === "life") {
    refreshPinsForMapMode();
  }
}

function loadGoogleEarth3D() {
  const lightOpts = getGoogleEarthLightOptions();
  const tilesetPromise = Cesium.createGooglePhotorealistic3DTileset(lightOpts);
  return withTimeout(
    tilesetPromise,
    GOOGLE_3D_TILES_TIMEOUT_MS,
    "Google 3D Tiles"
  ).then(function (tileset) {
    configureGoogle3DTileset(tileset);
    state.google3dTileset = tileset;
    state.usesGoogle3DTiles = true;
    state.google3dTilesPainted = false;
    // OSM 建物モデルは使わない
    state.fallbackBuildings = null;
    state.viewer.scene.primitives.add(tileset);
    // 起動〜山谷到着までは地球を残し、オリーブの空白画面を防ぐ
    state.mapGeometryReady = true;
    syncMapDisplayMode();
    syncMemoryTownAppearance();
    refreshPinsAfterMapGeometryReady();
    state.viewer.scene.requestRender();
    startGoogle3DPaintMonitor(tileset);
  });
}

/** Google 3D が使えないときの最終手段：建物モデルなしの地球画像のみ */
function loadFallbackGlobe() {
  configureGlobeForFallback(state.viewer);
  if (state.fallbackBuildings && state.viewer) {
    state.viewer.scene.primitives.remove(state.fallbackBuildings);
  }
  state.fallbackBuildings = null;
  state.mapGeometryReady = true;
  state.usesGoogle3DTiles = false;
  state.google3dTilesPainted = false;
  state.viewer.scene.globe.show = true;
  syncMapDisplayMode();
  syncMemoryTownAppearance();
  refreshPinsAfterMapGeometryReady();
  state.viewer.scene.requestRender();
  return Promise.resolve();
}

function loadMapGeometry() {
  if (!state.appMode) {
    setStatus("Google Earth 3D（軽量）を読み込み中...");
  }
  return loadGoogleEarth3D()
    .then(function () {
      if (!state.appMode) {
        setStatus(
          state.usesGoogle3DTiles
            ? "軽量 Google Earth 3D を読み込みました。モードを選択してください。"
            : "地図を読み込みました。モードを選択してください。"
        );
      }
    })
    .catch(function (err) {
      console.warn("Google Photorealistic 3D Tiles の読み込みに失敗:", err);
      removeGoogle3DTileset();
      if (!state.appMode) {
        setStatus("Google 3D地図は利用できません。平面地図で表示します...");
      }
      return loadFallbackGlobe();
    });
}

function setupClickHandler() {
  const handler = new Cesium.ScreenSpaceEventHandler(state.viewer.scene.canvas);
  handler.setInputAction(function (click) {
    const picked = state.viewer.scene.pick(click.position);
    state.viewer.selectedEntity = undefined;

    if (!Cesium.defined(picked) || !picked.id || !picked.id.properties) {
      if (state.appMode === "life") hidePinInfo();
      else closePhotoLightboxIfOpen();
      return;
    }

    const entity = picked.id;

    if (state.appMode === "memory" || isMemoryEntity(entity)) {
      handleMemoryEntityClick(entity);
      return;
    }

    if (state.appMode !== "life") return;

    resetCameraZoomState();
    clearPointCloudModal();
    showPinInfo(entity);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

function init() {
  if (location.protocol === "file:") {
    setStatus("npm start 後に http://localhost:8080 を開いてください。", "error");
    return;
  }

  if (typeof Cesium === "undefined") {
    setStatus("Cesium の読み込みに失敗しました。", "error");
    return;
  }

  setStatus("地図を初期化中...");

  Cesium.Ion.defaultAccessToken = CESIUM_ION_TOKEN;

  state.viewer = new Cesium.Viewer("cesium", {
    geocoder: false,
    infoBox: false,
    selectionIndicator: false,
    animation: false,
    timeline: false,
    homeButton: false,
    sceneModePicker: true,
    baseLayerPicker: false,
    navigationHelpButton: true,
    navigationInstructionsInitiallyVisible: false,
    orderIndependentTranslucency: false,
    contextOptions: {
      webgl: {
        alpha: false,
        failIfMajorPerformanceCaveat: false,
        powerPreference: needsExtraLightGoogleEarth() ? "default" : "high-performance"
      }
    }
  });

  applyMainViewerPerformanceTweaks(state.viewer);
  initHistoricalMaps(state.viewer);

  state.viewer.scene.morphComplete.addEventListener(function () {
    invalidatePinHeightCache();
    if (state.appMode === "memory") {
      renderMemoryPins(state.filteredMemoryPhotos);
    } else if (state.appMode === "life") {
      refreshPinsForMapMode();
    }
  });

  // 3D Tiles 描画までは Cesium 標準地図を表示（空白画面を防ぐ）
  // 起動カメラは地球俯瞰のまま（山谷への飛行はモード選択後）
  state.viewer.scene.globe.show = true;
  state.viewer.scene.globe.depthTestAgainstTerrain = false;
  // Google Photorealistic 3D では衝突検知が建物メッシュでカメラを押し戻し、
  // 水平寄りのチルトがドラッグ終了後に浅い俯瞰へ戻ることがあるためオフにする
  state.viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;
  mountCustomToolbarButtons();
  setupModeSwitcher();
  setupMapGeometrySwitcher();
  setupCameraCapture();
  setupClickHandler();
  setupSearchBox();
  setupFilterPanel();
  setupYearFilterBar();
  setupInfoPanel();
  setupHomeButton();
  setupArchiveList();
  setupAboutSheet();
  setupPointCloudModal();

  setStatus("地図データとピンを読み込み中...");

  // 3D地図とシートを並行読込（直列だと地球待ちでピンが長く出ない）
  Promise.all([loadMapGeometry(), tryLoadSheet()])
    .then(function () {
      syncModeAfterDataLoad();
    })
    .catch(function (err) {
      console.error(err);
      setStatus("地図の読み込みに失敗しました: " + err.message, "error");
    });
}

try {
  init();
} catch (err) {
  console.error(err);
  setStatus("起動に失敗しました: " + err.message, "error");
}
