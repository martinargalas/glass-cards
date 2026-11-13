/**
 * Glass's own icons, `glass:<name>`: blinds and slats drawn with three slats at most, so they
 * stay sharp and bold at icon size (Material Design's have five or more thin ones).
 *
 * Registered with Home Assistant as an icon set when the bundle loads, so they work in any
 * card (`icon: glass:slats-half`) and show up in every icon picker – the Studio's too. The
 * blind card draws its own glyphs from the same shapes (blindPath, slatsPath).
 *
 *   glass:blind        down: the head rail and three slats
 *   glass:blind-half   half way: two slats
 *   glass:blind-open   pulled up: the rail and the packed slats under it
 *   glass:slats-shut   three slats from the side, shut
 *   glass:slats-half   … half open
 *   glass:slats-open   … flat open
 */

/** The strokes' width (of 24). */
const W = 2.4;
const n = (v: number) => +v.toFixed(2);

/** A stroke from (x1, y1) to (x2, y2) with round ends, as a filled shape (icons are fills). */
function bar(x1: number, y1: number, x2: number, y2: number, w = W): string {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const r = w / 2;
  // the normal, half the width long
  const nx = (-(y2 - y1) / len) * r;
  const ny = ((x2 - x1) / len) * r;
  return (
    `M${n(x1 + nx)} ${n(y1 + ny)}L${n(x2 + nx)} ${n(y2 + ny)}` +
    `A${r} ${r} 0 0 0 ${n(x2 - nx)} ${n(y2 - ny)}` +
    `L${n(x1 - nx)} ${n(y1 - ny)}A${r} ${r} 0 0 0 ${n(x1 + nx)} ${n(y1 + ny)}Z`
  );
}

/** The slats' rows under the rail: three at most. */
const BLIND_ROWS = [10, 15, 20];

/**
 * The blind as it hangs, seen from the front: the head rail and up to three slats under it –
 * all three when it is down (position 0), fewer as it goes up; pulled up (100) only the packed
 * stack right under the rail.
 */
export function blindPath(pos: number): string {
  const down = (100 - Math.min(100, Math.max(0, pos))) / 100;
  const ys = pos >= 99 ? [8.5] : BLIND_ROWS.slice(0, Math.max(1, Math.ceil(down * BLIND_ROWS.length - 0.001)));
  return bar(3, 4.5, 21, 4.5) + ys.map((y) => bar(5.5, y, 18.5, y)).join("");
}

/**
 * Three slats seen from the side at an angle (90° = shut, 0° = flat open), around the middle.
 * A slat is 11 long up to 40°, steeper ones shorter (6 at 60°) so the three never touch and
 * run into one shape; the rows are 6 apart flat and wider as they tilt, never out of the box.
 */
export function slatsPath(deg: number): string {
  const r = (deg * Math.PI) / 180;
  const half = Math.max(3, 5.5 - (Math.max(0, deg - 40) / 20) * 2.5);
  const dx = Math.cos(r) * half;
  const dy = Math.abs(Math.sin(r) * half);
  const gap = Math.min(6 + 2 * Math.abs(Math.sin(r)), 10.6 - dy);
  return [12 - gap, 12, 12 + gap].map((y) => bar(12 - dx, y - dy, 12 + dx, y + dy)).join("");
}

/**
 * The tilt as an angle: Home Assistant's 0 % = shut (60°, steep enough to read as shut, still
 * three clear slats), 50 % = 40°, 100 % = flat open.
 */
export const tiltDeg = (tilt: number) => {
  const t = Math.min(100, Math.max(0, tilt)) / 100;
  return t <= 0.5 ? 60 - 40 * t : 80 * (1 - t);
};

const ICONS: Record<string, { path: string; keywords: string[] }> = {
  blind: { path: blindPath(0), keywords: ["blind", "cover", "down", "closed", "shade"] },
  "blind-half": { path: blindPath(50), keywords: ["blind", "cover", "half"] },
  "blind-open": { path: blindPath(100), keywords: ["blind", "cover", "up", "open"] },
  "slats-shut": { path: slatsPath(tiltDeg(0)), keywords: ["slats", "tilt", "shut", "closed", "blind"] },
  "slats-half": { path: slatsPath(tiltDeg(50)), keywords: ["slats", "tilt", "half", "blind"] },
  "slats-open": { path: slatsPath(tiltDeg(100)), keywords: ["slats", "tilt", "open", "blind"] },
};

/** Registers the `glass:` icon set with Home Assistant (its custom icon sets, read by ha-icon and the icon pickers). */
export function registerGlassIcons() {
  const w = window as unknown as { customIcons?: Record<string, unknown> };
  w.customIcons ??= {};
  if (w.customIcons.glass) return;
  w.customIcons.glass = {
    getIcon: async (name: string) => ({ path: ICONS[name]?.path ?? "" }),
    getIconList: async () => Object.entries(ICONS).map(([name, i]) => ({ name, keywords: i.keywords })),
  };
}
