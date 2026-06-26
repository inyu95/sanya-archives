import { dom } from "../config/dom.js";
import { ABOUT_SECTIONS } from "../content/about.js";
import { mountCustomToolbarButtons } from "./toolbar.js";
function renderAboutContent() {
  if (!dom.aboutSheetBody) return;
  dom.aboutSheetBody.replaceChildren();
  ABOUT_SECTIONS.forEach(function (section) {
    const heading = document.createElement("h3");
    heading.textContent = section.title;
    dom.aboutSheetBody.appendChild(heading);

    const paragraph = document.createElement("p");
    paragraph.textContent = section.body;
    dom.aboutSheetBody.appendChild(paragraph);
  });
}

function openAboutSheet() {
  if (!dom.aboutSheet) return;
  dom.aboutSheet.classList.remove("hidden");
  dom.aboutSheet.setAttribute("aria-hidden", "false");
}

function closeAboutSheet() {
  if (!dom.aboutSheet) return;
  dom.aboutSheet.classList.add("hidden");
  dom.aboutSheet.setAttribute("aria-hidden", "true");
}

export function setupAboutSheet() {
  renderAboutContent();
  mountCustomToolbarButtons();

  if (dom.aboutBtn) {    dom.aboutBtn.addEventListener("click", openAboutSheet);
  }
  if (dom.aboutSheetClose) {
    dom.aboutSheetClose.addEventListener("click", closeAboutSheet);
  }
  if (dom.aboutSheetBackdrop) {
    dom.aboutSheetBackdrop.addEventListener("click", closeAboutSheet);
  }
  document.addEventListener("keydown", function (event) {
    if (!dom.aboutSheet || dom.aboutSheet.classList.contains("hidden")) return;
    if (event.key === "Escape") {
      closeAboutSheet();
    }
  });
}
