/** Vyn's face, live: blinks, follows the pointer (when big enough), and shows her mood. */
import { vynSvg, type Mood } from "./face-art";

const live = new Set<HTMLElement>();
let mood: Mood = "idle";

/** A face element `size` px wide. `follow` faces mirror Vyn's current mood. */
export function face(size: number, opts: { mood?: Mood; follow?: boolean } = {}) {
  const el = document.createElement("span");
  el.className = "vyn-face";
  el.style.width = el.style.height = `${size}px`;
  el.dataset.size = String(size);
  draw(el, opts.follow === false ? (opts.mood ?? "idle") : mood);
  if (opts.follow !== false) live.add(el);
  return el;
}

function draw(el: HTMLElement, m: Mood) {
  el.innerHTML = vynSvg(m, { live: true });
  el.dataset.mood = m;
}

export function setFaceMood(next: Mood) {
  mood = next;
  for (const el of live) {
    if (!el.isConnected) live.delete(el);
    else if (el.dataset.mood !== next) draw(el, next);
  }
}

/** Mouth open/closed while she speaks aloud. */
export function talking(on: boolean) {
  for (const el of live) el.classList.toggle("speaking", on);
}

// Blink now and then (every face together, like one character).
function blink() {
  for (const el of live) {
    el.classList.add("blink");
    window.setTimeout(() => el.classList.remove("blink"), 140);
  }
  window.setTimeout(blink, 2600 + Math.random() * 3800);
}
window.setTimeout(blink, 2000);

// Big faces look toward the pointer.
window.addEventListener("pointermove", (e) => {
  for (const el of live) {
    if (Number(el.dataset.size) < 48 || !el.isConnected) continue;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, d / 400);
    el.style.setProperty("--look-x", `${((dx / d) * 6 * k).toFixed(2)}px`);
    el.style.setProperty("--look-y", `${((dy / d) * 4 * k).toFixed(2)}px`);
  }
});

/** Big faces glance toward an element (the message box as the person types); the pointer takes over again when it moves. */
export function glance(target: Element) {
  const t = target.getBoundingClientRect();
  const tx = t.left + t.width * 0.3;
  const ty = t.top + t.height / 2;
  for (const el of live) {
    if (Number(el.dataset.size) < 48 || !el.isConnected) continue;
    const r = el.getBoundingClientRect();
    const dx = tx - (r.left + r.width / 2);
    const dy = ty - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy) || 1;
    el.style.setProperty("--look-x", `${((dx / d) * 6).toFixed(2)}px`);
    el.style.setProperty("--look-y", `${((dy / d) * 4).toFixed(2)}px`);
  }
}
