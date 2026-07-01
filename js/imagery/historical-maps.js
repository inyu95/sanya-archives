import { state } from "../state.js";
import {
  HISTORICAL_MAP_BRIGHTNESS,
  HISTORICAL_MAP_FALLBACK_BOUNDS,
  HISTORICAL_MAP_GAMMA,
  HISTORICAL_MAP_MAX_CAMERA_DISTANCE,
  HISTORICAL_MAP_MAX_ZOOM_LEVEL,
  HISTORICAL_MAP_PADDING_DEGREES
} from "../config/constants.js";

const GSI_TILE_BASE = "https://cyberjapandata.gsi.go.jp/xyz/";

const MODERN_MAP_LAYER = { id: "modern3d", label: "3D地図（現在）" };

const DECADE_MAP_LAYERS = [
  { from: 2020, id: "seamlessphoto", min: 14, max: 18, ext: "jpg", label: "最新空中写真" },
  { from: 2010, id: "nendophoto2015", min: 14, max: 18, ext: "png", label: "2015年頃" },
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
      return DECADE_MAP_LAYERS[i];
    }
  }
  return DECADE_MAP_LAYERS[DECADE_MAP_LAYERS.length - 1];
}

function getHistoricalMapRectangle() {
  const b = HISTORICAL_MAP_FALLBACK_BOUNDS;
  const pins = state.allPins;
  if (!pins || pins.length === 0) {
    return Cesium.Rectangle.fromDegrees(b.west, b.south, b.east, b.north);
  }

  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  pins.forEach(function (pin) {
    west = Math.min(west, pin.lon);
    east = Math.max(east, pin.lon);
    south = Math.min(south, pin.lat);
    north = Math.max(north, pin.lat);
  });

  const pad = HISTORICAL_MAP_PADDING_DEGREES;
  return Cesium.Rectangle.fromDegrees(
    Math.max(b.west, west - pad),
    Math.max(b.south, south - pad),
    Math.min(b.east, east + pad),
    Math.min(b.north, north + pad)
  );
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

function createGsiProvider(config) {
  return new Cesium.UrlTemplateImageryProvider({
    url: GSI_TILE_BASE + config.id + "/{z}/{x}/{y}." + config.ext,
    minimumLevel: config.min,
    maximumLevel: Math.min(config.max, HISTORICAL_MAP_MAX_ZOOM_LEVEL),
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    rectangle: getHistoricalMapRectangle(),
    credit: "国土地理院"
  });
}

function removeHistoricalLayers() {
  const viewer = state.viewer;
  if (!viewer) return;

  if (state.historicalImageryLayer) {
    viewer.imageryLayers.remove(state.historicalImageryLayer, true);
    state.historicalImageryLayer = null;
  }
}

function clampCameraToRectangle(viewer) {
  const carto = viewer.camera.positionCartographic;
  if (!carto) return;

  const rectangle = getHistoricalMapRectangle();
  const lon = Cesium.Math.clamp(carto.longitude, rectangle.west, rectangle.east);
  const lat = Cesium.Math.clamp(carto.latitude, rectangle.south, rectangle.north);
  if (lon === carto.longitude && lat === carto.latitude) return;

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
      minimumZoomDistance: controller.minimumZoomDistance
    };
  }

  controller.maximumZoomDistance = HISTORICAL_MAP_MAX_CAMERA_DISTANCE;
  controller.minimumZoomDistance = 50;

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
    state.historicalCameraSaved = null;
  }
}

function setModernView() {
  const viewer = state.viewer;
  if (!viewer) return;

  ensureDefaultImageryLayer();
  removeHistoricalLayers();
  restoreCameraConstraints(viewer);
  viewer.scene.globe.baseColor = Cesium.Color.BLACK;
  showDefaultImageryLayer();

  if (state.usesGoogle3DTiles && state.google3dTileset) {
    viewer.scene.globe.show = false;
    viewer.scene.globe.depthTestAgainstTerrain = false;
    showModernGeometry();
  } else if (state.fallbackBuildings) {
    viewer.scene.globe.show = true;
    viewer.scene.globe.depthTestAgainstTerrain = true;
    showModernGeometry();
  } else {
    viewer.scene.globe.show = true;
    viewer.scene.globe.depthTestAgainstTerrain = false;
  }

  state.historicalMapActive = false;
  viewer.scene.requestRender();
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

function mountHistoricalImageryLayer(viewer, config) {
  removeHistoricalLayers();
  showDefaultImageryLayer();
  state.historicalImageryLayer = viewer.imageryLayers.addImageryProvider(createGsiProvider(config));
  state.historicalImageryLayer.alpha = 1.0;
  state.historicalImageryLayer.brightness = HISTORICAL_MAP_BRIGHTNESS;
  state.historicalImageryLayer.gamma = HISTORICAL_MAP_GAMMA;
  state.historicalMapActive = true;
  clampCameraToRectangle(viewer);
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

  const scene = viewer.scene;
  const canvas = scene.canvas;
  const center = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
  const ray = viewer.camera.getPickRay(center);
  if (!ray) return false;

  const hit = scene.globe.pick(ray, scene);
  if (!hit) return false;

  const carto = Cesium.Cartographic.fromCartesian(hit);
  return carto.longitude >= rectangle.west
    && carto.longitude <= rectangle.east
    && carto.latitude >= rectangle.south
    && carto.latitude <= rectangle.north;
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

  hideModernGeometry();

  viewer.scene.globe.show = true;
  viewer.scene.globe.depthTestAgainstTerrain = false;
  viewer.scene.globe.baseColor = Cesium.Color.BLACK;
  showDefaultImageryLayer();
  applyHistoricalCameraConstraints(viewer);

  if (!wasActive && !isCameraViewingHistoricalArea(viewer, rectangle)) {
    flyToHistoricalArea(viewer, rectangle, function () {
      mountHistoricalImageryLayer(viewer, config);
    });
    return;
  }

  mountHistoricalImageryLayer(viewer, config);
}

export function applyHistoricalMapLayer(year) {
  if (year === null || isModernMapYear(year)) {
    setModernView();
  } else {
    setHistoricalView(year);
  }
}

export function initHistoricalMaps(viewer) {
  state.viewer = viewer;
  ensureDefaultImageryLayer();
}
