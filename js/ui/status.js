import { dom } from "../config/dom.js";

export function setStatus(message, type) {
  if (!dom.status) return;
  dom.status.textContent = message;
  dom.status.classList.remove("hidden", "error", "ok");
  if (type) dom.status.classList.add(type);
}

export function hideStatus() {
  if (!dom.status) return;
  dom.status.classList.add("hidden");
}