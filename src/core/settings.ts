import type { GlassMode, HomeAssistant } from "./types";

/**
 * Dashboard-wide defaults. `glass-dashboard` writes them from its config,
 * cards read them as a fallback between their own config and HA's locale.
 */
export interface GlassSettings {
  glass: GlassMode;
  /** Glass tier for cards inside panels (tiles, chips, buttons); undefined = same as the panel. */
  tile_glass?: GlassMode;
  /** Glass tier for buttons, chips and people; undefined = same as the card they sit on. */
  control_glass?: GlassMode;
  /** The look's material for the side column (Apple Home: dark liquid); panels with `role: sidebar` use it. */
  sidebar?: GlassMode;
  /** The look's room bar material (the light looks: a smoky bar without blur); undefined = liquid. */
  bar_glass?: "liquid" | "frosted" | "solid" | "none";
  /** Current layout mode, set by glass-dashboard before it builds its cards. */
  mode: "mobile" | "tablet" | "desktop";
  /** Day / night as glass-dashboard decided it (its `appearance`, e.g. by the sun); undefined = HA's dark mode. */
  dark?: boolean;
}

export const settings: GlassSettings = { glass: "auto", mode: "tablet" };

/** Night for the cards: the dashboard's appearance when there is one, else HA's dark mode. */
export function isDark(hass?: HomeAssistant, el?: Element): boolean {
  // the nearest glass-dashboard decides (the editor preview may differ from the real one behind it)
  return fromDashboard(el, "glassNight") ?? settings.dark ?? !!hass?.themes?.darkMode;
}

/** Editor preview forced to day / night: true / false; undefined = no override. */
export function previewNight(el?: Element): boolean | undefined {
  return fromDashboard(el, "glassPreviewNight");
}

function fromDashboard(el: Element | undefined, fn: "glassNight" | "glassPreviewNight"): boolean | undefined {
  for (let n: Node | null | undefined = el?.parentNode; n; n = n instanceof ShadowRoot ? n.host : n.parentNode) {
    const v = (n as unknown as { [k: string]: (() => boolean | undefined) | undefined })[fn]?.();
    if (v !== undefined) return v;
    if ((n as Element).tagName === "GLASS-DASHBOARD") return undefined;
  }
  return undefined;
}

/** The HA user's language (Profile → Language) – the only place it is set. */
export function language(hass?: HomeAssistant): string {
  return hass?.locale?.language || hass?.language || navigator.language || "en";
}

/** 12 / 24 h as the HA user's profile says; undefined = as the language writes it. */
export function hour12(hass?: HomeAssistant): boolean | undefined {
  const tf = hass?.locale?.time_format;
  if (tf === "12") return true;
  if (tf === "24") return false;
  if (tf === "system") return new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hour12;
  return undefined;
}

let detected: Exclude<GlassMode, "auto"> | undefined;

/**
 * `auto` resolves to liquid only where it is both supported and affordable:
 * Chromium desktop with enough cores. Phones, tablets and Safari get frosted.
 */
export function resolveGlass(mode: GlassMode | undefined): Exclude<GlassMode, "auto"> {
  const m = mode && mode !== "auto" ? mode : settings.glass;
  if (m && m !== "auto") return m;
  if (!detected) {
    const ua = navigator.userAgent;
    const chromium = /Chrome\/\d+/.test(ua) && !/Edg\/|OPR\//.test(ua);
    const mobile = /Android|iPhone|iPad|Mobile/.test(ua);
    const reduced = matchMedia("(prefers-reduced-transparency: reduce)").matches;
    const cores = navigator.hardwareConcurrency || 4;
    // WebGL glass renders only on resize/scroll, so it is affordable on tablets too.
    let gl = false;
    try {
      gl = !!document.createElement("canvas").getContext("webgl");
    } catch {
      gl = false;
    }
    if (reduced) detected = "flat";
    else if (gl || (chromium && !mobile && cores >= 8)) detected = "liquid";
    // no WebGL (old tablets, phones): the light glass – frosted to look at, nothing blurred live
    else detected = "light";
  }
  return detected;
}

/**
 * Layout mode used by dashboards shown as an editor preview (HA's card editor
 * dialog is narrower than the device being designed for). Set from the editor;
 * dashboards in preview listen for `glass-preview-mode` on window.
 */
export const preview: { mode: "mobile" | "tablet" | "desktop"; w?: number; h?: number } = { mode: "tablet" };
export function setPreviewMode(mode: "mobile" | "tablet" | "desktop", size?: { w: number; h: number }) {
  preview.mode = mode;
  preview.w = size?.w;
  preview.h = size?.h;
  window.dispatchEvent(new CustomEvent("glass-preview-mode", { detail: mode }));
}

/** The preview's screen in CSS px: the size picked in the editor, else the mode's default. */
export function previewSize(mode: "mobile" | "tablet" | "desktop"): { w: number; h: number } {
  if (preview.w && preview.h && mode === preview.mode) return { w: preview.w, h: preview.h };
  return mode === "desktop" ? { w: 1600, h: 900 } : mode === "tablet" ? { w: 1280, h: 800 } : { w: 412, h: 915 };
}

/**
 * Looks: one key that sets the three glass levels (and the left column) at once.
 * Explicit glass / tile_glass / control_glass / a panel's own glass still win.
 */
export type Look = "liquid" | "frosted" | "light" | "solid" | "apple-home";
export const LOOKS: Record<
  Look,
  {
    glass: GlassMode;
    tile_glass?: GlassMode;
    control_glass?: GlassMode;
    sidebar?: GlassMode;
    bar_glass?: GlassSettings["bar_glass"];
    /** Areas that get the sidebar material, per device (default: the side column). */
    sidebar_areas?: Partial<Record<"mobile" | "tablet" | "desktop", string[]>>;
  }
> = {
  // panels in glass, room cards and chips in the Apple Home material
  liquid: { glass: "liquid", tile_glass: "home", control_glass: "home" },
  frosted: { glass: "frosted", tile_glass: "home", control_glass: "home" },
  // tiles straight on the wallpaper, the left column as the dark liquid sidebar
  // sidebar: the side column on tablets / computers; phones usually hide that column,
  // so there the header and the top bar carry the dark glass instead
  // no live blur anywhere: the panels show a once-blurred copy of the wallpaper, the room
  // bars are smoky without blur – near frosted, nearly free
  light: { glass: "light", tile_glass: "light", control_glass: "light", bar_glass: "solid" },
  // opaque surfaces only: nothing for the browser to blur, refract or blend
  solid: { glass: "solid", tile_glass: "solid", control_glass: "solid", bar_glass: "solid" },
  "apple-home": {
    glass: "none",
    tile_glass: "home",
    control_glass: "home",
    sidebar: "home",
    sidebar_areas: { mobile: ["header", "top"] },
  },
};
/** No / unknown `look` = liquid. */
export const lookOf = (look?: string) => (look && look in LOOKS ? LOOKS[look as Look] : LOOKS.liquid);
