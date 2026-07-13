import { dom } from "./config/dom.js";
import { state } from "./state.js";
import { flyToPin } from "./pins/pins.js";
import { clearPointCloud, clearPointCloudPreview, loadPointCloudPreview } from "./pointcloud/viewer.js";
import { renderSpotLinks } from "./ui/spot-links.js";
import {
  getPhotoDisplayUrl,
  getPhotoTitle,
  getPhotoYouTubeVideoId,
  isYouTubePhoto,
  normalizePhotoList
} from "./utils/photos.js";
import { getYouTubeEmbedUrl } from "./utils/youtube.js";

let galleryImages = [];
let galleryIndex = 0;
let lightboxMode = "gallery";
let standaloneVideoId = "";

function formatActiveYears(openingYear, closingYear) {
  const open = String(openingYear || "").trim();
  const close = String(closingYear || "").trim();
  if (open && close) return open + " - " + close;
  if (open) return open + " -";
  if (close) return "- " + close;
  return "";
}

function setInfoField(element, value) {
  if (!element) return;
  const text = String(value || "").trim();
  element.textContent = text || "—";
}

function spotName() {
  return (dom.infoName && dom.infoName.textContent) || "写真";
}

function setCaptionElement(element, title) {
  if (!element) return;
  const text = String(title || "").trim();
  if (text) {
    element.textContent = text;
    element.classList.remove("hidden");
  } else {
    element.textContent = "";
    element.classList.add("hidden");
  }
}

function setGalleryViewportVideoState(isVideo) {
  if (dom.imageGalleryViewport) {
    dom.imageGalleryViewport.classList.toggle("is-youtube", isVideo);
    dom.imageGalleryViewport.setAttribute(
      "aria-label",
      isVideo ? "動画を拡大再生" : "写真を拡大表示"
    );
  }
  if (dom.imageGalleryPlay) {
    dom.imageGalleryPlay.classList.toggle("hidden", !isVideo);
  }
  const hint = dom.imageGalleryViewport
    ? dom.imageGalleryViewport.querySelector(".image-gallery-hint")
    : null;
  if (hint) {
    hint.textContent = isVideo ? "クリックで再生" : "クリックで拡大表示";
  }
}

function setLightboxMediaMode(mode) {
  const isVideo = mode === "video";
  if (dom.photoModalImage) {
    dom.photoModalImage.classList.toggle("hidden", isVideo);
  }
  if (dom.photoModalEmbedWrap) {
    dom.photoModalEmbedWrap.classList.toggle("hidden", !isVideo);
  }
  if (!isVideo && dom.photoModalEmbed) {
    dom.photoModalEmbed.removeAttribute("src");
  }
}

