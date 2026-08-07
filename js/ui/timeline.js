import { dom } from "../config/dom.js";
import { TIMELINE_IMAGE_URL } from "../config/constants.js";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;
const ZOOM_STEP = 0.25;

let zoomLevel = 1;
let pinchStartDistance = 0;
let pinchStartZoom = 1;

function scrollTimelineToStart() {
  if (!dom.timelineScroll) return;
  dom.timelineScroll.scrollLeft = dom.timelineScroll.scrollWidth;
}

function updateZoomLabel() {
  if (!dom.timelineZoomLabel) return;
  dom.timelineZoomLabel.textContent = `${Math.round(zoomLevel * 100)}%`;
}

function applyTimelineZoom() {
  const img = dom.timelineImage;
  if (!img || !img.naturalWidth) return;

  img.style.width = `${Math.round(img.naturalWidth * zoomLevel)}px`;
  img.style.height = `${Math.round(img.naturalHeight * zoomLevel)}px`;
  updateZoomLabel();
}

function setTimelineZoom(newZoom, anchorX, anchorY) {
  const scroll = dom.timelineScroll;
  const prevZoom = zoomLevel;
  zoomLevel = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, newZoom));

  if (scroll && prevZoom !== zoomLevel && anchorX != null && anchorY != null) {
    const ratio = zoomLevel / prevZoom;
    scroll.scrollLeft = (scroll.scrollLeft + anchorX) * ratio - anchorX;
    scroll.scrollTop = (scroll.scrollTop + anchorY) * ratio - anchorY;
  }

  applyTimelineZoom();
}

function fitTimelineToView() {
  const scroll = dom.timelineScroll;
  const img = dom.timelineImage;
  if (!scroll || !img || !img.naturalWidth) return;

  zoomLevel = Math.min(
    scroll.clientWidth / img.naturalWidth,
    scroll.clientHeight / img.naturalHeight
  );
  applyTimelineZoom();
  scrollTimelineToStart();
}

function resetTimelineZoom() {
  zoomLevel = 1;
  applyTimelineZoom();
  scrollTimelineToStart();
}

function ensureTimelineImage() {
  if (!dom.timelineImage) return;
  if (dom.timelineImage.dataset.src === TIMELINE_IMAGE_URL) return;
  dom.timelineImage.dataset.src = TIMELINE_IMAGE_URL;
  dom.timelineImage.src = TIMELINE_IMAGE_URL;
}

function openTimelineModal() {
  if (!dom.timelineModal) return;
  ensureTimelineImage();
  dom.timelineModal.classList.remove("hidden");
  dom.timelineModal.setAttribute("aria-hidden", "false");
  if (dom.timelineImage && dom.timelineImage.complete && dom.timelineImage.naturalWidth > 0) {
    requestAnimationFrame(resetTimelineZoom);
  }
}

function closeTimelineModal() {
  if (!dom.timelineModal) return;
  dom.timelineModal.classList.add("hidden");
  dom.timelineModal.setAttribute("aria-hidden", "true");
}

function getTouchDistance(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

function setupTimelineZoom() {
  if (!dom.timelineScroll) return;

  if (dom.timelineZoomIn) {
    dom.timelineZoomIn.addEventListener("click", function () {
      const rect = dom.timelineScroll.getBoundingClientRect();
      setTimelineZoom(
        zoomLevel + ZOOM_STEP,
        rect.width / 2,
        rect.height / 2
      );
    });
  }

  if (dom.timelineZoomOut) {
    dom.timelineZoomOut.addEventListener("click", function () {
      const rect = dom.timelineScroll.getBoundingClientRect();
      setTimelineZoom(
        zoomLevel - ZOOM_STEP,
        rect.width / 2,
        rect.height / 2
      );
    });
  }

  if (dom.timelineZoomFit) {
    dom.timelineZoomFit.addEventListener("click", fitTimelineToView);
  }

  dom.timelineScroll.addEventListener("wheel", function (event) {
    if (!dom.timelineModal || dom.timelineModal.classList.contains("hidden")) return;
    event.preventDefault();

    const rect = dom.timelineScroll.getBoundingClientRect();
    const anchorX = event.clientX - rect.left;
    const anchorY = event.clientY - rect.top;
    const delta = event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    setTimelineZoom(zoomLevel + delta, anchorX, anchorY);
  }, { passive: false });

  dom.timelineScroll.addEventListener("touchstart", function (event) {
    if (event.touches.length === 2) {
      pinchStartDistance = getTouchDistance(event.touches);
      pinchStartZoom = zoomLevel;
    }
  }, { passive: true });

  dom.timelineScroll.addEventListener("touchmove", function (event) {
    if (event.touches.length !== 2 || pinchStartDistance <= 0) return;

    event.preventDefault();
    const distance = getTouchDistance(event.touches);
    const rect = dom.timelineScroll.getBoundingClientRect();
    const anchorX = (event.touches[0].clientX + event.touches[1].clientX) / 2 - rect.left;
    const anchorY = (event.touches[0].clientY + event.touches[1].clientY) / 2 - rect.top;
    setTimelineZoom(pinchStartZoom * (distance / pinchStartDistance), anchorX, anchorY);
  }, { passive: false });

  dom.timelineScroll.addEventListener("touchend", function () {
    pinchStartDistance = 0;
  });
}

export function setupTimeline() {
  if (dom.timelineImage) {
    dom.timelineImage.addEventListener("load", function () {
      if (!dom.timelineModal || dom.timelineModal.classList.contains("hidden")) return;
      requestAnimationFrame(resetTimelineZoom);
    });
  }

  setupTimelineZoom();

  [dom.timelineBtn, dom.startupTimelineBtn].forEach(function (btn) {
    if (btn) btn.addEventListener("click", openTimelineModal);
  });

  if (dom.timelineModalClose) {
    dom.timelineModalClose.addEventListener("click", closeTimelineModal);
  }
  if (dom.timelineModalBackdrop) {
    dom.timelineModalBackdrop.addEventListener("click", closeTimelineModal);
  }

  document.addEventListener("keydown", function (event) {
    if (!dom.timelineModal || dom.timelineModal.classList.contains("hidden")) return;
    if (event.key === "Escape") closeTimelineModal();
  });
}
