import {
  MEMORY_THUMB_SIZE,
  INITIAL_MEMORY_VIEW_RANGE,
  PIN_POLE_HEIGHT_METERS,
  PIN_STEM_WIDTH,
  PIN_STEM_COLOR,
  PIN_STEM_ALPHA,
  PIN_STEM_PIXEL_HEIGHT,
  PIN_RENDER_SCALE
} from "../config/constants.js";
import { state } from "../state.js";
import {
  openMemoryPhotoLightbox,
  closePhotoLightboxIfOpen
} from "../info-panel.js";
import { resolveHeights } from "../pins/pin-heights.js";
import { flyToSanyaDistrict } from "../pins/pins.js";
import { dom } from "../config/dom.js";

const MEMORY_WHITE_BORDER_WIDTH = 3;
const MEMORY_BORDER_COLOR = "rgba(255,255,255,0.95)";

/** 非同期の画像生成が重なったとき、古い renderMemoryPins 結果を捨てる */
let memoryRenderGeneration = 0;
/** 写真クリックによる飛行が重なったとき、古い complete を無視する */
let memoryPhotoFlightGeneration = 0;
/** 飛行完了後のライトボックス遅延表示をキャンセルする用 */
let memoryLightboxDelayTimer = 0;

const framedPhotoCache = new Map();

function ensureMemoryDataSource() {
  if (!state.viewer) return null;
  if (state.memoryDataSource) return state.memoryDataSource;

  const dataSource = new Cesium.CustomDataSource("memory");
  state.viewer.dataSources.add(dataSource);
  state.memoryDataSource = dataSource;
  return dataSource;
}

function clearMemoryEntities() {
  const dataSource = state.memoryDataSource;
  if (!dataSource) return;
  dataSource.entities.removeAll();
}

export function setMemoryPinsVisible(visible) {
  const dataSource = ensureMemoryDataSource();
  if (!dataSource) return;
  dataSource.show = Boolean(visible);
  if (state.viewer) state.viewer.scene.requestRender();
}

function createHiDpiCanvas(logicalW, logicalH) {
  const scale = PIN_RENDER_SCALE;
  const canvas = document.createElement("canvas");
  canvas.width = logicalW * scale;
  canvas.height = logicalH * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return { canvas: canvas, ctx: ctx };
}

function drawFramedPhoto(ctx, img, size) {
  const borderW = MEMORY_WHITE_BORDER_WIDTH;
  const inset = borderW;
  const contentSize = size - inset * 2;

  ctx.fillStyle = MEMORY_BORDER_COLOR;
  ctx.fillRect(0, 0, size, size);

  const min = Math.min(img.width, img.height);
  const sx = (img.width - min) / 2;
  const sy = (img.height - min) / 2;
  ctx.drawImage(
    img, sx, sy, min, min,
    inset, inset, contentSize, contentSize
  );

  ctx.strokeStyle = MEMORY_BORDER_COLOR;
  ctx.lineWidth = borderW;
  ctx.strokeRect(borderW / 2, borderW / 2, size - borderW, size - borderW);
}

function createFramedPhotoDataUrl(imageUrl, withStem, callback) {
  const cacheKey = imageUrl + (withStem ? "::stem" + PIN_STEM_PIXEL_HEIGHT : "");
  const cached = framedPhotoCache.get(cacheKey);
  if (cached) {
    callback(cached.dataUrl, cached.width, cached.height);
    return;
  }

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = function () {
    const size = MEMORY_THUMB_SIZE;
    const stemH = withStem ? PIN_STEM_PIXEL_HEIGHT : 0;
    const totalH = size + stemH;
    const surface = createHiDpiCanvas(size, totalH);
    const ctx = surface.ctx;
    const cx = size / 2;

    if (withStem) {
      ctx.strokeStyle = PIN_STEM_COLOR;
      ctx.globalAlpha = PIN_STEM_ALPHA;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, size);
      ctx.lineTo(cx, totalH);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    drawFramedPhoto(ctx, img, size);

    const result = {
      dataUrl: surface.canvas.toDataURL("image/png"),
      width: size,
      height: totalH
    };
    framedPhotoCache.set(cacheKey, result);
    callback(result.dataUrl, result.width, result.height);
  };
  img.onerror = function () {
    callback("", MEMORY_THUMB_SIZE, MEMORY_THUMB_SIZE);
  };
  img.src = imageUrl;
}

