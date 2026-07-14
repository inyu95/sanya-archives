import { dom } from "./config/dom.js";
import { state } from "./state.js";
import { flyToPin } from "./pins/pins.js";
import { clearPointCloud, clearPointCloudPreview, loadPointCloudPreview } from "./pointcloud/viewer.js";
import { renderSpotLinks, renderSpotYouTubePreviews } from "./ui/spot-links.js";
import {
  filterGalleryPhotos,
  getPhotoDisplayUrl,
  getPhotoTitle,
  getPhotoYouTubeVideoId,
  isYouTubePhoto,
} from "./utils/photos.js";
import { getYouTubeEmbedUrl } from "./utils/youtube.js";

let galleryImages = [];
let galleryIndex = 0;
let lightboxMode = "gallery";
let standaloneVideoId = "";
/** 記憶モード写真ライトボックス閉鎖時にカメラを戻すか */
let restoreCameraOnLightboxClose = false;
/** 記憶モード時のモーダル左上タイトル（写真タイトル） */
let memoryLightboxTitle = "";
/** 記憶モード時のモーダル下説明（C列）。null なら通常の photoTitle 表示 */
let memoryLightboxCaption = null;
/** 記憶モード時の撮影年代（D列）。空なら非表示 */
let memoryLightboxYear = "";

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

function setMemoryLightboxYearElement(year) {
  if (!dom.photoModalYear) return;
  const text = String(year || "").trim();
  if (text) {
    dom.photoModalYear.textContent = "撮影時期：" + text;
    dom.photoModalYear.classList.remove("hidden");
  } else {
    dom.photoModalYear.textContent = "";
    dom.photoModalYear.classList.add("hidden");
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
      prepareLightboxImageReveal(dom.photoModalImage, imageUrl, altText);
    } else {
      dom.photoModalImage.classList.remove("is-revealed");
      dom.photoModalImage.removeAttribute("src");
      dom.photoModalImage.alt = "";
    }
  }

  if (dom.photoModalTitle) {
    dom.photoModalTitle.textContent = memoryLightboxTitle || spot || "写真";
  }
  if (memoryLightboxCaption !== null) {
    setCaptionElement(dom.photoModalCaption, memoryLightboxCaption);
  } else {
    setCaptionElement(dom.photoModalCaption, photoTitle);
  }
  setMemoryLightboxYearElement(memoryLightboxYear);

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
  restoreCameraOnLightboxClose = false;
  memoryLightboxTitle = "";
  memoryLightboxCaption = null;
  memoryLightboxYear = "";
  updatePhotoLightboxView();
  showPhotoModal({ fadeIn: false });
}

/** 記憶モードなど、パネル外から単一写真のライトボックスを開く */
export function openMemoryPhotoLightbox(photo, spotTitle, opts) {
  if (!dom.photoModal || !photo) return;
  const options = opts || {};
  galleryImages = filterGalleryPhotos([photo]);
  galleryIndex = 0;
  lightboxMode = "gallery";
  standaloneVideoId = "";
  restoreCameraOnLightboxClose = Boolean(options.restoreCameraOnClose);
  // ヘッダー: 写真タイトル + 撮影年代（D列） / 下: C列の説明（あれば）
  memoryLightboxTitle = String(spotTitle || "").trim() || "写真";
  memoryLightboxCaption = Object.prototype.hasOwnProperty.call(options, "caption")
    ? String(options.caption || "").trim()
    : "";
  memoryLightboxYear = Object.prototype.hasOwnProperty.call(options, "year")
    ? String(options.year || "").trim()
    : String(photo.year || "").trim();
  updatePhotoLightboxView();
  showPhotoModal({ fadeIn: options.fadeIn !== false });
}

export function openVideoLightbox(videoId, title) {
  if (!dom.photoModal || !videoId) return;
  lightboxMode = "standalone-video";
  standaloneVideoId = videoId;
  restoreCameraOnLightboxClose = false;
  memoryLightboxTitle = "";
  memoryLightboxCaption = null;
  memoryLightboxYear = "";
  if (dom.photoModalTitle) {
    dom.photoModalTitle.textContent = title || "動画";
  }
  setCaptionElement(dom.photoModalCaption, "");
  setMemoryLightboxYearElement("");
  updateStandaloneVideoLightboxView();
  showPhotoModal({ fadeIn: false });
}

let photoModalFadeTimer = null;
let photoModalRevealRaf = 0;
const PHOTO_MODAL_FADE_MS = 1350;

function prepareLightboxImageReveal(img, imageUrl, altText) {
  const reveal = function () {
    if (!img || img.getAttribute("src") !== imageUrl) return;
    requestAnimationFrame(function () {
      img.classList.add("is-revealed");
    });
  };

  img.classList.remove("is-revealed");
  img.alt = altText;
  img.onload = reveal;
  img.onerror = reveal;
  img.src = imageUrl;
  if (img.complete && img.naturalWidth > 0) {
    reveal();
  }
}

