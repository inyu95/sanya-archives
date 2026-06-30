import { CESIUM_ION_TOKEN } from "./config/constants.js";
import { state } from "./state.js";
import { setStatus } from "./ui/status.js";
import { tryLoadSheet } from "./data/sheets.js";
import {
  setupSearchBox,
  setupFilterPanel,
  setupYearFilterBar
} from "./filters/filters.js?v=68";
import { setupInfoPanel, showPinInfo, hidePinInfo, resetCameraZoomState } from "./info-panel.js";
import { setupHomeButton } from "./ui/home.js";
import { setupArchiveList } from "./ui/archive-list.js";
import { setupAboutSheet } from "./ui/about.js";
import { setupPointCloudModal, clearPointCloudModal } from "./pointcloud/viewer.js";
import { mountCustomToolbarButtons } from "./ui/toolbar.js";
import { initHistoricalMaps, syncMapDisplayMode } from "./imagery/historical-maps.js?v=68";

const GOOGLE_3D_TILES_TIMEOUT_MS = 45000;

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
    state.mapGeometryReady = true;
    configureGlobeForGoogle3DTiles(state.viewer);
    syncMapDisplayMode();
    state.viewer.scene.requestRender();
  });
}

function loadFallbackBuildings() {
  configureGlobeForFallback(state.viewer);
  return Cesium.createOsmBuildingsAsync().then(function (buildings) {
    state.fallbackBuildings = buildings;
    state.viewer.scene.primitives.add(buildings);
    state.mapGeometryReady = true;
    syncMapDisplayMode();
    state.viewer.scene.requestRender();
  });
}

function setupClickHandler() {
  const handler = new Cesium.ScreenSpaceEventHandler(state.viewer.scene.canvas);
  handler.setInputAction(function (click) {
    const picked = state.viewer.scene.pick(click.position);
    state.viewer.selectedEntity = undefined;
    if (!Cesium.defined(picked) || !picked.id || !picked.id.properties) {
      hidePinInfo();
      return;
    }
    const entity = picked.id;
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
    navigationHelpButton: true
  });

  initHistoricalMaps(state.viewer);

  // 3D Tiles 読み込み完了までは Cesium 標準地図を表示（白画面を防ぐ）
  state.viewer.scene.globe.show = true;
  state.viewer.scene.globe.depthTestAgainstTerrain = false;
  state.viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;
  mountCustomToolbarButtons();
  setupClickHandler();
  setupSearchBox();
  setupFilterPanel();
  setupYearFilterBar();
  setupInfoPanel();
  setupHomeButton();
  setupArchiveList();
  setupAboutSheet();
  setupPointCloudModal();

  setStatus("Google Earth 風3D地図を読み込み中...");

  loadGoogleEarth3D()
    .then(function () {
      setStatus("3D地図を読み込みました。ピンを選択すると右側に3Dモデルのプレビューが表示されます。");
    })
    .catch(function (err) {
      console.warn("Google Photorealistic 3D Tiles の読み込みに失敗:", err);
      state.usesGoogle3DTiles = false;
      setStatus("Google 3D地図は利用できません。OSM建物データで代替表示します...");
      return loadFallbackBuildings();
    })
    .then(function () {
      tryLoadSheet();
    })
    .catch(function (err) {
      console.error(err);
      setStatus("3D地図の読み込みに失敗しました: " + err.message, "error");
    });
}

try {
  init();
} catch (err) {
  console.error(err);
  setStatus("起動に失敗しました: " + err.message, "error");
}
