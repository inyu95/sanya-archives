import {
  PIN_CIRCLE_SIZE,
  PIN_POLE_HEIGHT_METERS,
  PIN_STEM_WIDTH,
  PIN_STEM_COLOR,
  PIN_STEM_ALPHA,
  INITIAL_PIN_VIEW_RANGE,
  HISTORICAL_MAP_FALLBACK_BOUNDS,
  ASSETS_ICONS_BASE
} from "../config/constants.js";
import { state } from "../state.js";
import { createPinCircleImageDataUrl, createPinWithStemImageDataUrl } from "./pin-art.js";
import { resolveHeights } from "./pin-heights.js";

/** 非同期の高さ解決が重なったとき、古い renderPins 結果を捨てる */
let pinRenderGeneration = 0;

function buildPinLayers(pin) {
  const roles = pin.role || [];
  if (roles.length === 0) {
    return [{ imageUrl: "", borderColor: "", label: pin.name || "" }];
  }
  return roles.map(function (role) {
    return {
      imageUrl: ASSETS_ICONS_BASE + encodeURIComponent(role) + ".png",
      borderColor: state.roleColors[role] || "",
      label: role
    };
  });
}

/** Cesium 2D モード専用: 画面上の茎付きビルボード */
function addScreenFlatPin(pin, props, layers, onDone, generation) {
  const surfacePos = Cesium.Cartesian3.fromDegrees(pin.lon, pin.lat);
  createPinWithStemImageDataUrl(pin.name, layers, function (dataUrl, totalHeight) {
    if (generation !== pinRenderGeneration) {
      if (onDone) onDone();
      return;
    }
    state.viewer.entities.add({
      name: pin.name,
      position: surfacePos,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      billboard: {
        image: dataUrl,
        width: PIN_CIRCLE_SIZE,
        height: totalHeight,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        sizeInMeters: false,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
      },
      properties: props
    });
    if (onDone) onDone();
  });
}