function showPhotoModal(opts) {
  if (!dom.photoModal) return;
  const options = opts || {};
  if (photoModalFadeTimer) {
    window.clearTimeout(photoModalFadeTimer);
    photoModalFadeTimer = null;
  }
  if (photoModalRevealRaf) {
    window.cancelAnimationFrame(photoModalRevealRaf);
    photoModalRevealRaf = 0;
  }

  dom.photoModal.classList.remove("hidden");

  if (options.fadeIn) {
    dom.photoModal.classList.add("photo-modal--fade");
    dom.photoModal.classList.remove("photo-modal--visible");
    // 2フレーム空けてから visible を付け、トランジションが確実に走るようにする
    void dom.photoModal.offsetWidth;
    photoModalRevealRaf = requestAnimationFrame(function () {
      photoModalRevealRaf = requestAnimationFrame(function () {
        photoModalRevealRaf = 0;
        if (!dom.photoModal || dom.photoModal.classList.contains("hidden")) return;
        dom.photoModal.classList.add("photo-modal--visible");
      });
    });
    return;
  }

  dom.photoModal.classList.remove("photo-modal--fade");
  dom.photoModal.classList.add("photo-modal--visible");
  if (dom.photoModalImage) {
    dom.photoModalImage.classList.add("is-revealed");
  }
}

function hidePhotoModal() {
  if (!dom.photoModal) return;
  if (photoModalRevealRaf) {
    window.cancelAnimationFrame(photoModalRevealRaf);
    photoModalRevealRaf = 0;
  }
  dom.photoModal.classList.add("hidden");
  dom.photoModal.classList.remove("photo-modal--fade", "photo-modal--visible");
  if (dom.photoModalImage) {
    dom.photoModalImage.classList.remove("is-revealed");
    dom.photoModalImage.onload = null;
    dom.photoModalImage.onerror = null;
  }
}

function closePhotoLightbox(opts) {
  if (!dom.photoModal) return;
  const options = opts || {};
  const shouldRestore =
    options.restoreCamera !== false && restoreCameraOnLightboxClose;
  restoreCameraOnLightboxClose = false;

  const finishClose = function () {
    hidePhotoModal();
    lightboxMode = "gallery";
    standaloneVideoId = "";
    memoryLightboxTitle = "";
    memoryLightboxCaption = null;
    memoryLightboxYear = "";
    setMemoryLightboxYearElement("");
    setLightboxMediaMode("image");
    if (shouldRestore) {
      restoreCameraView();
    }
  };

  // 記憶モードのふわっと表示中なら、閉じるときもフェードアウト
  if (
    options.restoreCamera !== false
    && dom.photoModal.classList.contains("photo-modal--fade")
    && dom.photoModal.classList.contains("photo-modal--visible")
    && !dom.photoModal.classList.contains("hidden")
  ) {
    if (dom.photoModalImage) {
      dom.photoModalImage.classList.remove("is-revealed");
    }
    dom.photoModal.classList.remove("photo-modal--visible");
    if (photoModalFadeTimer) window.clearTimeout(photoModalFadeTimer);
    photoModalFadeTimer = window.setTimeout(finishClose, PHOTO_MODAL_FADE_MS);
    return;
  }

  if (photoModalFadeTimer) {
    window.clearTimeout(photoModalFadeTimer);
    photoModalFadeTimer = null;
  }
  finishClose();
}

export function closePhotoLightboxIfOpen(opts) {
  if (!dom.photoModal || dom.photoModal.classList.contains("hidden")) return;
  closePhotoLightbox(opts);
}

function showGallery(images) {
  galleryImages = filterGalleryPhotos(images);
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

/** スマホでピンタップ直後、同じ位置に出たパネルへのゴーストクリックを無視する */
const INFO_PANEL_CLICK_GUARD_MS = 450;
let infoPanelClickGuardUntil = 0;
let infoPanelClickGuardAttached = false;

function detachInfoPanelClickGuard() {
  if (!infoPanelClickGuardAttached) return;
  infoPanelClickGuardAttached = false;
  document.removeEventListener("click", onInfoPanelClickGuard, true);
  if (dom.infoPanel) {
    dom.infoPanel.classList.remove("info-panel--click-guard");
  }
}

function onInfoPanelClickGuard(event) {
  if (Date.now() >= infoPanelClickGuardUntil) {
    detachInfoPanelClickGuard();
    return;
  }
  if (!dom.infoPanel || dom.infoPanel.classList.contains("hidden")) {
    detachInfoPanelClickGuard();
    return;
  }
  if (dom.infoPanel.contains(event.target)) {
    event.preventDefault();
    event.stopPropagation();
  }
}

function armInfoPanelClickGuard() {
  infoPanelClickGuardUntil = Date.now() + INFO_PANEL_CLICK_GUARD_MS;
  if (dom.infoPanel) {
    dom.infoPanel.classList.add("info-panel--click-guard");
  }
  if (infoPanelClickGuardAttached) return;
  infoPanelClickGuardAttached = true;
  document.addEventListener("click", onInfoPanelClickGuard, true);
  window.setTimeout(function () {
    if (Date.now() >= infoPanelClickGuardUntil) {
      detachInfoPanelClickGuard();
    }
  }, INFO_PANEL_CLICK_GUARD_MS + 50);
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

  renderSpotYouTubePreviews(
    dom.spotYoutubePreviews,
    props.url ? props.url.getValue() : "",
    props.urlLabel ? props.urlLabel.getValue() : "",
    { onVideoClick: openVideoLightbox }
  );

  renderSpotLinks(
    dom.spotHomepageLinks,
    props.url ? props.url.getValue() : "",
    props.urlLabel ? props.urlLabel.getValue() : "",
    { onVideoClick: openVideoLightbox }
  );

  dom.infoPanel.classList.remove("hidden");
  // パネル表示と同時にタップが画像・リンクへ貫通するのを防ぐ
  armInfoPanelClickGuard();
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
  detachInfoPanelClickGuard();
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
