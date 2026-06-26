import { dom } from "../config/dom.js";
import { state } from "../state.js";
import { hidePinInfo } from "../info-panel.js";
import { flyToPins } from "../pins/pins.js";
import { clearPointCloudModal } from "../pointcloud/viewer.js";
import { mountCustomToolbarButtons } from "./toolbar.js";
export function goToHomeView() {
  hidePinInfo();
  clearPointCloudModal();
  flyToPins();
}

function mountHomeButtonInToolbar() {
  mountCustomToolbarButtons();
}

export function setupHomeButton() {
  if (!dom.homeBtn) return;
  mountHomeButtonInToolbar();
  dom.homeBtn.addEventListener("click", goToHomeView);
}