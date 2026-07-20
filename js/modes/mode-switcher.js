import { MEMORY_TOWN_BRIGHTNESS } from "../config/constants.js";
import { dom } from "../config/dom.js";
import { state } from "../state.js";
import { setStatus } from "../ui/status.js";
import { hidePinInfo, closePhotoLightboxIfOpen, resetCameraZoomState } from "../info-panel.js";
import { clearPointCloudModal } from "../pointcloud/viewer.js";
import { flyToSanyaDistrict } from "../pins/pins.js";
import {
  renderMemoryPins,
  flyToMemoryPhotos,
  setMemoryPinsVisible,
  filterMemoryPhotosByQuery
} from "../memory/memory-pins.js";
import { applyFilters, renderYearFilterBar } from "../filters/filters.js?v=99";
import { applyHistoricalMapLayer, getCurrentMapYear } from "../imagery/historical-maps.js";

function setElementHidden(el, hidden) {
  if (!el) return;
  el.classList.toggle("hidden", Boolean(hidden));
}

/** 記憶モードではまちを少し暗くし、写真ピンを相対的に目立たせる */
export function syncMemoryTownAppearance() {
  const dim = state.appMode === "memory";
  const brightness = dim ? MEMORY_TOWN_BRIGHTNESS : 1;
  const style = dim
    ? new Cesium.Cesium3DTileStyle({
        color: "vec4(" + brightness + ", " + brightness + ", " + brightness + ", 1.0)"
      })
    : undefined;

  applyTilesetDimStyle(state.google3dTileset, style);
  applyTilesetDimStyle(state.fallbackBuildings, style);

  if (state.defaultImageryLayer && !state.historicalMapActive) {
    state.defaultImageryLayer.brightness = brightness;
  }

  if (state.viewer) state.viewer.scene.requestRender();
}

function applyTilesetDimStyle(tileset, style) {
  if (!tileset) return;
  tileset.colorBlendMode = Cesium.Cesium3DTileColorBlendMode.HIGHLIGHT;
  tileset.style = style;
}

/** モード切替時に視点を動かさない（進行中の飛行・ライトボックス復帰を止める） */
function preserveCameraOnModeSwitch() {
  closePhotoLightboxIfOpen({ restoreCamera: false });
  resetCameraZoomState();
  if (state.viewer) {
    state.viewer.camera.cancelFlight();
  }
}

function updateModeSwitcherUI() {
  const isLife = state.appMode === "life";
  const isMemory = state.appMode === "memory";

  if (dom.modeSwitchLife) {
    dom.modeSwitchLife.classList.toggle("active", isLife);
    dom.modeSwitchLife.setAttribute("aria-pressed", isLife ? "true" : "false");
  }
  if (dom.modeSwitchMemory) {
    dom.modeSwitchMemory.classList.toggle("active", isMemory);
    dom.modeSwitchMemory.setAttribute("aria-pressed", isMemory ? "true" : "false");
  }
}

function updateLifeChrome(visible) {
  // 起動画面では検索・フィルターを隠す（タイトル／モード選択と重ねない）
  setElementHidden(dom.leftPanel, !state.appMode);
  setElementHidden(dom.filterPanel, !visible);
  // 一覧はモード選択後に生活史・記憶の両方で表示
  setElementHidden(dom.archiveListBtn, !state.appMode);

  if (!visible) {
    setElementHidden(dom.yearFilterBar, true);
    setElementHidden(dom.archiveListPanel, true);
    hidePinInfo();
    clearPointCloudModal();
  }

  if (dom.searchInput) {
    dom.searchInput.placeholder = "キーワードで検索";
  }
  if (dom.searchCount) {
    dom.searchCount.textContent = "";
  }
}

function enterLifeMode(opts) {
  const options = opts || {};
  const shouldFly = options.flyTo !== false;

  if (!shouldFly) {
    preserveCameraOnModeSwitch();
  }

  state.appMode = "life";
  hidePinInfo();
  updateModeSwitcherUI();
  updateLifeChrome(true);
  setMemoryPinsVisible(false);
  syncMemoryTownAppearance();
  renderYearFilterBar({ syncMap: shouldFly });
  applyFilters();

  if (shouldFly) {
    // ピン描画は非同期のため、まず山谷地区へ確実にフォーカスする
    flyToSanyaDistrict();
  }

  setStatus(
    state.allPins.length
      ? state.allPins.length + " 件のピン（生活史偏）"
      : "生活史偏",
    "ok"
  );
}

