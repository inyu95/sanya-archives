import { dom } from "../config/dom.js";
import { state } from "../state.js";
import { parseCommaList, parsePinYear } from "../utils/parse.js";
import { renderPins, flyToPins } from "../pins/pins.js";
import { setStatus, hideStatus } from "../ui/status.js";
import { hidePinInfo } from "../info-panel.js";
import { renderArchiveList } from "../ui/archive-list.js";

function getDecadesFromPins(pins) {
  const decades = new Set();
  pins.forEach(function (pin) {
    const year = parsePinYear(pin.year);
    if (year !== null) {
      decades.add(Math.floor(year / 10) * 10);
    }
  });
  return Array.from(decades).sort(function (a, b) { return a - b; });
}

function pinMatchesYearFilter(pin) {
  if (state.selectedYearDecade === null) return true;
  const year = parsePinYear(pin.year);
  if (year === null) return false;
  return year >= state.selectedYearDecade && year < state.selectedYearDecade + 10;
}

function formatYearDecadeLabel(decadeStart) {
  if (decadeStart === null) return "すべて";
  return decadeStart + "–" + (decadeStart + 9);
}

function updateYearFilterNavButtons() {
  if (!dom.yearFilterPrev || !dom.yearFilterNext) return;
  const currentIndex = state.selectedYearDecade === null
    ? -1
    : state.yearDecadeOptions.indexOf(state.selectedYearDecade);
  dom.yearFilterPrev.disabled = currentIndex <= 0;
  dom.yearFilterNext.disabled = currentIndex >= state.yearDecadeOptions.length - 1;
}

function getActiveYearFilterSegment(decadeStart) {
  const root = dom.yearFilterTrackInner || dom.yearFilterTrack;
  if (!root) return null;
  const selector = decadeStart === null
    ? ".year-filter-segment[data-decade='all']"
    : ".year-filter-segment[data-decade='" + decadeStart + "']";
  return root.querySelector(selector);
}

function updateYearFilterThumb(decadeStart, instant) {
  const thumb = dom.yearFilterThumb;
  const inner = dom.yearFilterTrackInner;
  if (!thumb || !inner) return;

  const activeSegment = getActiveYearFilterSegment(decadeStart);
  if (!activeSegment) {
    thumb.style.opacity = "0";
    return;
  }

  const left = activeSegment.offsetLeft;
  const width = activeSegment.offsetWidth;

  if (instant) {
    thumb.style.transition = "none";
  }

  thumb.style.width = width + "px";
  thumb.style.transform = "translateX(" + left + "px)";
  thumb.style.opacity = "1";

  if (instant) {
    requestAnimationFrame(function () {
      thumb.style.transition = "";
    });
  }
}

function scrollYearFilterSegmentIntoView(decadeStart) {
  const activeSegment = getActiveYearFilterSegment(decadeStart);
  if (activeSegment && activeSegment.scrollIntoView) {
    activeSegment.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }
}

function setYearFilter(decadeStart) {
  state.selectedYearDecade = decadeStart;
  if (dom.yearFilterTrack) {
    dom.yearFilterTrack.querySelectorAll(".year-filter-segment").forEach(function (button) {
      const value = button.getAttribute("data-decade");
      const isActive = value === "all"
        ? decadeStart === null
        : parseInt(value, 10) === decadeStart;
      button.classList.toggle("active", isActive);
    });
  }
  if (dom.yearFilterLabel) {
    dom.yearFilterLabel.textContent = formatYearDecadeLabel(decadeStart);
  }
  updateYearFilterNavButtons();
  updateYearFilterThumb(decadeStart);
  scrollYearFilterSegmentIntoView(decadeStart);
  applyFilters();
}

function shiftYearFilter(direction) {
  if (state.yearDecadeOptions.length === 0) return;
  const currentIndex = state.selectedYearDecade === null
    ? -1
    : state.yearDecadeOptions.indexOf(state.selectedYearDecade);
  const nextIndex = currentIndex + direction;
  if (nextIndex < 0) {
    setYearFilter(null);
    return;
  }
  if (nextIndex >= state.yearDecadeOptions.length) return;
  setYearFilter(state.yearDecadeOptions[nextIndex]);
}

