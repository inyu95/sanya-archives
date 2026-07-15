import { dom } from "../config/dom.js";
import { ASSETS_ICONS_BASE } from "../config/constants.js";
import { state } from "../state.js";
import { parseCommaList, parsePinYear } from "../utils/parse.js?v=73";
import { renderPins, flyToPins, refreshPinsForMapMode } from "../pins/pins.js";
import { setStatus, hideStatus } from "../ui/status.js";
import { hidePinInfo } from "../info-panel.js";
import { renderArchiveList, refreshArchiveListIfOpen } from "../ui/archive-list.js";
import { filterMemoryPhotosByQuery } from "../memory/memory-pins.js";
import {
  applyHistoricalMapLayer,
  EARLIEST_MAPPED_DECADE,
  getCurrentMapYear,
  resolveLayerForYear
} from "../imagery/historical-maps.js?v=135";

/** 地図レイヤー切替の重複呼び出しを防ぐ */
let activeHistoricalLayerId = null;
/** スライダー操作中のプレビュー年（マウスを離すまで地図は切り替えない） */
let yearSliderPreviewYear = null;

function getDefaultMapYear(bounds) {
  const currentYear = getCurrentMapYear();
  if (!bounds) return currentYear;
  return Math.max(bounds.min, Math.min(bounds.max, currentYear));
}

function getSliderPositionYear() {
  if (!dom.yearFilterSlider) return getCurrentMapYear();
  return parseInt(dom.yearFilterSlider.value, 10);
}

function getYearSliderBounds(pins) {
  let minYear = EARLIEST_MAPPED_DECADE;
  let maxYear = new Date().getFullYear();
  let hasYearData = false;

  pins.forEach(function (pin) {
    const range = getPinActiveYearRange(pin);
    if (!range) return;
    hasYearData = true;
    if (range.start < minYear) {
      minYear = Math.max(1928, range.start);
    }
    const endYear = Number.isFinite(range.end) ? range.end : maxYear;
    if (endYear > maxYear) {
      maxYear = endYear;
    }
  });

  if (!hasYearData) return null;
  return { min: minYear, max: maxYear };
}

function getPinActiveYearRange(pin) {
  const openingYear = parsePinYear(pin.openingYear);
  const closingYear = parsePinYear(pin.closingYear);

  let start = openingYear;
  let end = closingYear;
  if (start === null && end === null) return null;
  if (start === null) start = end;
  if (end === null) end = Number.POSITIVE_INFINITY;
  if (end < start) {
    const tmp = start;
    start = end;
    end = tmp;
  }
  return { start: start, end: end };
}

function pinMatchesYearFilter(pin) {
  if (state.selectedYear === null) return true;
  const range = getPinActiveYearRange(pin);
  if (!range) return false;
  const year = state.selectedYear;
  return range.start <= year && range.end >= year;
}

/** CSS の ::-webkit-slider-thumb / ::-moz-range-thumb 幅（border-box）と一致させる */
const YEAR_SLIDER_THUMB_PX = 16;
const YEAR_LABEL_MIN_GAP_PX = 40;
/** 詰めても必ず表示する年代ラベル */
const YEAR_LABEL_ALWAYS_SHOW = [1950, 2020];

function yearToSliderPercent(year, min, max) {
  if (max <= min) return 0;
  return ((year - min) / (max - min)) * 100;
}

function getYearSliderTrackWidth() {
  return dom.yearFilterSlider ? dom.yearFilterSlider.offsetWidth : 0;
}

/** スライダーつまみの中心位置（%）— ブラウザのつまみ幅を考慮 */
function yearToThumbPercent(year, min, max, trackWidthPx) {
  if (max <= min) return 0;
  const ratio = (year - min) / (max - min);
  const width = trackWidthPx || getYearSliderTrackWidth();
  if (!width || width <= YEAR_SLIDER_THUMB_PX) {
    return ratio * 100;
  }
  const usable = width - YEAR_SLIDER_THUMB_PX;
  const thumbCenter = YEAR_SLIDER_THUMB_PX / 2 + ratio * usable;
  return (thumbCenter / width) * 100;
}

