import { dom } from "../config/dom.js";
import { state } from "../state.js";
import { normalizeUrl } from "../utils/parse.js";
import { findPinEntity, flyToPin } from "../pins/pins.js";
import { showPinInfo, resetCameraZoomState } from "../info-panel.js";
import { clearPointCloudModal } from "../pointcloud/viewer.js";
import { mountCustomToolbarButtons } from "./toolbar.js";

let isOpen = false;

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

  const url = normalizeUrl(pin.url);
  if (url) {
    const link = document.createElement("a");
    link.className = "spot-homepage-btn";
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "リンク";
    link.addEventListener("click", function (event) {
      event.stopPropagation();
    });
    card.appendChild(link);
  }

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

export function renderArchiveList(pins) {
  if (!dom.archiveList) return;

  dom.archiveList.innerHTML = "";

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

export function openArchiveList() {
  if (!dom.archiveListPanel) return;
  renderArchiveList(state.filteredPins);
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

function toggleArchiveList() {
  if (isOpen) {
    closeArchiveList();
  } else {
    openArchiveList();
  }
}

export function mountArchiveListButton() {
  mountCustomToolbarButtons();
}

export function setupArchiveList() {
  if (!dom.archiveListBtn) return;

  mountArchiveListButton();

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
