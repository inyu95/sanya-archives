import { dom } from "../config/dom.js";
import { state } from "../state.js";
import { renderSpotLinks, renderSpotYouTubePreviews } from "./spot-links.js";
import { findPinEntity, flyToPin } from "../pins/pins.js";
import { showPinInfo, resetCameraZoomState, openVideoLightbox } from "../info-panel.js";
import { clearPointCloudModal } from "../pointcloud/viewer.js";
import { openMemoryPhoto } from "../memory/memory-pins.js";

let isOpen = false;

function getArchiveListTitleEl() {
  return dom.archiveListPanel
    ? dom.archiveListPanel.querySelector("#archive-list-header h2")
    : null;
}

function updateArchiveListChrome() {
  const titleEl = getArchiveListTitleEl();
  const isMemory = state.appMode === "memory";
  if (titleEl) {
    titleEl.textContent = isMemory ? "写真一覧" : "アーカイブ一覧";
  }
  if (dom.archiveListBtn) {
    dom.archiveListBtn.title = isMemory
      ? "登録された写真の一覧を表示"
      : "登録された場所の一覧を表示";
    dom.archiveListBtn.setAttribute(
      "aria-label",
      isMemory ? "写真一覧" : "アーカイブ一覧"
    );
  }
}

function createArchiveCard(pin) {
  const card = document.createElement("article");
  card.className = "archive-card";
  card.setAttribute("role", "button");
  card.tabIndex = 0;

  const top = document.createElement("div");
  top.className = "archive-card-top";

  const thumb = document.createElement("img");
  thumb.className = "archive-card-thumb";
  thumb.alt = "";
  if (pin.image) {
    thumb.src = pin.image;
    thumb.alt = pin.name || "";
  } else {
    thumb.classList.add("archive-card-thumb--empty");
  }

  const title = document.createElement("h3");
  title.className = "archive-card-title";
  title.textContent = pin.name || "スポット";

  top.appendChild(thumb);
  top.appendChild(title);

  const desc = document.createElement("p");
  desc.className = "archive-card-desc";
  desc.textContent = pin.text || "";

  card.appendChild(top);
  if (pin.text) card.appendChild(desc);

  const youtubeContainer = document.createElement("div");
  youtubeContainer.className = "spot-youtube-previews";
  const videos = renderSpotYouTubePreviews(youtubeContainer, pin.url, pin.urlLabel, {
    stopPropagation: true,
    onVideoClick: openVideoLightbox
  });
  if (videos.length > 0) card.appendChild(youtubeContainer);

  const linksContainer = document.createElement("div");
  linksContainer.className = "spot-homepage-links";
  const links = renderSpotLinks(linksContainer, pin.url, pin.urlLabel, {
    stopPropagation: true,
    onVideoClick: openVideoLightbox
  });
  if (links.length > 0) card.appendChild(linksContainer);

  function selectPin() {
    const entity = findPinEntity(pin);
    if (!entity) return;
    resetCameraZoomState();
    clearPointCloudModal();
    showPinInfo(entity);
    flyToPin(entity);
    closeArchiveList();
  }

  card.addEventListener("click", selectPin);
  card.addEventListener("keydown", function (event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectPin();
    }
  });

  return card;
}

function createMemoryCard(photo) {
  const card = document.createElement("article");
  card.className = "archive-card";
  card.setAttribute("role", "button");
  card.tabIndex = 0;

  const top = document.createElement("div");
  top.className = "archive-card-top";

  const thumb = document.createElement("img");
  thumb.className = "archive-card-thumb";
  thumb.alt = photo.title || "";
  if (photo.url) {
    thumb.src = photo.url;
  } else {
    thumb.classList.add("archive-card-thumb--empty");
  }

  const title = document.createElement("h3");
  title.className = "archive-card-title";
  title.textContent = photo.title || "写真";

  top.appendChild(thumb);
  top.appendChild(title);
  card.appendChild(top);

  if (photo.caption) {
    const desc = document.createElement("p");
    desc.className = "archive-card-desc";
    desc.textContent = photo.caption;
    card.appendChild(desc);
  }

  if (photo.year) {
    const meta = document.createElement("p");
    meta.className = "archive-card-meta";
    meta.textContent = photo.year;
    card.appendChild(meta);
  }

  function selectPhoto() {
    openMemoryPhoto(photo);
    closeArchiveList();
  }

  card.addEventListener("click", selectPhoto);
  card.addEventListener("keydown", function (event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectPhoto();
    }
  });

  return card;
}

export function renderArchiveList(pins) {
  if (!dom.archiveList) return;

  dom.archiveList.innerHTML = "";
  updateArchiveListChrome();

  if (state.appMode === "memory") {
    const photos = pins || state.filteredMemoryPhotos;
    if (!photos || photos.length === 0) {
      const empty = document.createElement("p");
      empty.className = "archive-list-empty";
      empty.textContent = "表示できる写真がありません";
      dom.archiveList.appendChild(empty);
      return;
    }
    photos.forEach(function (photo) {
      dom.archiveList.appendChild(createMemoryCard(photo));
    });
    return;
  }

  if (!pins || pins.length === 0) {
    const empty = document.createElement("p");
    empty.className = "archive-list-empty";
    empty.textContent = "表示できるスポットがありません";
    dom.archiveList.appendChild(empty);
    return;
  }

  pins.forEach(function (pin) {
    dom.archiveList.appendChild(createArchiveCard(pin));
  });
}

function openArchiveList() {
  if (!dom.archiveListPanel) return;
  if (state.appMode === "memory") {
    renderArchiveList(state.filteredMemoryPhotos);
  } else {
    renderArchiveList(state.filteredPins);
  }
  dom.archiveListPanel.classList.remove("hidden");
  if (dom.archiveListBtn) dom.archiveListBtn.classList.add("active");
  isOpen = true;
}

export function closeArchiveList() {
  if (!dom.archiveListPanel) return;
  dom.archiveListPanel.classList.add("hidden");
  if (dom.archiveListBtn) dom.archiveListBtn.classList.remove("active");
  isOpen = false;
}

export function refreshArchiveListIfOpen() {
  if (!isOpen) return;
  if (state.appMode === "memory") {
    renderArchiveList(state.filteredMemoryPhotos);
  } else {
    renderArchiveList(state.filteredPins);
  }
}

function toggleArchiveList() {
  if (isOpen) {
    closeArchiveList();
  } else {
    openArchiveList();
  }
}

export function setupArchiveList() {
  if (!dom.archiveListBtn) return;

  dom.archiveListBtn.addEventListener("click", function (event) {
    event.stopPropagation();
    toggleArchiveList();
  });

  if (dom.archiveListClose) {
    dom.archiveListClose.addEventListener("click", closeArchiveList);
  }

  document.addEventListener("click", function (event) {
    if (!isOpen) return;
    const target = event.target;
    if (dom.archiveListPanel && dom.archiveListPanel.contains(target)) return;
    if (dom.archiveListBtn && dom.archiveListBtn.contains(target)) return;
    closeArchiveList();
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && isOpen) closeArchiveList();
  });
}
