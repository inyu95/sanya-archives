import {
  POINT_CLOUD_ZOOM_WHEEL_FACTOR,
  POINT_CLOUD_ZOOM_PINCH_FACTOR,
  POINT_CLOUD_ZOOM_DRAG_FACTOR,
  POINT_CLOUD_PAN_DRAG_FACTOR,
  POINT_CLOUD_ROTATE_DRAG_FACTOR
} from "../config/constants.js";
import { state } from "../state.js";

function getPointCloudScratch() {
  if (!state.pointCloudScratchPos) {
    state.pointCloudScratchPos = new Cesium.Cartesian3();
    state.pointCloudScratchA = new Cesium.Cartesian3();
    state.pointCloudScratchB = new Cesium.Cartesian3();
    state.pointCloudScratchHpr = new Cesium.HeadingPitchRange();
    state.pointCloudScratchEnu = new Cesium.Matrix4();
  }
  return {
    pos: state.pointCloudScratchPos,
    a: state.pointCloudScratchA,
    b: state.pointCloudScratchB,
    hpr: state.pointCloudScratchHpr,
    enu: state.pointCloudScratchEnu
  };
}

export function isViewerUsable(targetViewer) {
  return !!(targetViewer && typeof targetViewer.isDestroyed === "function" && !targetViewer.isDestroyed());
}

/** iPad / 大型タッチ端末。画面が大きく高LODを読みやすく、近接時に黒テクスチャ化しがち */
export function isLargeTouchDisplay() {
  const ua = navigator.userAgent || "";
  if (/iPad/i.test(ua)) return true;
  if (navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1) {
    return true;
  }
  const minSide = Math.min(window.innerWidth || 0, window.innerHeight || 0);
  const maxSide = Math.max(window.innerWidth || 0, window.innerHeight || 0);
  return minSide >= 768 && maxSide >= 1024 && ("ontouchstart" in window || (navigator.maxTouchPoints || 0) > 1);
}

/** 描画解像度。drawingBuffer ≈ CSSサイズ × DPR × resolutionScale */
export function getPointCloudResolutionScale() {
  const dpr = window.devicePixelRatio || 1;
  if (isLargeTouchDisplay()) {
    return dpr >= 2 ? 0.45 : 0.65;
  }
  if (dpr >= 3) return 0.65;
  return 1;
}

export function getPointCloudBaseScreenSpaceError() {
  if (isLargeTouchDisplay()) return 20;
  return 4;
}

export function configurePointCloudCameraFeel(controller) {
  controller.inertiaSpin = 0;
  controller.inertiaTranslate = 0;
  controller.inertiaZoom = 0;
  controller.maximumMovementRatio = 0.22;
  controller.enableTranslate = false;
  controller.enableLook = false;
  controller.enableTilt = false;
  controller.enableRotate = false;
  controller.translateEventTypes = [];
  controller.rotateEventTypes = [];
  controller.lookEventTypes = [];
}

export function getPointCloudDefaultRange(tileset, isPreview) {
  const radius = tileset.boundingSphere && tileset.boundingSphere.radius > 0
    ? tileset.boundingSphere.radius
    : 10;
  return isPreview
    ? Math.max(radius * 4.5, 12)
    : Math.max(radius * 2.2, 8);
}

export function initPointCloudViewState(viewer, tileset, heading, pitch, range) {
  viewer._pointCloudViewState = {
    heading: heading !== undefined ? heading : 0,
    pitch: pitch !== undefined ? pitch : Cesium.Math.toRadians(-35),
    range: range !== undefined ? range : getPointCloudDefaultRange(tileset, false),
    panWorld: new Cesium.Cartesian3(0, 0, 0)
  };
}

