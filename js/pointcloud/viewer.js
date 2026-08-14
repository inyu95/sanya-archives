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
  isLargeTouchDisplay,
  getPointCloudResolutionScale,
  getPointCloudBaseScreenSpaceError,
  configurePointCloudCameraFeel,
  getPointCloudDefaultRange,
  initPointCloudViewState,
  applyPointCloudViewState,
  setupPointCloudModalZoom,
  teardownPointCloudModalZoom
} from "./camera.js";

/** @type {Array<{ assetId: number, index: number, card: HTMLElement, viewerId: string, viewer: object|null, tileset: object|null }>} */
let pointCloudPreviewEntries = [];

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

function normalizePointCloudAssetIds(assetIds) {
  if (assetIds == null) return [];
  if (Array.isArray(assetIds)) {
    return assetIds.filter(function (id) { return Number.isFinite(id) && id > 0; });
  }
  if (typeof assetIds === "number" && assetIds > 0) return [assetIds];
  return [];
}

function getCurrentPointCloudAssetId() {
  const ids = state.currentPointCloudAssetIds;
  if (!ids.length) return null;
  return ids[state.currentPointCloudIndex] || ids[0];
}

function buildPointCloudDisplayTitle() {
  const total = state.currentPointCloudAssetIds.length;
  const base = state.currentPointCloudTitle || "3Dスキャン";
  if (total <= 1) return base;
  return base + " (" + (state.currentPointCloudIndex + 1) + "/" + total + ")";
}

function updatePointCloudModalNav() {
  const total = state.currentPointCloudAssetIds.length;
  const hasMultiple = total > 1;
  if (dom.pointcloudModalPrev) {
    dom.pointcloudModalPrev.disabled = !hasMultiple;
  }
  if (dom.pointcloudModalNext) {
    dom.pointcloudModalNext.disabled = !hasMultiple;
  }
  if (dom.pointcloudModalCounter) {
    dom.pointcloudModalCounter.textContent = hasMultiple
      ? (state.currentPointCloudIndex + 1) + " / " + total
      : "";
  }
  if (dom.pointcloudModalTitle) {
    dom.pointcloudModalTitle.textContent = buildPointCloudDisplayTitle();
  }
}

