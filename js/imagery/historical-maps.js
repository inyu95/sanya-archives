import { state } from "../state.js";

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
  applyHistoricalMapLayer(state.selectedYearDecade);
}

function ensureDefaultImageryLayer() {
  if (!state.viewer || state.defaultImageryLayer) return;
  const layers = state.viewer.imageryLayers;
  if (layers.length > 0) {
    state.defaultImageryLayer = layers.get(0);
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
    maximumLevel: config.max,
    credit: "国土地理院"
  });
}

function ensurePaleBaseLayer() {
  const viewer = state.viewer;
  if (!viewer || state.basePaleLayer) return;

  state.basePaleLayer = viewer.imageryLayers.addImageryProvider(
    new Cesium.UrlTemplateImageryProvider({
      url: GSI_TILE_BASE + "pale/{z}/{x}/{y}.png",
      credit: "国土地理院"
    })
  );
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

function setModernView() {
  const viewer = state.viewer;
  if (!viewer) return;

  ensureDefaultImageryLayer();
  removeHistoricalLayers();

  if (state.defaultImageryLayer) {
    state.defaultImageryLayer.show = true;
  }

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

function setHistoricalView(decadeStart) {
  const viewer = state.viewer;
  const config = resolveLayerForDecade(decadeStart);
  if (!viewer || !config) return;

  ensureDefaultImageryLayer();

  if (state.defaultImageryLayer) {
    state.defaultImageryLayer.show = false;
  }

  hideModernGeometry();

  viewer.scene.globe.show = true;
  viewer.scene.globe.depthTestAgainstTerrain = true;
  viewer.scene.globe.baseColor = Cesium.Color.BLACK;

  ensurePaleBaseLayer();

  if (state.historicalImageryLayer) {
    viewer.imageryLayers.remove(state.historicalImageryLayer, false);
  }
  state.historicalImageryLayer = viewer.imageryLayers.addImageryProvider(
    createGsiProvider(config)
  );
  state.historicalImageryLayer.alpha = 1.0;
  state.historicalMapActive = true;

  viewer.scene.requestRender();
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