export function applyPointCloudViewState(viewer, tileset) {
  if (!isViewerUsable(viewer) || !tileset || tileset.isDestroyed()) return;
  const viewState = viewer._pointCloudViewState;
  if (!viewState) return;
  const scratch = getPointCloudScratch();
  const camera = viewer.scene.camera;
  const center = tileset.boundingSphere.center;
  Cesium.Cartesian3.add(center, viewState.panWorld, scratch.b);

  scratch.hpr.heading = viewState.heading;
  scratch.hpr.pitch = viewState.pitch;
  scratch.hpr.range = viewState.range;
  Cesium.Transforms.eastNorthUpToFixedFrame(scratch.b, undefined, scratch.enu);
  camera.lookAtTransform(scratch.enu, scratch.hpr);

  const heading = camera.heading;
  const pitch = camera.pitch;
  const roll = camera.roll;
  Cesium.Cartesian3.clone(camera.positionWC, scratch.pos);

  camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  camera.setView({
    destination: scratch.pos,
    orientation: { heading: heading, pitch: pitch, roll: roll }
  });
  updatePointCloudCameraFrustum(viewer, tileset, viewState.range);
}

/**
 * 近接時の黒塗り対策:
 * - near クリップ（断面が真っ黒）
 * - far/near 比過大による深度潰れ（log depth 無しで特に悪化）
 * - iPad で高LODテクスチャが黒くなる既知問題 → 近接ほど SSE を上げて回避
 */
function updatePointCloudCameraFrustum(viewer, tileset, range) {
  const frustum = viewer.scene.camera.frustum;
  if (!frustum || typeof frustum.near !== "number") return;
  const radius = tileset.boundingSphere && tileset.boundingSphere.radius > 0
    ? tileset.boundingSphere.radius
    : 10;
  const safeRange = Math.max(range, 0.05);
  const useLogDepth = !!viewer.scene.logarithmicDepthBuffer;

  if (useLogDepth) {
    frustum.near = Cesium.Math.clamp(safeRange * 0.001, 0.0008, 0.05);
    frustum.far = Math.max(safeRange + radius * 12, radius * 20, safeRange * 40, 80);
  } else {
    // 線形深度: 比が大きいと iPad でポリゴンが黒く潰れる
    const near = Cesium.Math.clamp(safeRange * 0.004, 0.004, 0.15);
    let far = Math.max(safeRange * 18, radius * 3.5, 30);
    const maxRatio = 4000;
    if (far / near > maxRatio) far = near * maxRatio;
    frustum.near = near;
    frustum.far = far;
  }

  if (isLargeTouchDisplay() && tileset && !tileset.isDestroyed()) {
    const closeness = radius / safeRange;
    // 近づくほど高詳細タイルを避ける（黒テクスチャ LOD を踏まない）
    tileset.maximumScreenSpaceError = Cesium.Math.clamp(
      getPointCloudBaseScreenSpaceError() + closeness * 4,
      getPointCloudBaseScreenSpaceError(),
      72
    );
    // 近接時はさらに描画解像度を落として GPU メモリを確保
    if (closeness > 2) {
      viewer.resolutionScale = Math.min(viewer.resolutionScale || 1, 0.4);
    } else {
      viewer.resolutionScale = getPointCloudResolutionScale();
    }
  }
}

function getPointCloudZoomLimits(tileset) {
  const radius = tileset.boundingSphere && tileset.boundingSphere.radius > 0
    ? tileset.boundingSphere.radius
    : 10;
  return {
    // 狭い通路・室内コーナーにも入れるよう、中心からの最短距離をかなり小さくする
    minRange: Math.max(radius * 0.015, 0.05),
    maxRange: Number.POSITIVE_INFINITY
  };
}

/** フォーカス距離上で、画面1pxの移動が世界空間で何メートルかを返す（指追従パン用） */
function getPointCloudPanMetersPerPixel(viewer, range) {
  const canvas = viewer.scene.canvas;
  const height = Math.max(canvas.clientHeight || canvas.height || 1, 1);
  const frustum = viewer.scene.camera.frustum;
  if (frustum && typeof frustum.fovy === "number" && frustum.fovy > 0) {
    return (2 * range * Math.tan(frustum.fovy * 0.5)) / height;
  }
  return Math.max(range * POINT_CLOUD_PAN_DRAG_FACTOR, 0.001);
}

function getPointCloudCameraRange(viewer, tileset) {
  if (viewer._pointCloudViewState) {
    return viewer._pointCloudViewState.range;
  }
  const camera = viewer.scene.camera;
  if (!Cesium.Matrix4.equals(camera.transform, Cesium.Matrix4.IDENTITY)) {
    return Cesium.Cartesian3.magnitude(camera.position);
  }
  return Cesium.Cartesian3.distance(camera.position, tileset.boundingSphere.center);
}

