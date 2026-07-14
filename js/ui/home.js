import { dom } from "../config/dom.js";
import { state } from "../state.js";
import { hidePinInfo } from "../info-panel.js";
import { flyToPins } from "../pins/pins.js";
import { flyToMemoryPhotos } from "../memory/memory-pins.js";
import { clearPointCloudModal } from "../pointcloud/viewer.js";

function goToHomeView() {
  hidePinInfo();
  clearPointCloudModal();
  if (state.appMode === "memory") {
    flyToMemoryPhotos();
    return;
  }
  flyToPins();
}

export function setupHomeButton() {
  if (!dom.homeBtn) return;
  dom.homeBtn.addEventListener("click", goToHomeView);
}
