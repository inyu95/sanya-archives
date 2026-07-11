function photoFileNameFromUrl(url) {
  const part = String(url || "").split("/").pop() || "";
  const withoutQuery = part.split("?")[0];
  try {
    return decodeURIComponent(withoutQuery);
  } catch (_err) {
    return withoutQuery;
  }
}

function captionFromFileName(fileName) {
  const base = String(fileName || "").trim();
  if (!base) return "";
  const lastDot = base.lastIndexOf(".");
  return lastDot > 0 ? base.slice(0, lastDot) : base;
}

export function normalizePhotoEntry(entry) {
  if (!entry) return null;

  if (typeof entry === "string") {
    const url = entry.trim();
    return url ? { url: url, title: "" } : null;
  }

  if (typeof entry === "object") {
    const url = String(entry.url || "").trim();
    if (!url) return null;
    return {
      url: url,
      title: String(entry.title || entry.caption || "").trim()
    };
  }

  return null;
}

export function normalizePhotoList(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.map(normalizePhotoEntry).filter(Boolean);
}

export function getPhotoUrl(entry) {
  const photo = normalizePhotoEntry(entry);
  return photo ? photo.url : "";
}

export function getPhotoTitle(entry) {
  const photo = normalizePhotoEntry(entry);
  if (!photo) return "";
  return captionFromFileName(photoFileNameFromUrl(photo.url));
}
