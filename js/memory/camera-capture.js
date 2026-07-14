import { state } from "../state.js";
import { setStatus } from "../ui/status.js";

function formatNumber(value, digits) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return n.toFixed(digits);
}

export function getCameraViewSpreadsheetRow() {
  if (!state.viewer) return null;
  const camera = state.viewer.camera;
  const carto = Cesium.Cartographic.fromCartesian(camera.position);
  return {
    lon: Cesium.Math.toDegrees(carto.longitude),
    lat: Cesium.Math.toDegrees(carto.latitude),
    height: carto.height,
    heading: Cesium.Math.toDegrees(camera.heading),
    pitch: Cesium.Math.toDegrees(camera.pitch)
  };
}

export function formatCameraViewForSheet(view) {
  if (!view) return "";
  return [
    formatNumber(view.lon, 6),
    formatNumber(view.lat, 6),
    formatNumber(view.height, 1),
    formatNumber(view.heading, 1),
    formatNumber(view.pitch, 1)
  ].join("\t");
}

export function copyCameraViewToClipboard() {
  const view = getCameraViewSpreadsheetRow();
  if (!view) {
    setStatus("地図がまだ準備できていません。", "error");
    return Promise.resolve(false);
  }

  const text = formatCameraViewForSheet(view);
  const write = navigator.clipboard && navigator.clipboard.writeText
    ? navigator.clipboard.writeText(text)
    : Promise.reject(new Error("clipboard unsupported"));

  return write
    .then(function () {
      setStatus("視点をコピーしました（経度・緯度・高さ・heading・pitch）", "ok");
      return true;
    })
    .catch(function () {
      window.prompt("視点パラメータをコピーしてください:", text);
      setStatus("視点パラメータを表示しました", "ok");
      return true;
    });
}

export function isAuthorMode() {
  try {
    return new URLSearchParams(window.location.search).get("author") === "1";
  } catch (err) {
    return false;
  }
}

export function setupCameraCapture() {
  const btn = document.getElementById("camera-capture-btn");
  if (!isAuthorMode()) {
    if (btn) btn.classList.add("hidden");
    return;
  }

  if (btn) {
    btn.classList.remove("hidden");
    btn.addEventListener("click", function () {
      copyCameraViewToClipboard();
    });
  }

  document.addEventListener("keydown", function (event) {
    if (!(event.ctrlKey && event.shiftKey && (event.key === "C" || event.key === "c"))) return;
    event.preventDefault();
    copyCameraViewToClipboard();
  });
}
