// Named colours map to overridable theme variables with macOS-like defaults.
const NAMED: Record<string, string> = {
  red: "#ff5f57", // macOS window controls (traffic lights)
  orange: "#ff9f0a",
  yellow: "#febc2e",
  green: "#28c840",
  mint: "#63e6e2",
  teal: "#40c8e0",
  cyan: "#64d2ff",
  blue: "#0a84ff",
  indigo: "#5e5ce6",
  purple: "#bf5af2",
  pink: "#ff375f",
  brown: "#ac8e68",
  gray: "#8e8e93",
  grey: "#8e8e93",
  white: "#ffffff",
  black: "#000000",
  // names HA's colour picker (ui_color selector) produces
  amber: "#ffbf00",
  "deep-orange": "#ff6b2c",
  "deep-purple": "#7e57ff",
  "light-blue": "#5ac8fa",
  "light-green": "#8fe36a",
  lime: "#cde34a",
  "blue-grey": "#7d8ea3",
  "light-grey": "#d1d1d6",
  "dark-grey": "#48484a",
};

/** The named colours' defaults (the editor's swatches). */
export const NAMED_COLORS: Readonly<Record<string, string>> = NAMED;

/** Names that mean "no colour" in HA's picker. */
const NONE = new Set(["none", "state", ""]);

/** `yellow` → `var(--glass-color-yellow, #febc2e)`; any other CSS colour passes through. */
export function cssColor(c: string | undefined): string | undefined {
  if (!c) return undefined;
  const key = c.trim().toLowerCase();
  if (NONE.has(key)) return undefined;
  if (key === "primary" || key === "accent") return `var(--${key}-color)`;
  return NAMED[key] ? `var(--glass-color-${key}, ${NAMED[key]})` : c;
}

/** Translucent fill for active states. */
export function tint(c: string | undefined, percent = 68): string | undefined {
  const col = cssColor(c);
  return col ? `color-mix(in srgb, ${col} ${percent}%, transparent)` : undefined;
}
