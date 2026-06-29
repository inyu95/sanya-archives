import { parseUrlLinks } from "../utils/parse.js";

export function renderSpotLinks(container, urlValue, labelValue, options) {
  if (!container) return [];

  const links = parseUrlLinks(urlValue, labelValue);
  container.innerHTML = "";

  if (links.length === 0) {
    container.classList.add("hidden");
    return links;
  }

  container.classList.remove("hidden");
  links.forEach(function (item) {
    const link = document.createElement("a");
    link.className = "spot-homepage-btn";
    link.href = item.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = item.label;
    if (options && options.stopPropagation) {
      link.addEventListener("click", function (event) {
        event.stopPropagation();
      });
    }
    container.appendChild(link);
  });

  return links;
}
