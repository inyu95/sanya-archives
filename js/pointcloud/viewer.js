import {
  LOCAL_TILESET_VIEW_LON,
  LOCAL_TILESET_VIEW_LAT,
  LOCAL_TILESET_VIEW_HEIGHT
} from "../config/constants.js";
import { dom } from "../config/dom.js";
import { state } from "../state.js";
import { setStatus, hideStatus } from "../ui/status.js";
import {
  isViewerUsable,
  configurePointCloudCameraFeel,
  getPointCloudDefaultRange,
  initPointCloudViewState,
  applyPointCloudViewState,
  setupPointCloudModalZoom,
  teardownPointCloudModalZoom
} from "./camera.js";

function waitForContainerSize(containerId, maxAttempts) {
  const limit = maxAttempts || 120;
  return new Promise(function (resolve, reject) {
    let attempts = 0;
    function check() {
      const el = document.getElementById(containerId);
      if (el && el.clientWidth > 0 && el.clientHeight > 0) {
        resolve(el);
        return;
      }
      attempts++;
      if (attempts >= limit) {
        reject(new Error("コンテナサイズを取得できません: " + containerId));
        return;
      }
      requestAnimationFrame(check);
    }
    check();
  });
}

function showPointCloudPreviewSection(show) {
  if (!dom.pointcloudPreviewSection) return;
  dom.pointcloudPreviewSection.classList.toggle("hidden", !show);
}

function openPointCloudModal(title) {
  if (!dom.pointcloudModal) return;
  if (dom.pointcloudModalTitle) {
    dom.pointcloudModalTitle.textContent = title || "点群";
  }
  dom.pointcloudModal.classList.remove("hidden");
}

function closePointCloudModal() {
  if (!dom.pointcloudModal) return;
  dom.pointcloudModal.classList.add("hidden");
}

function destroyPointCloudModalViewer() {
  state.pointCloudModalLoadGeneration++;
  if (state.pointCloudTileset && isViewerUsable(state.pointCloudViewer)) {
    state.pointCloudViewer.scene.primitives.remove(state.pointCloudTileset);
  }
  state.pointCloudTileset = null;
  if (isViewerUsable(state.pointCloudViewer)) {
    teardownPointCloudModalZoom(state.pointCloudViewer);
    state.pointCloudViewer.destroy();
  }
  state.pointCloudViewer = null;
  const container = document.getElementById("pointcloud-viewer");
  if (container) container.innerHTML = "";
}

function destroyPointCloudPreviewViewer() {
  state.pointCloudPreviewLoadGeneration++;
  removeTilesetFromViewer(state.pointCloudPreviewTileset, state.pointCloudPreviewViewer);
  state.pointCloudPreviewTileset = null;
  if (isViewerUsable(state.pointCloudPreviewViewer)) {
    state.pointCloudPreviewViewer.destroy();
  }
  state.pointCloudPreviewViewer = null;
  const container = document.getElementById("pointcloud-preview-viewer");
  if (container) container.innerHTML = "";
}

function createPointCloudViewer(containerId, isPreview) {
  const cloudViewer = new Cesium.Viewer(containerId, {
    baseLayer: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    infoBox: false,
    selectionIndicator: false,
    requestRenderMode: false,
    useDefaultRenderLoop: true
  });

  const scene = cloudViewer.scene;
  scene.skyBox.show = false;
  scene.skyAtmosphere.show = false;
  scene.sun.show = false;
  scene.moon.show = false;
  scene.globe.show = false;
  scene.fog.enabled = false;
  scene.backgroundColor = Cesium.Color.fromCssColorString("#2a2a2a");
  scene.screenSpaceCameraController.enableCollisionDetection = false;
  const controller = scene.screenSpaceCameraController;
  if (isPreview) {
    controller.enableRotate = false;
    controller.enableTranslate = false;
    controller.enableZoom = false;
    controller.enableTilt = false;
    controller.enableLook = false;
  } else {
    configurePointCloudCameraFeel(controller);
  }
  if (scene.imageBasedLighting) {
    scene.imageBasedLighting.imageBasedLightingFactor = new Cesium.Cartesian2(0.0, 0.0);
  }

  return cloudViewer;
}

function attachTilesetDiagnostics(tileset) {
  tileset.tileFailed.addEventListener(function (error) {
    console.error("3D Tiles tile failed:", error.url, error.message);
  });
}

function clearPointCloudTilesetCache() {
  if (state.cachedTileset && !state.cachedTileset.isDestroyed()) {
    state.cachedTileset.destroy();
  }
  state.cachedTileset = null;
  state.cachedTilesetAssetId = null;
  state.cachedTilesetPromise = null;
}

