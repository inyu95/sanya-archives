import { dom } from "../config/dom.js";
import { state } from "../state.js";
import { parseCommaList, parsePinYear } from "../utils/parse.js?v=65";
import { renderPins, flyToPins } from "../pins/pins.js";
import { setStatus, hideStatus } from "../ui/status.js";
import { hidePinInfo } from "../info-panel.js";
import { renderArchiveList } from "../ui/archive-list.js";
import {
  applyHistoricalMapLayer,
  EARLIEST_MAPPED_DECADE,
  resolveLayerForYear
} from "../imagery/historical-maps.js?v=65";

/** 地図レイヤー切替の重複呼び出しを防ぐ */
let activeHistoricalLayerId = null;

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

function formatYearLabel(year) {
  if (year === null) return "すべて";
  const layer = resolveLayerForYear(year);
  return year + "年 · " + layer.label;
}

function yearToSliderPercent(year, min, max) {
  if (max <= min) return 0;
  return ((year - min) / (max - min)) * 100;
}

function updateYearFilterSliderFill(year) {
  if (!dom.yearFilterSlider) return;
  const min = state.yearSliderMin;
  const max = state.yearSliderMax;
  const displayYear = year !== null
    ? year
    : parseInt(dom.yearFilterSlider.value, 10);
  const percent = yearToSliderPercent(displayYear, min, max);
  dom.yearFilterSlider.style.setProperty("--year-fill", percent + "%");
}

function updateYearFilterAllButton() {
  if (!dom.yearFilterAll) return;
  const isAll = state.selectedYear === null;
  dom.yearFilterAll.classList.toggle("active", isAll);
  if (dom.yearFilterSliderWrap) {
    dom.yearFilterSliderWrap.classList.toggle("year-filter-slider-wrap--inactive", isAll);
  }
}

