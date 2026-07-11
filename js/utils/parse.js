export function parseCommaList(value) {
  if (!value) return [];
  return String(value).split(",").map(function (item) { return item.trim(); }).filter(Boolean);
}

export function parseLineList(value) {
  if (!value) return [];
  return String(value).split(/\r?\n/).map(function (item) { return item.trim(); }).filter(Boolean);
}

const ERA_YEAR_OFFSETS = {
  "明治": 1867,
  "大正": 1911,
  "昭和": 1925,
  "平成": 1988,
  "令和": 2018
};

function normalizeWesternYear(year) {
  if (!Number.isFinite(year)) return null;
  const maxYear = new Date().getFullYear() + 2;
  // 1060→1960 のように先頭の「9」が抜けた表記を補正（1000年代のみ）
  if (year >= 1000 && year < 1100) {
    const corrected = year + 900;
    if (corrected >= 1900 && corrected <= maxYear) {
      year = corrected;
    }
  }
  if (year < 1 || year > maxYear) return null;
  return year;
}

export function parsePinYear(yearStr) {
  if (!yearStr) return null;
  const text = String(yearStr).trim();
  if (!text) return null;

  const parenMatch = text.match(/[（(](\d{4})\s*年?[）)]/);
  if (parenMatch) {
    return normalizeWesternYear(parseInt(parenMatch[1], 10));
  }

  const eraMatch = text.match(/(明治|大正|昭和|平成|令和)\s*(\d{1,2})\s*年?/);
  if (eraMatch) {
    const offset = ERA_YEAR_OFFSETS[eraMatch[1]];
    const eraYear = parseInt(eraMatch[2], 10);
    if (offset && eraYear >= 1) {
      return normalizeWesternYear(offset + eraYear);
    }
  }

  const fourMatch = text.match(/(\d{4})/);
  if (fourMatch) {
    return normalizeWesternYear(parseInt(fourMatch[1], 10));
  }

  const twoMatch = text.match(/(?:^|[^\d])(\d{2})\s*年?(?:[^\d]|$)/);
  if (twoMatch) {
    const n = parseInt(twoMatch[1], 10);
    const year = n >= 60 ? 1900 + n : 2000 + n;
    return normalizeWesternYear(year);
  }

  return null;
}

export function normalizeUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  return "https://" + text;
}

export function parseUrlLinks(urlValue, labelValue) {
  const urls = parseLineList(urlValue).map(normalizeUrl).filter(Boolean);
  const labels = parseLineList(labelValue);
  const defaultLabel = "リンク";
  return urls.map(function (href, index) {
    return {
      href: href,
      label: labels[index] || defaultLabel
    };
  });
}