function createTilesetFromIon(assetId) {
  return Cesium.Cesium3DTileset.fromIonAssetId(assetId, {
    cullWithChildrenBounds: false
  }).then(function (tileset) {
    attachTilesetDiagnostics(tileset);
    configurePointCloudTileset(tileset);
    return tileset;
  });
}

function getPointCloudTileset(assetId, forceFresh) {
  if (!assetId) {
    return Promise.reject(new Error("assetIdが必要です"));
  }
  if (!forceFresh && state.cachedTilesetAssetId === assetId) {
    if (state.cachedTileset && !state.cachedTileset.isDestroyed()) {
      return Promise.resolve(state.cachedTileset);
    }
    if (state.cachedTilesetPromise) {
      return state.cachedTilesetPromise;
    }
  }
  if (forceFresh) {
    clearPointCloudTilesetCache();
  }
  state.cachedTilesetAssetId = assetId;
  state.cachedTilesetPromise = createTilesetFromIon(assetId)
    .then(function (tileset) {
      state.cachedTileset = tileset;
      return tileset;
    })
    .catch(function (err) {
      clearPointCloudTilesetCache();
      throw err;
    });
  return state.cachedTilesetPromise;
}

function waitForFirstTilePaint(tileset, timeoutMs) {
  const timeout = timeoutMs || 8000;
  return new Promise(function (resolve) {
    if (tileset.tilesLoaded) {
      resolve();
      return;
    }
    let settled = false;
    function finish() {
      if (settled) return;
      settled = true;
      resolve();
    }
    const removeVisible = tileset.tileVisible.addEventListener(finish);
    const removeInitial = tileset.initialTilesLoaded.addEventListener(finish);
    setTimeout(function () {
      removeVisible();
      removeInitial();
      finish();
    }, timeout);
  });
}

function ensurePointCloudPreviewViewer() {
  if (isViewerUsable(state.pointCloudPreviewViewer)) {
    state.pointCloudPreviewViewer.resize();
    return Promise.resolve(state.pointCloudPreviewViewer);
  }
  return waitForContainerSize("pointcloud-preview-viewer").then(function () {
    state.pointCloudPreviewViewer = createPointCloudViewer("pointcloud-preview-viewer", true);
    return new Promise(function (resolve, reject) {
      requestAnimationFrame(function () {
        if (!isViewerUsable(state.pointCloudPreviewViewer)) {
          reject(new Error("プレビュービューアの初期化に失敗しました"));
          return;
        }
        state.pointCloudPreviewViewer.resize();
        resolve(state.pointCloudPreviewViewer);
      });
    });
  });
}

function ensurePointCloudModalViewer() {
  return waitForContainerSize("pointcloud-viewer").then(function () {
    destroyPointCloudModalViewer();
    state.pointCloudViewer = createPointCloudViewer("pointcloud-viewer");
    return new Promise(function (resolve, reject) {
      requestAnimationFrame(function () {
        if (!isViewerUsable(state.pointCloudViewer)) {
          reject(new Error("モーダルビューアの初期化に失敗しました"));
          return;
        }
        state.pointCloudViewer.resize();
        resolve(state.pointCloudViewer);
      });
    });
  });
}

function applyLocalTilesetViewOffset(tileset) {
  if (tileset._localViewOffsetApplied) return;
  tileset.modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(
    Cesium.Cartesian3.fromDegrees(
      LOCAL_TILESET_VIEW_LON,
      LOCAL_TILESET_VIEW_LAT,
      LOCAL_TILESET_VIEW_HEIGHT
    )
  );
  tileset._localViewOffsetApplied = true;
}

function configurePointCloudTileset(tileset) {
  applyLocalTilesetViewOffset(tileset);
  tileset.maximumScreenSpaceError = 8;
  tileset.backFaceCulling = false;
  if (tileset.imageBasedLighting) {
    tileset.imageBasedLighting.imageBasedLightingFactor = new Cesium.Cartesian2(0.0, 0.0);
  }
  if (!tileset.pointCloudShading) return;
  tileset.pointCloudShading.attenuation = true;
  tileset.pointCloudShading.geometricErrorScale = 0.5;
  tileset.pointCloudShading.maximumAttenuation = 4;
  tileset.pointCloudShading.baseResolution = 0.05;
  tileset.pointCloudShading.eyeDomeLighting = true;
  tileset.pointCloudShading.eyeDomeLightingStrength = 1.0;
  tileset.pointCloudShading.eyeDomeLightingRadius = 2.0;
}

function flyToPointCloudInViewer(targetViewer, tileset, isPreview) {
  const range = getPointCloudDefaultRange(tileset, isPreview);
  const pitch = Cesium.Math.toRadians(isPreview ? -40 : -35);

  targetViewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  return targetViewer.flyTo(tileset, {
    duration: isPreview ? 1.5 : 1.2,
    offset: new Cesium.HeadingPitchRange(0, pitch, range)
  });
}

