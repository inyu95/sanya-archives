import {
  SHEET_ID,
  SHEET_MEMORY,
  SHEET_FETCH_TIMEOUT_MS,
  SHEET_FETCH_MAX_RETRIES,
  ASSETS_MEMORIES_BASE,
  MEMORY_DEFAULT_HEIGHT,
  MEMORY_DEFAULT_HEADING,
  MEMORY_DEFAULT_PITCH,
  getAppBasePath
} from "../config/constants.js";
import { state } from "../state.js";
import { parseGvizRows } from "../utils/gviz.js";

const MEMORY_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"];

function cellValue(cell) {
  if (!cell) return "";
  if (cell.v != null) return cell.v;
  return "";
}

function normalizeHeaderText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function parseNumber(value, fallback) {
  const n = parseFloat(String(value != null ? value : "").trim());
  return Number.isFinite(n) ? n : fallback;
}

function hasImageExtension(path) {
  return /\.(jpe?g|png|gif|webp|svg|bmp)$/i.test(String(path || "").trim());
}

function buildMemoryAssetUrl(relativePath) {
  const text = String(relativePath || "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;

  const normalized = text.replace(/^\.\//, "").replace(/^\/+/, "");
  const base = getAppBasePath();

  if (normalized.toLowerCase().startsWith("assets/")) {
    return base + normalized.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  }

  return ASSETS_MEMORIES_BASE + normalized.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

function memoryPhotoUrlCandidates(path) {
  const text = String(path || "").trim();
  if (!text) return [];
  if (/^https?:\/\//i.test(text)) return [text];
  if (hasImageExtension(text)) return [buildMemoryAssetUrl(text)];
  return MEMORY_IMAGE_EXTENSIONS.map(function (ext) {
    return buildMemoryAssetUrl(text + ext);
  });
}

function probeImageUrl(url) {
  return new Promise(function (resolve) {
    if (!url) {
      resolve("");
      return;
    }
    const img = new Image();
    img.onload = function () { resolve(url); };
    img.onerror = function () { resolve(""); };
    img.src = url;
  });
}

function resolveFirstExistingUrl(candidates) {
  function next(index) {
    if (index >= candidates.length) return Promise.resolve("");
    return probeImageUrl(candidates[index]).then(function (found) {
      if (found) return found;
      return next(index + 1);
    });
  }
  return next(0);
}

function resolveMemoryPhotoUrl(path) {
  const candidates = memoryPhotoUrlCandidates(path);
  return candidates[0] || "";
}

function resolveMemoryPhotoUrls(photos) {
  return Promise.all(photos.map(function (photo) {
    const candidates = memoryPhotoUrlCandidates(photo.photoPath);
    if (candidates.length <= 1) {
      photo.url = candidates[0] || "";
      return photo;
    }
    return resolveFirstExistingUrl(candidates).then(function (url) {
      photo.url = url || candidates[0] || "";
      return photo;
    });
  }));
}

function getMemoryColumnIndexes(rows) {
  // シート実カラム: A写真タイトル / B写真パス / C説明 / D撮影年代 / E提供者 / F経度 / G緯度 / H高さ / I heading / J pitch
  const defaults = {
    title: 0,
    photoPath: 1,
    caption: 2,
    year: 3,
    provider: 4,
    lon: 5,
    lat: 6,
    height: 7,
    heading: 8,
    pitch: 9
  };
  if (!rows || rows.length === 0) return defaults;

  const headerRow = rows[0].c || [];
  const headerMap = {};
  for (let i = 0; i < headerRow.length; i++) {
    const header = normalizeHeaderText(cellValue(headerRow[i]));
    if (!header) continue;

    if (
      header === "title"
      || header === "タイトル"
      || header === "写真タイトル"
      || header === "名称"
      || header === "name"
    ) {
      headerMap.title = i;
    } else if (
      header === "photopath" || header === "写真パス" || header === "写真"
      || header === "image" || header === "path" || header === "画像"
    ) {
      headerMap.photoPath = i;
    } else if (header === "caption" || header === "キャプション" || header === "説明") {
      headerMap.caption = i;
    } else if (
      header === "year"
      || header === "年代"
      || header === "年"
      || header === "撮影年代"
      || header === "撮影年"
    ) {
      headerMap.year = i;
    } else if (
      header === "provider"
      || header === "提供者"
      || header === "提供"
      || header === "提供元"
    ) {
      headerMap.provider = i;
    } else if (header === "lon" || header === "lng" || header === "経度" || header === "longitude") {
      headerMap.lon = i;
    } else if (header === "lat" || header === "緯度" || header === "latitude") {
      headerMap.lat = i;
    } else if (header === "height" || header === "高さ" || header === "高度") {
      headerMap.height = i;
    } else if (header === "heading" || header === "方位" || header === "方角") {
      headerMap.heading = i;
    } else if (header === "pitch" || header === "ピッチ" || header === "俯角") {
      headerMap.pitch = i;
    }
  }

  const indexes = {};
  Object.keys(defaults).forEach(function (key) {
    indexes[key] = Object.prototype.hasOwnProperty.call(headerMap, key)
      ? headerMap[key]
      : defaults[key];
  });
  return indexes;
}

function isMemoryHeaderRow(c, col) {
  const title = normalizeHeaderText(cellValue(c[col.title]));
  return title === "title"
    || title === "タイトル"
    || title === "写真タイトル"
    || title === "名称"
    || title === "name";
}

function parseMemoryRows(rows) {
  const list = [];
  const col = getMemoryColumnIndexes(rows);

  for (let index = 0; index < rows.length; index++) {
    const c = rows[index].c || [];
    if (isMemoryHeaderRow(c, col)) continue;

    const title = String(cellValue(c[col.title]) || "").trim();
    const photoPath = String(cellValue(c[col.photoPath]) || "").trim();
    const lon = parseNumber(cellValue(c[col.lon]), NaN);
    const lat = parseNumber(cellValue(c[col.lat]), NaN);

    if (!photoPath || !Number.isFinite(lon) || !Number.isFinite(lat)) {
      if (title || photoPath) {
        console.warn("過去写真の行をスキップ（写真パスまたは座標が無効）:", title || photoPath);
      }
      continue;
    }

    const caption = col.caption >= 0
      ? String(cellValue(c[col.caption]) || "").trim()
      : "";
    const year = col.year >= 0
      ? String(cellValue(c[col.year]) || "").trim()
      : "";
    const provider = col.provider >= 0
      ? String(cellValue(c[col.provider]) || "").trim()
      : "";
    const url = resolveMemoryPhotoUrl(photoPath);

    list.push({
      id: "memory-" + index,
      title: title || caption || "記憶写真" + (list.length + 1),
      photoPath: photoPath,
      url: url,
      lon: lon,
      lat: lat,
      height: parseNumber(cellValue(c[col.height]), MEMORY_DEFAULT_HEIGHT),
      heading: parseNumber(cellValue(c[col.heading]), MEMORY_DEFAULT_HEADING),
      pitch: parseNumber(cellValue(c[col.pitch]), MEMORY_DEFAULT_PITCH),
      year: year,
      provider: provider,
      caption: caption
    });
  }

  return list;
}

function fetchMemorySheet(retryCount) {
  const attempt = retryCount || 0;
  const url = "https://docs.google.com/spreadsheets/d/" + SHEET_ID
    + "/gviz/tq?tqx=out:json&sheet=" + encodeURIComponent(SHEET_MEMORY);
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, SHEET_FETCH_TIMEOUT_MS);

  return fetch(url, { signal: controller.signal })
    .then(function (res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error("SHEET_HTTP_" + res.status);
      return res.text();
    })
    .then(function (text) {
      return parseGvizRows(text);
    })
    .catch(function (err) {
      clearTimeout(timer);
      const canRetry = attempt < SHEET_FETCH_MAX_RETRIES
        && (
          err.name === "AbortError"
          || (err.message && err.message.indexOf("SHEET_HTTP_") === 0)
          || err instanceof SyntaxError
        );
      if (canRetry) {
        return fetchMemorySheet(attempt + 1);
      }
      throw err;
    });
}

export function loadMemoryData() {
  return fetchMemorySheet()
    .then(function (rows) {
      return resolveMemoryPhotoUrls(parseMemoryRows(rows));
    })
    .then(function (photos) {
      state.allMemoryPhotos = photos;
      state.filteredMemoryPhotos = photos.slice();
      state.memoryDataLoaded = true;
      return photos;
    })
    .catch(function (err) {
      console.warn("過去写真の読み込みに失敗:", err);
      state.allMemoryPhotos = [];
      state.filteredMemoryPhotos = [];
      state.memoryDataLoaded = true;
      return [];
    });
}
