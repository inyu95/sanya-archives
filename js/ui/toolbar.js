import { dom } from "../config/dom.js";
import { state } from "../state.js";

export function mountCustomToolbarButtons() {
  if (!state.viewer) return;
  const toolbar = state.viewer.container.querySelector(".cesium-viewer-toolbar");
  if (!toolbar) return;

  const customButtons = [
    dom.toolbarNavActions,
    dom.modeSwitcher,
    dom.mapGeometrySwitcher,
    dom.cameraCaptureBtn,
    dom.toolbarMetaActions
  ].filter(Boolean);
  if (customButtons.length === 0) return;

  const customSet = new Set(customButtons);
  const firstCesiumButton = Array.from(toolbar.children).find(function (el) {
    return !customSet.has(el);
  });

  customButtons.slice().reverse().forEach(function (btn) {
    toolbar.insertBefore(btn, firstCesiumButton || null);
  });
}

export function syncToolbarMetaActionsVisibility() {
  if (!dom.toolbarMetaActions) return;
  dom.toolbarMetaActions.classList.toggle("hidden", !state.appMode);
}
