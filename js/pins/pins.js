import {
  PIN_CIRCLE_SIZE,
  PIN_POLE_HEIGHT_METERS,
  PIN_STEM_WIDTH,
  PIN_STEM_COLOR,
  PIN_STEM_ALPHA,
  INITIAL_PIN_VIEW_RANGE,
  ASSETS_ICONS_BASE
} from "../config/constants.js";
import { state } from "../state.js";
import { createPinCircleImageDataUrl, createPinWithStemImageDataUrl } from "./pin-art.js";
import { resolveHeights } from "./pin-heights.js";

function isScene2D() {
  return state.viewer && state.viewer.scene.mode === Cesium.SceneMode.SCENE2D;
}

function getPinBorderColor(pin) {
  const roles = pin.role || [];
  for (let i = 0; i < roles.length; i++) {
    const color = state.roleColors[roles[i]];
    if (color) return color;
  }
  return "";
}

function getPinIconUrl(pin) {
  const roles = pin.role || [];
  if (roles.length === 0) return "";
  return ASSETS_ICONS_BASE + encodeURIComponent(roles[0]) + ".png";
}

function addPhotoPin(pin, groundH, onDone) {
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

  const groundPos = Cesium.Cartesian3.fromDegrees(pin.lon, pin.lat, groundH);

  if (isScene2D()) {
    createPinWithStemImageDataUrl(pin.name, getPinIconUrl(pin), getPinBorderColor(pin), function (dataUrl, totalHeight) {
      state.viewer.entities.add({
        name: pin.name,
        position: groundPos,
        billboard: {
          image: dataUrl,
          width: PIN_CIRCLE_SIZE,
          height: totalHeight,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          sizeInMeters: false,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        },
        properties: props
      });
      if (onDone) onDone();
    });
    return;
  }

  const topPos = Cesium.Cartesian3.fromDegrees(pin.lon, pin.lat, groundH + PIN_POLE_HEIGHT_METERS);

  createPinCircleImageDataUrl(pin.name, getPinIconUrl(pin), getPinBorderColor(pin), function (dataUrl) {
    state.viewer.entities.add({
      name: pin.name,
      position: topPos,
      billboard: {
        image: dataUrl,
        width: PIN_CIRCLE_SIZE,
        height: PIN_CIRCLE_SIZE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        sizeInMeters: false,
        disableDepthTestDistance: 0
      },
      polyline: {
        positions: [groundPos, topPos],
        width: PIN_STEM_WIDTH,
        material: Cesium.Color.fromCssColorString(PIN_STEM_COLOR).withAlpha(PIN_STEM_ALPHA),
        arcType: Cesium.ArcType.NONE
      },
      properties: props
    });
    if (onDone) onDone();
  });
}

export function refreshPinsForMapMode() {
  if (!state.viewer || state.filteredPins.length === 0) return;
  renderPins(state.filteredPins);
}

export function renderPins(pinDataList, onComplete) {
  state.viewer.entities.removeAll();
  if (pinDataList.length === 0) {
    if (onComplete) onComplete();
    return;
  }

  resolveHeights(pinDataList).then(function (heights) {
    let remaining = pinDataList.length;
    for (let i = 0; i < pinDataList.length; i++) {
      addPhotoPin(pinDataList[i], heights[i], function () {
        remaining -= 1;
        if (remaining === 0) {
          state.viewer.scene.requestRender();
          if (onComplete) onComplete();
        }
      });
    }
  });
}

export function flyToPins() {
  if (state.viewer.entities.values.length === 0) return;
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