function yearToThumbPx(year, min, max, trackWidthPx) {
  const width = trackWidthPx || getYearSliderTrackWidth();
  return (yearToThumbPercent(year, min, max, width) / 100) * width;
}

function filterYearLabelsForDisplay(years, min, max, trackWidthPx) {
  if (years.length <= 2) return years;
  const width = trackWidthPx || getYearSliderTrackWidth();
  if (!width) return years;

  const alwaysShow = new Set(
    YEAR_LABEL_ALWAYS_SHOW.filter(function (year) {
      return year > min && year < max && years.indexOf(year) !== -1;
    })
  );

  const shown = [years[0]];
  for (let i = 1; i < years.length - 1; i++) {
    const year = years[i];
    const gapOk = yearToThumbPx(year, min, max, width) - yearToThumbPx(shown[shown.length - 1], min, max, width) >= YEAR_LABEL_MIN_GAP_PX;
    if (gapOk || alwaysShow.has(year)) {
      if (!gapOk && shown.length > 1 && !alwaysShow.has(shown[shown.length - 1])) {
        shown.pop();
      }
      shown.push(year);
    }
  }

  const last = years[years.length - 1];
  if (last !== shown[shown.length - 1]) {
    const lastGap = yearToThumbPx(last, min, max, width) - yearToThumbPx(shown[shown.length - 1], min, max, width);
    if (lastGap < YEAR_LABEL_MIN_GAP_PX) {
      if (shown.length > 1 && !alwaysShow.has(shown[shown.length - 1])) {
        shown.pop();
      } else if (alwaysShow.has(shown[shown.length - 1])) {
        // 1950/2020 を優先し、衝突する終端年ラベルは出さない
        return shown;
      }
    }
    if (shown[shown.length - 1] !== last) {
      shown.push(last);
    }
  }
  return shown;
}

function getDisplayYear(year) {
  if (year !== null) return year;
  if (!dom.yearFilterSlider) return state.yearSliderMin;
  return parseInt(dom.yearFilterSlider.value, 10);
}

function clampSliderYear(year) {
  return Math.max(state.yearSliderMin, Math.min(state.yearSliderMax, year));
}

function getSliderVisualYear(committedYear) {
  if (yearSliderPreviewYear !== null) return yearSliderPreviewYear;
  return getDisplayYear(committedYear);
}

function updateYearFilterSliderFill(year) {
  if (!dom.yearFilterSlider) return;
  const min = state.yearSliderMin;
  const max = state.yearSliderMax;
  const displayYear = getSliderVisualYear(year);
  const fillPercent = yearToSliderPercent(displayYear, min, max);
  dom.yearFilterSlider.style.setProperty("--year-fill", fillPercent + "%");
  updateYearFilterThumbLabel(year);
}

function updateYearFilterThumbLabel(year) {
  if (!dom.yearFilterThumbLabel) return;
  const isPreviewing = yearSliderPreviewYear !== null;
  const showLabel = year !== null || isPreviewing;
  dom.yearFilterThumbLabel.hidden = !showLabel;
  if (dom.yearFilterSliderWrap) {
    dom.yearFilterSliderWrap.classList.toggle("year-filter-slider-wrap--has-year", showLabel);
  }
  if (!showLabel) return;

  const displayYear = getSliderVisualYear(year);
  dom.yearFilterThumbLabel.textContent = displayYear + "年";
  const percent = yearToThumbPercent(displayYear, state.yearSliderMin, state.yearSliderMax);
  dom.yearFilterThumbLabel.style.left = percent + "%";
}

function updateYearFilterAllButton() {
  if (!dom.yearFilterAll) return;
  const isAll = state.selectedYear === null;
  dom.yearFilterAll.classList.toggle("active", isAll);
  dom.yearFilterAll.setAttribute("aria-pressed", isAll ? "true" : "false");
  dom.yearFilterAll.textContent = "全ピン表示";
  if (dom.yearFilterSliderWrap) {
    dom.yearFilterSliderWrap.classList.toggle("year-filter-slider-wrap--inactive", isAll);
  }
}

