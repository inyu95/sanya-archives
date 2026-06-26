import {
  POINT_CLOUD_ZOOM_WHEEL_FACTOR,
  POINT_CLOUD_ZOOM_PINCH_FACTOR,
  POINT_CLOUD_ZOOM_DRAG_FACTOR,
  POINT_CLOUD_PAN_DRAG_FACTOR
} from "../config/constants.js";
import { state } from "../state.js";

export function getPointCloudScratch() {
  if (!state.pointCloudScratchPos) {
    state.pointCloudScratchPos = new Cesium.Cartesian3();
    state.pointCloudScratchA = new Cesium.Cartesian3();
    state.pointCloudScratchB = new Cesium.Cartesian3();
  }
  return {
    pos: state.pointCloudScratchPos,
    a: state.pointCloudScratchA,
    b: state.pointCloudScratchB
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
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(center);

  camera.lookAtTransform(
    enu,
    new Cesium.HeadingPitchRange(viewState.heading, viewState.pitch, viewState.range)
  );

  const heading = camera.heading;
  const pitch = camera.pitch;
  const roll = camera.roll;
  Cesium.Cartesian3.clone(camera.positionWC, scratch.pos);
  if (viewState.panWorld && Cesium.Cartesian3.magnitudeSquared(viewState.panWorld) > 1e-16) {
    Cesium.Cartesian3.add(scratch.pos, viewState.panWorld, scratch.pos);
  }

  camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  camera.setView({
    destination: scratch.pos,
    orientation: { heading: heading, pitch: pitch, roll: roll }
  });

  viewer.scene.requestRender();
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

export function getPointCloudCameraRange(viewer, tileset) {
  if (viewer._pointCloudViewState) {
    return viewer._pointCloudViewState.range;
  }
  const camera = viewer.scene.camera;
  if (!Cesium.Matrix4.equals(camera.transform, Cesium.Matrix4.IDENTITY)) {
    return Cesium.Cartesian3.magnitude(camera.position);
  }
  return Cesium.Cartesian3.distance(camera.position, tileset.boundingSphere.center);
}

export function applyPointCloudZoom(viewer, tileset, zoomInAmount) {
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

export function applyPointCloudPanDelta(viewer, tileset, deltaX, deltaY) {
  if (!isViewerUsable(viewer) || !tileset || tileset.isDestroyed()) return;
  const viewState = viewer._pointCloudViewState;
  if (!viewState) return;
  if (deltaX === 0 && deltaY === 0) return;

  const camera = viewer.scene.camera;
  const scratch = getPointCloudScratch();
  const scale = Math.max(viewState.range * POINT_CLOUD_PAN_DRAG_FACTOR, 0.001);

  applyPointCloudViewState(viewer, tileset);

  Cesium.Cartesian3.multiplyByScalar(camera.rightWC, -deltaX * scale, scratch.a);
  Cesium.Cartesian3.multiplyByScalar(camera.upWC, deltaY * scale, scratch.b);
  Cesium.Cartesian3.add(viewState.panWorld, scratch.a, viewState.panWorld);
  Cesium.Cartesian3.add(viewState.panWorld, scratch.b, viewState.panWorld);

  applyPointCloudViewState(viewer, tileset);
}

export function applyPointCloudRotate(viewer, tileset, movement) {
  if (!isViewerUsable(viewer) || !tileset || tileset.isDestroyed()) return;
  const viewState = viewer._pointCloudViewState;
  if (!viewState) return;
  const dx = movement.endPosition.x - movement.startPosition.x;
  const dy = movement.endPosition.y - movement.startPosition.y;
  if (dx === 0 && dy === 0) return;

  const center = tileset.boundingSphere.center;
  const camera = viewer.scene.camera;
  camera.lookAtTransform(
    Cesium.Transforms.eastNorthUpToFixedFrame(center),
    new Cesium.HeadingPitchRange(viewState.heading, viewState.pitch, viewState.range)
  );

  const canvas = viewer.scene.canvas;
  let phiRatio = -dx / canvas.clientWidth;
  let thetaRatio = -dy / canvas.clientHeight;
  phiRatio = Cesium.Math.clamp(phiRatio, -0.22, 0.22);
  thetaRatio = Cesium.Math.clamp(thetaRatio, -0.22, 0.22);

  const rotateRate = Cesium.Math.clamp(viewState.range * 0.5, 0.05, 1.77);
  camera.rotateRight(rotateRate * phiRatio * Math.PI * 2);
  camera.rotateUp(rotateRate * thetaRatio * Math.PI);

  viewState.heading = camera.heading;
  viewState.pitch = Cesium.Math.clamp(
    camera.pitch,
    -Cesium.Math.PI_OVER_TWO + 0.01,
    Cesium.Math.PI_OVER_TWO - 0.01
  );

  applyPointCloudViewState(viewer, tileset);
}

function setupPointCloudDragPointer(viewer) {
  teardownPointCloudDragPointer(viewer);
  const canvas = viewer.scene.canvas;
  const dragState = { mode: null, lastX: 0, lastY: 0 };
  const rotateStart = new Cesium.Cartesian2();
  const rotateEnd = new Cesium.Cartesian2();

  const onPointerDown = function (event) {
    if (event.button === 0) {
      dragState.mode = event.ctrlKey ? "rotate" : "pan";
    } else if (event.button === 1) {
      dragState.mode = "rotate";
    } else if (event.button === 2) {
      dragState.mode = "zoom";
    } else {
      return;
    }
    dragState.lastX = event.clientX;
    dragState.lastY = event.clientY;
    event.preventDefault();
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch (err) {
      // ignore
    }
  };

  const onPointerMove = function (event) {
    if (!dragState.mode) return;
    const deltaX = event.clientX - dragState.lastX;
    const deltaY = event.clientY - dragState.lastY;
    if (deltaX === 0 && deltaY === 0) return;

    const activeTileset = viewer._pointCloudZoomTileset;
    if (!activeTileset) return;

    if (dragState.mode === "pan") {
      applyPointCloudPanDelta(viewer, activeTileset, deltaX, deltaY);
    } else if (dragState.mode === "rotate") {
      const rect = canvas.getBoundingClientRect();
      rotateEnd.x = event.clientX - rect.left;
      rotateEnd.y = event.clientY - rect.top;
      rotateStart.x = rotateEnd.x - deltaX;
      rotateStart.y = rotateEnd.y - deltaY;
      applyPointCloudRotate(viewer, activeTileset, {
        startPosition: rotateStart,
        endPosition: rotateEnd
      });
    } else if (dragState.mode === "zoom") {
      const range = getPointCloudCameraRange(viewer, activeTileset);
      applyPointCloudZoom(
        viewer,
        activeTileset,
        -deltaY * Math.max(range * POINT_CLOUD_ZOOM_DRAG_FACTOR, 0.005)
      );
    }

    dragState.lastX = event.clientX;
    dragState.lastY = event.clientY;
  };

  const endDrag = function (event) {
    if (!dragState.mode) return;
    dragState.mode = null;
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch (err) {
      // ignore
    }
  };

  canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
  canvas.addEventListener("pointermove", onPointerMove, { passive: false });
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  viewer._pointCloudDragPointer = {
    onPointerDown: onPointerDown,
    onPointerMove: onPointerMove,
    endDrag: endDrag
  };
}

function teardownPointCloudDragPointer(viewer) {
  if (!viewer || !viewer._pointCloudDragPointer) return;
  const canvas = viewer.scene.canvas;
  const pointer = viewer._pointCloudDragPointer;
  canvas.removeEventListener("pointerdown", pointer.onPointerDown);
  canvas.removeEventListener("pointermove", pointer.onPointerMove);
  canvas.removeEventListener("pointerup", pointer.endDrag);
  canvas.removeEventListener("pointercancel", pointer.endDrag);
  viewer._pointCloudDragPointer = null;
}

function setupPointCloudCanvasBlockers(viewer) {
  teardownPointCloudCanvasBlockers(viewer);
  const canvas = viewer.scene.canvas;
  const onContextMenu = function (event) {
    event.preventDefault();
  };
  const onMouseDown = function (event) {
    if (event.button === 1 || event.button === 2) {
      event.preventDefault();
    }
  };
  canvas.addEventListener("contextmenu", onContextMenu);
  canvas.addEventListener("mousedown", onMouseDown, { passive: false });
  viewer._pointCloudCanvasBlockers = { onContextMenu: onContextMenu, onMouseDown: onMouseDown };
}

function teardownPointCloudCanvasBlockers(viewer) {
  if (!viewer || !viewer._pointCloudCanvasBlockers) return;
  const canvas = viewer.scene.canvas;
  const blockers = viewer._pointCloudCanvasBlockers;
  canvas.removeEventListener("contextmenu", blockers.onContextMenu);
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
