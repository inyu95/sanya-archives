import {
  PIN_CIRCLE_SIZE,
  PIN_POLE_HEIGHT_METERS,
  PIN_STEM_WIDTH,
  PIN_STEM_COLOR,
  PIN_STEM_ALPHA,
  INITIAL_PIN_VIEW_RANGE
} from "../config/constants.js";
import { state } from "../state.js";
import { createPinCircleImageDataUrl } from "./pin-art.js";
import { resolveHeights } from "./pin-heights.js";

function getPinBorderColor(pin) {
  const activities = pin.activity || [];
  for (let i = 0; i < activities.length; i++) {
    const color = state.activityColors[activities[i]];
    if (color) return color;
  }
  return "";
}

function addPhotoPin(pin, groundH, onDone) {
  const props = {
    image: pin.image || "",
    images: pin.images || [],
    text: pin.text || "",
    pointcloudAssetId: pin.pointcloud,
    url: pin.url || "",
    category: pin.category || "",
    year: pin.year || "",
    activity: pin.activity || [],
    lon: pin.lon,
    lat: pin.lat
  };

  const groundPos = Cesium.Cartesian3.fromDegrees(pin.lon, pin.lat, groundH);
  const topPos = Cesium.Cartesian3.fromDegrees(pin.lon, pin.lat, groundH + PIN_POLE_HEIGHT_METERS);

  createPinCircleImageDataUrl(pin.name, pin.image, getPinBorderColor(pin), function (dataUrl) {
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
  state.viewer.flyTo(state.viewer.entities, {
    duration: 2,
    offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-55), INITIAL_PIN_VIEW_RANGE)
  });
}

export function flyToPin(entity) {
  if (!entity) return;
  state.viewer.flyTo(entity, {
    duration: 1.5,
    offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-50), 120)
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
