import { cssColor } from "./colors";

/**
 * Per-part typography for text-heavy cards (clock, date, weather…).
 *
 *   fonts:
 *     time: { font: Inter, size: 120, weight: 200, color: white }
 *     temperature: { weight: 300, style: italic }
 *
 * Each part becomes CSS custom properties (--gt-<part>-font / -size / -weight /
 * -style / -color / -spacing) that the card's stylesheet reads with its own
 * defaults. A font that isn't a system font is loaded from Google Fonts in the
 * weights actually used.
 */
export interface FontSpec {
  font?: string;
  size?: number | string;
  weight?: number | string;
  style?: "normal" | "italic";
  color?: string;
  spacing?: number | string;
}

const SYSTEM = new Set(
  ["roboto", "system-ui", "-apple-system", "sf pro", "sf pro display", "sf pro text", "helvetica", "helvetica neue", "arial", "sans-serif", "serif", "monospace", "inherit"].map(
    (s) => s.toLowerCase(),
  ),
);
const loaded = new Set<string>();

function loadFont(family: string, weight: number | string | undefined, italic: boolean) {
  const name = family.trim();
  if (!name || SYSTEM.has(name.toLowerCase())) return;
  const w = String(weight ?? 400);
  const key = `${name}|${w}|${italic}`;
  if (loaded.has(key)) return;
  loaded.add(key);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, "+")}:ital,wght@${italic ? 1 : 0},${w}&display=swap`;
  document.head.appendChild(link);
}

/** An icon of a card's part: `icons: { tab: { color, size }, tab_on: {…} }` → --gi-<part>-color / -size. */
export interface IconSpec {
  color?: string;
  size?: number | string;
}

const px = (v: number | string | undefined) => (v === undefined || v === "" ? undefined : typeof v === "number" ? `${v}px` : v);

/** `fonts:` config → inline style string with the --gt-* custom properties. */
export function fontVars(fonts: Record<string, FontSpec> | undefined): string {
  if (!fonts) return "";
  let out = "";
  for (const [part, f] of Object.entries(fonts)) {
    if (!f || typeof f !== "object") continue;
    const set = (k: string, v: string | undefined) => {
      if (v !== undefined && v !== "") out += `--gt-${part}-${k}:${v};`;
    };
    if (f.font) {
      loadFont(f.font, f.weight, f.style === "italic");
      set("font", `"${f.font.replace(/"/g, "")}", var(--g-font)`);
    }
    set("size", px(f.size));
    set("weight", f.weight !== undefined ? String(f.weight) : undefined);
    set("style", f.style);
    set("color", cssColor(f.color));
    set("spacing", px(f.spacing));
  }
  return out;
}

/** `icons:` config → inline style string with the --gi-* custom properties. */
export function iconVars(icons: Record<string, IconSpec> | undefined): string {
  if (!icons) return "";
  let out = "";
  for (const [part, f] of Object.entries(icons)) {
    if (!f || typeof f !== "object") continue;
    const c = cssColor(f.color);
    if (c) out += `--gi-${part}-color:${c};`;
    const s = px(f.size);
    if (s) out += `--gi-${part}-size:${s};`;
  }
  return out;
}
