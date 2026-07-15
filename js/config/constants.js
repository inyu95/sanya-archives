/** デプロイ時に increment して ES モジュールのブラウザキャッシュを無効化 */
export const APP_MODULE_VERSION = "103";

export const PIN_CIRCLE_SIZE = 48;
/** ピン画像の描画倍率（表示サイズは PIN_CIRCLE_SIZE のまま） */
export const PIN_RENDER_SCALE = 4;
/** 複数生活行為時の団子間隔（円の直径＝重ならない） */
export const PIN_DANGO_SPACING = PIN_CIRCLE_SIZE;
export const INITIAL_PIN_VIEW_RANGE = 3500;
export const HISTORICAL_MAP_PADDING_DEGREES = 0.012;
/** ピン未取得時の山谷エリア周辺（西・南・東・北） */
export const HISTORICAL_MAP_FALLBACK_BOUNDS = {
  west: 139.778,
  south: 35.714,
  east: 139.821,
  north: 35.742
};
/** 地理院タイルの最大ズーム（seamlessphoto 等は z18 まで提供） */
export const HISTORICAL_MAP_MAX_ZOOM_LEVEL = 18;
export const HISTORICAL_MAP_MAX_CAMERA_DISTANCE = 3500;
/** タイル読み込み前の地球色（暗すぎないベージュ系） */
export const HISTORICAL_MAP_GLOBE_BASE_COLOR = "#e0d8cc";
/** スキャン地図の明るさ補正 */
export const HISTORICAL_MAP_BRIGHTNESS = 1.3;
export const HISTORICAL_MAP_GAMMA = 0.9;
export const PIN_POLE_HEIGHT_METERS = 48;
/** Cesium 2D モード専用の茎（画面上のピクセル） */
export const PIN_STEM_PIXEL_HEIGHT = 22;
export const PIN_STEM_WIDTH = 1;
export const PIN_STEM_COLOR = "#ffffff";
export const PIN_STEM_ALPHA = 0.8;

export const SHEET_ID = "1aHy03FK6Yq1Lu37zzjlgoGtM622Ztrpmammcut22uuo";
export const SHEET_MAPPING = "マッピング";
export const SHEET_MEMORY = "過去写真";
export const SHEET_CATEGORIES = "カテゴリリスト";
export const SHEET_ROLES = "生活行為リスト";

/** 記憶モード写真のデフォルトカメラ（シート未設定時） */
export const MEMORY_DEFAULT_HEIGHT = 120;
export const MEMORY_DEFAULT_HEADING = 0;
export const MEMORY_DEFAULT_PITCH = -40;
export const MEMORY_THUMB_SIZE = 72;
export const INITIAL_MEMORY_VIEW_RANGE = 3500;
/** 記憶モード時のまち（3Dタイル）の明度。写真を目立たせるため 1 未満にする */
export const MEMORY_TOWN_BRIGHTNESS = 0.62;
export const SHEET_FETCH_TIMEOUT_MS = 30000;
export const SHEET_FETCH_MAX_RETRIES = 2;
export const GOOGLE_SHEETS_API_KEY = "AIzaSyAj3HmCQbFFqq1G7L9OhLMW2yT8cTJckJc";

export const LOCAL_TILESET_VIEW_LON = 139.6917;
export const LOCAL_TILESET_VIEW_LAT = 35.6895;
export const LOCAL_TILESET_VIEW_HEIGHT = 500;
export const POINT_CLOUD_ZOOM_WHEEL_FACTOR = 0.003;
export const POINT_CLOUD_ZOOM_PINCH_FACTOR = 0.08;
export const POINT_CLOUD_ZOOM_DRAG_FACTOR = 0.008;
export const POINT_CLOUD_PAN_DRAG_FACTOR = 0.005;
export const POINT_CLOUD_ROTATE_DRAG_FACTOR = 0.004;

export const CESIUM_ION_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI0YWEzZjAzZi1lYWNjLTQ1MjEtODNiNS1hODhhNzNiZDZmZWYiLCJpZCI6NDE3MTQ4LCJzdWIiOiJpbnl1MTk5NSIsImlzcyI6Imh0dHBzOi8vYXBpLmNlc2l1bS5jb20iLCJhdWQiOiJVbnRpdGxlZCIsImlhdCI6MTc4MDY2NzA4OX0.1Uh_YIa1s77JZ4JBrDFaTMt4XT9P8YyQq22-lak_M7s";

export function getAppBasePath() {
  let path = window.location.pathname;
  if (path.endsWith("/")) return path;
  const last = path.split("/").pop() || "";
  if (last.includes(".")) return path.slice(0, path.lastIndexOf("/") + 1);
  return path + "/";
}

export const ASSETS_PHOTOS_BASE = getAppBasePath() + "assets/photos/";
export const ASSETS_ICONS_BASE = getAppBasePath() + "assets/icons/";
