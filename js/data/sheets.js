import {
  SHEET_ID,
  SHEET_MAPPING,
  SHEET_CATEGORIES,
  SHEET_ACTIVITIES,
  SHEET_FETCH_TIMEOUT_MS,
  SHEET_FETCH_MAX_RETRIES,
  GOOGLE_SHEETS_API_KEY,
  ASSETS_PHOTOS_BASE
} from "../config/constants.js";
import { parseCommaList } from "../utils/parse.js";
import { loadPinData } from "../filters/filters.js";
import { setStatus } from "../ui/status.js";

function cellValue(cell) {
  if (!cell) return "";
  if (cell.v != null) return cell.v;
  if (cell.f) return cell.f;
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

function resolveImageUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  return path.startsWith("/") ? path : "/" + path.replace(/^\.\//, "");
}

function isDirectImagePath(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/^https?:\/\//i.test(text)) return true;
  return /\.(jpe?g|png|gif|webp|svg|bmp)$/i.test(text);
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

function fetchManifestUrls(base) {
  return fetch(base + "manifest.json")
    .then(function (res) {
      if (!res.ok) return null;
      return res.json();
    })
    .then(function (files) {
      if (!Array.isArray(files)) return null;
      const urls = files
        .map(function (file) { return String(file || "").trim(); })
        .filter(Boolean)
        .map(function (file) { return base + encodePhotoFileName(file); });
      return urls.length > 0 ? urls : null;
    })
    .catch(function () {
      return null;
    });
}

function probeNumberedImages(base) {
  const maxCount = 99;

  function probe(index, found) {
    if (index > maxCount) return Promise.resolve(found);
    const url = base + index + ".jpg";
    return fetch(url, { method: "HEAD" })
      .then(function (res) {
        if (res.ok) {
          found.push(url);
          return probe(index + 1, found);
        }
        return found;
      })
      .catch(function () {
        return found;
      });
  }

  return probe(1, []);
}

function resolveImagesFromFolder(folderName) {
  const folder = normalizeImageFolder(folderName);
  if (!folder) return Promise.resolve([]);

  const base = buildPhotoBaseUrl(folder);
  return fetchManifestUrls(base)
    .then(function (urls) {
      if (urls) return urls;
      return probeNumberedImages(base);
    });
}

function resolvePinImages(pins) {
  return Promise.all(pins.map(function (pin) {
    const raw = pin.imageFolder || "";
    if (!raw) {
      pin.images = [];
      pin.image = "";
      return Promise.resolve();
    }
    if (isDirectImagePath(raw)) {
      const url = resolveImageUrl(raw);
      pin.images = [url];
      pin.image = url;
      return Promise.resolve();
    }
    return resolveImagesFromFolder(raw).then(function (urls) {
      pin.images = urls;
      pin.image = urls[0] || "";
    });
  }));
}

function parseRows(rows) {
  const list = [];
  for (let index = 0; index < rows.length; index++) {
    const c = rows[index].c || [];
    if (isHeaderRow(c)) continue;

    const name = String(cellValue(c[0]) || "");
    const coords = parseLatLonCell(cellValue(c[1]));
    if (!coords) {
      console.warn("座標が無効な行をスキップ:", name || "(行 " + (index + 1) + ")");
      continue;
    }

    list.push({
      name: name || "ピン" + index,
      lon: coords.lon,
      lat: coords.lat,
      imageFolder: String(cellValue(c[2]) || "").trim(),
      image: "",
      images: [],
      text: String(cellValue(c[3]) || ""),
      pointcloud: cellValue(c[4]) !== "" ? parseInt(cellValue(c[4]), 10) : null,
      url: String(cellValue(c[5]) || "").trim(),
      year: String(cellValue(c[6]) || ""),
      category: String(cellValue(c[7]) || ""),
      activity: parseCommaList(cellValue(c[8]))
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
      if (!text.startsWith("/*O_o*/\ngoogle.visualization.Query.setResponse(")) {
        throw new Error("SHEET_PRIVATE");
      }
      const json = JSON.parse(text.substring(47, text.length - 2));
      return json.table ? json.table.rows : [];
    })
    .catch(function (err) {
      clearTimeout(timer);
      const canRetry = attempt < SHEET_FETCH_MAX_RETRIES
        && (err.name === "AbortError" || (err.message && err.message.indexOf("SHEET_HTTP_") === 0));
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

function resolveActivityColorFromText(cell) {
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

function parseActivityColorsFromSheetsApi(json) {
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

    const color = sheetsApiColorToCss(
      values[1] && values[1].effectiveFormat && values[1].effectiveFormat.backgroundColor
    );
    if (color) colors[name] = color;
  });

  return colors;
}

function fetchActivityColorsFromSheetsApi() {
  if (!GOOGLE_SHEETS_API_KEY) return Promise.resolve({});

  const range = encodeURIComponent(SHEET_ACTIVITIES + "!A2:B100");
  const fields = encodeURIComponent(
    "sheets(data(rowData(values(formattedValue,effectiveFormat(backgroundColor)))))"
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
    .then(parseActivityColorsFromSheetsApi)
    .catch(function (err) {
      clearTimeout(timer);
      console.warn("アクティビティ色の取得に失敗:", err);
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

function parseActivityListRows(rows) {
  const names = [];
  const colors = {};
  for (let index = 0; index < rows.length; index++) {
    const c = rows[index].c || [];
    const name = String(cellValue(c[0]) || "").trim();
    if (!name) continue;
    if (name.indexOf("一覧") !== -1) continue;

    names.push(name);
    const color = resolveActivityColorFromText(c[1]);
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

function fetchActivityList() {
  return Promise.all([
    fetchSheetData(SHEET_ACTIVITIES),
    fetchActivityColorsFromSheetsApi()
  ])
    .then(function (results) {
      const parsed = parseActivityListRows(results[0]);
      const apiColors = results[1];
      Object.keys(apiColors).forEach(function (name) {
        parsed.colors[name] = apiColors[name];
      });
      return parsed;
    })
    .catch(function (err) {
      console.warn("アクティビティリストの読み込みに失敗:", err);
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

  fetchSheetData(SHEET_MAPPING)
    .then(function (rows) {
      setStatus("フィルター情報を読み込み中...");
      return Promise.all([
        Promise.resolve(rows),
        fetchCategoryList(),
        fetchActivityList()
      ]);
    })
    .then(function (results) {
      const rows = results[0];
      const categories = results[1];
      const activityData = results[2];
      const pins = parseRows(rows);
      if (pins.length === 0) throw new Error("データ0件");
      setStatus("写真を読み込み中...");
      return resolvePinImages(pins).then(function () {
        return {
          pins: pins,
          categories: categories,
          activities: activityData.names,
          activityColors: activityData.colors
        };
      });
    })
    .then(function (data) {
      loadPinData(data.pins, {
        resetSearch: true,
        categories: data.categories,
        activities: data.activities,
        activityColors: data.activityColors,
        statusMessage: data.pins.length + " 件のピンを読み込みました",
        statusType: "ok"
      });
    })
    .catch(function (err) {
      console.warn("スプレッドシート読み込み失敗:", err);
      loadPinData([], {
        resetSearch: true,
        categories: [],
        activities: [],
        activityColors: {},
        flyTo: false,
        statusMessage: sheetErrorMessage(err),
        statusType: "error"
      });
    });
}
