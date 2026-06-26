import { state } from "../state.js";

export function sampleTerrainHeight(lon, lat) {
  return new Promise(function (resolve) {
    const carto = Cesium.Cartographic.fromDegrees(lon, lat);
    const timer = setTimeout(function () { resolve(40); }, 5000);

    Cesium.sampleTerrainMostDetailed(state.viewer.terrainProvider, [carto])
      .then(function (results) {
        clearTimeout(timer);
        resolve(results[0].height || 40);
      })
      .catch(function () {
        clearTimeout(timer);
        resolve(40);
      });
  });
}

export function waitFor3DTiles() {
  return new Promise(function (resolve) {
    if (!state.google3dTileset || !state.google3dTileset.readyPromise) {
      resolve();
      return;
    }
    state.google3dTileset.readyPromise.then(resolve).catch(resolve);
  });
}

export function sampleGroundHeights(pinDataList) {
  const cartographics = pinDataList.map(function (pin) {
    return Cesium.Cartographic.fromDegrees(pin.lon, pin.lat);
  });

  function terrainFallback() {
    return Cesium.sampleTerrainMostDetailed(state.viewer.terrainProvider, cartographics)
      .then(function (results) {
        return results.map(function (carto) {
          return carto.height || 40;
        });
      })
      .catch(function () {
        return cartographics.map(function () { return 40; });
      });
  }

  if (!state.viewer.scene.sampleHeightSupported) {
    return terrainFallback();
  }

  return state.viewer.scene.sampleHeightMostDetailed(cartographics, undefined, 2.0)
    .then(function () {
      return Promise.all(cartographics.map(function (carto, index) {
        if (carto.height != null && !isNaN(carto.height)) {
          return carto.height;
        }
        return sampleTerrainHeight(pinDataList[index].lon, pinDataList[index].lat);
      }));
    })
    .catch(function (err) {
      console.warn("3Dタイルの高さ取得に失敗:", err);
      return terrainFallback();
    });
}

function pinCacheKey(pin) {
  return pin.lon + "," + pin.lat;
}

export function resolveHeights(pinDataList) {
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
