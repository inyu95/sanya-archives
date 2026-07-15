import { state } from "../state.js";
import { refreshPinsForMapMode } from "../pins/pins.js";
import { invalidatePinHeightCache } from "../pins/pin-heights.js";
import { dom } from "../config/dom.js";
import { renderMemoryPins } from "../memory/memory-pins.js";
import {
  HISTORICAL_MAP_BRIGHTNESS,
  HISTORICAL_MAP_FALLBACK_BOUNDS,
  HISTORICAL_MAP_GAMMA,
  HISTORICAL_MAP_MAX_CAMERA_DISTANCE,
  HISTORICAL_MAP_MAX_ZOOM_LEVEL
} from "../config/constants.js";

const GSI_TILE_BASE = "https://cyberjapandata.gsi.go.jp/xyz/";

const MODERN_MAP_LAYER = { id: "modern3d", label: "3D地図（現在）" };

const DECADE_MAP_LAYERS = [
  { from: 2020, id: "seamlessphoto", min: 14, max: 18, ext: "jpg", label: "最新空中写真" },
  { from: 2010, id: "nendophoto", min: 14, max: 18, ext: "png", label: "2010年代", fallback: { id: "ort", min: 14, max: 18, ext: "jpg" } },
  { from: 2000, id: "ort", min: 14, max: 18, ext: "jpg", label: "2000年代" },
  { from: 1990, id: "gazo4", min: 10, max: 17, ext: "jpg", label: "1987–1990年" },
  { from: 1980, id: "gazo3", min: 10, max: 17, ext: "jpg", label: "1984–1986年" },
  { from: 1970, id: "gazo2", min: 10, max: 17, ext: "jpg", label: "1979–1983年" },
  { from: 1960, id: "ort_old10", min: 10, max: 17, ext: "png", label: "1961–1969年" },
  { from: 1940, id: "ort_USA10", min: 10, max: 17, ext: "png", label: "1945–1950年" },
  { from: 1930, id: "ort_riku10", min: 13, max: 18, ext: "png", label: "1936–1942年頃" }
];

/** 地理院タイルで利用できる最古の年代（これ未満は個別バーなし） */
export const EARLIEST_MAPPED_DECADE = DECADE_MAP_LAYERS[DECADE_MAP_LAYERS.length - 1].from;

export function decadeHasHistoricalMap(decadeStart) {
  return decadeStart >= EARLIEST_MAPPED_DECADE;
}

export function getAvailableMapDecades() {
  return DECADE_MAP_LAYERS
    .map(function (layer) { return layer.from; })
    .sort(function (a, b) { return a - b; });
}

export function syncMapDisplayMode() {
  applyHistoricalMapLayer(state.selectedYear);
}

export function getCurrentMapYear() {
  return new Date().getFullYear();
}

export function isModernMapYear(year) {
  return year !== null && year >= getCurrentMapYear();
}

export function resolveLayerForYear(year) {
  if (isModernMapYear(year)) {
    return MODERN_MAP_LAYER;
  }
  for (let i = 0; i < DECADE_MAP_LAYERS.length; i++) {
    if (year >= DECADE_MAP_LAYERS[i].from) {
      return materializeLayerConfig(DECADE_MAP_LAYERS[i], year);
    }
  }
  return materializeLayerConfig(DECADE_MAP_LAYERS[DECADE_MAP_LAYERS.length - 1], year);
}

function materializeLayerConfig(layer, year) {
  if (layer.id !== "nendophoto") {
    return layer;
  }
  const photoYear = Math.max(2007, Math.min(2019, year));
  return {
    from: layer.from,
    id: "nendophoto" + photoYear,
    min: layer.min,
    max: layer.max,
    ext: layer.ext,
    label: photoYear + "年頃",
    fallback: layer.fallback
  };
}

function getHistoricalMapRectangle() {
  const b = HISTORICAL_MAP_FALLBACK_BOUNDS;
  return Cesium.Rectangle.fromDegrees(b.west, b.south, b.east, b.north);
}

function ensureDefaultImageryLayer() {
  if (!state.viewer || state.defaultImageryLayer) return;
  const layers = state.viewer.imageryLayers;
  if (layers.length > 0) {
    state.defaultImageryLayer = layers.get(0);
  }
}

function showDefaultImageryLayer() {
  ensureDefaultImageryLayer();
  if (!state.defaultImageryLayer || !state.viewer) return;
  state.defaultImageryLayer.show = true;
  state.viewer.imageryLayers.lowerToBottom(state.defaultImageryLayer);
}

