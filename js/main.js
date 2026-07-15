import { CESIUM_ION_TOKEN } from "./config/constants.js";
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
import { setupAboutSheet } from "./ui/about.js";
import { setupPointCloudModal, clearPointCloudModal } from "./pointcloud/viewer.js";
import { mountCustomToolbarButtons } from "./ui/toolbar.js";
import { initHistoricalMaps, syncMapDisplayMode } from "./imagery/historical-maps.js?v=86";
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
/** タイルが一度も描画されない場合でも地球を隠しすぎない上限 */
const GOOGLE_3D_FIRST_PAINT_TIMEOUT_MS = 12000;

function configureGlobeForGoogle3DTiles(viewer) {
  viewer.scene.globe.show = false;
  viewer.scene.globe.depthTestAgainstTerrain = false;
}

function configureGlobeForFallback(viewer) {
  viewer.scene.globe.show = true;
  viewer.terrainProvider = Cesium.Terrain.fromWorldTerrain();
  viewer.scene.globe.depthTestAgainstTerrain = true;
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

/** 視点上のタイルが1枚見えるまで地球を残し、真っ黒な空白を防ぐ */
function waitForTilesetFirstPaint(tileset, timeoutMs) {
  const timeout = timeoutMs || GOOGLE_3D_FIRST_PAINT_TIMEOUT_MS;
  return new Promise(function (resolve) {
    if (tileset.tilesLoaded) {
      resolve(true);
      return;
    }
    let settled = false;
    function finish(painted) {
      if (settled) return;
      settled = true;
      resolve(Boolean(painted));
    }
    const removeVisible = tileset.tileVisible.addEventListener(function () {
      removeVisible();
      removeInitial();
      finish(true);
    });
    const removeInitial = tileset.initialTilesLoaded.addEventListener(function () {
      removeVisible();
      removeInitial();
      finish(true);
    });
    setTimeout(function () {
      removeVisible();
      removeInitial();
      finish(false);
    }, timeout);
  });
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
  const tilesetPromise = Cesium.createGooglePhotorealistic3DTileset({
    onlyUsingWithGoogleGeocoder: true
  });
  return withTimeout(
    tilesetPromise,
    GOOGLE_3D_TILES_TIMEOUT_MS,
    "Google 3D Tiles"
  ).then(function (tileset) {
    state.google3dTileset = tileset;
    state.viewer.scene.primitives.add(tileset);
    // 起動時は地球ビューのまま。山谷へはモード選択後に飛ぶ
    return waitForTilesetFirstPaint(tileset).then(function (painted) {
      state.mapGeometryReady = true;
      state.google3dTilesPainted = painted;
      // タイルが視点に出るまで地球は残す（空白のオリーブ画面を防ぐ）
      if (painted) {
        configureGlobeForGoogle3DTiles(state.viewer);
      }
      syncMapDisplayMode();
      syncMemoryTownAppearance();
      refreshPinsAfterMapGeometryReady();
      state.viewer.scene.requestRender();

      // 遅れてタイルが来た場合にも地球を切り替える
      if (!painted) {
        const removeVisible = tileset.tileVisible.addEventListener(function () {
          removeVisible();
          if (state.historicalMapActive) return;
          state.google3dTilesPainted = true;
          configureGlobeForGoogle3DTiles(state.viewer);
          syncMapDisplayMode();
          refreshPinsAfterMapGeometryReady();
          state.viewer.scene.requestRender();
        });
      }
    });
  });
}

function loadFallbackBuildings() {
  configureGlobeForFallback(state.viewer);
  return Cesium.createOsmBuildingsAsync().then(function (buildings) {
    state.fallbackBuildings = buildings;
    state.viewer.scene.primitives.add(buildings);
    state.mapGeometryReady = true;
    syncMapDisplayMode();
    syncMemoryTownAppearance();
    refreshPinsAfterMapGeometryReady();
    state.viewer.scene.requestRender();
  });
}

function loadMapGeometry() {
  return loadGoogleEarth3D()
    .then(function () {
      if (!state.appMode) {
        setStatus("3D地図を読み込みました。モードを選択してください。");
      }
    })
    .catch(function (err) {
      console.warn("Google Photorealistic 3D Tiles の読み込みに失敗:", err);
      state.usesGoogle3DTiles = false;
      if (!state.appMode) {
        setStatus("Google 3D地図は利用できません。OSM建物データで代替表示します...");
      }
      return loadFallbackBuildings();
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
    navigationInstructionsInitiallyVisible: false
  });

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
  state.viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;
  mountCustomToolbarButtons();
  setupModeSwitcher();
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
