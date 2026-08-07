import { dom } from "../config/dom.js";
import { TIMELINE_IMAGE_URL } from "../config/constants.js";

const MIN_DISPLAY_RATIO = 1;
const MAX_DISPLAY_RATIO = 8;
const ZOOM_BUTTON_FACTOR = 1.2;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;

let scale = 1;
let fitScale = 1;
let panX = 0;
let panY = 0;
let dragState = null;
let pinchStartDistance = 0;
let pinchStartScale = 1;
let rafId = 0;

function getViewportSize() {
  const viewport = dom.timelineScroll;
  if (!viewport) return { width: 0, height: 0 };
  return {
    width: viewport.clientWidth,
    height: viewport.clientHeight
  };
}

function getFitScale() {
  const img = dom.timelineImage;
  const { width, height } = getViewportSize();
  if (!img || !img.naturalWidth || !width || !height) return 1;
  return Math.min(width / img.naturalWidth, height / img.naturalHeight);
}

function getDisplayZoomRatio() {
  if (fitScale <= 0) return 1;
  return scale / fitScale;
}

function updateZoomLabel() {
  if (!dom.timelineZoomLabel) return;
  dom.timelineZoomLabel.textContent = `${Math.round(getDisplayZoomRatio() * 100)}%`;
}

function applyTransform() {
  const stage = dom.timelineScrollStage;
  if (!stage) return;
  stage.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${scale})`;
  updateZoomLabel();
}

function setImageNaturalSize() {
  const img = dom.timelineImage;
  if (!img || !img.naturalWidth) return;
  img.style.width = `${img.naturalWidth}px`;
  img.style.height = `${img.naturalHeight}px`;
}

function centerPan() {
  const img = dom.timelineImage;
  const { width, height } = getViewportSize();
  if (!img || !img.naturalWidth || !width || !height) return;
  panX = (width - img.naturalWidth * scale) / 2;
  panY = (height - img.naturalHeight * scale) / 2;
  applyTransform();
}

function clampScale(nextScale) {
  const minScale = fitScale * MIN_DISPLAY_RATIO;
  const maxScale = fitScale * MAX_DISPLAY_RATIO;
  return Math.min(maxScale, Math.max(minScale, nextScale));
}

function zoomAt(viewportX, viewportY, nextScale) {
  const clamped = clampScale(nextScale);
  if (clamped === scale) return;

  const worldX = (viewportX - panX) / scale;
  const worldY = (viewportY - panY) / scale;
  scale = clamped;
  panX = viewportX - worldX * scale;
  panY = viewportY - worldY * scale;
  applyTransform();
}

function fitTimelineToView() {
  fitScale = getFitScale();
  scale = fitScale;
  centerPan();
}

function revealTimelineView() {
  fitTimelineToView();
  if (dom.timelineScroll) {
    dom.timelineScroll.classList.add("timeline-view--ready");
  }
}

function prepareTimelineView() {
  if (dom.timelineScroll) {
    dom.timelineScroll.classList.remove("timeline-view--ready");
  }
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
  prepareTimelineView();
  dom.timelineModal.classList.remove("hidden");
  dom.timelineModal.setAttribute("aria-hidden", "false");
  if (dom.timelineImage && dom.timelineImage.complete && dom.timelineImage.naturalWidth > 0) {
    revealTimelineView();
    requestAnimationFrame(revealTimelineView);
  }
}

function closeTimelineModal() {
  if (!dom.timelineModal) return;
  dom.timelineModal.classList.add("hidden");
  dom.timelineModal.setAttribute("aria-hidden", "true");
  prepareTimelineView();
  dragState = null;
  if (dom.timelineScroll) dom.timelineScroll.classList.remove("is-dragging");
}

function getTouchDistance(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

function updateDragPan() {
  rafId = 0;
  if (!dragState) return;

  panX = dragState.startPanX + (dragState.clientX - dragState.startX);
  panY = dragState.startPanY + (dragState.clientY - dragState.startY);
  applyTransform();
}

function queueDragPan(clientX, clientY) {
  if (!dragState) return;
  dragState.clientX = clientX;
  dragState.clientY = clientY;
  if (!rafId) {
    rafId = requestAnimationFrame(updateDragPan);
  }
}

function setupTimelineDragPan() {
  const viewport = dom.timelineScroll;
  if (!viewport) return;

  if (dom.timelineImage) {
    dom.timelineImage.draggable = false;
  }

  viewport.addEventListener("pointerdown", function (event) {
    if (event.button !== 0) return;
    dragState = {
      startX: event.clientX,
      startY: event.clientY,
      clientX: event.clientX,
      clientY: event.clientY,
      startPanX: panX,
      startPanY: panY
    };
    viewport.classList.add("is-dragging");
    viewport.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  viewport.addEventListener("pointermove", function (event) {
    if (!dragState || !viewport.hasPointerCapture(event.pointerId)) return;
    queueDragPan(event.clientX, event.clientY);
  });

  function endDrag(event) {
    if (!dragState) return;
    if (event && viewport.hasPointerCapture(event.pointerId)) {
      viewport.releasePointerCapture(event.pointerId);
    }
    dragState = null;
    viewport.classList.remove("is-dragging");
  }

  viewport.addEventListener("pointerup", endDrag);
  viewport.addEventListener("pointercancel", endDrag);
}

function setupTimelineZoom() {
  const viewport = dom.timelineScroll;
  if (!viewport) return;

  if (dom.timelineZoomIn) {
    dom.timelineZoomIn.addEventListener("click", function () {
      const { width, height } = getViewportSize();
      zoomAt(width / 2, height / 2, scale * ZOOM_BUTTON_FACTOR);
    });
  }

  if (dom.timelineZoomOut) {
    dom.timelineZoomOut.addEventListener("click", function () {
      const { width, height } = getViewportSize();
      zoomAt(width / 2, height / 2, scale / ZOOM_BUTTON_FACTOR);
    });
  }

  if (dom.timelineZoomFit) {
    dom.timelineZoomFit.addEventListener("click", fitTimelineToView);
  }

  viewport.addEventListener("wheel", function (event) {
    if (!dom.timelineModal || dom.timelineModal.classList.contains("hidden")) return;
    event.preventDefault();

    const rect = viewport.getBoundingClientRect();
    const anchorX = event.clientX - rect.left;
    const anchorY = event.clientY - rect.top;
    const factor = Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY);
    zoomAt(anchorX, anchorY, scale * factor);
  }, { passive: false });

  viewport.addEventListener("touchstart", function (event) {
    if (event.touches.length === 2) {
      pinchStartDistance = getTouchDistance(event.touches);
      pinchStartScale = scale;
    }
  }, { passive: true });

  viewport.addEventListener("touchmove", function (event) {
    if (event.touches.length !== 2 || pinchStartDistance <= 0) return;

    event.preventDefault();
    const distance = getTouchDistance(event.touches);
    const rect = viewport.getBoundingClientRect();
    const anchorX = (event.touches[0].clientX + event.touches[1].clientX) / 2 - rect.left;
    const anchorY = (event.touches[0].clientY + event.touches[1].clientY) / 2 - rect.top;
    zoomAt(anchorX, anchorY, pinchStartScale * (distance / pinchStartDistance));
  }, { passive: false });

  viewport.addEventListener("touchend", function () {
    pinchStartDistance = 0;
  });
}

export function setupTimeline() {
  if (dom.timelineImage) {
    dom.timelineImage.addEventListener("load", function () {
      setImageNaturalSize();
      if (!dom.timelineModal || dom.timelineModal.classList.contains("hidden")) return;
      prepareTimelineView();
      requestAnimationFrame(revealTimelineView);
    });

    if (dom.timelineImage.complete && dom.timelineImage.naturalWidth > 0) {
      setImageNaturalSize();
    }
  }

  setupTimelineDragPan();
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