function applyPointCloudZoom(viewer, tileset, zoomInAmount) {
  if (!isViewerUsable(viewer) || !tileset || tileset.isDestroyed()) return;
  const viewState = viewer._pointCloudViewState;
  if (!viewState) return;
  const limits = getPointCloudZoomLimits(tileset);
  const newRange = Cesium.Math.clamp(
    viewState.range - zoomInAmount,
    limits.minRange,
    limits.maxRange
  );
  if (Math.abs(newRange - viewState.range) < 1e-9) return;
  viewState.range = newRange;
  applyPointCloudViewState(viewer, tileset);
}

function applyPointCloudPanDelta(viewer, tileset, deltaX, deltaY) {
  if (!isViewerUsable(viewer) || !tileset || tileset.isDestroyed()) return;
  const viewState = viewer._pointCloudViewState;
  if (!viewState) return;
  if (deltaX === 0 && deltaY === 0) return;

  const camera = viewer.scene.camera;
  const scratch = getPointCloudScratch();
  const scale = getPointCloudPanMetersPerPixel(viewer, viewState.range);
  const center = tileset.boundingSphere.center;
  Cesium.Cartesian3.add(center, viewState.panWorld, scratch.b);

  scratch.hpr.heading = viewState.heading;
  scratch.hpr.pitch = viewState.pitch;
  scratch.hpr.range = viewState.range;
  Cesium.Transforms.eastNorthUpToFixedFrame(scratch.b, undefined, scratch.enu);
  camera.lookAtTransform(scratch.enu, scratch.hpr);

  Cesium.Cartesian3.multiplyByScalar(camera.rightWC, -deltaX * scale, scratch.a);
  Cesium.Cartesian3.multiplyByScalar(camera.upWC, deltaY * scale, scratch.b);
  Cesium.Cartesian3.add(scratch.a, scratch.b, scratch.a);
  camera.lookAtTransform(Cesium.Matrix4.IDENTITY);

  Cesium.Cartesian3.add(viewState.panWorld, scratch.a, viewState.panWorld);
  applyPointCloudViewState(viewer, tileset);
}

function applyPointCloudRotateDelta(viewer, tileset, deltaX, deltaY) {
  if (!isViewerUsable(viewer) || !tileset || tileset.isDestroyed()) return;
  const viewState = viewer._pointCloudViewState;
  if (!viewState) return;
  if (deltaX === 0 && deltaY === 0) return;

  viewState.heading += deltaX * POINT_CLOUD_ROTATE_DRAG_FACTOR;
  viewState.pitch = Cesium.Math.clamp(
    viewState.pitch - deltaY * POINT_CLOUD_ROTATE_DRAG_FACTOR,
    -Cesium.Math.PI_OVER_TWO + 0.01,
    Cesium.Math.PI_OVER_TWO - 0.01
  );

  applyPointCloudViewState(viewer, tileset);
}

function isDragButtonHeld(event, button) {
  if (button === 0) return (event.buttons & 1) !== 0;
  if (button === 1) return (event.buttons & 4) !== 0;
  if (button === 2) return (event.buttons & 2) !== 0;
  return false;
}

function isTouchLikePointer(event) {
  return event.pointerType === "touch" || event.pointerType === "pen";
}

function getActiveTouchCentroid(activePointers) {
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  activePointers.forEach(function (p) {
    sumX += p.x;
    sumY += p.y;
    count++;
  });
  if (count === 0) return null;
  return { x: sumX / count, y: sumY / count, count: count };
}

function getActiveTouchDistance(activePointers) {
  if (activePointers.size < 2) return 0;
  const points = [];
  activePointers.forEach(function (p) {
    points.push(p);
  });
  const dx = points[0].x - points[1].x;
  const dy = points[0].y - points[1].y;
  return Math.sqrt(dx * dx + dy * dy);
}

