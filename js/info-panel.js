import { dom } from "./config/dom.js";
import { state } from "./state.js";
import { flyToPin } from "./pins/pins.js";
import { clearPointCloud, clearPointCloudPreview, loadPointCloudPreview } from "./pointcloud/viewer.js";
import { normalizeUrl } from "./utils/parse.js";

let galleryImages = [];
let galleryIndex = 0;

function setInfoField(element, value) {
  if (!element) return;
  const text = String(value || "").trim();
  element.textContent = text || "—";
}

function updateGalleryView() {
  if (!dom.imageView) return;

  const imageUrl = galleryImages[galleryIndex] || "";
  if (imageUrl) {
    dom.imageView.src = imageUrl;
    dom.imageView.alt = (dom.infoName && dom.infoName.textContent) || "写真";
  } else {
    dom.imageView.removeAttribute("src");
    dom.imageView.alt = "";
  }

  const hasMultiple = galleryImages.length > 1;
  if (dom.imageGalleryPrev) {
    dom.imageGalleryPrev.disabled = !hasMultiple;
  }
  if (dom.imageGalleryNext) {
    dom.imageGalleryNext.disabled = !hasMultiple;
  }
  if (dom.imageGalleryCounter) {
    if (galleryImages.length > 1) {
      dom.imageGalleryCounter.textContent = (galleryIndex + 1) + " / " + galleryImages.length;
      dom.imageGalleryCounter.classList.remove("hidden");
    } else {
      dom.imageGalleryCounter.textContent = "";
      dom.imageGalleryCounter.classList.add("hidden");
    }
  }
}

function updatePhotoLightboxView() {
  const imageUrl = galleryImages[galleryIndex] || "";
  const title = (dom.infoName && dom.infoName.textContent) || "写真";

  if (dom.photoModalImage) {
    if (imageUrl) {
      dom.photoModalImage.src = imageUrl;
      dom.photoModalImage.alt = title;
    } else {
      dom.photoModalImage.removeAttribute("src");
      dom.photoModalImage.alt = "";
    }
  }
  if (dom.photoModalTitle) {
    dom.photoModalTitle.textContent = title;
  }

  const hasMultiple = galleryImages.length > 1;
  if (dom.photoModalPrev) {
    dom.photoModalPrev.disabled = !hasMultiple;
  }
  if (dom.photoModalNext) {
    dom.photoModalNext.disabled = !hasMultiple;
  }
  if (dom.photoModalCounter) {
    dom.photoModalCounter.textContent = galleryImages.length > 1
      ? (galleryIndex + 1) + " / " + galleryImages.length
      : "";
  }
}

function openPhotoLightbox() {
  if (!dom.photoModal || galleryImages.length === 0) return;
  updatePhotoLightboxView();
  dom.photoModal.classList.remove("hidden");
}

function closePhotoLightbox() {
  if (!dom.photoModal) return;
  dom.photoModal.classList.add("hidden");
}

function showGallery(images) {
  galleryImages = Array.isArray(images) ? images.filter(Boolean) : [];
  galleryIndex = 0;
  closePhotoLightbox();

  if (galleryImages.length === 0) {
    if (dom.imageGallery) dom.imageGallery.classList.add("hidden");
    if (dom.imageGalleryCounter) dom.imageGalleryCounter.classList.add("hidden");
    return;
  }

  if (dom.imageGallery) dom.imageGallery.classList.remove("hidden");
  updateGalleryView();
}

function stepGallery(delta) {
  if (galleryImages.length <= 1) return;
  galleryIndex = (galleryIndex + delta + galleryImages.length) % galleryImages.length;
  updateGalleryView();
  if (dom.photoModal && !dom.photoModal.classList.contains("hidden")) {
    updatePhotoLightboxView();
  }
}