function updateYearFilterLabel(year) {
  if (!dom.yearFilterLabel) return;
  if (year === null) {
    const layer = resolveLayerForYear(getSliderPositionYear());
    dom.yearFilterLabel.textContent = layer.label;
    dom.yearFilterLabel.classList.remove("year-filter-label--active");
    return;
  }
  const layer = resolveLayerForYear(year);
  dom.yearFilterLabel.textContent = layer.label;
  dom.yearFilterLabel.classList.add("year-filter-label--active");
}

function syncHistoricalMapForYear(year, force) {
  if (year === null) {
    if (force || activeHistoricalLayerId !== null) {
      activeHistoricalLayerId = null;
      applyHistoricalMapLayer(null);
    }
    return;
  }

  const layer = resolveLayerForYear(year);
  if (force || layer.id !== activeHistoricalLayerId) {
    activeHistoricalLayerId = layer.id;
    applyHistoricalMapLayer(year);
  }
}

function previewYearSlider(year) {
  yearSliderPreviewYear = clampSliderYear(year);
  updateYearFilterAllButton();
  updateYearFilterSliderFill(state.selectedYear);
  updateYearFilterLabel(yearSliderPreviewYear);
}

function commitYearSliderSelection() {
  if (!dom.yearFilterSlider) return;
  if (yearSliderPreviewYear === null) return;
  setYearFromSlider(parseInt(dom.yearFilterSlider.value, 10));
}

function setYearFromSlider(year, forceYearFilter) {
  yearSliderPreviewYear = null;
  const clamped = clampSliderYear(year);
  const shouldForceYearFilter = forceYearFilter === true;
  const isAllMode = state.selectedYear === null;
  if (isAllMode && !shouldForceYearFilter) {
    if (dom.yearFilterSlider) {
      dom.yearFilterSlider.value = String(clamped);
    }
    updateYearFilterAllButton();
    updateYearFilterLabel(null);
    updateYearFilterSliderFill(null);
    syncHistoricalMapForYear(clamped, true);
    refreshPinsForMapMode();
    return;
  }

  const enteringFromAll = isAllMode;
  state.selectedYear = clamped;
  if (dom.yearFilterSlider) {
    dom.yearFilterSlider.value = String(clamped);
  }
  updateYearFilterAllButton();
  updateYearFilterLabel(clamped);
  updateYearFilterSliderFill(clamped);
  syncHistoricalMapForYear(clamped, enteringFromAll);
  applyFilters();
}

function setYearFilterAll() {
  yearSliderPreviewYear = null;
  state.selectedYear = null;
  updateYearFilterAllButton();
  updateYearFilterLabel(null);
  updateYearFilterSliderFill(null);
  syncHistoricalMapForYear(null, true);
  applyFilters();
}

function toggleYearFilterAll() {
  if (state.selectedYear === null) {
    setYearFromSlider(getSliderPositionYear(), true);
    return;
  }
  setYearFilterAll();
}

function renderYearFilterTicks(min, max) {
  if (!dom.yearFilterTicks) return;
  dom.yearFilterTicks.innerHTML = "";
  if (dom.yearFilterTickLabels) {
    dom.yearFilterTickLabels.innerHTML = "";
  }

  const boundaries = [min];
  const eraStarts = [2020, 2010, 2000, 1990, 1980, 1970, 1960, 1950, 1940, 1930];
  eraStarts.forEach(function (eraStart) {
    if (eraStart > min && eraStart < max) {
      boundaries.push(eraStart);
    }
  });
  if (max !== min && boundaries.indexOf(max) === -1) {
    boundaries.push(max);
  }
  boundaries.sort(function (a, b) { return a - b; });

  const trackWidth = getYearSliderTrackWidth();
  const visibleLabels = new Set(filterYearLabelsForDisplay(boundaries, min, max, trackWidth));

  boundaries.forEach(function (year) {
    const percent = yearToThumbPercent(year, min, max, trackWidth) + "%";
    const tick = document.createElement("span");
    tick.className = "year-filter-tick";
    tick.style.left = percent;
    tick.title = year + "年";
    dom.yearFilterTicks.appendChild(tick);

    if (!dom.yearFilterTickLabels || !visibleLabels.has(year)) return;
    const label = document.createElement("span");
    label.className = "year-filter-tick-label";
    label.textContent = String(year);
    label.style.left = percent;
    dom.yearFilterTickLabels.appendChild(label);
  });
}