function openPointCloudModal(title) {
  if (!dom.pointcloudModal) return;
  if (title) {
    state.currentPointCloudTitle = title;
  }
  updatePointCloudModalNav();
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

function destroyPointCloudPreviewViewers() {
  state.pointCloudPreviewLoadGeneration++;
  pointCloudPreviewEntries.forEach(function (entry) {
    removeTilesetFromViewer(entry.tileset, entry.viewer);
    if (isViewerUsable(entry.viewer)) {
      entry.viewer.destroy();
    }
  });
  pointCloudPreviewEntries = [];
  if (dom.pointcloudPreviewList) {
    dom.pointcloudPreviewList.innerHTML = "";
  }
}

function createPreviewCard(assetId, index, total) {
  const card = document.createElement("div");
  card.className = "pointcloud-preview loading";
  card.setAttribute("role", "button");
  card.tabIndex = 0;
  card.setAttribute("aria-label", "3Dスキャンを拡大表示");

  const viewerHost = document.createElement("div");
  const viewerId = "pointcloud-preview-viewer-" + index + "-" + assetId;
  viewerHost.className = "pointcloud-preview-viewer";
  viewerHost.id = viewerId;

  const placeholder = document.createElement("div");
  placeholder.className = "pointcloud-preview-placeholder";
  const placeholderLabel = document.createElement("span");
  placeholderLabel.textContent = "3Dスキャンを読み込み中...";
  placeholder.appendChild(placeholderLabel);

  const hint = document.createElement("span");
  hint.className = "pointcloud-preview-hint";
  hint.textContent = "クリックで拡大表示";

  card.appendChild(viewerHost);
  card.appendChild(placeholder);
  card.appendChild(hint);

  if (total > 1) {
    const badge = document.createElement("span");
    badge.className = "pointcloud-preview-badge";
    badge.textContent = (index + 1) + " / " + total;
    card.appendChild(badge);
  }

  return { card: card, viewerId: viewerId };
}

function setPreviewCardLoading(card, loading, previewReady) {
  if (!card) return;
  card.classList.toggle("loading", loading);
  const placeholder = card.querySelector(".pointcloud-preview-placeholder");
  if (!placeholder) return;
  const showPlaceholder = loading || !previewReady;
  placeholder.classList.toggle("hidden", !showPlaceholder);
  const label = placeholder.querySelector("span");
  if (label) {
    label.textContent = loading
      ? "3Dスキャンを読み込み中..."
      : "クリックして3Dスキャンを表示";
  }
}

function createPointCloudViewer(containerId, isPreview) {
  const largeTouch = isLargeTouchDisplay();
  const cloudViewer = new Cesium.Viewer(containerId, {
    baseLayer: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    animation: false,
    timeline: false,
    infoBox: false,
    selectionIndicator: false,
    requestRenderMode: isPreview,
    useDefaultRenderLoop: true,
    // iOS Metal WebGL で半透明パスが黒くなる事例がある
    orderIndependentTranslucency: false,
    contextOptions: {
      webgl: {
        alpha: false,
        antialias: !largeTouch,
        powerPreference: "default",
        failIfMajorPerformanceCaveat: false
      }
    }
  });

  const scene = cloudViewer.scene;
  scene.skyBox.show = false;
  scene.skyAtmosphere.show = false;
  scene.sun.show = false;
  scene.moon.show = false;
  scene.globe.show = false;
  scene.fog.enabled = false;
  scene.backgroundColor = Cesium.Color.fromCssColorString("#2a2a2a");
  // 近接室内表示では log depth が深度精度を保つ（far/near は frustum 更新側で抑制）
  scene.logarithmicDepthBuffer = true;
  scene.highDynamicRange = false;
  scene.fxaa = false;
  if (typeof scene.msaaSamples === "number") {
    scene.msaaSamples = 1;
  }
  cloudViewer.resolutionScale = getPointCloudResolutionScale();
  scene.screenSpaceCameraController.enableCollisionDetection = false;
  // 室内スキャン近接時、デフォルト near≈1m だと手前がクリップされて真っ黒になる
  if (cloudViewer.camera.frustum && typeof cloudViewer.camera.frustum.near === "number") {
    cloudViewer.camera.frustum.near = 0.001;
    cloudViewer.camera.frustum.far = 200;
  }
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
    // iPad: 失敗した高LODを避けるため SSE を段階的に上げる
    if (isLargeTouchDisplay()) {
      tileset._ipadSseBoost = (tileset._ipadSseBoost || 0) + 48;
    }
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
  tileset.maximumScreenSpaceError = getPointCloudBaseScreenSpaceError();
  tileset.backFaceCulling = false;
  // 高詳細タイルを一気に積まず、段階的に差し替える（iPad の GPU メモリ枯渇対策）
  if ("skipLevelOfDetail" in tileset) {
    tileset.skipLevelOfDetail = true;
  }
  if ("skipScreenSpaceErrorFactor" in tileset && isLargeTouchDisplay()) {
    tileset.skipScreenSpaceErrorFactor = 32;
  }
  if ("skipLevels" in tileset && isLargeTouchDisplay()) {
    tileset.skipLevels = 2;
  }
  if ("preferLeaves" in tileset) {
    tileset.preferLeaves = false;
  }
  if ("loadSiblings" in tileset) {
    tileset.loadSiblings = false;
  }
  if ("immediatelyLoadDesiredLevelOfDetail" in tileset) {
    tileset.immediatelyLoadDesiredLevelOfDetail = false;
  }
  // cacheBytes を下げすぎると memoryAdjustedScreenSpaceError で黒テクスチャになる
  if ("cacheBytes" in tileset && isLargeTouchDisplay()) {
    tileset.cacheBytes = 256 * 1024 * 1024;
  }
  if ("maximumCacheOverflowBytes" in tileset && isLargeTouchDisplay()) {
    tileset.maximumCacheOverflowBytes = 128 * 1024 * 1024;
  }
  if (tileset.imageBasedLighting) {
    tileset.imageBasedLighting.imageBasedLightingFactor = new Cesium.Cartesian2(0.0, 0.0);
  }
  if (!tileset.pointCloudShading) return;
  tileset.pointCloudShading.attenuation = true;
  // 近接時に点が疎になって背景（黒）だけ見えるのを抑える
  tileset.pointCloudShading.geometricErrorScale = 1.25;
  tileset.pointCloudShading.maximumAttenuation = 16;
  tileset.pointCloudShading.baseResolution = 0.02;
  // EDL は近接で過暗〜真っ黒に落ちやすいので無効化
  tileset.pointCloudShading.eyeDomeLighting = false;
  // 光源なしだと normalShading が点群を黒く落とすことがある
  tileset.pointCloudShading.normalShading = false;
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

function mountTilesetInViewer(tileset, targetViewer, isPreview, isLoadActive, previousTileset) {
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
  configurePointCloudTileset(tileset);
  if (previousTileset) {
    removeTilesetFromViewer(previousTileset, targetViewer);
  } else if (!isPreview) {
    removeTilesetFromViewer(state.pointCloudTileset, targetViewer);
  }

  targetViewer.scene.primitives.add(tileset);
  targetViewer.resize();

  return new Promise(function (resolve, reject) {
    requestAnimationFrame(function () {
      try {
        assertLoadActive();
        const flyPromise = flyToPointCloudInViewer(targetViewer, tileset, isPreview);
        if (!isPreview) {
          Promise.resolve(flyPromise).then(function () {
            if (!isLoadActive() || !isViewerUsable(targetViewer)) return;
            const pitch = Cesium.Math.toRadians(-35);
            const range = getPointCloudDefaultRange(tileset, false);
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
  if (!state.currentPointCloudAssetIds.length) return;
  if (!dom.pointcloudPreviewSection || dom.pointcloudPreviewSection.classList.contains("hidden")) return;
  clearPointCloudTilesetCache();
  loadPointCloudPreview(state.currentPointCloudAssetIds, state.currentPointCloudTitle);
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
  if (reloadPreview) {
    reloadPointCloudPreviewIfNeeded();
  }
}

export function clearPointCloudPreview() {
  destroyPointCloudPreviewViewers();
  state.currentPointCloudAssetId = null;
  state.currentPointCloudAssetIds = [];
  state.currentPointCloudIndex = 0;
  state.currentPointCloudTitle = "";
  showPointCloudPreviewSection(false);
  clearPointCloudTilesetCache();
}

export function clearPointCloud() {
  clearPointCloudModal();
  clearPointCloudPreview();
}

function loadPreviewEntry(entry, loadGeneration) {
  setPreviewCardLoading(entry.card, true, false);

  waitForContainerSize(entry.viewerId)
    .then(function () {
      if (loadGeneration !== state.pointCloudPreviewLoadGeneration) return null;
      entry.viewer = createPointCloudViewer(entry.viewerId, true);
      return new Promise(function (resolve, reject) {
        requestAnimationFrame(function () {
          if (!isViewerUsable(entry.viewer)) {
            reject(new Error("プレビュービューアの初期化に失敗しました"));
            return;
          }
          entry.viewer.resize();
          resolve(entry.viewer);
        });
      });
    })
    .then(function (previewViewer) {
      if (!previewViewer || loadGeneration !== state.pointCloudPreviewLoadGeneration) return null;
      return mountPreviewTileset(previewViewer, entry.assetId, loadGeneration, entry.tileset);
    })
    .then(function (tileset) {
      if (!tileset || loadGeneration !== state.pointCloudPreviewLoadGeneration) return;
      entry.tileset = tileset;
      setPreviewCardLoading(entry.card, false, true);
    })
    .catch(function (err) {
      if (loadGeneration !== state.pointCloudPreviewLoadGeneration) return;
      if (err && err.code === "LOAD_CANCELLED") return;
      entry.card.classList.remove("loading");
      setPreviewCardLoading(entry.card, false, false);
      const label = entry.card.querySelector(".pointcloud-preview-placeholder span");
      if (label) {
        label.textContent = "3Dスキャンの読み込みに失敗しました";
      }
      console.error("3Dスキャンプレビューの読み込みに失敗:", entry.assetId, err);
    });
}

export function loadPointCloudPreview(assetIds, title) {
  const ids = normalizePointCloudAssetIds(assetIds);
  if (!ids.length) {
    clearPointCloudPreview();
    return;
  }

  destroyPointCloudPreviewViewers();
  clearPointCloudTilesetCache();

  state.currentPointCloudAssetIds = ids;
  state.currentPointCloudIndex = 0;
  state.currentPointCloudAssetId = ids[0];
  state.currentPointCloudTitle = title || "3Dスキャン";
  showPointCloudPreviewSection(true);

  if (!dom.pointcloudPreviewList) return;

  state.pointCloudPreviewLoadGeneration++;
  const loadGeneration = state.pointCloudPreviewLoadGeneration;

  ids.forEach(function (assetId, index) {
    const preview = createPreviewCard(assetId, index, ids.length);
    dom.pointcloudPreviewList.appendChild(preview.card);

    const entry = {
      assetId: assetId,
      index: index,
      card: preview.card,
      viewerId: preview.viewerId,
      viewer: null,
      tileset: null
    };
    pointCloudPreviewEntries.push(entry);

    preview.card.addEventListener("click", function () {
      openPointCloudPopupAtIndex(index);
    });
    preview.card.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openPointCloudPopupAtIndex(index);
      }
    });

    loadPreviewEntry(entry, loadGeneration);
  });
}

function stepPointCloudScan(delta) {
  if (state.currentPointCloudAssetIds.length <= 1) return;
  if (!dom.pointcloudModal || dom.pointcloudModal.classList.contains("hidden")) return;

  const total = state.currentPointCloudAssetIds.length;
  const newIndex = (state.currentPointCloudIndex + delta + total) % total;
  state.currentPointCloudIndex = newIndex;
  state.currentPointCloudAssetId = state.currentPointCloudAssetIds[newIndex];
  updatePointCloudModalNav();
  reloadModalTileset();
}

function mountPreviewTileset(previewViewer, assetId, loadGeneration, previousTileset) {
  return createTilesetFromIon(assetId).then(function (tileset) {
    return mountTilesetInViewer(tileset, previewViewer, true, function () {
      return loadGeneration === state.pointCloudPreviewLoadGeneration;
    }, previousTileset);
  }).catch(function (err) {
    if (err && err.code === "LOAD_CANCELLED") {
      return null;
    }
    return createTilesetFromIon(assetId).then(function (tileset) {
      return mountTilesetInViewer(tileset, previewViewer, true, function () {
        return loadGeneration === state.pointCloudPreviewLoadGeneration;
      }, previousTileset);
    });
  });
}

function mountModalTileset(modalViewer, loadGeneration, assetId) {
  const targetAssetId = assetId || state.currentPointCloudAssetId;
  return getPointCloudTileset(targetAssetId).then(function (tileset) {
    return mountTilesetInViewer(tileset, modalViewer, false, function () {
      return loadGeneration === state.pointCloudModalLoadGeneration
        && state.pointCloudViewer === modalViewer;
    });
  }).catch(function (err) {
    if (err && err.code === "LOAD_CANCELLED") {
      return null;
    }
    clearPointCloudTilesetCache();
    return getPointCloudTileset(targetAssetId, true).then(function (tileset) {
      return mountTilesetInViewer(tileset, modalViewer, false, function () {
        return loadGeneration === state.pointCloudModalLoadGeneration
          && state.pointCloudViewer === modalViewer;
      });
    });
  });
}

function reloadModalTileset() {
  const assetId = getCurrentPointCloudAssetId();
  if (!assetId) return;

  const modalViewer = state.pointCloudViewer;
  if (!isViewerUsable(modalViewer)) return;

  state.pointCloudModalLoadGeneration++;
  const loadGeneration = state.pointCloudModalLoadGeneration;

  if (state.pointCloudTileset && isViewerUsable(modalViewer)) {
    teardownPointCloudModalZoom(modalViewer);
    removeTilesetFromViewer(state.pointCloudTileset, modalViewer);
  }
  state.pointCloudTileset = null;
  clearPointCloudTilesetCache();
  setStatus("3Dスキャンを読み込み中...");

  mountModalTileset(modalViewer, loadGeneration, assetId)
    .then(function (tileset) {
      if (!tileset || loadGeneration !== state.pointCloudModalLoadGeneration) {
        if (!tileset) {
          setStatus("3Dスキャンの読み込みが中断されました。もう一度お試しください。", "error");
        }
        return;
      }
      state.pointCloudTileset = tileset;
      hideStatus();
    })
    .catch(function (err) {
      if (loadGeneration !== state.pointCloudModalLoadGeneration) return;
      console.error("3Dスキャンの読み込みに失敗:", err);
      clearPointCloudModal(false);
      setStatus("3Dスキャンの読み込みに失敗しました: " + err.message, "error");
    });
}

function openPointCloudPopupAtIndex(index) {
  const ids = state.currentPointCloudAssetIds;
  if (!ids.length || index < 0 || index >= ids.length) return;

  state.currentPointCloudIndex = index;
  state.currentPointCloudAssetId = ids[index];
  openPointCloudPopup();
}

function openPointCloudPopup() {
  const assetId = getCurrentPointCloudAssetId();
  if (!assetId) return;

  destroyPointCloudPreviewViewers();
  openPointCloudModal();
  setStatus("3Dスキャンを読み込み中...");

  Promise.all([
    ensurePointCloudModalViewer(),
    getPointCloudTileset(assetId)
  ])
    .then(function (results) {
      const modalViewer = results[0];
      const loadGeneration = state.pointCloudModalLoadGeneration;
      if (!isViewerUsable(modalViewer) || state.pointCloudViewer !== modalViewer) {
        return null;
      }
      return mountModalTileset(modalViewer, loadGeneration, assetId);
    })
    .then(function (tileset) {
      if (!tileset) {
        setStatus("3Dスキャンの読み込みが中断されました。もう一度お試しください。", "error");
        return;
      }
      state.pointCloudTileset = tileset;
      hideStatus();
    })
    .catch(function (err) {
      console.error("3Dスキャンの読み込みに失敗:", err);
      clearPointCloudModal(false);
      setStatus("3Dスキャンの読み込みに失敗しました: " + err.message, "error");
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

  if (dom.pointcloudModalPrev) {
    dom.pointcloudModalPrev.addEventListener("click", function (event) {
      event.stopPropagation();
      stepPointCloudScan(-1);
    });
  }

  if (dom.pointcloudModalNext) {
    dom.pointcloudModalNext.addEventListener("click", function (event) {
      event.stopPropagation();
      stepPointCloudScan(1);
    });
  }

  document.addEventListener("keydown", function (event) {
    if (!dom.pointcloudModal || dom.pointcloudModal.classList.contains("hidden")) return;
    if (event.key === "ArrowLeft") {
      stepPointCloudScan(-1);
    } else if (event.key === "ArrowRight") {
      stepPointCloudScan(1);
    }
  });

  window.addEventListener("resize", function () {
    pointCloudPreviewEntries.forEach(function (entry) {
      if (isViewerUsable(entry.viewer)) {
        entry.viewer.resolutionScale = getPointCloudResolutionScale();
        entry.viewer.resize();
      }
    });
    if (isViewerUsable(state.pointCloudViewer) && dom.pointcloudModal && !dom.pointcloudModal.classList.contains("hidden")) {
      state.pointCloudViewer.resolutionScale = getPointCloudResolutionScale();
      state.pointCloudViewer.resize();
    }
  });
}