function hideDefaultImageryLayer() {
  ensureDefaultImageryLayer();
  if (!state.defaultImageryLayer) return;
  state.defaultImageryLayer.show = false;
}

function createGsiUrlTemplateProvider(config, rectangle) {
  return new Cesium.UrlTemplateImageryProvider({
    url: GSI_TILE_BASE + config.id + "/{z}/{x}/{y}." + config.ext,
    minimumLevel: config.min,
    maximumLevel: Math.min(config.max, HISTORICAL_MAP_MAX_ZOOM_LEVEL),
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    rectangle: rectangle,
    credit: "国土地理院"
  });
}

function wrapImageryProviderWithFallback(primary, fallback) {
  const wrapper = Object.create(primary);
  wrapper.requestImage = function (x, y, level, request) {
    const primaryResult = primary.requestImage(x, y, level, request);
    if (!Cesium.defined(primaryResult)) {
      return fallback.requestImage(x, y, level, request);
    }
    return Promise.resolve(primaryResult).then(function (image) {
      if (image) return image;
      return fallback.requestImage(x, y, level, request);
    }).catch(function () {
      return fallback.requestImage(x, y, level, request);
    });
  };
  return wrapper;
}

function createGsiProvider(config, rectangle) {
  const primary = createGsiUrlTemplateProvider(config, rectangle);
  if (!config.fallback) return primary;
  const fallback = createGsiUrlTemplateProvider(config.fallback, rectangle);
  return wrapImageryProviderWithFallback(primary, fallback);
}

function removeHistoricalLayers() {
  const viewer = state.viewer;
  if (!viewer) return;

  if (state.historicalImageryLayer) {
    viewer.imageryLayers.remove(state.historicalImageryLayer, true);
    state.historicalImageryLayer = null;
  }
}

function isCartographicInRectangle(carto, rectangle) {
  return carto.longitude >= rectangle.west
    && carto.longitude <= rectangle.east
    && carto.latitude >= rectangle.south
    && carto.latitude <= rectangle.north;
}

function getViewCenterCartographic(viewer) {
  const scene = viewer.scene;
  const canvas = scene.canvas;
  const center = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);

  if (scene.mode === Cesium.SceneMode.SCENE3D) {
    const picked = scene.pickPosition(center);
    if (Cesium.defined(picked)) {
      return Cesium.Cartographic.fromCartesian(picked);
    }
  }

  const ray = viewer.camera.getPickRay(center);
  if (!ray) return null;

  const hit = scene.globe.pick(ray, scene);
  if (!hit) return null;

  return Cesium.Cartographic.fromCartesian(hit);
}

function clampCameraToRectangle(viewer) {
  const carto = viewer.camera.positionCartographic;
  if (!carto) return;

  const rectangle = getHistoricalMapRectangle();
  if (isCartographicInRectangle(carto, rectangle)) return;

  const viewCenter = getViewCenterCartographic(viewer);
  if (viewCenter && isCartographicInRectangle(viewCenter, rectangle)) return;

  const lon = Cesium.Math.clamp(carto.longitude, rectangle.west, rectangle.east);
  const lat = Cesium.Math.clamp(carto.latitude, rectangle.south, rectangle.north);
  const camera = viewer.camera;
  camera.setView({
    destination: Cesium.Cartesian3.fromRadians(lon, lat, carto.height),
    orientation: {
      heading: camera.heading,
      pitch: camera.pitch,
      roll: camera.roll
    }
  });
}

function applyHistoricalCameraConstraints(viewer) {
  const controller = viewer.scene.screenSpaceCameraController;

  if (!state.historicalCameraSaved) {
    state.historicalCameraSaved = {
      maximumZoomDistance: controller.maximumZoomDistance,
      minimumZoomDistance: controller.minimumZoomDistance,
      enableCollisionDetection: controller.enableCollisionDetection
    };
  }

  controller.maximumZoomDistance = HISTORICAL_MAP_MAX_CAMERA_DISTANCE;
  controller.minimumZoomDistance = 50;
  controller.enableCollisionDetection = false;

  if (state.historicalCameraClamp) {
    viewer.camera.moveEnd.removeEventListener(state.historicalCameraClamp);
  }

  state.historicalCameraClamp = function () {
    clampCameraToRectangle(viewer);
  };
  viewer.camera.moveEnd.addEventListener(state.historicalCameraClamp);
}