function setupPointCloudDragPointer(viewer) {
  teardownPointCloudDragPointer(viewer);
  const canvas = viewer.scene.canvas;
  const activePointers = new Map();
  const dragState = {
    mode: null,
    button: -1,
    lastX: 0,
    lastY: 0,
    lastPinchDist: 0,
    touchSession: false,
    frameId: 0
  };
  const pendingMove = { deltaX: 0, deltaY: 0, zoomAmount: 0 };

  const flushPendingMove = function () {
    const deltaX = pendingMove.deltaX;
    const deltaY = pendingMove.deltaY;
    const zoomAmount = pendingMove.zoomAmount;
    pendingMove.deltaX = 0;
    pendingMove.deltaY = 0;
    pendingMove.zoomAmount = 0;

    const activeTileset = viewer._pointCloudZoomTileset;
    if (!activeTileset || !dragState.mode) return;

    if (dragState.mode === "pan") {
      applyPointCloudPanDelta(viewer, activeTileset, deltaX, deltaY);
    } else if (dragState.mode === "rotate") {
      applyPointCloudRotateDelta(viewer, activeTileset, deltaX, deltaY);
    } else if (dragState.mode === "zoom") {
      const range = getPointCloudCameraRange(viewer, activeTileset);
      applyPointCloudZoom(
        viewer,
        activeTileset,
        -deltaY * Math.max(range * POINT_CLOUD_ZOOM_DRAG_FACTOR, 0.005)
      );
    }

    if (zoomAmount !== 0 && (dragState.mode === "pan" || dragState.mode === "rotate")) {
      applyPointCloudZoom(viewer, activeTileset, zoomAmount);
    }
  };

  const stopDragLoop = function () {
    if (!dragState.frameId) return;
    cancelAnimationFrame(dragState.frameId);
    dragState.frameId = 0;
    flushPendingMove();
  };

  const dragLoopTick = function () {
    if (!dragState.mode) {
      dragState.frameId = 0;
      return;
    }
    flushPendingMove();
    dragState.frameId = requestAnimationFrame(dragLoopTick);
  };

  const startDragLoop = function () {
    if (dragState.frameId) return;
    dragState.frameId = requestAnimationFrame(dragLoopTick);
  };

  const syncTouchGesture = function () {
    const centroid = getActiveTouchCentroid(activePointers);
    if (!centroid) {
      stopDragLoop();
      dragState.mode = null;
      dragState.button = -1;
      dragState.touchSession = false;
      dragState.lastPinchDist = 0;
      return;
    }

    // スマホ/タブレット: 1本指=回転、2本指=移動（ピンチ距離でズーム）
    dragState.mode = centroid.count >= 2 ? "pan" : "rotate";
    dragState.button = -1;
    dragState.touchSession = true;
    dragState.lastX = centroid.x;
    dragState.lastY = centroid.y;
    dragState.lastPinchDist = getActiveTouchDistance(activePointers);
    pendingMove.deltaX = 0;
    pendingMove.deltaY = 0;
    pendingMove.zoomAmount = 0;
    startDragLoop();
  };

  const onPointerDown = function (event) {
    if (isTouchLikePointer(event)) {
      activePointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY
      });
      event.preventDefault();
      event.stopPropagation();
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch (err) {
        // ignore
      }
      syncTouchGesture();
      return;
    }

    if (dragState.touchSession) return;

    if (event.button === 0) {
      dragState.mode = event.ctrlKey ? "rotate" : "pan";
      dragState.button = 0;
    } else if (event.button === 1) {
      dragState.mode = "rotate";
      dragState.button = 1;
    } else if (event.button === 2) {
      dragState.mode = "zoom";
      dragState.button = 2;
    } else {
      return;
    }
    dragState.touchSession = false;
    dragState.lastX = event.clientX;
    dragState.lastY = event.clientY;
    dragState.lastPinchDist = 0;
    pendingMove.deltaX = 0;
    pendingMove.deltaY = 0;
    pendingMove.zoomAmount = 0;
    event.preventDefault();
    event.stopPropagation();
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch (err) {
      // ignore
    }
    startDragLoop();
  };

  const onPointerMove = function (event) {
    if (isTouchLikePointer(event)) {
      if (!activePointers.has(event.pointerId)) return;
      activePointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY
      });
      if (!dragState.mode || !dragState.touchSession) return;

      const centroid = getActiveTouchCentroid(activePointers);
      if (!centroid) return;

      const nextMode = centroid.count >= 2 ? "pan" : "rotate";
      if (nextMode !== dragState.mode) {
        dragState.mode = nextMode;
        dragState.lastX = centroid.x;
        dragState.lastY = centroid.y;
        dragState.lastPinchDist = getActiveTouchDistance(activePointers);
        event.preventDefault();
        return;
      }

      const deltaX = centroid.x - dragState.lastX;
      const deltaY = centroid.y - dragState.lastY;
      if (deltaX !== 0 || deltaY !== 0) {
        pendingMove.deltaX += deltaX;
        pendingMove.deltaY += deltaY;
        dragState.lastX = centroid.x;
        dragState.lastY = centroid.y;
      }

      if (centroid.count >= 2) {
        const pinchDist = getActiveTouchDistance(activePointers);
        if (dragState.lastPinchDist > 0) {
          const pinchDelta = pinchDist - dragState.lastPinchDist;
          if (pinchDelta !== 0) {
            const viewState = viewer._pointCloudViewState;
            const range = viewState && viewState.range > 0 ? viewState.range : 10;
            pendingMove.zoomAmount += pinchDelta * Math.max(
              range * POINT_CLOUD_ZOOM_PINCH_FACTOR,
              0.01
            );
          }
        }
        dragState.lastPinchDist = pinchDist;
      }

      event.preventDefault();
      return;
    }

    if (!dragState.mode || dragState.touchSession) return;
    if (!isDragButtonHeld(event, dragState.button)) return;
    const deltaX = event.clientX - dragState.lastX;
    const deltaY = event.clientY - dragState.lastY;
    if (deltaX === 0 && deltaY === 0) return;

    pendingMove.deltaX += deltaX;
    pendingMove.deltaY += deltaY;
    dragState.lastX = event.clientX;
    dragState.lastY = event.clientY;
    event.preventDefault();
  };

  const endDrag = function (event) {
    if (isTouchLikePointer(event)) {
      if (!activePointers.has(event.pointerId)) return;
      activePointers.delete(event.pointerId);
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch (err) {
        // ignore
      }
      syncTouchGesture();
      event.preventDefault();
      return;
    }

    if (!dragState.mode || dragState.touchSession) return;
    if (event.button !== dragState.button) return;
    stopDragLoop();
    dragState.mode = null;
    dragState.button = -1;
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch (err) {
      // ignore
    }
    event.preventDefault();
  };

  const onLostPointerCapture = function (event) {
    if (activePointers.has(event.pointerId)) {
      activePointers.delete(event.pointerId);
      syncTouchGesture();
      return;
    }
    if (!dragState.mode || dragState.touchSession) return;
    stopDragLoop();
    dragState.mode = null;
    dragState.button = -1;
  };

  canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
  canvas.addEventListener("pointermove", onPointerMove, { passive: false });
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("lostpointercapture", onLostPointerCapture);
  viewer._pointCloudDragPointer = {
    onPointerDown: onPointerDown,
    onPointerMove: onPointerMove,
    endDrag: endDrag,
    onLostPointerCapture: onLostPointerCapture,
    dragState: dragState,
    stopDragLoop: stopDragLoop,
    activePointers: activePointers
  };
}

