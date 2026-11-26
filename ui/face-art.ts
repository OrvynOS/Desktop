/**
 * Vyn's face: one drawing, every mood. Pure (no DOM), so the window animates it live and the
 * build exports the static mood files (static/vyn/<mood>.svg) other apps use.
 *
 * A flat charcoal teddy with a light-blue nose and bow (Orvyn's colours: no gradients). Expression lives in the eyes
 * (and a small mouth): every mood's eyes are in the drawing; `data-mood` on the root shows one.
 */
export const MOODS = ["idle", "happy", "thinking", "curious", "attentive", "sorry", "sleepy", "talking"] as const;
export type Mood = (typeof MOODS)[number];

const INK = "#FFFFFF";
const SKY = "#8BC8FF";
const HEAD = "#1A1E26";
const INNER = "#2A303B";
const RIM = "#FFFFFF";

/** Eyes and mouth for one mood (centred on the face; the eye group moves to look around). */
function features(mood: Mood) {
  const pill = (x: number, h = 26, w = 15) => `<rect x="${x - w / 2}" y="${128 - h / 2}" width="${w}" height="${h}" rx="${w / 2}" fill="${INK}"/>`;
  const arc = (x: number, up = true) =>
    `<path d="M${x - 10} ${up ? 132 : 124} Q${x} ${up ? 116 : 140} ${x + 10} ${up ? 132 : 124}" stroke="${INK}" stroke-width="6" stroke-linecap="round" fill="none"/>`;
  const smile = `<path d="M118 177 Q128 185 138 177" stroke="${INK}" stroke-opacity=".75" stroke-width="3.5" stroke-linecap="round" fill="none"/>`;
  switch (mood) {
    case "happy":
      return { eyes: arc(98) + arc(158), mouth: `<path d="M114 175 Q128 191 142 175 Z" fill="${INK}" fill-opacity=".85"/>` };
    case "thinking":
      return {
        eyes: `<g transform="translate(5 -7)">${pill(98, 22)}${pill(158, 22)}</g>`,
        mouth: `<path d="M120 180 L136 178" stroke="${INK}" stroke-opacity=".7" stroke-width="3.5" stroke-linecap="round"/>`,
        extra: `<g class="vyn-dots"><circle cx="206" cy="40" r="5" fill="${SKY}"/><circle cx="222" cy="24" r="3.5" fill="${SKY}" opacity=".7"/><circle cx="234" cy="11" r="2.5" fill="${SKY}" opacity=".45"/></g>`,
      };
    case "curious":
      return { eyes: pill(98, 22, 14) + pill(158, 30, 17), mouth: `<circle cx="128" cy="179" r="4.5" fill="${INK}" fill-opacity=".8"/>`, tilt: -7 };
    case "attentive":
      return { eyes: `<circle cx="98" cy="128" r="11" fill="${INK}"/><circle cx="158" cy="128" r="11" fill="${INK}"/>`, mouth: `<path d="M121 179 L135 179" stroke="${INK}" stroke-opacity=".75" stroke-width="3.5" stroke-linecap="round"/>` };
    case "sorry":
      return {
        eyes: `${pill(98, 20)}${pill(158, 20)}<path d="M84 116 L108 108 M172 116 L148 108" stroke="${INK}" stroke-width="4.5" stroke-linecap="round" opacity=".85"/>`,
        mouth: `<path d="M118 182 Q128 174 138 182" stroke="${INK}" stroke-opacity=".75" stroke-width="3.5" stroke-linecap="round" fill="none"/>`,
      };
    case "sleepy":
      return {
        eyes: arc(98, false) + arc(158, false),
        mouth: `<ellipse cx="128" cy="180" rx="4" ry="3" fill="${INK}" fill-opacity=".6"/>`,
        extra: `<g class="vyn-z" fill="${SKY}" font-family="'Schibsted Grotesk', system-ui, sans-serif" font-weight="700"><text x="200" y="52" font-size="26">z</text><text x="222" y="30" font-size="17" opacity=".6">z</text></g>`,
      };
    case "talking":
      return { eyes: pill(98) + pill(158), mouth: `<ellipse class="vyn-mouth" cx="128" cy="180" rx="9" ry="7" fill="${INK}" fill-opacity=".85"/>` };
    default:
      return { eyes: pill(98) + pill(158), mouth: smile };
  }
}

