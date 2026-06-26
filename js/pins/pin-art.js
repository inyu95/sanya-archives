import { PIN_CIRCLE_SIZE } from "../config/constants.js";

const DEFAULT_PIN_BORDER_COLOR = "rgba(255,255,255,0.95)";
const PIN_BORDER_WIDTH = 1;

export function drawPinCircle(ctx, size, drawCircleContent, borderColor) {
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size / 2 - 1;
  const innerR = outerR - PIN_BORDER_WIDTH;
  const ringColor = borderColor || DEFAULT_PIN_BORDER_COLOR;

  ctx.clearRect(0, 0, size, size);

  ctx.beginPath();
  ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
  ctx.fillStyle = ringColor;
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
  ctx.clip();
  drawCircleContent(ctx, cx, cy, innerR);
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
  ctx.strokeStyle = ringColor;
  ctx.lineWidth = PIN_BORDER_WIDTH;
  ctx.stroke();
}

export function createPinCircleImageDataUrl(name, imageUrl, borderColor, callback) {
  const canvas = document.createElement("canvas");
  canvas.width = PIN_CIRCLE_SIZE;
  canvas.height = PIN_CIRCLE_SIZE;
  const ctx = canvas.getContext("2d");
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  const contentSize = (PIN_CIRCLE_SIZE / 2 - 1 - PIN_BORDER_WIDTH) * 2;

  function finish() {
    callback(canvas.toDataURL("image/png"));
  }

  function drawInitial(c, cx, cy) {
    c.fillStyle = "#888888";
    c.fillRect(cx - PIN_CIRCLE_SIZE / 2, cy - PIN_CIRCLE_SIZE / 2, PIN_CIRCLE_SIZE, PIN_CIRCLE_SIZE);
    c.fillStyle = "#ffffff";
    c.font = "bold " + Math.round(PIN_CIRCLE_SIZE * 0.42) + "px sans-serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(initial, cx, cy + 2);
  }

  if (!imageUrl) {
    drawPinCircle(ctx, PIN_CIRCLE_SIZE, drawInitial, borderColor);
    finish();
    return;
  }

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = function () {
    drawPinCircle(ctx, PIN_CIRCLE_SIZE, function (c, cx, cy) {
      const min = Math.min(img.width, img.height);
      const sx = (img.width - min) / 2;
      const sy = (img.height - min) / 2;
      c.drawImage(
        img, sx, sy, min, min,
        cx - contentSize / 2, cy - contentSize / 2, contentSize, contentSize
      );
    }, borderColor);
    finish();
  };
  img.onerror = function () {
    drawPinCircle(ctx, PIN_CIRCLE_SIZE, drawInitial, borderColor);
    finish();
  };
  img.src = imageUrl;
}
