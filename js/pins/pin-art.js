import {
  PIN_CIRCLE_SIZE,
  PIN_RENDER_SCALE,
  PIN_DANGO_SPACING,
  PIN_STEM_PIXEL_HEIGHT,
  PIN_STEM_COLOR,
  PIN_STEM_ALPHA
} from "../config/constants.js";

const DEFAULT_PIN_BORDER_COLOR = "rgba(255,255,255,0.95)";
const PIN_WHITE_BORDER_WIDTH = 2;
/** 白縁の内側とアイコンとの余白（px） */
const PIN_ICON_PADDING = 8;
const PIN_NO_COLOR_FILL = "#9a9a9a";

function getDangoHeight(layerCount) {
  if (layerCount <= 1) return PIN_CIRCLE_SIZE;
  return PIN_CIRCLE_SIZE + (layerCount - 1) * PIN_DANGO_SPACING;
}

function getDangoPositions(layerCount, clusterHeight) {
  const positions = [];
  const cx = PIN_CIRCLE_SIZE / 2;
  for (let i = 0; i < layerCount; i++) {
    positions.push({
      x: cx,
      y: clusterHeight - PIN_CIRCLE_SIZE / 2 - i * PIN_DANGO_SPACING
    });
  }
  return positions;
}

function drawPinCircleAt(ctx, cx, cy, size, drawCircleContent, fillColor) {
  const outerR = size / 2 - 1;
  const borderW = PIN_WHITE_BORDER_WIDTH;
  // stroke はパス中心に描かれるため、塗りは内縁（outerR - borderW/2）まで伸ばす
  const fillR = outerR - borderW / 2;
  const contentR = fillR - PIN_ICON_PADDING;
  const color = fillColor || PIN_NO_COLOR_FILL;

  ctx.beginPath();
  ctx.arc(cx, cy, fillR, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, fillR, 0, Math.PI * 2);
  ctx.clip();
  drawCircleContent(ctx, cx, cy, contentR);
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
  ctx.strokeStyle = DEFAULT_PIN_BORDER_COLOR;
  ctx.lineWidth = borderW;
  ctx.stroke();
}

function drawInitialContent(c, cx, cy, innerR, text) {
  const initial = (text || "?").trim().charAt(0).toUpperCase();
  const size = innerR * 2;
  c.fillStyle = "#888888";
  c.fillRect(cx - innerR, cy - innerR, size, size);
  c.fillStyle = "#ffffff";
  c.font = "bold " + Math.round(size * 0.42) + "px sans-serif";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(initial, cx, cy + 2);
}

function drawImageContent(c, cx, cy, innerR, img) {
  const contentSize = innerR * 2;
  const min = Math.min(img.width, img.height);
  const sx = (img.width - min) / 2;
  const sy = (img.height - min) / 2;
  c.drawImage(
    img, sx, sy, min, min,
    cx - contentSize / 2, cy - contentSize / 2, contentSize, contentSize
  );
}

function normalizeLayers(layers) {
  if (!layers || layers.length === 0) {
    return [{ imageUrl: "", borderColor: "", label: "" }];
  }
  return layers;
}

function loadLayerImages(layers, callback) {
  const normalized = normalizeLayers(layers);
  const results = new Array(normalized.length);
  let remaining = normalized.length;

  normalized.forEach(function (layer, index) {
    const url = layer.imageUrl || "";
    if (!url) {
      results[index] = null;
      remaining -= 1;
      if (remaining === 0) callback(normalized, results);
      return;
    }

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = function () {
      results[index] = img;
      remaining -= 1;
      if (remaining === 0) callback(normalized, results);
    };
    img.onerror = function () {
      results[index] = null;
      remaining -= 1;
      if (remaining === 0) callback(normalized, results);
    };
    img.src = url;
  });
}

function drawDangoLayers(ctx, clusterHeight, name, normalized, images) {
  const positions = getDangoPositions(normalized.length, clusterHeight);

  for (let i = 0; i < normalized.length; i++) {
    const layer = normalized[i];
    const pos = positions[i];
    const fallbackLabel = layer.label || name;

    drawPinCircleAt(ctx, pos.x, pos.y, PIN_CIRCLE_SIZE, function (c, drawCx, drawCy, innerR) {
      const img = images[i];
      if (img) {
        drawImageContent(c, drawCx, drawCy, innerR, img);
      } else {
        drawInitialContent(c, drawCx, drawCy, innerR, fallbackLabel);
      }
    }, layer.borderColor);
  }
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

export function createPinCircleImageDataUrl(name, layers, callback) {
  loadLayerImages(layers, function (normalized, images) {
    const clusterHeight = getDangoHeight(normalized.length);
    const surface = createHiDpiCanvas(PIN_CIRCLE_SIZE, clusterHeight);

    drawDangoLayers(surface.ctx, clusterHeight, name, normalized, images);
    callback(surface.canvas.toDataURL("image/png"), clusterHeight);
  });
}

/** 2D モード用: 団子アイコン + 下方向の棒を 1 枚の画像にまとめる */
export function createPinWithStemImageDataUrl(name, layers, callback) {
  loadLayerImages(layers, function (normalized, images) {
    const clusterHeight = getDangoHeight(normalized.length);
    const stemH = PIN_STEM_PIXEL_HEIGHT;
    const totalH = clusterHeight + stemH;
    const surface = createHiDpiCanvas(PIN_CIRCLE_SIZE, totalH);
    const ctx = surface.ctx;
    const cx = PIN_CIRCLE_SIZE / 2;

    ctx.strokeStyle = PIN_STEM_COLOR;
    ctx.globalAlpha = PIN_STEM_ALPHA;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, clusterHeight);
    ctx.lineTo(cx, totalH);
    ctx.stroke();
    ctx.globalAlpha = 1;

    drawDangoLayers(ctx, clusterHeight, name, normalized, images);
    callback(surface.canvas.toDataURL("image/png"), totalH);
  });
}