function updateYearFilterLabel(year) {
  if (dom.yearFilterLabel) {
    dom.yearFilterLabel.textContent = formatYearLabel(year);
  }
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

function setYearFromSlider(year) {
  const clamped = Math.max(state.yearSliderMin, Math.min(state.yearSliderMax, year));
  const enteringFromAll = state.selectedYear === null;
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
  state.selectedYear = null;
  updateYearFilterAllButton();
  updateYearFilterLabel(null);
  updateYearFilterSliderFill(null);
  syncHistoricalMapForYear(null, true);
  applyFilters();
}

function renderYearFilterTicks(min, max) {
  if (!dom.yearFilterTicks) return;
  dom.yearFilterTicks.innerHTML = "";

  const boundaries = [min];
  const eraStarts = [2020, 2010, 2000, 1990, 1980, 1970, 1960, 1940, 1930];
  eraStarts.forEach(function (eraStart) {
    if (eraStart > min && eraStart < max) {
      boundaries.push(eraStart);
    }
  });

  boundaries.forEach(function (year) {
    const tick = document.createElement("span");
    tick.className = "year-filter-tick";
    tick.style.left = yearToSliderPercent(year, min, max) + "%";
    tick.title = year + "年";
    dom.yearFilterTicks.appendChild(tick);
  });
}

function renderYearFilterBar() {
  if (!dom.yearFilterBar) return;

  const bounds = getYearSliderBounds(state.allPins);
  if (!bounds) {
    dom.yearFilterBar.classList.add("hidden");
    state.selectedYear = null;
    activeHistoricalLayerId = null;
    applyHistoricalMapLayer(null);
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
    const defaultYear = state.selectedYear !== null
      ? state.selectedYear
      : Math.round((bounds.min + bounds.max) / 2);
    dom.yearFilterSlider.value = String(defaultYear);
    if (state.selectedYear === null) {
      dom.yearFilterSlider.value = String(defaultYear);
    }
  }

  renderYearFilterTicks(bounds.min, bounds.max);
  updateYearFilterAllButton();
  updateYearFilterLabel(state.selectedYear);
  updateYearFilterSliderFill(state.selectedYear);
  syncHistoricalMapForYear(state.selectedYear, true);
}

export function setupYearFilterBar() {
  if (dom.yearFilterAll) {
    dom.yearFilterAll.addEventListener("click", function () {
      setYearFilterAll();
    });
  }
  if (dom.yearFilterSlider) {
    dom.yearFilterSlider.addEventListener("pointerdown", function () {
      if (state.selectedYear === null) {
        setYearFromSlider(parseInt(dom.yearFilterSlider.value, 10));
      }
    });
    dom.yearFilterSlider.addEventListener("input", function () {
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
    (pin.activity || []).join(" ")
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

function pinMatchesActivityFilter(pin) {
  if (state.selectedActivities.size === 0) return true;
  return (pin.activity || []).some(function (activity) {
    return state.selectedActivities.has(activity);
  });
}

function getFilteredPins() {
  const query = dom.searchInput ? dom.searchInput.value.trim() : "";
  return state.allPins.filter(function (pin) {
    return pinMatchesQuery(pin, query)
      && pinMatchesCategoryFilter(pin)
      && pinMatchesActivityFilter(pin)
      && pinMatchesYearFilter(pin);
  });
}

function hasActiveFilters() {
  const query = dom.searchInput ? dom.searchInput.value.trim() : "";
  return Boolean(query)
    || state.selectedCategories.size > 0
    || state.selectedActivities.size > 0
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
  const filtered = syncFilteredView();
  renderPins(filtered);
  renderArchiveList(filtered);
}

function applyActivityTagColor(button, label, isActive) {
  const color = state.activityColors[label];
  if (!color) {
    button.removeAttribute("data-color");
    button.style.removeProperty("--tag-color");
    return;
  }
  button.setAttribute("data-color", "");
  button.style.setProperty("--tag-color", color);
  if (isActive) {
    button.style.background = color;
    button.style.borderColor = color;
    button.style.color = "#fff";
  } else {
    button.style.background = "";
    button.style.borderColor = "";
    button.style.color = "";
  }
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
    button.textContent = label;
    if (type === "activity") {
      applyActivityTagColor(button, label, selectedSet.has(label));
    }
    button.addEventListener("click", function () {
      if (selectedSet.has(label)) {
        selectedSet.delete(label);
      } else {
        selectedSet.add(label);
      }
      button.classList.toggle("active");
      if (type === "activity") {
        applyActivityTagColor(button, label, selectedSet.has(label));
      }
      applyFilters();
    });
    container.appendChild(button);
  });
}

function renderAllFilterTags() {
  renderFilterTags(dom.categoryFilters, state.categoryOptions, state.selectedCategories, "category");
  renderFilterTags(dom.activityFilters, state.activityOptions, state.selectedActivities, "activity");
}

function clearFilters() {
  state.selectedCategories.clear();
  state.selectedActivities.clear();
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
      (pin.activity || []).forEach(function (value) { values.add(value); });
    }
  });
  return Array.from(values).sort();
}

function setFilterOptions(categories, activities, activityColors, pins) {
  state.categoryOptions = categories.length > 0 ? categories : deriveOptionsFromPins(pins, "category");
  state.activityOptions = activities.length > 0 ? activities : deriveOptionsFromPins(pins, "activity");
  state.activityColors = activityColors || {};
  renderAllFilterTags();
}

export function loadPinData(pins, options) {
  const opts = options || {};
  state.allPins = pins;

  if (opts.categories || opts.activities || opts.activityColors) {
    setFilterOptions(opts.categories || [], opts.activities || [], opts.activityColors, pins);
  }

  if (opts.resetSearch) {
    state.selectedCategories.clear();
    state.selectedActivities.clear();
    state.selectedYear = null;
    if (dom.searchInput) dom.searchInput.value = "";
    renderAllFilterTags();
  }

  renderYearFilterBar();
  const filtered = syncFilteredView();
  renderPins(filtered, function () {
    renderArchiveList(filtered);
    if (opts.flyTo !== false && filtered.length > 0) flyToPins();
    if (opts.statusMessage) {
      if (opts.statusType === "ok") {
        setStatus(opts.statusMessage, "ok");
        window.setTimeout(hideStatus, 1500);
      } else {
        setStatus(opts.statusMessage, opts.statusType || "");
      }
    }
  });
}

export function setupSearchBox() {
  if (!dom.searchInput) return;
  dom.searchInput.addEventListener("input", function () {
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
    dom.filterPanel.classList.add("filter-panel--open");
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
