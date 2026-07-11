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
}

function getPointCloudZoomLimits(tileset) {
  const radius = tileset.boundingSphere && tileset.boundingSphere.radius > 0
    ? tileset.boundingSphere.radius
    : 10;
  return {
    minRange: Math.max(radius * 0.05, 0.05),
    maxRange: Math.max(radius * 20, 50)
  };
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
  const scale = Math.max(viewState.range * POINT_CLOUD_PAN_DRAG_FACTOR, 0.001);
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

  viewState.heading -= deltaX * POINT_CLOUD_ROTATE_DRAG_FACTOR;
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

function setupPointCloudDragPointer(viewer) {
  teardownPointCloudDragPointer(viewer);
  const canvas = viewer.scene.canvas;
  const dragState = { mode: null, button: -1, lastX: 0, lastY: 0, frameId: 0 };
  const pendingMove = { deltaX: 0, deltaY: 0 };

  const flushPendingMove = function () {
    const deltaX = pendingMove.deltaX;
    const deltaY = pendingMove.deltaY;
    pendingMove.deltaX = 0;
    pendingMove.deltaY = 0;
    if (deltaX === 0 && deltaY === 0) return;

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

  const onPointerDown = function (event) {
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
    dragState.lastX = event.clientX;
    dragState.lastY = event.clientY;
    pendingMove.deltaX = 0;
    pendingMove.deltaY = 0;
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
    if (!dragState.mode) return;
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
    if (!dragState.mode) return;
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

  const onLostPointerCapture = function () {
    if (!dragState.mode) return;
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
    stopDragLoop: stopDragLoop
  };
}

function teardownPointCloudDragPointer(viewer) {
  if (!viewer || !viewer._pointCloudDragPointer) return;
  const canvas = viewer.scene.canvas;
  const pointer = viewer._pointCloudDragPointer;
  pointer.stopDragLoop();
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

export function teardownPointCloudModalZoom(viewer) {
  if (!viewer) return;
  if (viewer._pointCloudZoomHandler) {
    viewer._pointCloudZoomHandler.destroy();
    viewer._pointCloudZoomHandler = null;
  }
  viewer._pointCloudZoomTileset = null;
  viewer._pointCloudViewState = null;
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

  handler.setInputAction(function (movement) {
    const activeTileset = viewer._pointCloudZoomTileset;
    if (!activeTileset) return;
    const pinchDelta = movement.distance.endPosition.y - movement.distance.startPosition.y;
    applyPointCloudZoom(viewer, activeTileset, pinchDelta * POINT_CLOUD_ZOOM_PINCH_FACTOR);
  }, Cesium.ScreenSpaceEventType.PINCH_MOVE);
}