function removeTilesetFromViewer(tileset, targetViewer) {
  if (tileset && isViewerUsable(targetViewer)) {
    targetViewer.scene.primitives.remove(tileset);
    targetViewer.scene.requestRender();
  }
}

function mountTilesetInViewer(tileset, targetViewer, isPreview, isLoadActive) {
  function assertLoadActive() {
    if (!isLoadActive()) {
      const err = new Error("LOAD_CANCELLED");
      err.code = "LOAD_CANCELLED";
      throw err;
    }
    if (!isViewerUsable(targetViewer)) {
      const err = new Error("LOAD_CANCELLED");
      err.code = "LOAD_CANCELLED";
      throw err;
    }
  }

  assertLoadActive();
  if (isPreview) {
    removeTilesetFromViewer(state.pointCloudPreviewTileset, targetViewer);
  } else {
    removeTilesetFromViewer(state.pointCloudTileset, targetViewer);
  }

  targetViewer.scene.primitives.add(tileset);
  targetViewer.resize();

  return new Promise(function (resolve, reject) {
    requestAnimationFrame(function () {
      try {
        assertLoadActive();
        const pitch = Cesium.Math.toRadians(-35);
        const range = getPointCloudDefaultRange(tileset, false);
        const flyPromise = flyToPointCloudInViewer(targetViewer, tileset, isPreview);
        if (!isPreview) {
          Promise.resolve(flyPromise).then(function () {
            if (!isLoadActive() || !isViewerUsable(targetViewer)) return;
            setupPointCloudModalZoom(targetViewer, tileset, 0, pitch, range);
          });
        }
        targetViewer.scene.requestRender();
        waitForFirstTilePaint(tileset).then(function () {
          assertLoadActive();
          targetViewer.scene.requestRender();
          resolve(tileset);
        }).catch(reject);
      } catch (err) {
        reject(err);
      }
    });
  });
}

function reloadPointCloudPreviewIfNeeded() {
  if (!state.currentPointCloudAssetId) return;
  if (!dom.pointcloudPreviewSection || dom.pointcloudPreviewSection.classList.contains("hidden")) return;
  clearPointCloudTilesetCache();
  loadPointCloudPreview(state.currentPointCloudAssetId, state.currentPointCloudTitle);
}

function resetPointCloudView() {
  if (!isViewerUsable(state.pointCloudViewer) || !state.pointCloudTileset || state.pointCloudTileset.isDestroyed()) {
    return;
  }
  const pitch = Cesium.Math.toRadians(-35);
  const range = getPointCloudDefaultRange(state.pointCloudTileset, false);
  initPointCloudViewState(state.pointCloudViewer, state.pointCloudTileset, 0, pitch, range);
  applyPointCloudViewState(state.pointCloudViewer, state.pointCloudTileset);
}

export function clearPointCloudModal(reloadPreview) {
  destroyPointCloudModalViewer();
  closePointCloudModal();
  setPointCloudPreviewLoading(false);
  if (reloadPreview) {
    reloadPointCloudPreviewIfNeeded();
  }
}

export function clearPointCloudPreview() {
  state.pointCloudPreviewLoadGeneration++;
  destroyPointCloudPreviewViewer();
  state.currentPointCloudAssetId = null;
  state.currentPointCloudTitle = "";
  showPointCloudPreviewSection(false);
  setPointCloudPreviewLoading(false);
  clearPointCloudTilesetCache();
}

export function clearPointCloud() {
  clearPointCloudModal();
  clearPointCloudPreview();
}

export function loadPointCloudPreview(assetId, title) {
  if (state.currentPointCloudAssetId !== assetId) {
    destroyPointCloudPreviewViewer();
    clearPointCloudTilesetCache();
  }
  state.currentPointCloudAssetId = assetId;
  state.currentPointCloudTitle = title || "3Dモデル";
  showPointCloudPreviewSection(true);
  setPointCloudPreviewLoading(true);

  state.pointCloudPreviewLoadGeneration++;
  const loadGeneration = state.pointCloudPreviewLoadGeneration;

  ensurePointCloudPreviewViewer()
    .then(function (previewViewer) {
      if (loadGeneration !== state.pointCloudPreviewLoadGeneration) return null;
      return mountPreviewTileset(previewViewer, assetId, loadGeneration);
    })
    .then(function (tileset) {
      if (!tileset || loadGeneration !== state.pointCloudPreviewLoadGeneration) return;
      state.pointCloudPreviewTileset = tileset;
      setPointCloudPreviewLoading(false, true);
    })
    .catch(function (err) {
      if (loadGeneration !== state.pointCloudPreviewLoadGeneration) return;
      showPointCloudPreviewSection(false);
      setPointCloudPreviewLoading(false, false);
      console.error("3Dモデルプレビューの読み込みに失敗:", err);
      setStatus("3Dモデルプレビューの読み込みに失敗しました: " + err.message, "error");
    });
}