export function renderYearFilterBar(opts) {
  if (!dom.yearFilterBar) return;
  const options = opts || {};
  // モード切替で syncMap:false のときは UI のみ更新（視点を動かさない）
  const syncMap = options.syncMap !== false;

  const bounds = getYearSliderBounds(state.allPins);
  if (!bounds) {
    dom.yearFilterBar.classList.add("hidden");
    yearSliderPreviewYear = null;
    state.selectedYear = null;
    if (syncMap) {
      activeHistoricalLayerId = null;
      applyHistoricalMapLayer(null);
    }
    return;
  }

  state.yearSliderMin = bounds.min;
  state.yearSliderMax = bounds.max;

  if (state.selectedYear !== null) {
    if (state.selectedYear < bounds.min || state.selectedYear > bounds.max) {
      state.selectedYear = null;
    }
  }

  dom.yearFilterBar.classList.remove("hidden");

  if (dom.yearFilterSlider) {
    dom.yearFilterSlider.min = String(bounds.min);
    dom.yearFilterSlider.max = String(bounds.max);
    if (state.selectedYear !== null) {
      dom.yearFilterSlider.value = String(state.selectedYear);
    } else if (!dom.yearFilterSlider.value) {
      dom.yearFilterSlider.value = String(getDefaultMapYear(bounds));
    }
  }

  renderYearFilterTicks(bounds.min, bounds.max);
  updateYearFilterAllButton();
  updateYearFilterLabel(state.selectedYear);
  updateYearFilterSliderFill(state.selectedYear);
  if (syncMap) {
    syncHistoricalMapForYear(state.selectedYear, true);
  }

  requestAnimationFrame(function () {
    renderYearFilterTicks(bounds.min, bounds.max);
    updateYearFilterSliderFill(state.selectedYear);
  });
}

let yearFilterResizeObserver = null;

function setupYearFilterResizeObserver() {
  if (!dom.yearFilterSliderWrap || yearFilterResizeObserver) return;
  yearFilterResizeObserver = new ResizeObserver(function () {
    if (!dom.yearFilterBar || dom.yearFilterBar.classList.contains("hidden")) return;
    renderYearFilterTicks(state.yearSliderMin, state.yearSliderMax);
    updateYearFilterSliderFill(state.selectedYear);
  });
  yearFilterResizeObserver.observe(dom.yearFilterSliderWrap);
}

export function setupYearFilterBar() {
  setupYearFilterResizeObserver();

  if (dom.yearFilterAll) {
    dom.yearFilterAll.addEventListener("click", function () {
      toggleYearFilterAll();
    });
  }
  if (dom.yearFilterSlider) {
    dom.yearFilterSlider.addEventListener("pointerdown", function () {
      previewYearSlider(parseInt(dom.yearFilterSlider.value, 10));
    });
    dom.yearFilterSlider.addEventListener("input", function () {
      previewYearSlider(parseInt(dom.yearFilterSlider.value, 10));
    });
    dom.yearFilterSlider.addEventListener("pointerup", function () {
      commitYearSliderSelection();
    });
    dom.yearFilterSlider.addEventListener("pointercancel", function () {
      commitYearSliderSelection();
    });
    dom.yearFilterSlider.addEventListener("blur", function () {
      commitYearSliderSelection();
    });
    dom.yearFilterSlider.addEventListener("change", function () {
      setYearFromSlider(parseInt(dom.yearFilterSlider.value, 10));
    });
  }
}