export function renderYearFilterBar() {
  if (!dom.yearFilterBar || !dom.yearFilterTrack) return;

  state.yearDecadeOptions = getDecadesFromPins(state.allPins);
  if (state.yearDecadeOptions.length === 0) {
    dom.yearFilterBar.classList.add("hidden");
    state.selectedYearDecade = null;
    return;
  }

  dom.yearFilterBar.classList.remove("hidden");
  if (state.selectedYearDecade !== null && state.yearDecadeOptions.indexOf(state.selectedYearDecade) === -1) {
    state.selectedYearDecade = null;
  }

  dom.yearFilterTrack.innerHTML = "";

  const inner = document.createElement("div");
  inner.className = "year-filter-track-inner";
  dom.yearFilterTrack.appendChild(inner);
  dom.yearFilterTrackInner = inner;

  const thumb = document.createElement("div");
  thumb.className = "year-filter-thumb";
  thumb.setAttribute("aria-hidden", "true");
  inner.appendChild(thumb);
  dom.yearFilterThumb = thumb;

  const allButton = document.createElement("button");
  allButton.type = "button";
  allButton.className = "year-filter-segment" + (state.selectedYearDecade === null ? " active" : "");
  allButton.setAttribute("data-decade", "all");
  allButton.setAttribute("role", "tab");
  allButton.textContent = "すべて";
  allButton.addEventListener("click", function () {
    setYearFilter(null);
  });
  inner.appendChild(allButton);

  state.yearDecadeOptions.forEach(function (decadeStart) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "year-filter-segment" + (state.selectedYearDecade === decadeStart ? " active" : "");
    button.setAttribute("data-decade", String(decadeStart));
    button.setAttribute("role", "tab");
    button.textContent = decadeStart + "年代";
    button.addEventListener("click", function () {
      setYearFilter(decadeStart);
    });
    inner.appendChild(button);
  });

  if (dom.yearFilterLabel) {
    dom.yearFilterLabel.textContent = formatYearDecadeLabel(state.selectedYearDecade);
  }
  updateYearFilterNavButtons();
  requestAnimationFrame(function () {
    updateYearFilterThumb(state.selectedYearDecade, true);
  });
}

export function setupYearFilterBar() {
  if (dom.yearFilterPrev) {
    dom.yearFilterPrev.addEventListener("click", function () {
      shiftYearFilter(-1);
    });
  }
  if (dom.yearFilterNext) {
    dom.yearFilterNext.addEventListener("click", function () {
      shiftYearFilter(1);
    });
  }
  if (dom.yearFilterTrack) {
    dom.yearFilterTrack.addEventListener("scroll", function () {
      updateYearFilterThumb(state.selectedYearDecade, true);
    });
  }
  window.addEventListener("resize", function () {
    updateYearFilterThumb(state.selectedYearDecade, true);
  });
}

function pinMatchesQuery(pin, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  const fields = [
    pin.name,
    pin.text,
    pin.category,
    pin.year,
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

export function getFilteredPins() {
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
    || state.selectedYearDecade !== null;
}

function updateSearchCount(filteredCount) {
  if (!dom.searchCount) return;
  if (!hasActiveFilters()) {
    dom.searchCount.textContent = "";
    return;
  }
  dom.searchCount.textContent = filteredCount + " / " + state.allPins.length + " 件";
}

export function applyFilters() {
  const filtered = getFilteredPins();
  state.filteredPins = filtered;
  updateSearchCount(filtered.length);
  hidePinInfo();
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

  if (options.length === 0) {
    container.hidden = true;
    return;
  }

  container.hidden = false;
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
    state.selectedYearDecade = null;
    if (dom.searchInput) dom.searchInput.value = "";
    renderAllFilterTags();
  }

  renderYearFilterBar();

  const filtered = getFilteredPins();
  state.filteredPins = filtered;
  updateSearchCount(filtered.length);
  hidePinInfo();
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

function syncFilterPanelState() {
  if (!dom.filterPanel || !dom.filterToggle) return;
  if (!isMobileLayout()) {
    dom.filterPanel.classList.add("filter-panel--open");
    dom.filterToggle.setAttribute("aria-expanded", "true");
    return;
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
    window.matchMedia(MOBILE_BREAKPOINT).addEventListener("change", syncFilterPanelState);
    syncFilterPanelState();
  }
}