function updateGalleryView() {
  if (!dom.imageView) return;

  const photo = galleryImages[galleryIndex];
  const imageUrl = getPhotoDisplayUrl(photo);
  const photoTitle = getPhotoTitle(photo);
  const altText = photoTitle || spotName();
  const isVideo = isYouTubePhoto(photo);

  setCaptionElement(dom.imageCaption, photoTitle);
  setGalleryViewportVideoState(isVideo);

  if (imageUrl) {
    dom.imageView.src = imageUrl;
    dom.imageView.alt = altText;
  } else {
    dom.imageView.removeAttribute("src");
    dom.imageView.alt = "";
    setCaptionElement(dom.imageCaption, "");
    setGalleryViewportVideoState(false);
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
  if (lightboxMode === "standalone-video") {
    updateStandaloneVideoLightboxView();
    return;
  }

  const photo = galleryImages[galleryIndex];
  const imageUrl = getPhotoDisplayUrl(photo);
  const photoTitle = getPhotoTitle(photo);
  const spot = spotName();
  const altText = photoTitle || spot;
  const videoId = getPhotoYouTubeVideoId(photo);
  const isVideo = Boolean(videoId);

  setLightboxMediaMode(isVideo ? "video" : "image");

  if (isVideo) {
    if (dom.photoModalEmbed) {
      dom.photoModalEmbed.src = getYouTubeEmbedUrl(videoId);
    }
  } else if (dom.photoModalImage) {
    if (imageUrl) {
      dom.photoModalImage.src = imageUrl;
      dom.photoModalImage.alt = altText;
    } else {
      dom.photoModalImage.removeAttribute("src");
      dom.photoModalImage.alt = "";
    }
  }

  if (dom.photoModalTitle) {
    dom.photoModalTitle.textContent = spot;
  }
  setCaptionElement(dom.photoModalCaption, photoTitle);

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

function updateStandaloneVideoLightboxView() {
  setLightboxMediaMode("video");
  if (dom.photoModalEmbed && standaloneVideoId) {
    dom.photoModalEmbed.src = getYouTubeEmbedUrl(standaloneVideoId);
  }
  if (dom.photoModalPrev) dom.photoModalPrev.disabled = true;
  if (dom.photoModalNext) dom.photoModalNext.disabled = true;
  if (dom.photoModalCounter) dom.photoModalCounter.textContent = "";
}

function openPhotoLightbox() {
  if (!dom.photoModal || galleryImages.length === 0) return;
  lightboxMode = "gallery";
  standaloneVideoId = "";
  updatePhotoLightboxView();
  dom.photoModal.classList.remove("hidden");
}

export function openVideoLightbox(videoId, title) {
  if (!dom.photoModal || !videoId) return;
  lightboxMode = "standalone-video";
  standaloneVideoId = videoId;
  if (dom.photoModalTitle) {
    dom.photoModalTitle.textContent = title || "動画";
  }
  setCaptionElement(dom.photoModalCaption, "");
  updateStandaloneVideoLightboxView();
  dom.photoModal.classList.remove("hidden");
}

function closePhotoLightbox() {
  if (!dom.photoModal) return;
  dom.photoModal.classList.add("hidden");
  lightboxMode = "gallery";
  standaloneVideoId = "";
  setLightboxMediaMode("image");
}

function showGallery(images) {
  galleryImages = normalizePhotoList(images);
  galleryIndex = 0;
  closePhotoLightbox();

  if (galleryImages.length === 0) {
    if (dom.imageGallery) dom.imageGallery.classList.add("hidden");
    if (dom.imageGalleryCounter) dom.imageGalleryCounter.classList.add("hidden");
    setCaptionElement(dom.imageCaption, "");
    return;
  }

  if (dom.imageGallery) dom.imageGallery.classList.remove("hidden");
  updateGalleryView();
}

function stepGallery(delta) {
  if (galleryImages.length <= 1) return;
  galleryIndex = (galleryIndex + delta + galleryImages.length) % galleryImages.length;
  updateGalleryView();
  if (dom.photoModal && !dom.photoModal.classList.contains("hidden") && lightboxMode === "gallery") {
    updatePhotoLightboxView();
  }
}

export function showPinInfo(entity) {
  if (!dom.infoPanel || !entity || !entity.properties) return;
  const props = entity.properties;
  const images = props.images ? props.images.getValue() : [];
  const imageUrl = props.image.getValue();
  const imageList = images && images.length
    ? images
    : (imageUrl ? [{ url: imageUrl, title: "" }] : []);
  const roles = props.role.getValue() || [];

  state.selectedPinEntity = entity;
  if (dom.infoName) dom.infoName.textContent = entity.name || "ピン";
  showGallery(imageList);
  setInfoField(dom.textView, props.text.getValue());
  setInfoField(dom.categoryView, props.category.getValue());
  setInfoField(dom.roleView, roles.join(", "));
  setInfoField(
    dom.yearView,
    formatActiveYears(
      props.openingYear ? props.openingYear.getValue() : "",
      props.closingYear ? props.closingYear.getValue() : ""
    )
  );
  const assetId = props.pointcloudAssetId.getValue();
  if (assetId) {
    loadPointCloudPreview(assetId, entity.name);
  } else {
    clearPointCloudPreview();
  }

  renderSpotLinks(
    dom.spotHomepageLinks,
    props.url ? props.url.getValue() : "",
    props.urlLabel ? props.urlLabel.getValue() : "",
    { onVideoClick: openVideoLightbox }
  );

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
    } else if (lightboxMode === "gallery" && event.key === "ArrowLeft") {
      stepGallery(-1);
    } else if (lightboxMode === "gallery" && event.key === "ArrowRight") {
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