/**
 * The SVG for one mood. `live: true` adds the classes the window animates (blinking, looking
 * around); static exports leave them out.
 */
export function vynSvg(mood: Mood = "idle", opts: { live?: boolean; title?: string } = {}) {
  const f = features(mood);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-label="${opts.title ?? "Vyn"}" data-mood="${mood}"${opts.live ? ' class="vyn-live"' : ""}>
<g class="vyn-head" transform="rotate(${f.tilt ?? 0} 128 150)">
  <circle cx="62" cy="70" r="31" fill="${HEAD}" stroke="${RIM}" stroke-opacity=".12" stroke-width="2.5"/>
  <circle cx="194" cy="70" r="31" fill="${HEAD}" stroke="${RIM}" stroke-opacity=".12" stroke-width="2.5"/>
  <circle cx="62" cy="70" r="15" fill="${INNER}"/>
  <circle cx="194" cy="70" r="15" fill="${INNER}"/>
  <ellipse cx="128" cy="142" rx="88" ry="80" fill="${HEAD}"/>
  <ellipse cx="128" cy="142" rx="87" ry="79" fill="none" stroke="${RIM}" stroke-opacity=".12" stroke-width="2.5"/>
  <ellipse cx="128" cy="174" rx="37" ry="27" fill="${INNER}"/>
  <path d="M120 160 Q128 154 136 160 Q137 167 128 171 Q119 167 120 160 Z" fill="${SKY}"/>
  <g class="vyn-eyes">${f.eyes}</g>
  <g class="vyn-mouth-g">${f.mouth}</g>
  <g transform="translate(200 42) rotate(14)">
    <path d="M0 0 L-25 -13 Q-31 -16 -31 -9 L-31 9 Q-31 16 -25 13 Z" fill="${SKY}"/>
    <path d="M0 0 L25 -13 Q31 -16 31 -9 L31 9 Q31 16 25 13 Z" fill="${SKY}"/>
    <path d="M-25 -13 L0 0 L-25 13" fill="#000" fill-opacity=".12"/>
    <rect x="-7" y="-8" width="14" height="16" rx="5" fill="#04121F"/>
    </g>
</g>
${f.extra ?? ""}
</svg>`;
}

/**
 * Vyn's app icon (1024 px): her idle face on a flat black tile, over a light-blue disc.
 * `tile: "rounded"` draws the desktop shape (a rounded square with transparent margins);
 * `"full"` fills the square (platforms that mask icons themselves).
 */
export function vynIcon(tile: "rounded" | "full" = "rounded") {
  const inset = tile === "rounded" ? 100 : 0;
  const size = 1024 - inset * 2;
  const radius = tile === "rounded" ? 185 : 0;
  const face = vynSvg("idle").replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  const fs = size * 0.7;
  const fx = inset + (size - fs) / 2;
  const fy = inset + (size - fs) / 2 + size * 0.03;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
<defs>
  <clipPath id="itile"><rect x="${inset}" y="${inset}" width="${size}" height="${size}" rx="${radius}"/></clipPath>
</defs>
<g clip-path="url(#itile)">
  <rect width="1024" height="1024" fill="#050608"/>
  <circle cx="512" cy="${inset + size * 0.56}" r="${size * 0.36}" fill="${SKY}" fill-opacity=".16"/>
  <svg x="${fx}" y="${fy}" width="${fs}" height="${fs}" viewBox="0 0 256 256" overflow="visible">${face}</svg>
</g>
${tile === "rounded" ? `<rect x="${inset + 1.5}" y="${inset + 1.5}" width="${size - 3}" height="${size - 3}" rx="${radius - 1.5}" fill="none" stroke="#fff" stroke-opacity=".10" stroke-width="3"/>` : ""}
</svg>`;
}
