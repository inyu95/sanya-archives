import { dom } from "../config/dom.js";
import { TIMELINE_IMAGE_URL } from "../config/constants.js";

function scrollTimelineToStart() {
  if (!dom.timelineScroll) return;
  dom.timelineScroll.scrollLeft = dom.timelineScroll.scrollWidth;
}

function openTimelineModal() {
  if (!dom.timelineModal) return;
  dom.timelineModal.classList.remove("hidden");
  dom.timelineModal.setAttribute("aria-hidden", "false");
  requestAnimationFrame(scrollTimelineToStart);
}

function closeTimelineModal() {
  if (!dom.timelineModal) return;
  dom.timelineModal.classList.add("hidden");
  dom.timelineModal.setAttribute("aria-hidden", "true");
}

export function setupTimeline() {
  if (dom.timelineImage) {
    dom.timelineImage.src = TIMELINE_IMAGE_URL;
    dom.timelineImage.addEventListener("load", scrollTimelineToStart);
  }

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
