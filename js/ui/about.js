import { dom } from "../config/dom.js";
import { ABOUT_SECTIONS } from "../content/about.js?v=2";
import { ARCHIVE_CREATOR_NAME, ARCHIVE_CREATOR_URL } from "../config/constants.js";

function renderAboutContent() {
  if (!dom.aboutSheetBody) return;
  dom.aboutSheetBody.replaceChildren();
  ABOUT_SECTIONS.forEach(function (section) {
    const heading = document.createElement("h3");
    heading.textContent = section.title;
    dom.aboutSheetBody.appendChild(heading);

    if (section.html) {
      const paragraph = document.createElement("p");
      paragraph.innerHTML = section.html;
      dom.aboutSheetBody.appendChild(paragraph);
      return;
    }

    section.body.split(/\n\n+/).forEach(function (part) {
      const paragraph = document.createElement("p");
      paragraph.textContent = part;
      dom.aboutSheetBody.appendChild(paragraph);
    });
  });
}

function ensureCreatorFooter() {
  if (!dom.aboutSheetBody) return;
  if (dom.aboutSheetBody.querySelector(".about-sheet-creator-link")) return;

  const footer = document.createElement("p");
  footer.className = "about-sheet-creator-link";
  footer.appendChild(document.createTextNode("制作者HP : "));
  const link = document.createElement("a");
  link.href = ARCHIVE_CREATOR_URL;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = ARCHIVE_CREATOR_NAME;
  footer.appendChild(link);
  dom.aboutSheetBody.appendChild(footer);
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
  ensureCreatorFooter();

  if (dom.aboutBtn) {
    dom.aboutBtn.addEventListener("click", openAboutSheet);
  }
  if (dom.startupAboutBtn) {
    dom.startupAboutBtn.addEventListener("click", openAboutSheet);
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