function restoreCameraConstraints(viewer) {
  const controller = viewer.scene.screenSpaceCameraController;

  if (state.historicalCameraClamp) {
    viewer.camera.moveEnd.removeEventListener(state.historicalCameraClamp);
    state.historicalCameraClamp = null;
  }

  if (state.historicalCameraSaved) {
    controller.maximumZoomDistance = state.historicalCameraSaved.maximumZoomDistance;
    controller.minimumZoomDistance = state.historicalCameraSaved.minimumZoomDistance;
    // Photorealistic 3D では衝突オンだとチルトが押し戻されるため、常にオフへ戻す
    controller.enableCollisionDetection = false;
    state.historicalCameraSaved = null;
  }
}

function setModernView() {
  const viewer = state.viewer;
  if (!viewer) return;

  state.historicalMapActive = false;
  invalidatePinHeightCache();

  ensureDefaultImageryLayer();
  removeHistoricalLayers();
  restoreCameraConstraints(viewer);
  viewer.scene.globe.baseColor = Cesium.Color.BLACK;
  showDefaultImageryLayer();

  if (state.mapGeometryMode === "2d") {
    applyModernFlatGeometry(viewer);
  } else if (state.usesGoogle3DTiles && state.google3dTileset && state.google3dTilesPainted) {
    viewer.scene.globe.show = false;
    viewer.scene.globe.depthTestAgainstTerrain = false;
    showModernGeometry();
  } else if (state.usesGoogle3DTiles && state.google3dTileset) {
    // タイル未描画のうちは標準地図を残して空白を防ぐ
    viewer.scene.globe.show = true;
    viewer.scene.globe.depthTestAgainstTerrain = false;
    showModernGeometry();
  } else if (state.fallbackBuildings) {
    viewer.scene.globe.show = true;
    viewer.scene.globe.depthTestAgainstTerrain = true;
    showModernGeometry();
  } else {
    viewer.scene.globe.show = true;
    viewer.scene.globe.depthTestAgainstTerrain = false;
    hideModernGeometry();
  }

  refreshPinsForMapMode();
  viewer.scene.requestRender();
}

/** 現代地図を平面表示（Google 3D は残して非表示にし、切替を速くする） */
function applyModernFlatGeometry(viewer) {
  hideModernGeometry();
  viewer.scene.globe.show = true;
  viewer.scene.globe.depthTestAgainstTerrain = Boolean(state.fallbackBuildings)
    || !(state.usesGoogle3DTiles && state.google3dTileset);
}

function hideModernGeometry() {
  if (state.google3dTileset) {
    state.google3dTileset.show = false;
  }
  if (state.fallbackBuildings) {
    state.fallbackBuildings.show = false;
  }
}

function showModernGeometry() {
  if (state.google3dTileset) {
    state.google3dTileset.show = true;
  }
  if (state.fallbackBuildings) {
    state.fallbackBuildings.show = true;
  }
}

function mountHistoricalImageryLayer(viewer, config, options) {
  const rectangle = getHistoricalMapRectangle();
  removeHistoricalLayers();
  showDefaultImageryLayer();
  state.historicalImageryLayer = viewer.imageryLayers.addImageryProvider(createGsiProvider(config, rectangle));
  state.historicalImageryLayer.rectangle = rectangle;
  state.historicalImageryLayer.alpha = 1.0;
  state.historicalImageryLayer.brightness = HISTORICAL_MAP_BRIGHTNESS;
  state.historicalImageryLayer.gamma = HISTORICAL_MAP_GAMMA;
  state.historicalMapActive = true;
  if (!options || !options.skipCameraClamp) {
    clampCameraToRectangle(viewer);
  }
  refreshPinsForMapMode();
  viewer.scene.requestRender();
}

function isCameraInHistoricalArea(viewer, rectangle) {
  const carto = viewer.camera.positionCartographic;
  if (!carto) return false;
  return carto.longitude >= rectangle.west
    && carto.longitude <= rectangle.east
    && carto.latitude >= rectangle.south
    && carto.latitude <= rectangle.north
    && carto.height <= HISTORICAL_MAP_MAX_CAMERA_DISTANCE * 1.2;
}

function isCameraViewingHistoricalArea(viewer, rectangle) {
  if (isCameraInHistoricalArea(viewer, rectangle)) return true;

  const viewCenter = getViewCenterCartographic(viewer);
  return viewCenter !== null && isCartographicInRectangle(viewCenter, rectangle);
}