function buildMemoryProps(photo) {
  return {
    memoryPhoto: true,
    title: photo.title,
    url: photo.url,
    caption: photo.caption || "",
    year: photo.year || "",
    lon: photo.lon,
    lat: photo.lat,
    height: photo.height,
    heading: photo.heading,
    pitch: photo.pitch
  };
}

function addMemoryScreenFlatPin(dataSource, photo, props, onDone, generation) {
  const surfacePos = Cesium.Cartesian3.fromDegrees(photo.lon, photo.lat);
  createFramedPhotoDataUrl(photo.url, true, function (dataUrl, width, height) {
    if (generation !== memoryRenderGeneration) {
      if (onDone) onDone();
      return;
    }
    if (!dataUrl) {
      if (onDone) onDone();
      return;
    }
    dataSource.entities.add({
      id: photo.id,
      name: photo.title,
      position: surfacePos,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      billboard: {
        image: dataUrl,
        width: width,
        height: height,
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

function addMemoryPolePin(dataSource, photo, groundH, props, onDone, generation) {
  const groundPos = Cesium.Cartesian3.fromDegrees(photo.lon, photo.lat, groundH);
  const topPos = Cesium.Cartesian3.fromDegrees(
    photo.lon,
    photo.lat,
    groundH + PIN_POLE_HEIGHT_METERS
  );

  createFramedPhotoDataUrl(photo.url, false, function (dataUrl, width, height) {
    if (generation !== memoryRenderGeneration) {
      if (onDone) onDone();
      return;
    }
    if (!dataUrl) {
      if (onDone) onDone();
      return;
    }
    dataSource.entities.add({
      id: photo.id,
      name: photo.title,
      position: topPos,
      billboard: {
        image: dataUrl,
        width: width,
        height: height,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        sizeInMeters: false,
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

export function renderMemoryPins(photos, opts) {
  const options = opts || {};
  const dataSource = ensureMemoryDataSource();
  if (!dataSource || !state.viewer) {
    if (typeof options.onComplete === "function") options.onComplete();
    return;
  }

  const generation = ++memoryRenderGeneration;
  clearMemoryEntities();

  const list = (photos || []).filter(function (photo) {
    return photo && photo.url;
  });
  if (list.length === 0) {
    state.viewer.scene.requestRender();
    if (typeof options.onComplete === "function") options.onComplete();
    return;
  }

  const scene2D = state.viewer.scene.mode === Cesium.SceneMode.SCENE2D;
  const historicalFlat = state.historicalMapActive;
  const flatHeights = scene2D || historicalFlat;

  function placePins(heights) {
    if (generation !== memoryRenderGeneration) return;
    let remaining = list.length;
    for (let i = 0; i < list.length; i++) {
      const photo = list[i];
      const props = buildMemoryProps(photo);
      const done = function () {
        if (generation !== memoryRenderGeneration) return;
        remaining -= 1;
        if (remaining === 0) {
          state.viewer.scene.requestRender();
          if (typeof options.onComplete === "function") options.onComplete();
        }
      };

      if (scene2D) {
        addMemoryScreenFlatPin(dataSource, photo, props, done, generation);
      } else {
        addMemoryPolePin(dataSource, photo, heights[i], props, done, generation);
      }
    }
  }

  resolveHeights(list, flatHeights).then(placePins).catch(function (err) {
    console.error("記憶ピンの高さ取得に失敗:", err);
    placePins(list.map(function () { return 0; }));
  });
}

function saveReturnCameraView() {
  if (!state.viewer) return;
  const camera = state.viewer.camera;
  state.savedCameraView = {
    position: camera.position.clone(),
    heading: camera.heading,
    pitch: camera.pitch,
    roll: camera.roll
  };
}

export function flyToMemoryPhoto(photoOrEntity, opts) {
  if (!state.viewer) return;

  const options = opts || {};
  let lon;
  let lat;
  let height;
  let headingDeg;
  let pitchDeg;

  if (photoOrEntity && photoOrEntity.properties) {
    const props = photoOrEntity.properties;
    lon = props.lon.getValue();
    lat = props.lat.getValue();
    height = props.height.getValue();
    headingDeg = props.heading.getValue();
    pitchDeg = props.pitch.getValue();
  } else if (photoOrEntity) {
    lon = photoOrEntity.lon;
    lat = photoOrEntity.lat;
    height = photoOrEntity.height;
    headingDeg = photoOrEntity.heading;
    pitchDeg = photoOrEntity.pitch;
  } else {
    return;
  }

  const flightId = ++memoryPhotoFlightGeneration;
  if (memoryLightboxDelayTimer) {
    window.clearTimeout(memoryLightboxDelayTimer);
    memoryLightboxDelayTimer = 0;
  }
  const controller = state.viewer.scene.screenSpaceCameraController;
  const previousCollision = controller.enableCollisionDetection;
  state.viewer.camera.cancelFlight();
  controller.enableCollisionDetection = false;

  state.viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
    orientation: {
      heading: Cesium.Math.toRadians(headingDeg),
      pitch: Cesium.Math.toRadians(pitchDeg),
      roll: 0
    },
    duration: options.duration != null ? options.duration : 1.5,
    complete: function () {
      controller.enableCollisionDetection = previousCollision;
      if (flightId !== memoryPhotoFlightGeneration) return;
      if (typeof options.complete === "function") options.complete();
    },
    cancel: function () {
      controller.enableCollisionDetection = previousCollision;
      if (flightId !== memoryPhotoFlightGeneration) return;
      if (typeof options.cancel === "function") options.cancel();
    }
  });
}

export function flyToMemoryPhotos() {
  const dataSource = ensureMemoryDataSource();
  if (!dataSource || dataSource.entities.values.length === 0 || !state.viewer) {
    flyToSanyaDistrict();
    return;
  }

  const controller = state.viewer.scene.screenSpaceCameraController;
  const previousCollision = controller.enableCollisionDetection;
  state.viewer.camera.cancelFlight();
  controller.enableCollisionDetection = false;

  state.viewer.flyTo(dataSource.entities, {
    duration: 2,
    offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-55), INITIAL_MEMORY_VIEW_RANGE),
    complete: function () {
      controller.enableCollisionDetection = previousCollision;
    },
    cancel: function () {
      controller.enableCollisionDetection = previousCollision;
    }
  });
}

export function isMemoryEntity(entity) {
  if (!entity || !entity.properties) return false;
  const flag = entity.properties.memoryPhoto;
  return flag ? Boolean(flag.getValue()) : false;
}

/** 記憶写真をアングルへ移動してからライトボックス表示 */
export function openMemoryPhoto(photoOrEntity) {
  if (!photoOrEntity) return false;

  let title;
  let url;
  let caption;
  let year;
  let flyTarget = photoOrEntity;

  if (photoOrEntity.properties) {
    if (!isMemoryEntity(photoOrEntity)) return false;
    const props = photoOrEntity.properties;
    title = props.title ? props.title.getValue() : (photoOrEntity.name || "写真");
    url = props.url ? props.url.getValue() : "";
    caption = props.caption ? props.caption.getValue() : "";
    year = props.year ? props.year.getValue() : "";
  } else {
    title = photoOrEntity.title || "写真";
    url = photoOrEntity.url || "";
    caption = photoOrEntity.caption || "";
    year = photoOrEntity.year || "";
  }

  const lightboxOpen = Boolean(dom.photoModal && !dom.photoModal.classList.contains("hidden"));
  if (!lightboxOpen) {
    saveReturnCameraView();
  } else {
    closePhotoLightboxIfOpen({ restoreCamera: false });
  }

  flyToMemoryPhoto(flyTarget, {
    complete: function () {
      if (!url || state.appMode !== "memory") return;
      // カメラ定着のあと少し間を置いてからふわっと出す
      if (memoryLightboxDelayTimer) {
        window.clearTimeout(memoryLightboxDelayTimer);
      }
      memoryLightboxDelayTimer = window.setTimeout(function () {
        memoryLightboxDelayTimer = 0;
        if (!url || state.appMode !== "memory") return;
        openMemoryPhotoLightbox(
          { url: url, title: caption },
          title,
          {
            restoreCameraOnClose: true,
            fadeIn: true,
            caption: caption,
            year: year
          }
        );
      }, 220);
    }
  });
  return true;
}

export function handleMemoryEntityClick(entity) {
  return openMemoryPhoto(entity);
}

export function filterMemoryPhotosByQuery(query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) {
    state.filteredMemoryPhotos = state.allMemoryPhotos.slice();
  } else {
    state.filteredMemoryPhotos = state.allMemoryPhotos.filter(function (photo) {
      return [photo.title, photo.caption, photo.year, photo.photoPath]
        .join(" ")
        .toLowerCase()
        .indexOf(q) !== -1;
    });
  }

  if (state.appMode === "memory") {
    renderMemoryPins(state.filteredMemoryPhotos);
  }

  return state.filteredMemoryPhotos;
}
