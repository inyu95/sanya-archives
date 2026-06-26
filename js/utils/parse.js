export function parseCommaList(value) {
  if (!value) return [];
  return String(value).split(",").map(function (item) { return item.trim(); }).filter(Boolean);
}

export function parsePinYear(yearStr) {
  if (!yearStr) return null;
  const match = String(yearStr).trim().match(/(\d{4})/);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  return isNaN(year) ? null : year;
}

export function normalizeUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  return "https://" + text;
}