function teardownPointCloudDragPointer(viewer) {
  if (!viewer || !viewer._pointCloudDragPointer) return;
  const canvas = viewer.scene.canvas;
  const pointer = viewer._pointCloudDragPointer;
  pointer.stopDragLoop();
  if (pointer.activePointers) pointer.activePointers.clear();
  canvas.removeEventListener("pointerdown", pointer.onPointerDown);
  canvas.removeEventListener("pointermove", pointer.onPointerMove);
  canvas.removeEventListener("pointerup", pointer.endDrag);
  canvas.removeEventListener("pointercancel", pointer.endDrag);
  canvas.removeEventListener("lostpointercapture", pointer.onLostPointerCapture);
  viewer._pointCloudDragPointer = null;
}

function setupPointCloudCanvasBlockers(viewer) {
  teardownPointCloudCanvasBlockers(viewer);
  const canvas = viewer.scene.canvas;
  const onContextMenu = function (event) {
    event.preventDefault();
  };
  const onAuxClick = function (event) {
    event.preventDefault();
    event.stopPropagation();
  };
  const onMouseDown = function (event) {
    if (event.button === 1 || event.button === 2) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  canvas.addEventListener("contextmenu", onContextMenu);
  canvas.addEventListener("auxclick", onAuxClick, { passive: false });
  canvas.addEventListener("mousedown", onMouseDown, { passive: false });
  viewer._pointCloudCanvasBlockers = {
    onContextMenu: onContextMenu,
    onAuxClick: onAuxClick,
    onMouseDown: onMouseDown
  };
}

function teardownPointCloudCanvasBlockers(viewer) {
  if (!viewer || !viewer._pointCloudCanvasBlockers) return;
  const canvas = viewer.scene.canvas;
  const blockers = viewer._pointCloudCanvasBlockers;
  canvas.removeEventListener("contextmenu", blockers.onContextMenu);
  if (blockers.onAuxClick) {
    canvas.removeEventListener("auxclick", blockers.onAuxClick);
  }
  canvas.removeEventListener("mousedown", blockers.onMouseDown);
  viewer._pointCloudCanvasBlockers = null;
}

function teardownPointCloudFrustumGuard(viewer) {
  if (!viewer || !viewer._pointCloudFrustumGuard) return;
  if (isViewerUsable(viewer)) {
    viewer.scene.preRender.removeEventListener(viewer._pointCloudFrustumGuard);
  }
  viewer._pointCloudFrustumGuard = null;
}

function setupPointCloudFrustumGuard(viewer) {
  teardownPointCloudFrustumGuard(viewer);
  // Cesium / WebKit が near を戻すことがあるため、毎フレーム再適用する
  const onPreRender = function () {
    const activeTileset = viewer._pointCloudZoomTileset;
    const viewState = viewer._pointCloudViewState;
    if (!activeTileset || activeTileset.isDestroyed() || !viewState) return;
    updatePointCloudCameraFrustum(viewer, activeTileset, viewState.range);
  };
  viewer.scene.preRender.addEventListener(onPreRender);
  viewer._pointCloudFrustumGuard = onPreRender;
}

export function teardownPointCloudModalZoom(viewer) {
  if (!viewer) return;
  if (viewer._pointCloudZoomHandler) {
    viewer._pointCloudZoomHandler.destroy();
    viewer._pointCloudZoomHandler = null;
  }
  viewer._pointCloudZoomTileset = null;
  viewer._pointCloudViewState = null;
  teardownPointCloudFrustumGuard(viewer);
  teardownPointCloudDragPointer(viewer);
  teardownPointCloudCanvasBlockers(viewer);
  if (isViewerUsable(viewer)) {
    const controller = viewer.scene.screenSpaceCameraController;
    controller.enableZoom = true;
    controller.enableRotate = true;
  }
}

export function setupPointCloudModalZoom(viewer, tileset, heading, pitch, range) {
  teardownPointCloudModalZoom(viewer);
  const controller = viewer.scene.screenSpaceCameraController;
  configurePointCloudCameraFeel(controller);
  controller.enableZoom = false;
  controller.zoomEventTypes = [];
  controller.tiltEventTypes = [];
  viewer._pointCloudZoomTileset = tileset;
  initPointCloudViewState(viewer, tileset, heading, pitch, range);
  applyPointCloudViewState(viewer, tileset);
  setupPointCloudFrustumGuard(viewer);
  setupPointCloudCanvasBlockers(viewer);
  setupPointCloudDragPointer(viewer);

  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  viewer._pointCloudZoomHandler = handler;

  handler.setInputAction(function (delta) {
    const activeTileset = viewer._pointCloudZoomTileset;
    if (!activeTileset) return;
    const cameraRange = getPointCloudCameraRange(viewer, activeTileset);
    applyPointCloudZoom(
      viewer,
      activeTileset,
      delta * Math.max(cameraRange * POINT_CLOUD_ZOOM_WHEEL_FACTOR, 0.005)
    );
  }, Cesium.ScreenSpaceEventType.WHEEL);
}
