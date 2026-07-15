import {
  SHEET_ID,
  SHEET_MAPPING,
  SHEET_CATEGORIES,
  SHEET_ROLES,
  SHEET_FETCH_TIMEOUT_MS,
  SHEET_FETCH_MAX_RETRIES,
  GOOGLE_SHEETS_API_KEY,
  ASSETS_PHOTOS_BASE,
  getAppBasePath
} from "../config/constants.js";
import { isYouTubeUrl } from "../utils/youtube.js";
import { parseCommaList } from "../utils/parse.js";
import { loadPinData } from "../filters/filters.js?v=99";
import { loadMemoryData } from "../memory/memory-data.js";
import { refreshMemoryModeIfActive } from "../modes/mode-switcher.js";
import { parseGvizRows } from "../utils/gviz.js";
import { state } from "../state.js";
import { setStatus } from "../ui/status.js";

function cellValue(cell) {
  if (!cell) return "";
  if (cell.v != null) return cell.v;
  return "";
}

function parseLatLonCell(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const parts = raw.split(/[,\s]+/).filter(Boolean).map(parseFloat);
  if (parts.length < 2 || parts.some(isNaN)) return null;

  const a = parts[0];
  const b = parts[1];
  const inJapanLon = function (v) { return v >= 120 && v <= 155; };
  const inJapanLat = function (v) { return v >= 20 && v <= 50; };

  if (inJapanLat(a) && inJapanLon(b)) return { lat: a, lon: b };
  if (inJapanLon(a) && inJapanLat(b)) return { lon: a, lat: b };
  return { lat: a, lon: b };
}

function isHeaderRow(c) {
  const colA = String(cellValue(c[0]) || "").toLowerCase();
  const colB = String(cellValue(c[1]) || "").toLowerCase();
  return colA === "name" && (colB.indexOf("lat") !== -1 || colB.indexOf("lon") !== -1);
}

function normalizeHeaderText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function resolveColumnIndex(headerMap, key, fallback) {
  return Object.prototype.hasOwnProperty.call(headerMap, key) ? headerMap[key] : fallback;
}

function getColumnIndexes(rows) {
  const defaults = {
    name: 0,
    coords: 1,
    imageFolder: 2,
    text: 3,
    pointcloud: 4,
    url: 5,
    urlLabel: 6,
    openingYear: 7,
    closingYear: 8,
    category: 9,
    role: 10
  };
  if (!rows || rows.length === 0) return defaults;

  const headerRow = rows[0].c || [];
  const headerMap = {};
  for (let i = 0; i < headerRow.length; i++) {
    const header = normalizeHeaderText(cellValue(headerRow[i]));
    if (!header) continue;

    if (header === "name" || header === "名称" || header === "スポット名") headerMap.name = i;
    else if (header.indexOf("lat") !== -1 || header.indexOf("lon") !== -1 || header === "座標" || header === "緯度経度") headerMap.coords = i;
    else if (header === "imagefolder" || header === "image" || header === "写真フォルダ") headerMap.imageFolder = i;
    else if (header === "text" || header === "説明") headerMap.text = i;
    else if (header.indexOf("pointcloud") !== -1) headerMap.pointcloud = i;
    else if (header === "url") headerMap.url = i;
    else if (header === "url表示名") headerMap.urlLabel = i;
    else if (header === "開業年") headerMap.openingYear = i;
    else if (header === "閉業年") headerMap.closingYear = i;
    else if (header === "category" || header === "カテゴリ") headerMap.category = i;
    else if (header === "role" || header === "役割" || header === "生活行為" || header === "activity" || header === "アクティビティ") headerMap.role = i;
  }

  const indexes = {};
  Object.keys(defaults).forEach(function (key) {
    indexes[key] = resolveColumnIndex(headerMap, key, defaults[key]);
  });
  return indexes;
}

