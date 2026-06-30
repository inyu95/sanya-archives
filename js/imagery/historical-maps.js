import { state } from "../state.js";
import {
  HISTORICAL_MAP_BOUNDS,
  HISTORICAL_MAP_MAX_CAMERA_DISTANCE,
  HISTORICAL_MAP_MAX_ZOOM_LEVEL
} from "../config/constants.js";

const GSI_TILE_BASE = "https://cyberjapandata.gsi.go.jp/xyz/";

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

/** 年代バー「それ以前」の内部値 */
export const YEAR_FILTER_BEFORE = -1;

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

export function resolveLayerForYear(year) {
  return resolveLayerForDecade(year);
}

function getHistoricalMapRectangle() {
  const b = HISTORICAL_MAP_BOUNDS;
  return Cesium.Rectangle.fromDegrees(b.west, b.south, b.east, b.north);
}

function ensureDefaultImageryLayer() {
  if (!state.viewer || state.defaultImageryProvider) return;
  const layers = state.viewer.imageryLayers;
  if (layers.length > 0) {
    state.defaultImageryLayer = layers.get(0);
    state.defaultImageryProvider = state.defaultImageryLayer.imageryProvider;
  }
}

function resolveLayerForDecade(decadeStart) {
  for (let i = 0; i < DECADE_MAP_LAYERS.length; i++) {
    if (decadeStart >= DECADE_MAP_LAYERS[i].from) {
      return DECADE_MAP_LAYERS[i];
    }
  }
  return DECADE_MAP_LAYERS[DECADE_MAP_LAYERS.length - 1];
}

function createGsiProvider(config) {
  return new Cesium.UrlTemplateImageryProvider({
    url: GSI_TILE_BASE + config.id + "/{z}/{x}/{y}." + config.ext,
    minimumLevel: config.min,
    maximumLevel: Math.min(config.max, HISTORICAL_MAP_MAX_ZOOM_LEVEL),
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    credit: "国土地理院"
  });
}

function clearImageryLayers(viewer) {
  while (viewer.imageryLayers.length > 0) {
    viewer.imageryLayers.remove(viewer.imageryLayers.get(0));
  }
}

function removeHistoricalLayers() {
  const viewer = state.viewer;
  if (!viewer) return;

  if (state.historicalImageryLayer) {
    viewer.imageryLayers.remove(state.historicalImageryLayer, false);
    state.historicalImageryLayer = null;
  }
  if (state.basePaleLayer) {
    viewer.imageryLayers.remove(state.basePaleLayer, false);
    state.basePaleLayer = null;
  }
}

function clampCameraToRectangle(viewer, rectangle) {
  const carto = viewer.camera.positionCartographic;
  if (!carto) return;

  const lon = Cesium.Math.clamp(carto.longitude, rectangle.west, rectangle.east);
  const lat = Cesium.Math.clamp(carto.latitude, rectangle.south, rectangle.north);
  if (lon === carto.longitude && lat === carto.latitude) return;

  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromRadians(lon, lat, carto.height)
  });
}

function applyHistoricalCameraConstraints(viewer) {
  const controller = viewer.scene.screenSpaceCameraController;
  const rectangle = getHistoricalMapRectangle();

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
    clampCameraToRectangle(viewer, rectangle);
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

function restoreDefaultImageryLayer(viewer) {
  clearImageryLayers(viewer);
  state.historicalImageryLayer = null;
  state.basePaleLayer = null;

  if (state.defaultImageryProvider) {
    state.defaultImageryLayer = viewer.imageryLayers.addImageryProvider(state.defaultImageryProvider);
    state.defaultImageryLayer.show = true;
    return;
  }

  return Cesium.createWorldImageryAsync().then(function (provider) {
    state.defaultImageryProvider = provider;
    state.defaultImageryLayer = viewer.imageryLayers.addImageryProvider(provider);
    state.defaultImageryLayer.show = true;
  });
}

function setModernView() {
  const viewer = state.viewer;
  if (!viewer) return;

  ensureDefaultImageryLayer();
  removeHistoricalLayers();
  restoreCameraConstraints(viewer);

  const restored = restoreDefaultImageryLayer(viewer);
  const finalize = function () {
    if (state.usesGoogle3DTiles) {
      viewer.scene.globe.show = false;
      viewer.scene.globe.depthTestAgainstTerrain = false;
      showModernGeometry();
    } else {
      viewer.scene.globe.show = true;
      viewer.scene.globe.depthTestAgainstTerrain = true;
      showModernGeometry();
    }

    state.historicalMapActive = false;
    viewer.scene.requestRender();
  };

  if (restored && typeof restored.then === "function") {
    restored.then(finalize).catch(function (err) {
      console.warn("デフォルト地図の復元に失敗:", err);
      finalize();
    });
    return;
  }

  finalize();
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

function mountHistoricalImageryLayer(viewer, config, replaceStack) {
  if (replaceStack) {
    clearImageryLayers(viewer);
    state.defaultImageryLayer = null;
  } else if (state.historicalImageryLayer) {
    viewer.imageryLayers.remove(state.historicalImageryLayer, false);
  }

  state.historicalImageryLayer = viewer.imageryLayers.addImageryProvider(createGsiProvider(config));
  state.historicalImageryLayer.alpha = 1.0;
  state.historicalMapActive = true;
  clampCameraToRectangle(viewer, getHistoricalMapRectangle());
  viewer.scene.requestRender();
}

function flyToHistoricalArea(viewer, rectangle, onComplete) {
  viewer.camera.cancelFlight();
  viewer.camera.flyTo({
    destination: rectangle,
    duration: 1.2,
    complete: onComplete,
    cancel: onComplete
  });
}

function setHistoricalView(decadeStart) {
  const viewer = state.viewer;
  const config = resolveLayerForDecade(decadeStart);
  if (!viewer || !config) return;

  const rectangle = getHistoricalMapRectangle();
  const wasActive = state.historicalMapActive;

  ensureDefaultImageryLayer();
  hideModernGeometry();

  viewer.scene.globe.show = true;
  viewer.scene.globe.depthTestAgainstTerrain = false;
  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#1a1a1a");

  applyHistoricalCameraConstraints(viewer);

  if (wasActive) {
    mountHistoricalImageryLayer(viewer, config, false);
    return;
  }

  flyToHistoricalArea(viewer, rectangle, function () {
    mountHistoricalImageryLayer(viewer, config, true);
  });
}

export function applyHistoricalMapLayer(decadeStart) {
  if (decadeStart === null) {
    setModernView();
  } else if (decadeStart === YEAR_FILTER_BEFORE) {
    setHistoricalView(EARLIEST_MAPPED_DECADE);
  } else {
    setHistoricalView(decadeStart);
  }
}

export function initHistoricalMaps(viewer) {
  state.viewer = viewer;
  ensureDefaultImageryLayer();
}
