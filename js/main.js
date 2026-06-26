import { CESIUM_ION_TOKEN } from "./config/constants.js";
import { state } from "./state.js";
import { setStatus } from "./ui/status.js";
import { tryLoadSheet } from "./data/sheets.js";
import {
  setupSearchBox,
  setupFilterPanel,
  setupYearFilterBar
} from "./filters/filters.js";
import { setupInfoPanel, showPinInfo, hidePinInfo, resetCameraZoomState } from "./info-panel.js";
import { setupHomeButton } from "./ui/home.js";
import { setupArchiveList } from "./ui/archive-list.js";
import { setupAboutSheet } from "./ui/about.js";
import { setupPointCloudModal, clearPointCloudModal } from "./pointcloud/viewer.js";

function configureGlobeForGoogle3DTiles(viewer) {
  viewer.scene.globe.show = false;
  viewer.scene.globe.depthTestAgainstTerrain = false;
}

function configureGlobeForFallback(viewer) {
  viewer.scene.globe.show = true;
  viewer.terrainProvider = Cesium.Terrain.fromWorldTerrain();
  viewer.scene.globe.depthTestAgainstTerrain = true;
}

export function loadGoogleEarth3D() {
  return Cesium.createGooglePhotorealistic3DTileset({
    onlyUsingWithGoogleGeocoder: true
  }).then(function (tileset) {
    state.google3dTileset = tileset;
    state.viewer.scene.primitives.add(tileset);
    configureGlobeForGoogle3DTiles(state.viewer);
    state.viewer.scene.requestRender();
  });
}

export function loadFallbackBuildings() {
  configureGlobeForFallback(state.viewer);
  return Cesium.createOsmBuildingsAsync().then(function (buildings) {
    state.viewer.scene.primitives.add(buildings);
    state.viewer.scene.requestRender();
  });
}

export function setupClickHandler() {
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

export function init() {
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

  // Google 3D Tiles 読み込み前はデフォルトの楕円体地形のみ。World Terrain は 3D Tiles と重なってチカチカする。
  configureGlobeForGoogle3DTiles(state.viewer);
  state.viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;
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

init();