/** 3D / 歴史地図: メートル単位のポール（3D と同じ見た目） */
function addPolePin(pin, groundH, props, layers, onDone, generation) {
  const groundPos = Cesium.Cartesian3.fromDegrees(pin.lon, pin.lat, groundH);
  const topPos = Cesium.Cartesian3.fromDegrees(pin.lon, pin.lat, groundH + PIN_POLE_HEIGHT_METERS);

  createPinCircleImageDataUrl(pin.name, layers, function (dataUrl, totalHeight) {
    if (generation !== pinRenderGeneration) {
      if (onDone) onDone();
      return;
    }
    state.viewer.entities.add({
      name: pin.name,
      position: topPos,
      billboard: {
        image: dataUrl,
        width: PIN_CIRCLE_SIZE,
        height: totalHeight,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        sizeInMeters: false,
        // 重い 3D タイル／未確定な高さでもピンがメッシュに隠れないようにする
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      polyline: {
        positions: [groundPos, topPos],
        width: PIN_STEM_WIDTH,
        material: Cesium.Color.fromCssColorString(PIN_STEM_COLOR).withAlpha(PIN_STEM_ALPHA),
        arcType: Cesium.ArcType.NONE,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      properties: props
    });
    if (onDone) onDone();
  });
}

function addPhotoPin(pin, groundH, onDone, generation, scene2D) {
  const props = {
    image: pin.image || "",
    images: pin.images || [],
    text: pin.text || "",
    pointcloudAssetId: pin.pointcloud,
    url: pin.url || "",
    urlLabel: pin.urlLabel || "",
    openingYear: pin.openingYear || "",
    closingYear: pin.closingYear || "",
    category: pin.category || "",
    role: pin.role || [],
    lon: pin.lon,
    lat: pin.lat
  };

  const layers = buildPinLayers(pin);

  if (scene2D) {
    addScreenFlatPin(pin, props, layers, onDone, generation);
    return;
  }

  addPolePin(pin, groundH, props, layers, onDone, generation);
}

export function refreshPinsForMapMode() {
  // 起動画面（モード未選択）ではピンを出さない
  if (!state.viewer || state.appMode !== "life") return;
  if (state.filteredPins.length === 0) return;
  renderPins(state.filteredPins);
}

export function renderPins(pinDataList, onComplete) {
  const generation = ++pinRenderGeneration;
  const scene2D = state.viewer.scene.mode === Cesium.SceneMode.SCENE2D;
  const historicalFlat = state.historicalMapActive;
  const flatHeights = scene2D || historicalFlat;
  state.viewer.entities.removeAll();
  if (pinDataList.length === 0) {
    if (onComplete) onComplete();
    return;
  }

  function placePins(heights) {
    if (generation !== pinRenderGeneration) return;
    let remaining = pinDataList.length;
    for (let i = 0; i < pinDataList.length; i++) {
      addPhotoPin(pinDataList[i], heights[i], function () {
        if (generation !== pinRenderGeneration) return;
        remaining -= 1;
        if (remaining === 0) {
          state.viewer.scene.requestRender();
          if (onComplete) onComplete();
        }
      }, generation, scene2D);
    }
  }

  resolveHeights(pinDataList, flatHeights).then(placePins).catch(function (err) {
    console.error("ピンの高さ取得に失敗:", err);
    placePins(pinDataList.map(function () { return 0; }));
  });
}

/** 山谷地区の概観へ飛行（ピン未配置時でも使える） */
export function flyToSanyaDistrict(opts) {
  if (!state.viewer) return;
  const options = opts || {};
  const b = HISTORICAL_MAP_FALLBACK_BOUNDS;
  const rectangle = Cesium.Rectangle.fromDegrees(b.west, b.south, b.east, b.north);
  const center = Cesium.Rectangle.center(rectangle);
  // 注視点を地区中心にし、HeadingPitchRange で回り込む（destination+pitch だと視線が北へずれる）
  const target = Cesium.Cartesian3.fromRadians(center.longitude, center.latitude, 0);
  const sphere = new Cesium.BoundingSphere(target, 1);
  const offset = new Cesium.HeadingPitchRange(
    0,
    Cesium.Math.toRadians(-55),
    INITIAL_PIN_VIEW_RANGE
  );
  const controller = state.viewer.scene.screenSpaceCameraController;
  const previousCollision = controller.enableCollisionDetection;
  state.viewer.camera.cancelFlight();
  controller.enableCollisionDetection = false;

  if (options.duration === 0) {
    state.viewer.camera.viewBoundingSphere(sphere, offset);
    state.viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    controller.enableCollisionDetection = previousCollision;
    if (typeof options.complete === "function") options.complete();
    return;
  }

  state.viewer.camera.flyToBoundingSphere(sphere, {
    duration: options.duration != null ? options.duration : 2.5,
    offset: offset,
    complete: function () {
      controller.enableCollisionDetection = previousCollision;
      if (typeof options.complete === "function") options.complete();
    },
    cancel: function () {
      controller.enableCollisionDetection = previousCollision;
      if (typeof options.cancel === "function") options.cancel();
    }
  });
}

export function flyToPins() {
  if (!state.viewer || state.viewer.entities.values.length === 0) {
    flyToSanyaDistrict();
    return;
  }
  const controller = state.viewer.scene.screenSpaceCameraController;
  const previousCollision = controller.enableCollisionDetection;
  state.viewer.camera.cancelFlight();
  controller.enableCollisionDetection = false;
  state.viewer.flyTo(state.viewer.entities, {
    duration: 2,
    offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-55), INITIAL_PIN_VIEW_RANGE),
    complete: function () {
      controller.enableCollisionDetection = previousCollision;
    },
    cancel: function () {
      controller.enableCollisionDetection = previousCollision;
    }
  });
}

export function flyToPin(entity) {
  if (!entity) return;
  const controller = state.viewer.scene.screenSpaceCameraController;
  const previousCollision = controller.enableCollisionDetection;
  state.viewer.camera.cancelFlight();
  controller.enableCollisionDetection = false;
  state.viewer.flyTo(entity, {
    duration: 1.5,
    offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-50), 120),
    complete: function () {
      controller.enableCollisionDetection = previousCollision;
    },
    cancel: function () {
      controller.enableCollisionDetection = previousCollision;
    }
  });
}

export function findPinEntity(pin) {
  if (!pin || !state.viewer) return null;
  const entities = state.viewer.entities.values;
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (!entity.properties) continue;
    const lon = entity.properties.lon && entity.properties.lon.getValue();
    const lat = entity.properties.lat && entity.properties.lat.getValue();
    if (lon === pin.lon && lat === pin.lat) return entity;
  }
  return null;
}
