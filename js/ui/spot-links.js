import { parseUrlLinks } from "../utils/parse.js";
import { getYouTubeThumbnailUrl } from "../utils/youtube.js";

function createYouTubePreviewButton(item, options) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "spot-youtube-preview";
  button.setAttribute("aria-label", item.label + "を再生");

  const thumb = document.createElement("img");
  thumb.className = "spot-youtube-preview-thumb";
  thumb.src = getYouTubeThumbnailUrl(item.videoId);
  thumb.alt = "";
  thumb.loading = "lazy";

  const play = document.createElement("span");
  play.className = "video-play-overlay";
  play.setAttribute("aria-hidden", "true");

  const label = document.createElement("span");
  label.className = "spot-youtube-preview-label";
  label.textContent = item.label;

  button.appendChild(thumb);
  button.appendChild(play);
  button.appendChild(label);

  button.addEventListener("click", function (event) {
    if (options && options.stopPropagation) {
      event.stopPropagation();
    }
    if (options && typeof options.onVideoClick === "function") {
      options.onVideoClick(item.videoId, item.label);
    }
  });

  return button;
}

export function renderSpotYouTubePreviews(container, urlValue, labelValue, options) {
  if (!container) return [];

  const videos = parseUrlLinks(urlValue, labelValue).filter(function (item) {
    return item.type === "youtube";
  });

  container.innerHTML = "";

  if (videos.length === 0) {
    container.classList.add("hidden");
    return videos;
  }

  container.classList.remove("hidden");
  videos.forEach(function (item) {
    container.appendChild(createYouTubePreviewButton(item, options));
  });

  return videos;
}

export function renderSpotLinks(container, urlValue, labelValue, options) {
  if (!container) return [];

  const links = parseUrlLinks(urlValue, labelValue).filter(function (item) {
    return item.type !== "youtube";
  });

  container.innerHTML = "";

  if (links.length === 0) {
    container.classList.add("hidden");
    return links;
  }

  container.classList.remove("hidden");
  links.forEach(function (item) {
    const link = document.createElement("a");
    link.className = "spot-homepage-btn";
    link.href = item.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = item.label;
    if (options && options.stopPropagation) {
      link.addEventListener("click", function (event) {
        event.stopPropagation();
      });
    }
    container.appendChild(link);
  });

  return links;
}
