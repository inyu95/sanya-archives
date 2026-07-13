export function normalizeUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  return "https://" + text;
}

export function parseYouTubeVideoId(value) {
  const text = String(value || "").trim();
  if (!text) return null;

  try {
    const parsed = new URL(normalizeUrl(text));
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();

    if (host === "youtu.be") {
      const id = parsed.pathname.replace(/^\//, "").split("/")[0];
      return id || null;
    }

    if (host === "youtube.com" || host === "m.youtube.com") {
      if (parsed.pathname === "/watch") {
        return parsed.searchParams.get("v") || null;
      }
      const pathMatch = parsed.pathname.match(/^\/(?:embed|shorts|live)\/([^/?]+)/);
      if (pathMatch) return pathMatch[1];
    }
  } catch (_err) {
    return null;
  }

  return null;
}

export function isYouTubeUrl(value) {
  return Boolean(parseYouTubeVideoId(value));
}

export function getYouTubeThumbnailUrl(videoId) {
  return "https://i.ytimg.com/vi/" + videoId + "/hqdefault.jpg";
}

export function getYouTubeEmbedUrl(videoId) {
  return "https://www.youtube.com/embed/" + videoId + "?autoplay=1&rel=0";
}