function resolveImageUrl(path) {
  if (!path) return "";
  const text = String(path).trim();
  if (/^https?:\/\//i.test(text)) return text;

  const normalized = text.replace(/^\.\//, "").replace(/^\/+/, "");
  const base = getAppBasePath();

  if (normalized.toLowerCase().startsWith("assets/")) {
    return base + normalized.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  }

  if (isDirectImagePath(normalized) && normalized.indexOf("/") === -1) {
    return ASSETS_PHOTOS_BASE + encodeURIComponent(normalized);
  }

  return base + normalized.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

function isDirectImagePath(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/^https?:\/\//i.test(text)) return true;
  return /\.(jpe?g|png|gif|webp|svg|bmp)$/i.test(text);
}

function normalizePathSeparators(value) {
  return String(value || "").trim().replace(/\\/g, "/");
}

function extractFolderFromImagePath(value) {
  const text = normalizePathSeparators(value)
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
  const lastSlash = text.lastIndexOf("/");
  if (lastSlash === -1) return "";
  return text.slice(0, lastSlash);
}

function photoFileNameFromUrl(url) {
  const part = String(url || "").split("/").pop() || "";
  try {
    return decodeURIComponent(part);
  } catch (_err) {
    return part;
  }
}

function reorderPhotosWithPreferred(photos, preferredUrl, preferredFileName) {
  if (!photos.length || (!preferredUrl && !preferredFileName)) return photos;

  const index = photos.findIndex(function (photo) {
    if (preferredUrl && photo.url === preferredUrl) return true;
    if (!preferredFileName) return false;
    return photoFileNameFromUrl(photo.url) === preferredFileName;
  });

  if (index <= 0) return photos;

  const reordered = photos.slice();
  const preferred = reordered.splice(index, 1)[0];
  reordered.unshift(preferred);
  return reordered;
}

function normalizeImageFolder(value) {
  let text = String(value || "").trim().replace(/\\/g, "/");
  text = text.replace(/^\.\//, "").replace(/^\/+/, "");
  const prefix = "assets/photos/";
  if (text.toLowerCase().startsWith(prefix)) {
    text = text.slice(prefix.length);
  }
  return text.replace(/^\/+|\/+$/g, "");
}

function buildPhotoBaseUrl(folder) {
  const segments = folder.split("/").filter(Boolean).map(function (seg) {
    return encodeURIComponent(seg);
  });
  return ASSETS_PHOTOS_BASE + segments.join("/") + "/";
}

function encodePhotoFileName(fileName) {
  return String(fileName || "")
    .trim()
    .split("/")
    .map(function (part) { return encodeURIComponent(part); })
    .join("/");
}

function buildPhotoEntry(base, file) {
  const name = String(file || "").trim();
  if (!name) return null;
  return { url: base + encodePhotoFileName(name), title: "" };
}

let photosIndexPromise = null;

function fetchPhotosIndex() {
  if (!photosIndexPromise) {
    photosIndexPromise = fetch(ASSETS_PHOTOS_BASE + "index.json")
      .then(function (res) {
        if (!res.ok) return {};
        return res.json();
      })
      .catch(function () {
        return {};
      });
  }
  return photosIndexPromise;
}

function normalizeFolderKey(value) {
  const folder = normalizeImageFolder(value);
  return folder ? folder.normalize("NFC") : "";
}

function lookupFilesInPhotosIndex(index, folder) {
  const normalized = normalizeFolderKey(folder);
  if (!normalized) return null;

  const keys = Object.keys(index);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (key.normalize("NFC") !== normalized) continue;
    const files = index[key];
    if (Array.isArray(files) && files.length > 0) return files;
  }

  const leaf = normalized.split("/").filter(Boolean).pop();
  if (!leaf || leaf === normalized) return null;
  for (let j = 0; j < keys.length; j++) {
    const key = keys[j];
    if (key.normalize("NFC") !== leaf.normalize("NFC")) continue;
    const files = index[key];
    if (Array.isArray(files) && files.length > 0) return files;
  }

  return null;
}

function photosFromIndex(index, folder, base) {
  const files = lookupFilesInPhotosIndex(index, folder);
  if (!files) return null;
  const photos = files
    .map(function (file) { return buildPhotoEntry(base, file); })
    .filter(Boolean);
  return photos.length > 0 ? photos : null;
}

function probeNumberedImages(base) {
  const maxCount = 99;
  const extensions = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

  function probeExtensions(index, extIndex) {
    if (extIndex >= extensions.length) return Promise.resolve("");
    const url = base + index + extensions[extIndex];
    return fetch(url, { method: "HEAD" })
      .then(function (res) {
        if (res.ok) return url;
        return probeExtensions(index, extIndex + 1);
      })
      .catch(function () {
        return probeExtensions(index, extIndex + 1);
      });
  }

  function probe(index, found) {
    if (index > maxCount) return Promise.resolve(found);
    return probeExtensions(index, 0).then(function (url) {
      if (url) {
        found.push({ url: url, title: "" });
        return probe(index + 1, found);
      }
      return found;
    });
  }

  return probe(1, []);
}

function resolveImagesFromFolder(folderName) {
  const folder = normalizeFolderKey(folderName);
  if (!folder) return Promise.resolve([]);

  const base = buildPhotoBaseUrl(folder);
  return fetchPhotosIndex().then(function (index) {
    const indexed = photosFromIndex(index, folder, base);
    if (indexed) return indexed;
    return probeNumberedImages(base);
  });
}

function resolvePinImages(pins) {
  return Promise.all(pins.map(function (pin) {
    const raw = pin.imageFolder || "";
    if (!raw || isYouTubeUrl(raw)) {
      pin.images = [];
      pin.image = "";
      return Promise.resolve();
    }

    if (isDirectImagePath(raw) && /^https?:\/\//i.test(raw)) {
      if (isYouTubeUrl(raw)) {
        pin.images = [];
        pin.image = "";
        return Promise.resolve();
      }
      const url = resolveImageUrl(raw);
      pin.images = [{ url: url, title: "" }];
      pin.image = url;
      return Promise.resolve();
    }

    const folderInput = isDirectImagePath(raw) ? extractFolderFromImagePath(raw) : raw;
    const folder = normalizeFolderKey(folderInput);
    const preferredUrl = isDirectImagePath(raw) ? resolveImageUrl(raw) : "";
    const preferredFileName = isDirectImagePath(raw)
      ? normalizePathSeparators(raw).split("/").pop()
      : "";
    const safePreferredUrl = isYouTubeUrl(preferredUrl) ? "" : preferredUrl;

    if (isDirectImagePath(raw) && !folder) {
      if (!safePreferredUrl) {
        pin.images = [];
        pin.image = "";
        return Promise.resolve();
      }
      const url = safePreferredUrl;
      pin.images = [{ url: url, title: "" }];
      pin.image = url;
      return Promise.resolve();
    }

    if (!folder) {
      pin.images = [];
      pin.image = "";
      return Promise.resolve();
    }

    return resolveImagesFromFolder(folder).then(function (photos) {
      const galleryPhotos = photos.filter(function (photo) {
        return !isYouTubeUrl(photo.url);
      });

      if (galleryPhotos.length === 0 && safePreferredUrl) {
        pin.images = [{ url: safePreferredUrl, title: "" }];
        pin.image = safePreferredUrl;
        return;
      }

      const ordered = reorderPhotosWithPreferred(
        galleryPhotos,
        safePreferredUrl,
        isYouTubeUrl(preferredFileName) ? "" : preferredFileName
      );
      pin.images = ordered;
      pin.image = ordered[0] ? ordered[0].url : "";
      if (ordered.length === 0) {
        console.warn(
          "写真が見つかりません:",
          pin.name,
          "(" + raw + ")",
          "— フォルダ名を確認するか、npm run photos:index で assets/photos/index.json を再生成してください。"
        );
      }
    });
  }));
}

function parseRows(rows) {
  const list = [];
  const col = getColumnIndexes(rows);
  for (let index = 0; index < rows.length; index++) {
    const c = rows[index].c || [];
    if (isHeaderRow(c)) continue;

    const name = String(cellValue(c[col.name]) || "");
    const coords = parseLatLonCell(cellValue(c[col.coords]));
    if (!coords) {
      console.warn("座標が無効な行をスキップ:", name || "(行 " + (index + 1) + ")");
      continue;
    }

    list.push({
      name: name || "ピン" + index,
      lon: coords.lon,
      lat: coords.lat,
      imageFolder: String(cellValue(c[col.imageFolder]) || "").trim(),
      image: "",
      images: [],
      text: String(cellValue(c[col.text]) || ""),
      pointcloud: cellValue(c[col.pointcloud]) !== "" ? parseInt(cellValue(c[col.pointcloud]), 10) : null,
      url: String(cellValue(c[col.url]) || "").trim(),
      urlLabel: String(cellValue(c[col.urlLabel]) || "").trim(),
      openingYear: String(cellValue(c[col.openingYear]) || "").trim(),
      closingYear: String(cellValue(c[col.closingYear]) || "").trim(),
      category: String(cellValue(c[col.category]) || ""),
      role: parseCommaList(cellValue(c[col.role]))
    });
  }
  return list;
}

function fetchSheetData(sheetName, retryCount) {
  const attempt = retryCount || 0;
  const url = "https://docs.google.com/spreadsheets/d/" + SHEET_ID
    + "/gviz/tq?tqx=out:json&sheet=" + encodeURIComponent(sheetName);
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, SHEET_FETCH_TIMEOUT_MS);

  return fetch(url, { signal: controller.signal })
    .then(function (res) {
      clearTimeout(timer);
      if (!res.ok) {
        throw new Error("SHEET_HTTP_" + res.status);
      }
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
        console.warn("スプレッドシート再試行:", sheetName, "(" + (attempt + 1) + "/" + SHEET_FETCH_MAX_RETRIES + ")");
        return fetchSheetData(sheetName, attempt + 1);
      }
      throw err;
    });
}

function isCssColorText(value) {
  const text = String(value || "").trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(text) || /^rgba?\(/i.test(text);
}

function resolveRoleColorFromText(cell) {
  const text = String(cellValue(cell) || "").trim();
  return isCssColorText(text) ? text : "";
}

function sheetsApiColorToCss(color) {
  if (!color) return "";
  const r = Math.round((color.red ?? 1) * 255);
  const g = Math.round((color.green ?? 1) * 255);
  const b = Math.round((color.blue ?? 1) * 255);
  if (r >= 254 && g >= 254 && b >= 254) return "";
  return "rgb(" + r + ", " + g + ", " + b + ")";
}

function getCellBackgroundCss(valueCell) {
  if (!valueCell) return "";
  const bg = (valueCell.effectiveFormat && valueCell.effectiveFormat.backgroundColor)
    || (valueCell.userEnteredFormat && valueCell.userEnteredFormat.backgroundColor);
  return sheetsApiColorToCss(bg);
}

function getRowRoleColorFromApi(values) {
  if (!values || values.length < 2) return "";
  for (let i = 1; i < values.length; i++) {
    const color = getCellBackgroundCss(values[i]);
    if (color) return color;
  }
  return "";
}

function parseRoleColorsFromSheetsApi(json) {
  const colors = {};
  const rowData = json && json.sheets && json.sheets[0]
    && json.sheets[0].data && json.sheets[0].data[0]
    ? json.sheets[0].data[0].rowData || []
    : [];

  rowData.forEach(function (row) {
    const values = row.values || [];
    if (values.length < 2) return;

    const name = String(values[0] && values[0].formattedValue || "").trim();
    if (!name || name.indexOf("一覧") !== -1) return;

    const color = getRowRoleColorFromApi(values);
    if (color) colors[name] = color;
  });

  return colors;
}

function fetchRoleColorsFromSheetsApi() {
  if (!GOOGLE_SHEETS_API_KEY) return Promise.resolve({});

  const range = encodeURIComponent(SHEET_ROLES + "!A2:B100");
  const fields = encodeURIComponent(
    "sheets(data(rowData(values(formattedValue,effectiveFormat(backgroundColor),userEnteredFormat(backgroundColor)))))"
  );
  const url = "https://sheets.googleapis.com/v4/spreadsheets/" + SHEET_ID
    + "?ranges=" + range + "&fields=" + fields + "&key=" + encodeURIComponent(GOOGLE_SHEETS_API_KEY);
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, SHEET_FETCH_TIMEOUT_MS);

  return fetch(url, { signal: controller.signal })
    .then(function (res) {
      clearTimeout(timer);
      if (!res.ok) {
        return res.text().then(function (body) {
          console.warn("Sheets API エラー:", res.status, body);
          throw new Error("SHEET_HTTP_" + res.status);
        });
      }
      return res.json();
    })
    .then(parseRoleColorsFromSheetsApi)
    .catch(function (err) {
      clearTimeout(timer);
      console.warn("生活行為色の取得に失敗:", err);
      return {};
    });
}

function parseListRows(rows) {
  const list = [];
  for (let index = 0; index < rows.length; index++) {
    const value = String(cellValue(rows[index].c && rows[index].c[0]) || "").trim();
    if (!value) continue;
    if (value.indexOf("一覧") !== -1) continue;
    list.push(value);
  }
  return list;
}

function parseRoleListRows(rows) {
  const names = [];
  const colors = {};
  for (let index = 0; index < rows.length; index++) {
    const c = rows[index].c || [];
    const name = String(cellValue(c[0]) || "").trim();
    if (!name) continue;
    if (name.indexOf("一覧") !== -1) continue;

    names.push(name);
    const color = resolveRoleColorFromText(c[1]);
    if (color) colors[name] = color;
  }
  return { names: names, colors: colors };
}

function fetchListSheet(sheetName, label) {
  return fetchSheetData(sheetName)
    .then(parseListRows)
    .catch(function (err) {
      console.warn(label + "の読み込みに失敗:", err);
      return [];
    });
}

function fetchCategoryList() {
  return fetchListSheet(SHEET_CATEGORIES, "カテゴリリスト");
}

function fetchRoleList() {
  return Promise.all([
    fetchSheetData(SHEET_ROLES),
    fetchRoleColorsFromSheetsApi()
  ])
    .then(function (results) {
      const parsed = parseRoleListRows(results[0]);
      const apiColors = results[1];
      Object.keys(apiColors).forEach(function (name) {
        parsed.colors[name] = apiColors[name];
      });
      return parsed;
    })
    .catch(function (err) {
      console.warn("生活行為リストの読み込みに失敗:", err);
      return { names: [], colors: {} };
    });
}

function sheetErrorMessage(err) {
  if (!err || !err.message) {
    return "スプレッドシートを読み込めませんでした。ページを再読み込みしてください。";
  }
  if (err.message === "SHEET_PRIVATE") {
    return "スプレッドシートが非公開です。「リンクを知っている全員」に共有設定を変更してください。";
  }
  if (err.message.indexOf("SHEET_HTTP_") === 0) {
    return "スプレッドシートへの接続に失敗しました（" + err.message.replace("SHEET_HTTP_", "HTTP ") + "）。";
  }
  if (err.message === "データ0件") {
    return "スプレッドシートに有効な座標データがありません。B列に「緯度,経度」を入力してください。";
  }
  return "スプレッドシートを読み込めませんでした。ページを再読み込みしてください。";
}

export function tryLoadSheet() {
  setStatus("スプレッドシートを読み込み中...");

  return Promise.all([
    fetchSheetData(SHEET_MAPPING),
    loadMemoryData()
  ])
    .then(function (results) {
      // 生活史ピンの画像解決を待たず、記憶モード表示を先に更新する
      refreshMemoryModeIfActive();
      const rows = results[0];
      if (state.appMode !== "memory") {
        setStatus("フィルター情報を読み込み中...");
      }
      return Promise.all([
        Promise.resolve(rows),
        fetchCategoryList(),
        fetchRoleList()
      ]);
    })
    .then(function (results) {
      const rows = results[0];
      const categories = results[1];
      const roleData = results[2];
      const pins = parseRows(rows);
      if (pins.length === 0) throw new Error("データ0件");
      if (state.appMode !== "memory") {
        setStatus("写真を読み込み中...");
      }
      return resolvePinImages(pins).then(function () {
        return {
          pins: pins,
          categories: categories,
          roles: roleData.names,
          roleColors: roleData.colors
        };
      });
    })
    .then(function (data) {
      loadPinData(data.pins, {
        resetSearch: true,
        categories: data.categories,
        roles: data.roles,
        roleColors: data.roleColors,
        flyTo: false,
        // 記憶モード中は件数表示を上書きしない（refreshMemoryModeIfActive 側に任せる）
        statusMessage: state.appMode === "memory"
          ? ""
          : data.pins.length + " 件のピンを読み込みました",
        statusType: "ok"
      });
    })
    .catch(function (err) {
      console.warn("スプレッドシート読み込み失敗:", err);
      loadPinData([], {
        resetSearch: true,
        categories: [],
        roles: [],
        roleColors: {},
        flyTo: false,
        statusMessage: sheetErrorMessage(err),
        statusType: "error"
      });
    });
}