function flyToHistoricalArea(viewer, rectangle, onComplete) {
  const camera = viewer.camera;
  const carto = camera.positionCartographic;
  const center = Cesium.Rectangle.center(rectangle);
  const height = carto
    ? Cesium.Math.clamp(carto.height, 50, HISTORICAL_MAP_MAX_CAMERA_DISTANCE)
    : HISTORICAL_MAP_MAX_CAMERA_DISTANCE * 0.5;

  viewer.camera.cancelFlight();
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromRadians(center.longitude, center.latitude, height),
    orientation: {
      heading: camera.heading,
      pitch: camera.pitch,
      roll: camera.roll
    },
    duration: 0.8,
    complete: onComplete,
    cancel: onComplete
  });
}

function setHistoricalView(year) {
  const viewer = state.viewer;
  const config = resolveLayerForYear(year);
  if (!viewer || !config) return;

  const rectangle = getHistoricalMapRectangle();
  const wasActive = state.historicalMapActive;
  const preserveCamera = wasActive || isCameraViewingHistoricalArea(viewer, rectangle);

  state.historicalMapActive = true;
  invalidatePinHeightCache();

  hideModernGeometry();

  viewer.scene.globe.show = true;
  viewer.scene.globe.depthTestAgainstTerrain = false;
  viewer.scene.globe.baseColor = Cesium.Color.BLACK;
  showDefaultImageryLayer();
  applyHistoricalCameraConstraints(viewer);

  if (!preserveCamera) {
    flyToHistoricalArea(viewer, rectangle, function () {
      mountHistoricalImageryLayer(viewer, config);
    });
    return;
  }

  mountHistoricalImageryLayer(viewer, config, { skipCameraClamp: true });
}

export function applyHistoricalMapLayer(year) {
  if (year === null || isModernMapYear(year)) {
    setModernView();
  } else {
    setHistoricalView(year);
  }
  updateMapGeometrySwitcherUI();
}

/** 現代地図の 3D / 2D 切替。過去年代地図のときは変更不可 */
export function setMapGeometryMode(mode) {
  if (isMapGeometrySwitcherLocked()) return;

  const next = mode === "2d" ? "2d" : "3d";
  if (state.mapGeometryMode === next) {
    updateMapGeometrySwitcherUI();
    return;
  }
  state.mapGeometryMode = next;
  updateMapGeometrySwitcherUI();
  applyHistoricalMapLayer(state.selectedYear);
  if (state.appMode === "memory") {
    renderMemoryPins(state.filteredMemoryPhotos);
  }
}

/** 過去年代の歴史地図表示中は 3D/2D を切り替えられない */
export function isMapGeometrySwitcherLocked() {
  return Boolean(state.historicalMapActive);
}

export function updateMapGeometrySwitcherUI() {
  const locked = isMapGeometrySwitcherLocked();
  // 歴史地図中は見た目として 2D を強調（設定値 mapGeometryMode は保持）
  const is3d = !locked && state.mapGeometryMode !== "2d";

  if (dom.mapGeometrySwitcher) {
    dom.mapGeometrySwitcher.classList.toggle("is-disabled", locked);
    dom.mapGeometrySwitcher.setAttribute("aria-disabled", locked ? "true" : "false");
    dom.mapGeometrySwitcher.title = locked
      ? "過去の年代地図では 3D / 2D を切り替えられません"
      : "";
  }

  if (dom.mapGeometry3d) {
    dom.mapGeometry3d.classList.toggle("active", is3d);
    dom.mapGeometry3d.setAttribute("aria-pressed", is3d ? "true" : "false");
    dom.mapGeometry3d.disabled = locked;
  }
  if (dom.mapGeometry2d) {
    dom.mapGeometry2d.classList.toggle("active", !is3d);
    dom.mapGeometry2d.setAttribute("aria-pressed", !is3d ? "true" : "false");
    dom.mapGeometry2d.disabled = locked;
  }
}

export function setupMapGeometrySwitcher() {
  updateMapGeometrySwitcherUI();
  if (dom.mapGeometry3d) {
    dom.mapGeometry3d.addEventListener("click", function () {
      setMapGeometryMode("3d");
    });
  }
  if (dom.mapGeometry2d) {
    dom.mapGeometry2d.addEventListener("click", function () {
      setMapGeometryMode("2d");
    });
  }
}

export function initHistoricalMaps(viewer) {
  state.viewer = viewer;
  ensureDefaultImageryLayer();
}