function pinMatchesQuery(pin, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  const fields = [
    pin.name,
    pin.text,
    pin.category,
    pin.openingYear,
    pin.closingYear,
    (pin.role || []).join(" ")
  ];
  return fields.some(function (field) {
    return String(field || "").toLowerCase().indexOf(q) !== -1;
  });
}

function pinMatchesCategoryFilter(pin) {
  if (state.selectedCategories.size === 0) return true;
  const categories = parseCommaList(pin.category);
  return categories.some(function (category) {
    return state.selectedCategories.has(category);
  });
}

function pinMatchesRoleFilter(pin) {
  if (state.selectedRoles.size === 0) return true;
  return (pin.role || []).some(function (role) {
    return state.selectedRoles.has(role);
  });
}

function getFilteredPins() {
  const query = dom.searchInput ? dom.searchInput.value.trim() : "";
  return state.allPins.filter(function (pin) {
    return pinMatchesQuery(pin, query)
      && pinMatchesCategoryFilter(pin)
      && pinMatchesRoleFilter(pin)
      && pinMatchesYearFilter(pin);
  });
}

function hasActiveFilters() {
  const query = dom.searchInput ? dom.searchInput.value.trim() : "";
  return Boolean(query)
    || state.selectedCategories.size > 0
    || state.selectedRoles.size > 0
    || state.selectedYear !== null;
}

function updateSearchCount(filteredCount) {
  if (!dom.searchCount) return;
  if (!hasActiveFilters()) {
    dom.searchCount.textContent = "";
    return;
  }
  dom.searchCount.textContent = filteredCount + " / " + state.allPins.length + " 件";
}

function syncFilteredView() {
  const filtered = getFilteredPins();
  state.filteredPins = filtered;
  updateSearchCount(filtered.length);
  hidePinInfo();
  return filtered;
}

export function applyFilters() {
  if (state.appMode === "memory") return;

  const filtered = syncFilteredView();
  renderArchiveList(filtered);

  if (state.appMode !== "life") return;
  renderPins(filtered);
}

function applyRoleTagColor(button, label) {
  const color = state.roleColors[label] || "#9a9a9a";
  button.setAttribute("data-color", "");
  button.style.setProperty("--tag-color", color);
}

function renderFilterTags(container, options, selectedSet, type) {
  if (!container) return;
  container.innerHTML = "";
  const group = container.closest(".filter-group");

  if (options.length === 0) {
    container.hidden = true;
    if (group) group.hidden = true;
    return;
  }

  container.hidden = false;
  if (group) group.hidden = false;
  options.forEach(function (label) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "filter-tag filter-tag--" + type + (selectedSet.has(label) ? " active" : "");
    if (type === "role") {
      const icon = document.createElement("img");
      icon.className = "filter-tag-icon";
      icon.src = ASSETS_ICONS_BASE + encodeURIComponent(label) + ".png";
      icon.alt = "";
      icon.setAttribute("aria-hidden", "true");
      icon.addEventListener("error", function () {
        icon.remove();
      });
      button.appendChild(icon);
    }
    const text = document.createElement("span");
    text.className = "filter-tag-label";
    text.textContent = label;
    button.appendChild(text);
    if (type === "role") {
      applyRoleTagColor(button, label);
    }
    button.addEventListener("click", function () {
      if (selectedSet.has(label)) {
        selectedSet.delete(label);
      } else {
        selectedSet.add(label);
      }
      button.classList.toggle("active");
      applyFilters();
    });
    container.appendChild(button);
  });
}

function renderAllFilterTags() {
  renderFilterTags(dom.categoryFilters, state.categoryOptions, state.selectedCategories, "category");
  renderFilterTags(dom.roleFilters, state.roleOptions, state.selectedRoles, "role");
}

function clearFilters() {
  state.selectedCategories.clear();
  state.selectedRoles.clear();
  if (dom.searchInput) dom.searchInput.value = "";
  renderAllFilterTags();
  applyFilters();
}