function setPointCloudPreviewLoading(loading, previewReady) {
  if (!dom.pointcloudPreview) return;
  dom.pointcloudPreview.classList.toggle("loading", loading);
  const placeholder = document.getElementById("pointcloud-preview-placeholder");
  if (placeholder) {
    const showPlaceholder = loading || !previewReady;
    placeholder.classList.toggle("hidden", !showPlaceholder);
    const label = placeholder.querySelector("span");
    if (label) {
      label.textContent = loading
        ? "3Dモデルを読み込み中..."
        : "クリックして3Dモデルを表示";
    }
  }
}

function mountPreviewTileset(previewViewer, assetId, loadGeneration) {
  return getPointCloudTileset(assetId).then(function (tileset) {
    return mountTilesetInViewer(tileset, previewViewer, true, function () {
      return loadGeneration === state.pointCloudPreviewLoadGeneration;
    });
  }).catch(function (err) {
    if (err && err.code === "LOAD_CANCELLED") {
      return null;
    }
    clearPointCloudTilesetCache();
    return getPointCloudTileset(assetId, true).then(function (tileset) {
      return mountTilesetInViewer(tileset, previewViewer, true, function () {
        return loadGeneration === state.pointCloudPreviewLoadGeneration;
      });
    });
  });
}

function mountModalTileset(modalViewer, loadGeneration) {
  return getPointCloudTileset(state.currentPointCloudAssetId).then(function (tileset) {
    return mountTilesetInViewer(tileset, modalViewer, false, function () {
      return loadGeneration === state.pointCloudModalLoadGeneration
        && state.pointCloudViewer === modalViewer;
    });
  }).catch(function (err) {
    if (err && err.code === "LOAD_CANCELLED") {
      return null;
    }
    clearPointCloudTilesetCache();
    return getPointCloudTileset(state.currentPointCloudAssetId, true).then(function (tileset) {
      return mountTilesetInViewer(tileset, modalViewer, false, function () {
        return loadGeneration === state.pointCloudModalLoadGeneration
          && state.pointCloudViewer === modalViewer;
      });
    });
  });
}

function openPointCloudPopup() {
  if (!state.currentPointCloudAssetId) return;

  destroyPointCloudPreviewViewer();
  openPointCloudModal(state.currentPointCloudTitle);
  setStatus("3Dモデルを読み込み中...");

  Promise.all([
    ensurePointCloudModalViewer(),
    getPointCloudTileset(state.currentPointCloudAssetId)
  ])
    .then(function (results) {
      const modalViewer = results[0];
      const loadGeneration = state.pointCloudModalLoadGeneration;
      if (!isViewerUsable(modalViewer) || state.pointCloudViewer !== modalViewer) {
        return null;
      }
      return mountModalTileset(modalViewer, loadGeneration);
    })
    .then(function (tileset) {
      if (!tileset) {
        setStatus("3Dモデルの読み込みが中断されました。もう一度お試しください。", "error");
        return;
      }
      state.pointCloudTileset = tileset;
      hideStatus();
    })
    .catch(function (err) {
      console.error("3Dモデルの読み込みに失敗:", err);
      clearPointCloudModal(false);
      setStatus("3Dモデルの読み込みに失敗しました: " + err.message, "error");
    });
}

export function setupPointCloudModal() {
  if (dom.pointcloudModalReset) {
    dom.pointcloudModalReset.addEventListener("click", function (event) {
      event.stopPropagation();
      resetPointCloudView();
    });
  }

  if (dom.pointcloudModalClose) {
    dom.pointcloudModalClose.addEventListener("click", function () {
      clearPointCloudModal(true);
    });
  }

  if (dom.pointcloudModalBackdrop) {
    dom.pointcloudModalBackdrop.addEventListener("click", function () {
      clearPointCloudModal(true);
    });
  }

  if (dom.pointcloudPreview) {
    dom.pointcloudPreview.addEventListener("click", openPointCloudPopup);
    dom.pointcloudPreview.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openPointCloudPopup();
      }
    });
  }

  window.addEventListener("resize", function () {
    if (isViewerUsable(state.pointCloudPreviewViewer) && dom.pointcloudPreviewSection && !dom.pointcloudPreviewSection.classList.contains("hidden")) {
      state.pointCloudPreviewViewer.resize();
    }
    if (isViewerUsable(state.pointCloudViewer) && dom.pointcloudModal && !dom.pointcloudModal.classList.contains("hidden")) {
      state.pointCloudViewer.resize();
    }
  });
}
