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
      title: String(entry.title || "").trim()
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
  return photo ? photo.title : "";
}