function deriveOptionsFromPins(pins, field) {
  const values = new Set();
  pins.forEach(function (pin) {
    if (field === "category") {
      parseCommaList(pin.category).forEach(function (value) { values.add(value); });
    } else {
      (pin.role || []).forEach(function (value) { values.add(value); });
    }
  });
  return Array.from(values).sort();
}

function setFilterOptions(categories, roles, roleColors, pins) {
  state.categoryOptions = categories.length > 0 ? categories : deriveOptionsFromPins(pins, "category");
  state.roleOptions = roles.length > 0 ? roles : deriveOptionsFromPins(pins, "role");
  state.roleColors = roleColors || {};
  renderAllFilterTags();
}

export function loadPinData(pins, options) {
  const opts = options || {};
  state.allPins = pins;

  if (opts.categories || opts.roles || opts.roleColors) {
    setFilterOptions(opts.categories || [], opts.roles || [], opts.roleColors, pins);
  }

  if (opts.resetSearch) {
    state.selectedCategories.clear();
    state.selectedRoles.clear();
    state.selectedYear = getCurrentMapYear();
    yearSliderPreviewYear = null;
    if (dom.searchInput) dom.searchInput.value = "";
    renderAllFilterTags();
  }

  // 生活史モード以外では地図レイヤー切替・ピン描画を起こさない（起動の地球ビューを維持）
  renderYearFilterBar({ syncMap: state.appMode === "life" });
  if (state.appMode !== "life" && dom.yearFilterBar) {
    dom.yearFilterBar.classList.add("hidden");
  }
  const filtered = syncFilteredView();
  renderArchiveList(filtered);

  function finishStatus() {
    if (!opts.statusMessage) return;
    if (opts.statusType === "ok") {
      setStatus(opts.statusMessage, "ok");
      window.setTimeout(hideStatus, 1500);
    } else {
      setStatus(opts.statusMessage, opts.statusType || "");
    }
  }

  if (state.appMode !== "life") {
    finishStatus();
    return;
  }

  renderPins(filtered, function () {
    if (opts.flyTo !== false && filtered.length > 0) flyToPins();
    finishStatus();
  });
}

export function setupSearchBox() {
  if (!dom.searchInput) return;
  dom.searchInput.addEventListener("input", function () {
    if (state.appMode === "memory") {
      const filtered = filterMemoryPhotosByQuery(dom.searchInput.value);
      if (dom.searchCount) {
        const q = dom.searchInput.value.trim();
        dom.searchCount.textContent = q
          ? filtered.length + " / " + state.allMemoryPhotos.length + " 件"
          : "";
      }
      refreshArchiveListIfOpen();
      return;
    }
    applyFilters();
  });
}

const MOBILE_BREAKPOINT = "(max-width: 768px)";

function isMobileLayout() {
  return window.matchMedia(MOBILE_BREAKPOINT).matches;
}

function syncFilterPanelState(options) {
  if (!dom.filterPanel || !dom.filterToggle) return;
  if (!isMobileLayout()) {
    dom.filterPanel.classList.add("filter-panel--open");
    dom.filterToggle.setAttribute("aria-expanded", "true");
    return;
  }
  if (options && options.initial) {
    dom.filterPanel.classList.remove("filter-panel--open");
  }
  const isOpen = dom.filterPanel.classList.contains("filter-panel--open");
  dom.filterToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
}

export function setupFilterPanel() {
  if (dom.filterClear) {
    dom.filterClear.addEventListener("click", clearFilters);
  }
  if (dom.filterToggle && dom.filterPanel) {
    dom.filterToggle.addEventListener("click", function () {
      if (!isMobileLayout()) return;
      dom.filterPanel.classList.toggle("filter-panel--open");
      syncFilterPanelState();
    });
    window.matchMedia(MOBILE_BREAKPOINT).addEventListener("change", function () {
      syncFilterPanelState();
    });
    syncFilterPanelState({ initial: true });
  }
}