export function showPinInfo(entity) {
  if (!dom.infoPanel || !entity || !entity.properties) return;
  const props = entity.properties;
  const images = props.images ? props.images.getValue() : [];
  const imageUrl = props.image.getValue();
  const imageList = images && images.length ? images : (imageUrl ? [imageUrl] : []);
  const activities = props.activity.getValue() || [];

  state.selectedPinEntity = entity;
  if (dom.infoName) dom.infoName.textContent = entity.name || "ピン";
  showGallery(imageList);
  setInfoField(dom.textView, props.text.getValue());
  setInfoField(dom.categoryView, props.category.getValue());
  setInfoField(dom.activityView, activities.join(", "));
  setInfoField(dom.yearView, props.year.getValue());
  const assetId = props.pointcloudAssetId.getValue();
  if (assetId) {
    loadPointCloudPreview(assetId, entity.name);
  } else {
    clearPointCloudPreview();
  }

  const url = normalizeUrl(props.url ? props.url.getValue() : "");
  if (dom.spotHomepageBtn) {
    if (url) {
      dom.spotHomepageBtn.href = url;
      dom.spotHomepageBtn.classList.remove("hidden");
    } else {
      dom.spotHomepageBtn.removeAttribute("href");
      dom.spotHomepageBtn.classList.add("hidden");
    }
  }

  dom.infoPanel.classList.remove("hidden");
}

function saveCameraView() {
  const camera = state.viewer.camera;
  return {
    position: camera.position.clone(),
    heading: camera.heading,
    pitch: camera.pitch,
    roll: camera.roll
  };
}

function restoreCameraView() {
  if (!state.savedCameraView) return;
  state.viewer.camera.flyTo({
    destination: state.savedCameraView.position,
    orientation: {
      heading: state.savedCameraView.heading,
      pitch: state.savedCameraView.pitch,
      roll: state.savedCameraView.roll
    },
    duration: 1.5
  });
  resetCameraZoomState();
}

export function resetCameraZoomState() {
  state.isCameraZoomed = false;
  state.savedCameraView = null;
  if (dom.flyToPinBtn) dom.flyToPinBtn.classList.remove("active");
}

export function hidePinInfo() {
  state.selectedPinEntity = null;
  galleryImages = [];
  galleryIndex = 0;
  closePhotoLightbox();
  resetCameraZoomState();
  clearPointCloud();
  if (dom.infoPanel) dom.infoPanel.classList.add("hidden");
}

export function setupInfoPanel() {
  if (dom.imageGalleryPrev) {
    dom.imageGalleryPrev.addEventListener("click", function (event) {
      event.stopPropagation();
      stepGallery(-1);
    });
  }
  if (dom.imageGalleryNext) {
    dom.imageGalleryNext.addEventListener("click", function (event) {
      event.stopPropagation();
      stepGallery(1);
    });
  }
  if (dom.imageGalleryViewport) {
    dom.imageGalleryViewport.addEventListener("click", openPhotoLightbox);
    dom.imageGalleryViewport.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openPhotoLightbox();
      }
    });
  }
  if (dom.photoModalClose) {
    dom.photoModalClose.addEventListener("click", closePhotoLightbox);
  }
  if (dom.photoModalBackdrop) {
    dom.photoModalBackdrop.addEventListener("click", closePhotoLightbox);
  }
  if (dom.photoModalPrev) {
    dom.photoModalPrev.addEventListener("click", function () {
      stepGallery(-1);
    });
  }
  if (dom.photoModalNext) {
    dom.photoModalNext.addEventListener("click", function () {
      stepGallery(1);
    });
  }
  document.addEventListener("keydown", function (event) {
    if (!dom.photoModal || dom.photoModal.classList.contains("hidden")) return;
    if (event.key === "Escape") {
      closePhotoLightbox();
    } else if (event.key === "ArrowLeft") {
      stepGallery(-1);
    } else if (event.key === "ArrowRight") {
      stepGallery(1);
    }
  });
  if (dom.flyToPinBtn) {
    dom.flyToPinBtn.addEventListener("click", function () {
      if (!state.selectedPinEntity) return;
      if (state.isCameraZoomed) {
        restoreCameraView();
        return;
      }
      state.savedCameraView = saveCameraView();
      state.isCameraZoomed = true;
      dom.flyToPinBtn.classList.add("active");
      flyToPin(state.selectedPinEntity);
    });
  }
  if (dom.infoCloseBtn) {
    dom.infoCloseBtn.addEventListener("click", hidePinInfo);
  }
}