function enterMemoryMode(opts) {
  const options = opts || {};
  const shouldFly = options.flyTo !== false;

  if (!shouldFly) {
    preserveCameraOnModeSwitch();
  }

  state.appMode = "memory";
  updateModeSwitcherUI();
  updateLifeChrome(false);

  state.mapGeometryMode = "3d";
  applyHistoricalMapLayer(getCurrentMapYear());

  syncMemoryTownAppearance();

  if (state.viewer) {
    state.viewer.entities.removeAll();
  }

  const query = dom.searchInput ? dom.searchInput.value : "";
  filterMemoryPhotosByQuery(query);
  setMemoryPinsVisible(true);
  renderMemoryPins(state.filteredMemoryPhotos, {
    onComplete: shouldFly
      ? function () {
          if (state.appMode !== "memory") return;
          if (
            state.memoryDataSource &&
            state.memoryDataSource.entities.values.length > 0
          ) {
            flyToMemoryPhotos();
          }
        }
      : null
  });

  if (shouldFly) {
    // 写真ピン描画前でも山谷へフォーカス（描画完了後にピン俯瞰へ更新）
    flyToSanyaDistrict();
  }

  const count = state.filteredMemoryPhotos.length;
  if (!state.memoryDataLoaded) {
    setStatus("過去写真を読み込み中...");
  } else if (count) {
    setStatus(count + " 件の写真（記憶偏）", "ok");
  } else {
    setStatus(
      "記憶偏（シート「過去写真」に写真を追加してください）",
      "error"
    );
  }
}

export function setAppMode(mode, opts) {
  if (mode === "memory") {
    enterMemoryMode(opts);
  } else {
    enterLifeMode(opts);
  }

  document.body.dataset.appMode = state.appMode || "";
  setElementHidden(dom.modeSwitcher, false);
  setElementHidden(dom.mapGeometrySwitcher, false);
  hideStartupOverlay();
}

function hideStartupOverlay() {
  if (!dom.startupTitle) return;
  dom.startupTitle.classList.remove("visible");
  dom.startupTitle.classList.add("startup-dismissed");
  dom.startupTitle.setAttribute("aria-hidden", "true");
}

function showStartupOverlay() {
  if (!dom.startupTitle) return;
  dom.startupTitle.classList.remove("startup-dismissed");
  dom.startupTitle.classList.add("visible");
  dom.startupTitle.setAttribute("aria-hidden", "false");
}

export function setupModeSwitcher() {
  showStartupOverlay();
  setElementHidden(dom.modeSwitcher, true);
  setElementHidden(dom.mapGeometrySwitcher, true);
  updateLifeChrome(false);

  if (dom.modeSelectLife) {
    dom.modeSelectLife.addEventListener("click", function () {
      setAppMode("life");
    });
  }
  if (dom.modeSelectMemory) {
    dom.modeSelectMemory.addEventListener("click", function () {
      setAppMode("memory");
    });
  }
  if (dom.modeSwitchLife) {
    dom.modeSwitchLife.addEventListener("click", function () {
      if (state.appMode === "life") return;
      // 右上切替では視点を維持（起動時のモード選択のみ飛移動作）
      setAppMode("life", { flyTo: false });
    });
  }
  if (dom.modeSwitchMemory) {
    dom.modeSwitchMemory.addEventListener("click", function () {
      if (state.appMode === "memory") return;
      setAppMode("memory", { flyTo: false });
    });
  }
}

/** 過去写真の取得直後など、記憶モード表示だけ先に更新する */
export function refreshMemoryModeIfActive() {
  if (state.appMode !== "memory") return;
  setAppMode("memory", { flyTo: false });
}

/** シート読込完了後、選択済みモードがあれば表示を再同期し山谷へフォーカス */
export function syncModeAfterDataLoad() {
  if (!state.appMode) return;
  setAppMode(state.appMode, { flyTo: true });
}
