import {
  PIN_CIRCLE_SIZE,
  PIN_STACK_OFFSET,
  PIN_STEM_PIXEL_HEIGHT,
  PIN_STEM_COLOR,
  PIN_STEM_ALPHA
} from "../config/constants.js";

const DEFAULT_PIN_BORDER_COLOR = "rgba(255,255,255,0.95)";
const PIN_BORDER_WIDTH = 1;

function getStackedHeight(layerCount) {
  if (layerCount <= 1) return PIN_CIRCLE_SIZE;
  return PIN_CIRCLE_SIZE + (layerCount - 1) * PIN_STACK_OFFSET;
}

function drawPinCircleAt(ctx, cx, cy, size, drawCircleContent, ringColor) {
  const outerR = size / 2 - 1;
  const innerR = outerR - PIN_BORDER_WIDTH;
  const fillColor = ringColor || DEFAULT_PIN_BORDER_COLOR;

  ctx.beginPath();
  ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
  ctx.fillStyle = fillColor;
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
  ctx.clip();
  drawCircleContent(ctx, cx, cy, innerR);
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
  ctx.strokeStyle = DEFAULT_PIN_BORDER_COLOR;
  ctx.lineWidth = PIN_BORDER_WIDTH;
  ctx.stroke();
}

function drawInitialContent(c, cx, cy, size, text) {
  const initial = (text || "?").trim().charAt(0).toUpperCase();
  c.fillStyle = "#888888";
  c.fillRect(cx - size / 2, cy - size / 2, size, size);
  c.fillStyle = "#ffffff";
  c.font = "bold " + Math.round(size * 0.42) + "px sans-serif";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(initial, cx, cy + 2);
}

function drawImageContent(c, cx, cy, size, img) {
  const contentSize = (size / 2 - 1 - PIN_BORDER_WIDTH) * 2;
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

function drawStackedLayers(ctx, canvasW, stackHeight, name, normalized, images) {
  const cx = canvasW / 2;
  const count = normalized.length;

  for (let i = 0; i < count; i++) {
    const layer = normalized[i];
    const cy = stackHeight - PIN_CIRCLE_SIZE / 2 - i * PIN_STACK_OFFSET;
    const fallbackLabel = layer.label || name;

    drawPinCircleAt(ctx, cx, cy, PIN_CIRCLE_SIZE, function (c, drawCx, drawCy) {
      const img = images[i];
      if (img) {
        drawImageContent(c, drawCx, drawCy, PIN_CIRCLE_SIZE, img);
      } else {
        drawInitialContent(c, drawCx, drawCy, PIN_CIRCLE_SIZE, fallbackLabel);
      }
    }, layer.borderColor);
  }
}

export function createPinCircleImageDataUrl(name, layers, callback) {
  loadLayerImages(layers, function (normalized, images) {
    const stackHeight = getStackedHeight(normalized.length);
    const canvas = document.createElement("canvas");
    canvas.width = PIN_CIRCLE_SIZE;
    canvas.height = stackHeight;
    const ctx = canvas.getContext("2d");

    drawStackedLayers(ctx, PIN_CIRCLE_SIZE, stackHeight, name, normalized, images);
    callback(canvas.toDataURL("image/png"), stackHeight);
  });
}

/** 2D モード用: 円アイコン（積み上げ可）+ 下方向の棒を 1 枚の画像にまとめる */
export function createPinWithStemImageDataUrl(name, layers, callback) {
  loadLayerImages(layers, function (normalized, images) {
    const stackHeight = getStackedHeight(normalized.length);
    const stemH = PIN_STEM_PIXEL_HEIGHT;
    const totalH = stackHeight + stemH;
    const canvas = document.createElement("canvas");
    canvas.width = PIN_CIRCLE_SIZE;
    canvas.height = totalH;
    const ctx = canvas.getContext("2d");
    const cx = PIN_CIRCLE_SIZE / 2;

    ctx.strokeStyle = PIN_STEM_COLOR;
    ctx.globalAlpha = PIN_STEM_ALPHA;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, stackHeight);
    ctx.lineTo(cx, totalH);
    ctx.stroke();
    ctx.globalAlpha = 1;

    drawStackedLayers(ctx, PIN_CIRCLE_SIZE, stackHeight, name, normalized, images);
    callback(canvas.toDataURL("image/png"), totalH);
  });
}
