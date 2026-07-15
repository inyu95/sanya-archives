import { state } from "../state.js";
import { PIN_MAX_HEIGHT_ABOVE_TERRAIN_METERS } from "../config/constants.js";

/** 2D/歴史地図/平面モードでは 3D タイルの屋根高ではなく地形（楕円体）基準にする */
export function isFlatMapHeightMode() {
  if (state.historicalMapActive) return true;
  if (state.mapGeometryMode === "2d") return true;
  if (!state.viewer) return false;
  return state.viewer.scene.mode === Cesium.SceneMode.SCENE2D;
}

/** sampleHeight がタイル待ちで固まるのを防ぐ */
const SAMPLE_HEIGHT_TIMEOUT_MS = 2500;
/** 山谷エリアの仮の地表高（楕円体上・m）。タイル未準備時の即時配置用 */
const SANYA_APPROX_GROUND_HEIGHT_METERS = 30;

function sampleTerrainHeight(lon, lat) {
  return new Promise(function (resolve) {
    const carto = Cesium.Cartographic.fromDegrees(lon, lat);
    const timer = setTimeout(function () { resolve(0); }, 5000);

    Cesium.sampleTerrainMostDetailed(state.viewer.terrainProvider, [carto])
      .then(function (results) {
        clearTimeout(timer);
        resolve(results[0].height || 0);
      })
      .catch(function () {
        clearTimeout(timer);
        resolve(0);
      });
  });
}

function waitFor3DTiles() {
  return new Promise(function (resolve) {
    if (!state.google3dTileset || !state.google3dTileset.readyPromise) {
      resolve();
      return;
    }
    state.google3dTileset.readyPromise.then(resolve).catch(resolve);
  });
}

function sampleTerrainHeights(pinDataList) {
  const cartographics = pinDataList.map(function (pin) {
    return Cesium.Cartographic.fromDegrees(pin.lon, pin.lat);
  });

  return Cesium.sampleTerrainMostDetailed(state.viewer.terrainProvider, cartographics)
    .then(function (results) {
      return results.map(function (carto) {
        return carto.height || 0;
      });
    })
    .catch(function () {
      return cartographics.map(function () { return 0; });
    });
}

function approximateGroundHeights(pinDataList) {
  return pinDataList.map(function () {
    return SANYA_APPROX_GROUND_HEIGHT_METERS;
  });
}

/**
 * 3Dメッシュのサンプリング結果を採用し、建物表面（屋根含む）に載せる。
 * （以前は屋上ヒットを路面へ押し下げていたが、建物に埋もれる原因になっていた）
 */
function refineSampledHeights(pinDataList, sampledHeights) {
  return sampleTerrainHeights(pinDataList).then(function (terrainHeights) {
    return sampledHeights.map(function (height, index) {
      const terrainHeight = terrainHeights[index] || 0;
      const terrainFallback = terrainHeight || SANYA_APPROX_GROUND_HEIGHT_METERS;

      if (height == null || isNaN(height)) {
        return terrainFallback;
      }

      // メッシュが地形より明らかに下＝欠測扱いで地形基準
      if (height < terrainHeight - 2) {
        return terrainFallback;
      }

      // 異常に高いサンプルをクランプ
      const aboveTerrain = height - terrainHeight;
      if (aboveTerrain > PIN_MAX_HEIGHT_ABOVE_TERRAIN_METERS) {
        return terrainHeight + PIN_MAX_HEIGHT_ABOVE_TERRAIN_METERS;
      }

      return height;
    });
  });
}

function sampleGroundHeights(pinDataList) {
  if (isFlatMapHeightMode()) {
    return sampleTerrainHeights(pinDataList);
  }

  // 3Dタイル未着時は仮高さで即返し、後で mapGeometryReady 時に再サンプリング
  if (!state.mapGeometryReady) {
    return Promise.resolve(approximateGroundHeights(pinDataList));
  }

  const cartographics = pinDataList.map(function (pin) {
    return Cesium.Cartographic.fromDegrees(pin.lon, pin.lat);
  });

  function terrainFallback() {
    return sampleTerrainHeights(pinDataList).then(function (heights) {
      return heights.map(function (height) {
        return height && !isNaN(height) ? height : SANYA_APPROX_GROUND_HEIGHT_METERS;
      });
    });
  }

  if (!state.viewer.scene.sampleHeightSupported) {
    return terrainFallback();
  }

  const samplePromise = state.viewer.scene.sampleHeightMostDetailed(cartographics, undefined, 2.0)
    .then(function () {
      return Promise.all(cartographics.map(function (carto, index) {
        if (carto.height != null && !isNaN(carto.height)) {
          return carto.height;
        }
        return sampleTerrainHeight(pinDataList[index].lon, pinDataList[index].lat);
      })).then(function (sampledHeights) {
        return refineSampledHeights(pinDataList, sampledHeights);
      });
    });

  return new Promise(function (resolve) {
    let settled = false;
    const timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      console.warn("3Dタイルの高さ取得がタイムアウトしたため仮高さを使います");
      resolve(approximateGroundHeights(pinDataList));
    }, SAMPLE_HEIGHT_TIMEOUT_MS);

    samplePromise.then(function (heights) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(heights);
    }).catch(function (err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      console.warn("3Dタイルの高さ取得に失敗:", err);
      terrainFallback().then(resolve);
    });
  });
}

function pinCacheKey(pin) {
  return pin.lon + "," + pin.lat + ":" + (isFlatMapHeightMode() ? "flat-v4" : "3d-v6-mesh");
}

export function invalidatePinHeightCache() {
  state.pinHeightCache.clear();
}

export function resolveHeights(pinDataList, forceFlat) {
  const flat = forceFlat != null ? forceFlat : isFlatMapHeightMode();
  if (flat) {
    return Promise.resolve(pinDataList.map(function () { return 0; }));
  }

  const missingPins = [];
  const missingIndexes = [];

  pinDataList.forEach(function (pin, index) {
    if (!state.pinHeightCache.has(pinCacheKey(pin))) {
      missingPins.push(pin);
      missingIndexes.push(index);
    }
  });

  if (missingPins.length === 0) {
    return Promise.resolve(pinDataList.map(function (pin) {
      return state.pinHeightCache.get(pinCacheKey(pin));
    }));
  }

  return waitFor3DTiles().then(function () {
    return sampleGroundHeights(missingPins);
  }).then(function (missingHeights) {
    missingIndexes.forEach(function (pinIndex, i) {
      state.pinHeightCache.set(pinCacheKey(pinDataList[pinIndex]), missingHeights[i]);
    });
    return pinDataList.map(function (pin) {
      return state.pinHeightCache.get(pinCacheKey(pin));
    });
  });
}
