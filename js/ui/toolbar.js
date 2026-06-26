import { dom } from "../config/dom.js";
import { state } from "../state.js";

export function mountCustomToolbarButtons() {
  if (!state.viewer) return;
  const toolbar = state.viewer.container.querySelector(".cesium-viewer-toolbar");
  if (!toolbar) return;

  const customButtons = [dom.aboutBtn, dom.archiveListBtn, dom.homeBtn].filter(Boolean);
  if (customButtons.length === 0) return;

  const customSet = new Set(customButtons);
  const firstCesiumButton = Array.from(toolbar.children).find(function (el) {
    return !customSet.has(el);
  });

  customButtons.slice().reverse().forEach(function (btn) {
    toolbar.insertBefore(btn, firstCesiumButton || null);
  });
}
