import type { PartDef } from "../core/parts";
import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import type { HomeAssistant } from "../core/types";
import { PRESETS, areaOrder, cardKind, ident, overlayCards, parseAreas, type Preset } from "../core/layout";

/** Views of a dashboard with the number of pop-ups each holds (for the source picker). */
const viewCache = new Map<string, Promise<{ value: string; label: string }[]>>();
function viewsOf(hass: HomeAssistant, url: string) {
  let p = viewCache.get(url);
  if (!p) {
    p = hass
      .callWS<Record<string, any>>({ type: "lovelace/config", url_path: url })
      .then((cfg) =>
        (cfg.views ?? []).map((v: any, i: number) => {
          const cards = [...(v.cards ?? []), ...(v.sections ?? []).map((x: any) => ({ type: "vertical-stack", cards: x.cards ?? [] }))];
          const n = cards.filter((c: any) => cardKind(c) === "popup").length;
          return { value: String(v.path ?? i), label: `${v.title ?? v.path ?? t("View {n}", { n: i + 1 })} – ${n ? t("{n} pop-ups", { n }) : t("no pop-ups")}` };
        }),
      )
      .catch(() => []);
    viewCache.set(url, p);
  }
  return p;
}
import { lookOf, preview, resolveGlass, setPreviewMode, settings, type Look } from "../core/settings";
import { editorLangPref, setEditorLang, t, tSchema } from "./i18n";
import { LANGS, syncLang } from "../i18n";
import { nightConfig, nightDiff } from "../core/night";
import { configForMode } from "../core/container";
import "./color-field";

/**
 * Generic visual editor built on HA's own <ha-form>, so it looks and behaves like
 * core card editors. A card describes its editor declaratively:
 *
 *   form:  top-level ha-form schema
 *   lists: arrays of objects (status items, room entities, people…) – each item gets
 *          an expandable panel with its own schema, plus add / remove / move.
 *
 * Anything without a natural form control (conditions, rules, menus) is edited
 * with HA's YAML `object` selector inside the same editor.
 */
export type Schema = Record<string, any>;

export interface ListSpec {
  name: string;
  title: string;
  /** Schema for one item; may depend on the item (e.g. menu action → YAML). */
  item: (item: Record<string, any>) => Schema[];
  label: (item: Record<string, any>, index: number) => string;
  create: () => Record<string, any>;
  /** Values the card uses when a key is missing; shown in the form, never written. */
  defaults?: Record<string, any>;
}

/** A list of child card configs, each edited with HA's own card editor. */
export interface CardListSpec {
  name: string;
  title: string;
  /** One or two sentences under the title: what these cards are for. */
  hint?: string;
  /** Split the list into sections: navigation, pop-ups, other. */
  grouped?: boolean;
}

/* ── Human-readable summaries of card configs for the card lists ─────────── */

const TYPE_NAMES: Record<string, [string, string]> = {
  entities: ["Entities", "mdi:format-list-bulleted"],
  "vertical-stack": ["Vertical stack", "mdi:view-agenda-outline"],
  "horizontal-stack": ["Horizontal stack", "mdi:view-column-outline"],
  grid: ["Card grid", "mdi:view-grid-outline"],
  markdown: ["Text (Markdown)", "mdi:text"],
  picture: ["Picture", "mdi:image-outline"],
  "picture-elements": ["Picture elements", "mdi:image-edit-outline"],
  tile: ["Tile", "mdi:card-outline"],
  button: ["Button", "mdi:gesture-tap-button"],
  "custom:apexcharts-card": ["Chart (ApexCharts)", "mdi:chart-line"],
  "custom:mini-graph-card": ["Mini graph", "mdi:chart-line"],
  "custom:layout-card": ["Card layout", "mdi:view-dashboard-outline"],
  "custom:button-card": ["Button (button-card)", "mdi:gesture-tap-button"],
};
export const MODE_NAMES: Record<string, string> = { mobile: "Mobile", tablet: "Tablet / desktop", desktop: "Desktop" };

/** Depth-first search for the first nested card matching `pred`. */
function findCard(c: any, pred: (c: any) => boolean, depth = 0): any {
  if (!c || typeof c !== "object" || depth > 6) return undefined;
  if (pred(c)) return c;
  for (const child of [...(Array.isArray(c.cards) ? c.cards : []), c.card].filter(Boolean)) {
    const hit = findCard(child, pred, depth + 1);
    if (hit) return hit;
  }
  return undefined;
}

function conditionText(conds: any[] | undefined): string {
  return (conds ?? [])
    .map((k) => {
      const e = k.entity ?? k.condition?.entity;
      const st = k.state ?? k.state_not;
      if (e === "sun.sun") return st === "above_horizon" ? t("day") : st === "below_horizon" ? t("night") : `${t("sun")} ${st}`;
      if (k.condition === "screen") return "by screen width";
      if (k.condition === "select") return `${k.group} = ${[k.id].flat().join(" / ")}`;
      if (e) return `${e.split(".")[1]} ${k.state_not !== undefined ? "≠" : "="} ${st}`;
      return k.condition ?? "";
    })
    .filter(Boolean)
    .join(", ");
}

/* ── Per-device visibility and order of a child card ─────────────────────────
   visible_on: [mobile, tablet] → the container builds the card only there;
   responsive.<mode>.view_layout.order → its place among its siblings there. */
// the editor offers two devices: a computer is edited as the tablet (desktop follows it)
export const DEVICE_MODES = ["mobile", "tablet"] as const;
type DeviceMode = (typeof DEVICE_MODES)[number] | "desktop";

export function shownOn(c: Record<string, any>, m: DeviceMode) {
  return !Array.isArray(c.visible_on) || c.visible_on.includes(m) || (m === "tablet" && c.visible_on.includes("desktop"));
}
export function withShown(c: Record<string, any>, m: DeviceMode, on: boolean): Record<string, any> {
  const now: string[] = DEVICE_MODES.filter((x) => (x === m ? on : shownOn(c, x)));
  // at least one device: a card shown nowhere would just vanish from the dashboard
  if (!now.length) return c;
  const { visible_on: _, ...rest } = c;
  return now.length === DEVICE_MODES.length ? rest : { ...rest, visible_on: now.includes("tablet") ? [...now, "desktop"] : now };
}
export function orderOn(c: Record<string, any>, m: DeviceMode): string {
  const v = c.responsive?.[m]?.view_layout?.order ?? c.view_layout?.order;
  return v === undefined ? "" : String(v);
}
export function withOrder(c: Record<string, any>, m: DeviceMode, raw: string): Record<string, any> {
  const n = raw.trim() === "" ? undefined : Number(raw);
  if (n !== undefined && Number.isNaN(n)) return c;
  const resp = { ...(c.responsive ?? {}) };
  const dev = { ...(resp[m] ?? {}) };
  const vl = { ...(dev.view_layout ?? {}) };
  if (n === undefined) delete vl.order;
  else vl.order = n;
  if (Object.keys(vl).length) dev.view_layout = vl;
  else delete dev.view_layout;
  if (Object.keys(dev).length) resp[m] = dev;
  else delete resp[m];
  const { responsive: _, ...rest } = c;
  return Object.keys(resp).length ? { ...rest, responsive: resp } : rest;
}

/** view_layout.select: the card picks `id` in that `group` (see core/container). */
function withSelect(c: Record<string, any>, key: "group" | "id", raw: string): Record<string, any> {
  const vl = { ...(c.view_layout ?? {}) };
  const sel = { ...(vl.select ?? {}), [key]: raw.trim() };
  if (!sel[key]) delete sel[key];
  if (sel.group || sel.id) vl.select = sel;
  else delete vl.select;
  const { view_layout: _, ...rest } = c;
  return Object.keys(vl).length ? { ...rest, view_layout: vl } : rest;
}

/** `c` with these visibility conditions (none: the key goes). */
export function withVisibility(c: Record<string, any>, v: unknown[] | undefined): Record<string, any> {
  const { visibility: _, ...rest } = c;
  return v?.length ? { ...rest, visibility: v } : rest;
}

/** HA's conditions editor (the card dialog's Visibility tab): loaded with the conditional card's editor. */
let conditionsEditor: Promise<unknown> | undefined;
function loadConditionsEditor(): Promise<unknown> {
  if (customElements.get("ha-card-conditions-editor")) return Promise.resolve();
  conditionsEditor ??= (async () => {
    const helpers = await (window as any).loadCardHelpers?.();
    helpers?.createCardElement({ type: "conditional", conditions: [], card: { type: "markdown", content: "" } });
    const cls = (await customElements.whenDefined("hui-conditional-card")) as any;
    await cls?.getConfigElement?.();
    await customElements.whenDefined("ha-card-conditions-editor");
  })().catch(() => undefined);
  return conditionsEditor;
}

export function describeCard(c: Record<string, any>): { title: string; sub: string; icon: string; badges: string[] } {
  const on = Array.isArray(c.visible_on) ? (c.visible_on as string[]) : undefined;
  // desktop goes with the tablet; only a card limited to the desktop says so
  const badges = on ? on.filter((m) => m !== "desktop" || !on.includes("tablet")).map((m) => t(MODE_NAMES[m] ?? m)) : [];
  if (Array.isArray(c.visibility) && c.visibility.length) {
    const { visibility: _, ...rest } = c;
    const inner = describeCard(rest);
    const when = conditionText(c.visibility);
    return { ...inner, sub: [when && `${t("Only ")}${when}`, inner.sub].filter(Boolean).join(" · ") };
  }
  if (c.type === "conditional") {
    const inner = describeCard(c.card ?? {});
    const when = conditionText(c.conditions);
    return { ...inner, sub: [when && `${t("Only ")}${when}`, inner.sub].filter(Boolean).join(" · "), badges: [...badges, ...inner.badges] };
  }
  const popup = findCard(c, (x) => x.type === "custom:bubble-card" && x.card_type === "pop-up");
  if (popup) {
    return {
      title: `${t("Pop-up")}: ${popup.name ?? popup.hash ?? t("untitled")}`,
      sub: popup.hash ? `${t("Opened by a button or the link")} ${popup.hash}` : "",
      icon: popup.icon ?? "mdi:dock-window",
      badges,
    };
  }
  if (c.type === "custom:bubble-card" && c.card_type === "horizontal-buttons-stack") {
    const names = Object.keys(c)
      .filter((k) => /^\d+_name$/.test(k))
      .sort((a, b) => parseInt(a) - parseInt(b))
      .map((k) => c[k]);
    return { title: t("Bottom navigation bar"), sub: names.length ? names.join(", ") : t("Buttons open pop-ups"), icon: "mdi:dock-bottom", badges };
  }
  const type = String(c.type ?? "");
  if (type.startsWith("custom:glass-")) {
    const meta = window.customCards?.find((m) => m.type === type.slice(7));
    const name = (meta?.name ?? type.slice(7)).replace(/^Glass – /, "");
    return named(t(name.charAt(0).toUpperCase() + name.slice(1)), c.icon ?? "mdi:card-outline");
  }
  const known = TYPE_NAMES[type];
  return named(known?.[0] ? t(known[0]) : type.replace("custom:", ""), known?.[1] ?? "mdi:card-outline");

  /** Its own name as the title, the kind of card always under it (with what is inside). */
  function named(kind: string, icon: string) {
    const own = c.name ?? c.title;
    const inner = Array.isArray(c.cards) ? t("{n} cards", { n: c.cards.length }) : "";
    const ent = typeof c.entity === "string" ? c.entity : "";
    return own && typeof own === "string"
      ? { title: own, sub: [kind, inner].filter(Boolean).join(" · "), icon, badges }
      : { title: kind, sub: inner || ent, icon, badges };
  }
}

/** Slider group for a nested numeric object (liquid shader parameters). */
export interface TuningSpec {
  name: string;
  title: string;
  fields: [string, number, number, number][];
}

export interface EditorSpec {
  /** The settings; a function of the config shows only what applies (e.g. per layout). Besides
   *  ha-form fields it takes `custom:` blocks – see GlassCardEditor._blocks. */
  form: Schema[] | ((c: Record<string, any>) => Schema[]);
  /** The card's texts and icons (core/card-parts): their fields go to its Appearance. */
  parts?: PartDef[];
  tuning?: TuningSpec;
  defaults?: Record<string, any>;
  lists?: ListSpec[];
  cards?: CardListSpec[];
  /** Optional tabs; each shows part of the form plus named lists / card lists / tuning. */
  tabs?: TabSpec[];
  /** Show the "Preview as: mobile / tablet / desktop" switch (dashboard). */
  previewSwitch?: boolean;
  /** Dashboard: look presets above the glass groups (panels inherit instead). */
  looks?: boolean;
  /** Fixes up a form change before it is saved (e.g. columns only work in a grid). */
  adjust?: (next: Record<string, any>, prev: Record<string, any>, hass?: HomeAssistant) => Record<string, any>;
  /** No background material of its own to offer (a dock, a tab bar: their bar is the glass). */
  noGlass?: boolean;
  /** Other people's work the card is built on: its own "Credits" tab, with links. */
  credits?: Credit[];
}

/** A card or project a glass card wraps, needs or took its idea from (the "Credits" tab). */
export interface Credit {
  kind: "wraps" | "requires" | "inspired";
  name: string;
  url: string;
  author: string;
  author_url: string;
  /** What exactly comes from it, in a sentence. */
  note?: string;
}

const CREDIT_KINDS: [Credit["kind"], string][] = [
  ["wraps", "Wraps"],
  ["requires", "Requires"],
  ["inspired", "Inspired by"],
];

export interface TabSpec {
  id: string;
  label: string;
  icon: string;
  form?: Schema[] | ((c: Record<string, any>) => Schema[]);
  lists?: string[];
  cards?: string[];
  tuning?: boolean;
  /** Dashboard layout: preset picker, custom grid fields and one card list per area. */
  layout?: boolean;
  /** Dashboard: where the Bubble Card pop-ups come from (overlay_source), per device. */
  popups?: boolean;
  /** Glass type + color per level (panels / cards / buttons), each in its own collapsible group. */
  glassGroups?: boolean;
  /** The day / night switch above the tab: at night its fields set the night look (`dark:`). */
  dayNight?: boolean;
  /** The tab as collapsible sections, each with a line saying what is set in it. */
  sections?: SectionSpec[];
}

/** Blocks of the editor a section can show besides its form fields. */
export type SectionBlock = "layout" | "dock" | "popups" | "popupTheme" | "wallpaper" | "looks" | "levels" | "foreign" | "tuning";

/** One collapsible section of a tab; whether it is open is remembered per browser. */
export interface SectionSpec {
  key: string;
  title: string;
  /** Open until closed once. */
  open?: boolean;
  form?: Schema[] | ((c: Record<string, any>) => Schema[]);
  blocks?: SectionBlock[];
  /** Set by day only (e.g. when it is night): at night it says so instead. */
  day?: boolean;
  /** Shown only with this card installed (e.g. "bubble-card") – or while `keep` says it is in use. */
  requires?: string;
  keep?: (c: Record<string, any>) => boolean;
  /** The line under the title: what is set (translated). */
  summary?: (c: Record<string, any>, hass?: HomeAssistant) => string;
}

const OPEN_KEY = "glass-editor-open";
let openState: Record<string, boolean> | undefined;
/** Whether a section is open: as the user left it, else its default. */
function sectionOpen(key: string, fallback: boolean): boolean {
  if (!openState) {
    try {
      openState = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "{}");
    } catch {
      openState = {};
    }
  }
  return openState![key] ?? fallback;
}
function rememberOpen(key: string, open: boolean) {
  sectionOpen(key, open);
  openState![key] = open;
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify(openState));
  } catch {
    /* private mode: open as by default next time */
  }
}

export const AREA_TITLES: Record<string, [string, string]> = {
  header: ["Header", "Usually the date and name day."],
  top: ["Top bar", "Status chips and people."],
  left: ["Side column", "Clock, weather, calendar…"],
  right: ["Second side column", ""],
  main: ["Main area", "Mostly room cards."],
};
const LEGACY_AREAS = ["header", "top", "left", "main"];

/**
 * A layout picked on a dashboard with no cards yet: an empty panel in each of its areas, so
 * the preview shows where cards go and each has its "+" (an empty panel shows only in editors).
 * Picking another layout before any card went in starts over: the old empty panels go, the new
 * layout's areas get theirs. Once a card is in, the areas are left as they are.
 */
function withEmptyPanels(c: Record<string, any>, rows: string[][]): Record<string, any> {
  const lists = [...LEGACY_AREAS.map((k) => c[k]), ...Object.values(c.areas ?? {})];
  const emptyPanel = (x: any) => x?.type === "custom:glass-panel" && !(Array.isArray(x.cards) && x.cards.length);
  if (lists.some((l) => Array.isArray(l) && l.some((x) => !emptyPanel(x)))) return c;
  const out: Record<string, any> = { ...c, areas: {} };
  for (const k of LEGACY_AREAS) delete out[k];
  for (const n of areaOrder(rows)) {
    if (n === ".") continue;
    const panel = [{ type: "custom:glass-panel", cards: [] }];
    if (LEGACY_AREAS.includes(n)) out[n] = panel;
    else out.areas[n] = panel;
  }
  if (!Object.keys(out.areas).length) delete out.areas;
  return out;
}

/** Cards offered by "+ Add card": type, name, icon, one-line description. */
/** Glass cards that need another card installed: not offered without it. */
const REQUIRES: Record<string, string> = {
  "custom:glass-dock": "bubble-card",
  "custom:glass-popup-header": "bubble-card",
  "custom:glass-chart": "apexcharts-card",
};
const REQUIRED_NAMES: Record<string, string> = { "bubble-card": "Bubble Card", "apexcharts-card": "apexcharts-card" };
/** Whether a card can be added: what it needs is installed. */
export const cardAvailable = (type: string) => !REQUIRES[type] || !!customElements.get(REQUIRES[type]);
/** What to install first, for a card that cannot be added yet: "Requires Bubble Card (HACS)". */
export const missingFor = (type: string): string | undefined =>
  cardAvailable(type) ? undefined : `${t("Requires")} ${REQUIRED_NAMES[REQUIRES[type]] ?? REQUIRES[type]} (HACS) – ${t("install it first")}`;
/** Bubble Card installed: the pop-ups, the dock and their settings are offered. */
export const hasBubble = () => !!customElements.get("bubble-card");

/** Where people can support the project (the studio's top bar, every card's Credits tab). */
export const SUPPORT_URL = "https://buymeacoffee.com/argii";
/** Buy Me a Coffee's own button (their logo, font and colours) – shown as they make it, never translated. */
export const SUPPORT_BUTTON = "https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png";

export const NEW_CARDS: [string, string, string, string][] = [
  ["custom:glass-room-card", "Room", "mdi:sofa-outline", "Room icon or photo with device buttons"],
  ["custom:glass-panel", "Panel", "mdi:view-dashboard-outline", "Glass frame that holds other cards"],
  ["custom:glass-status-bar", "Status bar", "mdi:dots-horizontal-circle-outline", "Chips with values (temperature, power…)"],
  ["custom:glass-people", "People", "mdi:account-group-outline", "People's photos, where they are and phone battery"],
  ["custom:glass-clock-weather", "Clock and weather", "mdi:weather-partly-cloudy", "Time, current weather and forecast"],
  ["custom:glass-date-header", "Date and name day", "mdi:calendar-today", "Today's date and more lines of text"],
  ["custom:glass-calendar", "Calendar", "mdi:calendar-month-outline", "Upcoming events by day"],
  ["custom:glass-divider", "Divider", "mdi:minus", "Rounded separator line"],
  ["custom:glass-tabs", "Tabs", "mdi:tab", "Switch that picks which cards of a panel show"],
  ["custom:glass-now", "Running now", "mdi:play-circle-outline", "Everything that is on, switched off with one tap"],
  ["custom:glass-dock", "Dock", "mdi:dock-bottom", "Icon bar at the bottom that opens pop-ups"],
  ["custom:glass-automation", "Automation switch", "mdi:robot-outline", "An automation on / off, and for how long a switch-off lasts"],
  ["custom:glass-sun-shading", "Sun and shading", "mdi:sun-compass", "The sun over a compass with your windows, the light and the shading decision"],
  ["custom:glass-value-grid", "Value grid", "mdi:table-cog", "Numbers with − / + in a table, a column per season or mode"],
  // any other card (HA's own or from HACS): starts as a Markdown card, change it in the card's YAML
  ["markdown", "Other card (YAML)", "mdi:code-braces", "Any Home Assistant or HACS card – edit its YAML"],
];

/** A CSS length the Size fields take: empty, a number (px) or a number with a unit. */
function validLength(v: string): boolean {
  return /^\s*(\d*\.?\d+(px|%|vh|vw|dvh|svh|lvh|rem|em)?)?\s*$/i.test(v);
}

/** Fields that set a card's glass and colours: the "Appearance" tab of a card. */
// button_size: how big the buttons are is their look, next to their material
const LOOK_FIELDS = new Set(["glass", "glass_tint", "tile_glass", "tile_tint", "control_glass", "control_tint", "bar_glass", "bar_tint", "fonts", "icons", "button_size"]);

/** A card's form → what it shows, its look (glass, colours, fonts) and the rest of "Advanced". */
function splitForm(form: Schema[], parts?: PartDef[]): { content: Schema[]; look: Schema[]; adv: Schema[] } {
  const look: Schema[] = [];
  const adv: Schema[] = [];
  const pull = (sc: Schema[]): Schema[] =>
    sc.flatMap((x) => {
      // a card's own "Look" section is its appearance as a whole
      if (x.custom === "section" && x.key === "look" && Array.isArray(x.schema)) {
        look.push(...x.schema);
        return [];
      }
      // colours belong to the look as well: any colour picker of a card's form, and the
      // materials of a card's own parts (pill_glass, switch_glass, … – see core/materials)
      if (x.name && (LOOK_FIELDS.has(x.name) || x.name.endsWith("_glass") || (x.selector as any)?.ui_color)) {
        look.push(x);
        return [];
      }
      if (Array.isArray(x.schema) && (x.type === "grid" || x.type === "expandable" || x.custom === "section")) {
        // a part's group (see part()) goes with the fields taken out of it
        const inner = pull(x.group ? x.schema.map((f: Schema) => ({ group: x.group, ...f })) : x.schema);
        return inner.length ? [{ ...x, schema: inner }] : [];
      }
      return [x];
    });
  const content = pull(form).filter((x) => {
    const isAdv = (x.type === "expandable" && x.title === "Advanced") || (x.custom === "section" && x.key === "advanced");
    if (isAdv) adv.push(...x.schema);
    return !isAdv;
  });
  // the card's texts and icons (core/card-parts): each in its part's group
  if (parts?.length) look.push(...PARTS_LOOK(parts));
  return { content, look, adv };
}

/**
 * A card's Appearance by what it is made of: the card, then each part with its material and
 * colours side by side (Bar, Icon, − / + buttons…). A spec names a field's part with `group`
 * (see `part()`); untagged fields fall in by their name: the card's glass, the buttons, colours.
 */
const CARD_FIELDS = new Set(["glass", "glass_tint", "tile_glass", "tile_tint", "fonts"]);
const BUTTON_FIELDS = new Set(["control_glass", "control_tint", "button_size"]);
const BAR_FIELDS = new Set(["bar_glass", "bar_tint"]);
function groupOf(x: Schema): string {
  if (x.group) return x.group;
  const first = x.type === "grid" && Array.isArray(x.schema) ? x.schema[0] : x;
  if (first?.group) return first.group;
  const n = first?.name ?? "";
  return CARD_FIELDS.has(n) ? "Card" : BUTTON_FIELDS.has(n) ? "Buttons" : BAR_FIELDS.has(n) ? "Bar" : "Colours";
}
function groupLook(look: Schema[]): [string, Schema[]][] {
  const out = new Map<string, Schema[]>([["Card", []]]);
  let last = "Card";
  for (const x of look) {
    // a hint goes with the field before it
    const g = x.custom === "hint" ? last : groupOf(x);
    last = g;
    if (!out.has(g)) out.set(g, []);
    out.get(g)!.push(x);
  }
  return [...out].filter(([, f]) => f.length);
}
/** Fields of one part of a card, shown together in its Appearance (see groupLook). */
export const part = (title: string, ...schema: Schema[]): Schema[] => schema.map((x) => ({ ...x, group: title }));
/** Whether a field holds a value in `data` – into a named grid / expandable (fonts.name.color…) too. */
const isSet = (x: Schema, data: Record<string, any> | undefined): boolean =>
  Array.isArray(x.schema)
    ? x.schema.some((y: Schema) => isSet(y, x.name ? data?.[x.name] : data))
    : !!x.name && data?.[x.name] !== undefined && data?.[x.name] !== "";

export function stubFor(type: string, hass?: HomeAssistant): Record<string, any> {
  if (type === "markdown") return { type, content: "Change `type:` in this card's YAML to any card you like." };
  const tag = type.replace("custom:", "");
  const cls = customElements.get(tag) as unknown as { getStubConfig?: (h?: HomeAssistant) => Record<string, any> } | undefined;
  return { type, ...(cls?.getStubConfig?.(hass) ?? {}) };
}

/** Czech labels for ha-form fields. Unknown names fall back to the field name. */
const LABELS: Record<string, string> = {
  device: "Device",
  min_column_width: "Min. column width (as many columns as fit)",
  wallpaper: "Wallpaper",
  overlay_theme: "Pop-up theme",
  masonry: "Grid without gaps (each card as tall as its content)",
  limits: "Level limits",
  days: "Days",
  image: "Image (URL or image./camera. entity)",
  image_position: "Image position",
  image_opacity: "Image opacity",
  image_on: "Full image only when (condition)",
  image_color: "Photo in colour",
  button_align: "Button alignment (photo layout)",
  equal_rows: "Card heights",
  show_condition: "Condition text (e.g. Cloudy)",
  show_icon: "Weather icon",
  show_temperature: "Temperature",
  hourly_forecast: "Hourly forecast – hours (0 = off)",
  daily_forecast: "Daily forecast – days (0 = off)",
  zoom: "Map zoom",
  frames: "Frames (10 min each)",
  satellite: "Satellite clouds",
  radar: "Precipitation radar",
  labels: "Place names",
  autoplay: "Play automatically",
  radar_opacity: "Radar opacity",
  satellite_delay: "Satellite delay",
  marker: "Home marker",
  speed: "Frame time",
  latitude: "Latitude",
  longitude: "Longitude",
  show_advice: "Advice",
  role: "Role in the look",
  forecast: "Precipitation forecast (hours)",
  image_haze: "Haze over the picture as the air gets worse",
  details_columns: "Details – columns",
  hours: "Graph – hours",
  graph: "Graph",
  graph_entities: "More in the graph (numbers: line, on/off: shaded)",
  min_range: "Graph – smallest span (°)",
  smoothing: "Graph – smoothing",
  controls: "Controls",
  presets: "Presets (select entity)",
  min_max: "Highest and lowest – over hours (empty = off)",
  graph_color: "Graph colour",
  show_station: "Station",
  image_entities: "Colour while any of these is on (empty = the buttons)",
  max_events: "Max. events",
  hide_empty: "Hide when empty",
  show_title: "Show title",
  thickness: "Weight",
  opacity: "Opacity",
  margin: "Margin",
  entity: "Entity",
  entities: "Entities",
  name: "Name",
  icon: "Icon",
  icon_active: "Icon when on",
  icon_color: "Icon color",
  color: "Color",
  active_color: "Color when on",
  active_states: "\"On\" states",
  state_icons: "Icons by state (YAML)",
  text: "Text ({value}, {unit}, {state}, {name}, {attr:x})",
  format: "Value format",
  precision: "Decimals",
  unit: "Unit",
  abs: "Absolute value",
  aggregate: "Aggregate",
  animation: "Animation",
  visible: "Show only when (condition, YAML)",
  active: "On when (condition, YAML)",
  rules: "Rules (YAML)",
  badge: "Badge",
  badge_color: "Badge color",
  label: "Label under the button",
  tap_action: "Tap",
  hold_action: "Hold",
  double_tap_action: "Double tap",
  glass: "Background material",
  font: "Font (Google Fonts or system)",
  strength: "Strength",
  image_fade: "Image fade-out",
  type: "Material",
  show_weather: "Weather",
  dashboard: "Dashboard",
  light: "Day / light",
  dark: "Night / dark",
  view: "View",
  filter: "What to take",
  weight: "Weight",
  style: "Style",
  spacing: "Letter spacing",
  icon_style: "Big icon style",
  tile_glass: "Material of cards inside panels",
  control_glass: "Material of the items inside",
  appearance: "Light / dark mode",
  time_tint: "Time-of-day tint",
  breakpoint: "Mobile / tablet breakpoint",
  dock_space: "Space for the bottom navigation",
  align: "Alignment",
  justify: "Main axis distribution",
  gap: "Gap (px)",
  padding: "Margin",
  size: "Size (px)",
  wrap: "Wrap rows",
  pack: "Fill rows (reorder)",
  pack_animation: "Animate reordering",
  place: "Placement",
  perform_action: "Runs (action, e.g. script.open_blinds)",
  data: "Action data (YAML)",
  snooze: "Dismissed alert hidden for",
  alerts: "Alerts",
  condition: "Condition",
  join: "Lines in one, separated by",
  status_below: "Status on a second line",
  count: "Count these lights as on",
  now_align: "Current weather alignment",
  frame: "Glass frame",
  rain_bars: "Rain bars (off: text only)",
  scroll: "Swipe sideways",
  item_width: "Card width (swipe)",
  fit: "Fit the free space (scroll inside)",
  indicator: "Open pop-up",
  bare: "Icons only (no capsule)",
  fade: "Fade content above the dock",
  inline: "In a panel instead of floating",
  link: "Link (#pop-up)",
  home: "Home button (closes pop-ups)",
  light_icon: "Lights icon",
  light_color: "Lights color",
  room: "Room (text or device_tracker)",
  progress: "Progress (%)",
  time_left: "Time left (min)",
  detail: "Value after the room",
  completion: "Finish time",
  area: "Work area",
  show_name: "Show name",
  show_location: "Show location",
  show_battery: "Show battery",
  battery: "Battery (%)",
  battery_state: "Charging state",
  driving: "Driving (binary_sensor)",
  picture: "Picture",
  max_entities: "Max. entities",
  columns: "Columns",
  rows: "Rows",
  button_size: "Button size (px, empty = automatic)",
  info: "Corner values (YAML)",
  weather: "Weather",
  temperature_entity: "Temperature sensor",
  line: "Line",
  offset_entity: "Offset (0 = now, −1 = before)",
  select_entity: "Period kind (drop-down)",
  label_entity: "Period name",
  current_entity: "On while showing now",
  now_label: "Now button text",
  periods: "Periods to choose from",
  kinds: "Options → day / week / month / year",
  card: "Shared look (all periods)",
  zero_line: "Line at zero",
  period: "Follow the period bar",
  column_width: "Column width",
  radius: "Rounded ends",
  gradient: "Gradient",
  glow: "Glow",
  values: "Value labels",
  time: "Time labels",
  grid: "Lines at values",
  day: "Day",
  week: "Week",
  month: "Month",
  year: "Year",
  compact: "Compact (phones)",
  select_group: "Selection group",
  selected: "Selected by default",
  group: "Selection group",
  views: "Views (id → cards)",
  map: "Map image",
  room_names: "Room names",
  tracker: "Mower on the map (device tracker)",
  max_zoom: "Sharpest satellite zoom",
  tiles: "Aerial picture (esri, cuzk or a URL)",
  settings: "Before mowing (angle, height, speed, spacing entities)",
  options: "Choices under the map (select entities)",
  service: "Clean-rooms service",
  buttons: "Buttons (name, icon, tap_action)",
  title_width: "Where the cards start",
  spread: "Now left, kind right, period centred",
  parts: "Parts shown (empty = all)",
  show_clock: "Clock",
  show_seconds: "Seconds",
  show_date: "Date under the clock",
  clock_align: "Clock alignment",
  divider: "Line under the clock",
  dividers: "Lines between the sections",
  forecast_type: "Forecast",
  forecast_rows: "Forecast rows",
  show_precipitation: "Precipitation in forecast",
  details: "Details",
  animated_icons: "Animated icons",
  title: "Title",
  layout: "Layout",
  button_gap: "Button gap (empty = even)",
  height: "Height",
  transparent: "No glass (transparent)",
  cards: "Cards (YAML)",
  lines: "Lines",
  date_format: "Date format (Intl, YAML)",
  width: "Length",
  left_width: "Left panel width (CSS)",
  max_width: "Max. width",
  offset: "Subtract header height",
  fill_height: "Full height",
  header: "Header (YAML)",
  top: "Top panel (YAML)",
  left: "Left panel (YAML)",
  main: "Main panel (YAML)",
  overlay: "Overlay – pop-ups (YAML)",
  variant: "Variant",
  edge_intensity: "Edge refraction – strength",
  rim_intensity: "Rim refraction – strength",
  base_intensity: "Center magnification – strength",
  edge_distance: "Edge refraction – falloff",
  rim_distance: "Rim refraction – falloff",
  base_distance: "Center magnification – falloff",
  corner_boost: "Corner boost",
  ripple: "Rim ripple",
  blur: "Blur",
  tint: "Milky tint",
  dispersion: "Dispersion",
  specular: "Specular",
  rim_light: "Edge light – brightness",
  rim_width: "Edge light – width (px)",
  battery_style: "Battery display",
  styles: "Styles – CSS variables (YAML)",
  hide_unavailable: "Hide unavailable",
  zone_icons: "Zone icons (YAML)",
};

const HELPERS: Record<string, string> = {
  limits: "Upper bounds of the levels good, moderate, unhealthy for sensitive, unhealthy and very unhealthy – five numbers, e.g. 50, 100, 150, 200, 300 (US AQI, the default). For a sensor in µg/m³ use its own, e.g. PM2.5: 15, 25, 37.5, 50, 75.",

  preset: "",
  appearance: "When to use the dark (night) glass.",
  time_tint: "Subtle warm tint in the morning and evening, blue at night.",
  glass: "Empty = as the panel or the dashboard (inside a panel with glass the card then has no tile of its own). A material picked here always gives the card a tile of its own: Liquid refracts light, Frosted is blurred, No blur is the fastest, Home is a matte tile as in Apple Home. None = no tile at all.",
  tile_glass: "Cards inside panels, e.g. rooms. Empty = same as the panel.",
  control_glass: "Buttons, chips and people. Empty = same as the card they sit on.",
  layout: "Switches between mobile and tablet by screen width.",
  breakpoint: "Below this width the mobile layout is used.",
  left_width: "Width of the side column, e.g. 380px or minmax(340px, 0.36fr).",
  dock_space: "Space at the bottom so the navigation bar doesn't cover cards.",
  rules: "E.g. - { above: 45, color: red }  |  - { entity: sensor.x, state: 'on', animation: glow }",
  visible: "E.g. { state: 'on' } or { or: [ {entity: a, state: x}, {entity: b, state: y} ] }",
  styles: "E.g. radius: 20px, surface: rgba(255,255,255,.1)",
};

/**
 * Card clipboard, shared by every editor on the page (nested panels, other dashboards)
 * and kept per browser: copy or cut a card in one list, paste it in another.
 */
const CLIP_KEY = "glass-cards-clipboard";
let clip: { card: Record<string, any>; cut: boolean } | undefined;
try {
  clip = JSON.parse(localStorage.getItem(CLIP_KEY) ?? "null") ?? undefined;
} catch {
  clip = undefined;
}
export const getClip = () => clip;

const CONTAINERS = ["vertical-stack", "horizontal-stack", "grid", "conditional", "custom:layout-card", "custom:stack-in-card"];

/** A card from HA or HACS (not a glass card, not a container of other cards). */
export function isForeign(c: Record<string, any> | undefined): boolean {
  const type = c?.type;
  return typeof type === "string" && !type.startsWith("custom:glass-") && !CONTAINERS.includes(type) && cardKind(c!) === "other";
}

/**
 * A drop-down with an empty choice ("Automatic") would show a blank field for it (ha-select
 * hides an empty value): the choice gets a stand-in value, turned back into "not set".
 */
const AUTO = "__auto";
function autoSchema(schema: Schema[]): Schema[] {
  return schema.map((f) => {
    if (f.type === "grid" && Array.isArray(f.schema)) return { ...f, schema: autoSchema(f.schema) };
    const opts = f.selector?.select?.options;
    if (!Array.isArray(opts) || !opts.some((o: any) => (typeof o === "string" ? o : o?.value) === "")) return f;
    const options = opts.map((o: any) => (typeof o === "string" ? (o === "" ? { value: AUTO, label: "" } : o) : o?.value === "" ? { ...o, value: AUTO } : o));
    return { ...f, selector: { ...f.selector, select: { ...f.selector.select, options } } };
  });
}
function autoNames(schema: Schema[], out = new Set<string>()): Set<string> {
  for (const f of schema) {
    if (f.type === "grid" && Array.isArray(f.schema)) autoNames(f.schema, out);
    else if (f.name && f.selector?.select?.options?.some((o: any) => (typeof o === "string" ? o : o?.value) === "")) out.add(f.name);
  }
  return out;
}

/** HA's colour selectors → the glass colour field: the named colours plus any RGB (editor/color-field). */
function colorSchema(schema: Schema[]): Schema[] {
  return schema.map((x) => {
    const sel = x.selector as Record<string, any> | undefined;
    if (sel?.ui_color) return { ...x, selector: { glass_color: {} } };
    if (sel?.color_rgb) return { ...x, selector: { glass_color: { rgb: true } } };
    return Array.isArray(x.schema) ? { ...x, schema: colorSchema(x.schema) } : x;
  });
}

/** Glass cards with round buttons, chips or people – what control_glass reaches. */
const CONTROL_PARTS: Record<string, string> = {
  "room-card": "Room buttons",
  light: "Light bars and buttons",
  thermostat: "Thermostat buttons",
  blind: "Blind buttons",
  appliance: "Appliance buttons",
  now: "Now playing buttons",
  people: "People",
  "status-bar": "Status chips",
  "period-bar": "Period buttons",
  "popup-header": "Header buttons",
};
const CONTROL_CARDS = new Set(Object.keys(CONTROL_PARTS));

/** Every card config inside a card list, nested panels and stacks included. */
function deepCards(list: any): Record<string, any>[] {
  const out: Record<string, any>[] = [];
  const walk = (o: any) => {
    if (!o || typeof o !== "object") return;
    out.push(o);
    if (Array.isArray(o.cards)) o.cards.forEach(walk);
    if (o.card) walk(o.card);
  };
  if (Array.isArray(list)) list.forEach(walk);
  return out;
}

/** Cards from HA / HACS on the dashboard, outside pop-ups: they keep their own look. */
/** Whether the dashboard has its bottom bar (a dock card in the overlay or the mobile one). */
export function hasDock(c: Record<string, any>): boolean {
  const isDock = (x: any) => x?.type === "custom:glass-dock";
  const mob = c.responsive?.mobile?.overlay;
  return (c.overlay ?? []).some(isDock) || (Array.isArray(mob) && mob.some(isDock));
}

/** Which areas of a dashboard have cards on a device (after its responsive overrides). */
function filledAreas(cfg: Record<string, any>, mode: "mobile" | "tablet"): Set<string> {
  const c = (configForMode(cfg as any, mode) ?? {}) as Record<string, any>;
  const out = new Set<string>();
  for (const k of LEGACY_AREAS) if (Array.isArray(c[k]) && c[k].length) out.add(k);
  for (const [k, v] of Object.entries(c.areas ?? {})) if (Array.isArray(v) && v.length) out.add(ident(k));
  return out;
}

/** Glass cards the cards level reaches: all but the containers and the bars (they are glass themselves). */
const NOT_TILES = new Set(["dashboard", "panel", "dock", "tabs"]);
const TILE_CARDS = (k: string) => !NOT_TILES.has(k) && !!window.customCards?.some((m) => m.type === `glass-${k}`);
/** Room layouts drawn as a photo with a glass bar. */
const BAR_LAYOUTS = new Set(["image-full", "compact"]);
/** A glass card's name as the card picker shows it, e.g. "Room". */
function cardName(k: string): string {
  const name = (window.customCards?.find((m) => m.type === `glass-${k}`)?.name ?? k).replace(/^Glass – /, "");
  return t(name.charAt(0).toUpperCase() + name.slice(1));
}

/** What the picked look does on this dashboard. */
function lookHint(look: Look, c: Record<string, any>): string {
  if (look === "apple-home") return appleHomeHint(c);
  const big = filledAreas(c, "tablet").has("left");
  const what: Record<string, string> = {
    liquid: "Liquid glass: panels of liquid glass that bends the wallpaper (WebGL) – the heaviest; cards and buttons inside in the Apple Home material.",
    frosted: "Frosted glass: panels of blurred glass, blurred live by the browser – medium; cards and buttons inside in the Apple Home material.",
    light: "Light glass: looks frosted, but the wallpaper is blurred once and shown under the panels – nearly free; for older tablets and phones. Shows the wallpaper, not what moves behind it.",
    solid: "Solid: opaque slate panels, cards and buttons, no blur or transparency – the fastest, for the weakest devices.",
  };
  return [
    t(what[look] ?? what.liquid),
    big ? t("The side column keeps the glass and takes the sidebar's colours: white text, accent icons.") : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Apple Home's dark sidebar goes to the side column (phones: header and top bar) – only when they have cards. */
function appleHomeHint(c: Record<string, any>): string {
  const big = filledAreas(c, "tablet").has("left");
  const phone = filledAreas(c, "mobile");
  const top = phone.has("header") || phone.has("top");
  return [
    t("Apple Home: tiles straight on the wallpaper."),
    t(big ? "On tablets and computers the side column becomes the dark glass sidebar." : "This dashboard has no side column, so tablets and computers get no dark sidebar – add cards to the Left column for one."),
    t(top ? "On phones the header and the top bar get it." : "On phones there is no header or top bar to carry it."),
    big || top ? t("Everything inside takes the sidebar style. A panel with its own glass setting keeps it.") : "",
  ].filter(Boolean).join(" ");
}

export function foreignCards(cfg: Record<string, any>): number {
  let n = 0;
  // only through card lists: buttons, chips and actions have their own `type` keys
  const card = (o: any) => {
    if (!o || typeof o !== "object") return;
    if (isForeign(o)) n++;
    list(o.cards);
    if (o.card) card(o.card);
  };
  const list = (l: any) => Array.isArray(l) && l.forEach(card);
  const dash = (d: any) => {
    for (const k of LEGACY_AREAS) list(d?.[k]);
    for (const v of Object.values(d?.areas ?? {})) list(v);
  };
  dash(cfg);
  // a panel: its own cards
  list(cfg.cards);
  for (const m of Object.values(cfg.responsive ?? {})) dash(m);
  return n;
}

/** Shown on a card from HA / HACS: the glass settings do not reach it. */
export function foreignNotice(card: Record<string, any> | undefined) {
  if (!isForeign(card)) return nothing;
  return html`<div class="bubble-notice"><ha-icon .icon=${"mdi:information-outline"}></ha-icon><span>${t("Not a glass card: the glass type, colours and the day / night look do not reach it – it keeps its own look (theme, card_mod).")}</span></div>`;
}

/**
 * Pop-ups are Bubble Card's: the glass cards only place and open them, they don't
 * contain Bubble Card. Without it installed (HACS) pop-ups stay empty – say so.
 */
export function bubbleNotice() {
  if (customElements.get("bubble-card")) return nothing;
  return html`<div class="bubble-notice">
    <ha-icon .icon=${"mdi:alert-circle-outline"}></ha-icon>
    <span>
      ${t("Pop-ups need Bubble Card – it is not installed. Install it from HACS (Frontend → Bubble Card), then reload the page.")}
      <a href="https://github.com/Clooos/Bubble-Card" target="_blank" rel="noreferrer">Bubble Card</a>
    </span>
  </div>`;
}
export function setClip(next: typeof clip) {
  clip = next;
  try {
    if (next) localStorage.setItem(CLIP_KEY, JSON.stringify(next));
    else localStorage.removeItem(CLIP_KEY);
  } catch {
    /* private mode: this page only */
  }
  window.dispatchEvent(new Event("glass-clipboard"));
}

/** The card being dragged: rows of the same editor (any of its lists) take it. */
let drag: { editor: GlassCardEditor; key: string; i: number; card: Record<string, any>; remove: () => void } | undefined;

export class GlassCardEditor extends LitElement {
  static override properties = { hass: { attribute: false }, lovelace: { attribute: false }, _cfg: { state: true }, _open: { state: true } };
  declare hass?: HomeAssistant;
  declare lovelace?: unknown;
  /** The config as set, `dark:` included. */
  declare _cfg?: Record<string, any>;
  declare _open: Record<string, number>;

  /** The config being edited: at night (the Appearance tab's day / night switch) the night look,
   *  `dark:` merged in – what is changed then goes to `dark:` (see _emit). */
  get _config(): Record<string, any> | undefined {
    return this._open?.night === 1 && this._cfg ? nightConfig(this._cfg, true) : this._cfg;
  }
  set _config(v: Record<string, any> | undefined) {
    this._cfg = v;
  }
  spec!: EditorSpec;
  /** Shown inside a dashboard area that lists the panel's cards itself: no card tab. */
  noCards = false;

  constructor() {
    super();
    this._open = {};
  }

  /** Where a dragged card would land: list key, index before which it goes. */
  private _dropAt?: { key: string; i: number };

  private _setDrop(at: { key: string; i: number } | undefined) {
    if (at?.key === this._dropAt?.key && at?.i === this._dropAt?.i) return;
    this._dropAt = at;
    this.requestUpdate();
  }

  /** Drop into list `key` before index `to` (cards.length = at the end). */
  private _drop(key: string, to: number, cards: Record<string, any>[], set: (next: Record<string, any>[]) => void) {
    const d = drag;
    drag = undefined;
    this._setDrop(undefined);
    if (!d || d.editor !== this) return;
    if (d.key === key) {
      if (to === d.i || to === d.i + 1) return;
      set(move(cards, d.i, to > d.i ? to - 1 : to));
      return;
    }
    // another list of this editor (another area): take it out there, then put it here
    d.remove();
    set([...cards.slice(0, to), d.card, ...cards.slice(to)]);
  }

  setConfig(config: Record<string, any>) {
    this._config = config;
  }

  private _emit(config: Record<string, any>) {
    // Drop empty values so the YAML stays as short as hand-written config.
    let clean = Object.fromEntries(Object.entries(config).filter(([, v]) => v !== undefined && v !== "" && v !== null));
    if (this._open.night === 1) {
      // the night look edited in full: what differs from the day goes to `dark:`
      const { dark: _old, ...day } = this._cfg ?? {};
      const dark = nightDiff(day, clean);
      clean = { ...day, ...(dark ? { dark } : {}) };
    }
    this._cfg = clean;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: clean }, bubbles: true, composed: true }));
  }

  // a field's own `label` / `helper` (already translated by tSchema) wins over the shared ones
  private _label = (s: Schema) => s.label ?? t(LABELS[s.name] ?? s.name);
  // `layout` means the device mode only on the dashboard; other cards have a layout of their own
  private _helper = (s: Schema) => s.helper ?? (HELPERS[s.name] && (s.name !== "layout" || this.spec.previewSwitch) ? t(HELPERS[s.name]) : undefined);

  private _form(data: Record<string, any>, schema: Schema[], onChange: (v: Record<string, any>) => void): TemplateResult {
    const auto = autoNames(schema);
    const shown = auto.size ? { ...data } : data;
    for (const n of auto) if (shown[n] === undefined || shown[n] === "") shown[n] = AUTO;
    return html`<ha-form
      .hass=${this.hass}
      .data=${shown}
      .schema=${tSchema(colorSchema(auto.size ? autoSchema(schema) : schema))}
      .computeLabel=${this._label}
      .computeHelper=${this._helper}
      @value-changed=${(e: CustomEvent) => {
        e.stopPropagation();
        const v = { ...e.detail.value };
        for (const n of auto) if (v[n] === AUTO) v[n] = undefined;
        onChange(v);
      }}
    ></ha-form>`;
  }

  /** A list of the card's config, or – with `src` – one nested in an item of another list. */
  private _list(spec: ListSpec, src?: { items: Record<string, any>[]; set: (next: Record<string, any>[]) => void; id: string; title?: string }): TemplateResult {
    const items: Record<string, any>[] = src ? src.items : (this._config?.[spec.name] ?? []);
    const set = src ? src.set : (next: Record<string, any>[]) => this._emit({ ...this._config, [spec.name]: next });
    const okey = src?.id ?? spec.name;
    const open = this._open[okey] ?? -1;
    return html`<div class="list ${src ? "nested" : ""}">
      <div class="list-title">${t(src?.title ?? spec.title)}</div>
      ${items.map(
        (item, i) => html`<div class="item ${open === i ? "open" : ""}">
          <div class="item-head" @click=${() => (this._open = { ...this._open, [okey]: open === i ? -1 : i })}>
            ${item.icon && typeof item.icon === "string" && item.icon.startsWith("mdi:") ? html`<ha-icon .icon=${item.icon}></ha-icon>` : nothing}
            <span class="item-label">${spec.label(item, i)}</span>
            <span class="tools" @click=${(e: Event) => e.stopPropagation()}>
              <button title=${t("Up")} ?disabled=${i === 0} @click=${() => set(move(items, i, i - 1))}>▲</button>
              <button title=${t("Down")} ?disabled=${i === items.length - 1} @click=${() => set(move(items, i, i + 1))}>▼</button>
              <button title=${t("Remove")} class="del" @click=${() => set(items.filter((_, k) => k !== i))}>✕</button>
            </span>
          </div>
          ${open === i
            ? html`<div class="item-body">
                ${this._form({ ...spec.defaults, ...item }, spec.item(item), (v) =>
                  set(items.map((x, k) => (k === i ? withoutDefaults(stripEmpty(v), item, spec.defaults) : x))),
                )}
                ${/"(tap|hold)_action"/.test(JSON.stringify(spec.item(item))) || item.tap_action?.action === "menu" || item.hold_action?.action === "menu"
                  ? (["tap_action", "hold_action"] as const).map((k) =>
                      this._menu(item, k, `${spec.name}:${i}`, (next) => set(items.map((x, j) => (j === i ? next : x)))),
                    )
                  : nothing}
              </div>`
            : nothing}
        </div>`,
      )}
      <button
        class="add"
        @click=${() => {
          set([...items, spec.create()]);
          this._open = { ...this._open, [okey]: items.length };
        }}
      >
        ${t("+ Add")}
      </button>
    </div>`;
  }

  /** List `spec` kept in an item of another list – `at` = [that list's key, item index]. */
  private _listAt(spec: ListSpec, [key, i]: [string, number], title?: string) {
    const parent: Record<string, any>[] = this._config?.[key] ?? [];
    const item = parent[i];
    if (!item) return nothing;
    return this._list(spec, {
      items: item[spec.name] ?? [],
      set: (next) => this._emit({ ...this._config, [key]: parent.map((x, k) => (k === i ? stripEmpty({ ...x, [spec.name]: next.length ? next : undefined }) : x)) }),
      id: `${key}:${i}:${spec.name}`,
      title,
    });
  }

  /**
   * The radial menu of a button (`tap_action` / `hold_action`: { action: menu, items }):
   * its items as a list, each with icon, name, what it runs and when it is lit / shown.
   */
  private _menu(item: Record<string, any>, key: "tap_action" | "hold_action", id: string, setItem: (next: Record<string, any>) => void) {
    const act = item[key];
    const title = key === "tap_action" ? "Radial menu on tap" : "Radial menu on hold";
    if (act?.action !== "menu")
      return html`<button class="add menu-make" @click=${() => setItem({ ...item, [key]: { action: "menu", items: [] } })}>
        <ha-icon .icon=${"mdi:dots-circle"}></ha-icon> ${t(key === "tap_action" ? "+ Radial menu on tap" : "+ Radial menu on hold")}
      </button>`;
    const entries: Record<string, any>[] = act.items ?? [];
    const setMenu = (next: Record<string, any>) => setItem({ ...item, [key]: next });
    const setEntries = (next: Record<string, any>[]) => setMenu({ ...act, items: next });
    const okey = `menu:${id}:${key}`;
    const open = this._open[okey] ?? -1;
    const what = (m: Record<string, any>) => m.name ?? m.perform_action ?? m.tap_action?.perform_action ?? m.tap_action?.action ?? m.entity ?? m.icon;
    return html`<div class="menu-edit">
      <div class="menu-edit-head">
        <ha-icon .icon=${"mdi:dots-circle"}></ha-icon>
        <b>${t(title)}</b>
        <span class="grow"></span>
        <label class="menu-labels">
          <input type="checkbox" .checked=${!!act.labels} @change=${(e: Event) => setMenu({ ...act, labels: (e.target as HTMLInputElement).checked || undefined })} />
          ${t("Names under the icons")}
        </label>
        <button class="del-link" title=${t("Remove the menu")} @click=${() => {
          const { [key]: _, ...rest } = item;
          setItem(rest);
        }}>${t("Remove the menu")}</button>
      </div>
      ${entries.map(
        (m, i) => html`<div class="item ${open === i ? "open" : ""}">
          <div class="item-head" @click=${() => (this._open = { ...this._open, [okey]: open === i ? -1 : i })}>
            <ha-icon .icon=${m.icon ?? "mdi:circle-outline"}></ha-icon>
            <span class="item-label">${what(m)}</span>
            <span class="tools" @click=${(e: Event) => e.stopPropagation()}>
              <button title=${t("Up")} ?disabled=${i === 0} @click=${() => setEntries(move(entries, i, i - 1))}>▲</button>
              <button title=${t("Down")} ?disabled=${i === entries.length - 1} @click=${() => setEntries(move(entries, i, i + 1))}>▼</button>
              <button title=${t("Remove")} class="del" @click=${() => setEntries(entries.filter((_, k) => k !== i))}>✕</button>
            </span>
          </div>
          ${open === i
            ? html`<div class="item-body">
                ${this._form(
                  m,
                  [
                    grid({ name: "icon", selector: { icon: {} } }, { name: "name", selector: { text: {} } }),
                    grid({ name: "perform_action", selector: { text: {} } }, { name: "entity", selector: { entity: {} } }),
                    YAML("data"),
                    { name: "tap_action", selector: { ui_action: {} } },
                    YAML("active"),
                    YAML("visible"),
                  ],
                  (v) => setEntries(entries.map((x, k) => (k === i ? stripEmpty(v) : x))),
                )}
              </div>`
            : nothing}
        </div>`,
      )}
      <button
        class="add"
        @click=${() => {
          setEntries([...entries, { icon: "mdi:circle-outline" }]);
          this._open = { ...this._open, [okey]: entries.length };
        }}
      >
        ${t("+ Add menu item")}
      </button>
    </div>`;
  }

  /** Where an area's cards live: `areas.<name>` in the `areas:` map, anything else at the top level. */
  private _areaCards(name: string): { cards: Record<string, any>[]; set: (next: Record<string, any>[]) => void } {
    const [root, sub] = name.startsWith("areas.") ? ["areas", name.slice(6)] : [name, ""];
    const raw = sub ? this._config?.areas?.[sub] : this._config?.[root];
    const cards: Record<string, any>[] = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
    const set = (next: Record<string, any>[]) => {
      const v = next.length ? next : undefined;
      if (!sub) return this._emit({ ...this._config, [root]: v });
      const areas = { ...(this._config?.areas ?? {}), [sub]: v };
      if (!v) delete areas[sub];
      this._emit({ ...this._config, areas: Object.keys(areas).length ? areas : undefined });
    };
    return { cards, set };
  }

  /** The groups and ids picked on this card's screen (appliance bars, tabs, pickers) – offered for "Picked in a group". */
  private _pickChoices(): { groups: string[]; ids: Map<string, Set<string>> } {
    const ids = new Map<string, Set<string>>();
    const add = (g?: unknown, id?: unknown) => {
      if (typeof g !== "string" || !g) return;
      if (!ids.has(g)) ids.set(g, new Set());
      if (typeof id === "string" && id) ids.get(g)!.add(id);
    };
    const walk = (x: any) => {
      if (Array.isArray(x)) return x.forEach(walk);
      if (!x || typeof x !== "object") return;
      if (x.select_group) add(x.select_group, x.select);
      if (x.type === "custom:glass-tabs") (x.tabs ?? []).forEach((tb: any) => add(x.group, tb?.id));
      if (x.view_layout?.select) add(x.view_layout.select.group, x.view_layout.select.id);
      if (x.condition === "select") [x.id].flat().forEach((id: unknown) => add(x.group, id));
      Object.values(x).forEach(walk);
    };
    walk(this._config);
    return { groups: [...ids.keys()], ids };
  }

  /** "Visible when": the card's visibility conditions, edited as on HA's Visibility tab – ours ("Picked in a group") above it. */
  private _visibility(card: Record<string, any>, set: (v: unknown[] | undefined) => void) {
    const all: Record<string, any>[] = Array.isArray(card.visibility) ? card.visibility : [];
    const picks = all.filter((k) => k?.condition === "select");
    const conds = all.filter((k) => k?.condition !== "select");
    const save = (p: Record<string, any>[], o: unknown[]) => set([...p, ...o].length ? [...p, ...o] : undefined);
    const setPick = (i: number, v: Record<string, any> | undefined) => save(v ? picks.map((x, k) => (k === i ? v : x)) : picks.filter((_, k) => k !== i), conds);
    const choices = this._pickChoices();
    const listId = `pick-${Math.random().toString(36).slice(2, 8)}`;
    const ready = !!customElements.get("ha-card-conditions-editor");
    if (!ready) loadConditionsEditor().then(() => this.requestUpdate());
    return html`<div class="visibility">
      <span class="devices-title">${t("Visible when")}</span>
      <span class="vis-hint">${t("Empty = always. A hidden card leaves the page (a camera stops), in the preview too.")}</span>
      <datalist id="${listId}-g">${choices.groups.map((g) => html`<option value=${g}></option>`)}</datalist>
      ${picks.map((k, i) => {
        const ids = [...(choices.ids.get(k.group) ?? [])];
        return html`<div class="pick-cond">
          <span class="pick-label">${t("Picked in a group")}</span>
          <input
            placeholder=${t("Group")}
            list="${listId}-g"
            .value=${k.group ?? ""}
            @change=${(e: Event) => setPick(i, { ...k, group: (e.target as HTMLInputElement).value.trim() })}
          />
          <span>=</span>
          <input
            placeholder=${t("Id")}
            list="${listId}-${i}"
            .value=${[k.id ?? ""].flat().join(", ")}
            @change=${(e: Event) => {
              const v = (e.target as HTMLInputElement).value.split(",").map((x) => x.trim()).filter(Boolean);
              setPick(i, { ...k, id: v.length > 1 ? v : (v[0] ?? "") });
            }}
          />
          <datalist id="${listId}-${i}">${ids.map((id) => html`<option value=${id}></option>`)}</datalist>
          <button title=${t("Remove")} class="del" @click=${() => setPick(i, undefined)}>✕</button>
        </div>`;
      })}
      <button class="add" @click=${() => save([...picks, { condition: "select", group: choices.groups[0] ?? "", id: "" }], conds)}>${t("+ Picked in a group")}</button>
      ${ready
        ? html`<ha-card-conditions-editor
            .hass=${this.hass}
            .conditions=${conds}
            @value-changed=${(e: CustomEvent) => {
              e.stopPropagation();
              save(picks, e.detail.value ?? []);
            }}
          ></ha-card-conditions-editor>`
        : html`<ha-yaml-editor
            .hass=${this.hass}
            .defaultValue=${conds}
            @value-changed=${(e: CustomEvent) => {
              e.stopPropagation();
              if (e.detail.isValid !== false) save(picks, Array.isArray(e.detail.value) ? e.detail.value : []);
            }}
          ></ha-yaml-editor>`}
    </div>`;
  }

  private _cardList(spec: CardListSpec, bare = false, src?: { cards: Record<string, any>[]; set: (next: Record<string, any>[]) => void }) {
    const { cards, set } = src ?? this._areaCards(spec.name);
    const key = `cards:${spec.name}`;
    // a panel shows or hides its cards by their visibility (a dashboard area straight does not)
    const inPanel = this._config?.type === "custom:glass-panel" || spec.name.endsWith("#panel");
    const open = this._open[key] ?? -1;
    const over = (i: number) => (e: DragEvent) => {
      if (drag?.editor !== this) return;
      e.preventDefault();
      e.stopPropagation();
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      this._setDrop({ key, i: e.clientY > r.top + r.height / 2 ? i + 1 : i });
    };
    const drop = (e: DragEvent) => {
      if (drag?.editor !== this) return;
      e.preventDefault();
      e.stopPropagation();
      this._drop(key, this._dropAt?.key === key ? this._dropAt.i : cards.length, cards, set);
    };
    const menu = this._open[`menu:${key}`] ?? -1;
    const mark = (i: number) => (this._dropAt?.key === key && this._dropAt.i === i ? "drop-before" : "");
    const row = (card: Record<string, any>, i: number) => html`<div
      class="item ${open === i ? "open" : ""} ${menu === i ? "menu-open" : ""} ${mark(i)} ${i === cards.length - 1 && mark(cards.length) ? "drop-after" : ""}"
      @dragover=${over(i)}
      @drop=${drop}
    >
      <div
        class="item-head"
        draggable="true"
        title=${t("Drag to move")}
        @dragstart=${(e: DragEvent) => {
          e.stopPropagation();
          drag = { editor: this, key, i, card, remove: () => set(cards.filter((_, k) => k !== i)) };
          e.dataTransfer?.setData("text/plain", JSON.stringify(card));
          if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
        }}
        @dragend=${() => {
          drag = undefined;
          this._setDrop(undefined);
        }}
        @click=${() => (this._open = { ...this._open, [key]: open === i ? -1 : i })}
      >
        <ha-icon class="grip" .icon=${"mdi:drag-vertical"}></ha-icon>
        ${(() => {
          const d = describeCard(card);
          return html`<ha-icon .icon=${d.icon}></ha-icon>
            <span class="item-text">
              <span class="item-label">${d.title}</span>
              ${d.sub ? html`<span class="item-sub">${d.sub}</span>` : nothing}
            </span>
            ${d.badges.map((b) => html`<span class="badge">${b}</span>`)}`;
        })()}
        <span class="tools" @click=${(e: Event) => e.stopPropagation()}>
          <button title=${t("Move up")} ?disabled=${i === 0} @click=${() => set(move(cards, i, i - 1))}>▲</button>
          <button title=${t("Move down")} ?disabled=${i === cards.length - 1} @click=${() => set(move(cards, i, i + 1))}>▼</button>
          <span class="more">
            <button title=${t("More")} @click=${() => (this._open = { ...this._open, [`menu:${key}`]: menu === i ? -1 : i })}>
              <ha-icon .icon=${"mdi:dots-vertical"}></ha-icon>
            </button>
            ${menu === i
              ? html`<span class="menu" @click=${() => (this._open = { ...this._open, [`menu:${key}`]: -1 })}>
                  <button @click=${() => set([...cards.slice(0, i + 1), structuredClone(card), ...cards.slice(i + 1)])}>
                    <ha-icon .icon=${"mdi:content-duplicate"}></ha-icon>${t("Duplicate")}
                  </button>
                  <button @click=${() => setClip({ card: structuredClone(card), cut: false })}>
                    <ha-icon .icon=${"mdi:content-copy"}></ha-icon>${t("Copy")}
                  </button>
                  <button
                    @click=${() => {
                      setClip({ card: structuredClone(card), cut: true });
                      set(cards.filter((_, k) => k !== i));
                    }}
                  >
                    <ha-icon .icon=${"mdi:content-cut"}></ha-icon>${t("Cut (paste it in another panel)")}
                  </button>
                </span>`
              : nothing}
          </span>
          <button title=${t("Remove")} class="del" @click=${() => set(cards.filter((_, k) => k !== i))}>✕</button>
        </span>
      </div>
      ${open === i
        ? html`<div class="item-body">
            <div class="devices">
              <span class="devices-title">${t("Devices")}</span>
              ${DEVICE_MODES.map(
                (m) => html`<div class="device">
                  <label class="device-on">
                    <input
                      type="checkbox"
                      .checked=${shownOn(card, m)}
                      @change=${(e: Event) => set(cards.map((x, k) => (k === i ? withShown(x, m, (e.target as HTMLInputElement).checked) : x)))}
                    />${t(MODE_NAMES[m])}
                  </label>
                  <input
                    class="device-order"
                    type="number"
                    step="1"
                    placeholder=${t("Order")}
                    title=${t("Order among the cards next to it (lower first, empty = as listed)")}
                    ?disabled=${!shownOn(card, m)}
                    .value=${orderOn(card, m)}
                    @change=${(e: Event) => set(cards.map((x, k) => (k === i ? withOrder(x, m, (e.target as HTMLInputElement).value) : x)))}
                  />
                </div>`,
              )}
              <span class="devices-title">${t("Picks in a group")}</span>
              <input
                class="device-order"
                placeholder=${t("Group")}
                title=${t("The group in which this card picks its id")}
                .value=${card.view_layout?.select?.group ?? ""}
                @change=${(e: Event) => set(cards.map((x, k) => (k === i ? withSelect(x, "group", (e.target as HTMLInputElement).value) : x)))}
              />
              <input
                class="device-order"
                placeholder=${t("View id")}
                title=${t("Which of the switch's views a tap on this card shows")}
                .value=${card.view_layout?.select?.id ?? ""}
                @change=${(e: Event) => set(cards.map((x, k) => (k === i ? withSelect(x, "id", (e.target as HTMLInputElement).value) : x)))}
              />
            </div>
            ${inPanel ? this._visibility(card, (v) => set(cards.map((x, k) => (k === i ? withVisibility(x, v) : x)))) : nothing}
            <hui-card-element-editor
              .hass=${this.hass}
              .lovelace=${this.lovelace}
              .value=${card}
              @config-changed=${(e: CustomEvent) => {
                e.stopPropagation();
                if (e.detail?.config) set(cards.map((x, k) => (k === i ? e.detail.config : x)));
              }}
            ></hui-card-element-editor>
          </div>`
        : nothing}
    </div>`;
    const indexed = cards.map((c, i) => ({ c, i }));
    const groups: [string, string, { c: Record<string, any>; i: number }[]][] = spec.grouped
      ? ([
          ["Navigation bars", "Button bar at the bottom of the screen.", indexed.filter(({ c }) => cardKind(c) === "nav")],
          ["Pop-ups", "Opened by a bar button or a #name link.", indexed.filter(({ c }) => cardKind(c) === "popup")],
          ["Other", "", indexed.filter(({ c }) => cardKind(c) === "other")],
        ] as [string, string, { c: Record<string, any>; i: number }[]][]).filter(([, , g]) => g.length)
      : [["", "", indexed]];
    const picking = this._open[`pick:${spec.name}`] === 1;
    return html`<div
      class="list ${bare ? "bare" : ""} ${!cards.length && mark(0) ? "drop-empty" : ""}"
      @dragover=${(e: DragEvent) => {
        if (drag?.editor !== this) return;
        e.preventDefault();
        e.stopPropagation();
        if (!cards.length) this._setDrop({ key, i: 0 });
      }}
      @drop=${drop}
    >
      ${bare ? nothing : html`<div class="list-title">${t(spec.title)}</div>`}
      ${spec.hint ? html`<div class="list-hint">${t(spec.hint)}</div>` : nothing}
      ${groups.map(
        ([title, hint, items]) => html`${title ? html`<div class="group-title">${t(title)} <small>${items.length}</small></div>` : nothing}
          ${hint ? html`<div class="list-hint">${t(hint)}</div>` : nothing} ${items.map(({ c, i }) => row(c, i))}`,
      )}
      ${picking
        ? html`<div class="picker">
            ${NEW_CARDS.map(
              ([type, name, icon, desc]) => html`<button
                class="pick"
                ?disabled=${!cardAvailable(type)}
                @click=${() => {
                  set([...cards, stubFor(type, this.hass)]);
                  this._open = { ...this._open, [key]: cards.length, [`pick:${spec.name}`]: 0 };
                }}
              >
                <ha-icon .icon=${icon}></ha-icon>
                <span><b>${t(name)}</b><small>${missingFor(type) ?? t(desc)}</small></span>
              </button>`,
            )}
            <button class="pick other" @click=${() => (this._open = { ...this._open, [`pick:${spec.name}`]: 0 })}>${t("Cancel")}</button>
          </div>`
        : html`<div class="list-actions">
            <button class="add" @click=${() => (this._open = { ...this._open, [`pick:${spec.name}`]: 1 })}>${t("+ Add card")}</button>
            ${clip
              ? html`<button
                  class="add"
                  title=${t(clip.cut ? "Moves the cut card here" : "Adds a copy of the copied card here")}
                  @click=${() => {
                    const c = clip!;
                    set([...cards, structuredClone(c.card)]);
                    this._open = { ...this._open, [key]: cards.length };
                    if (c.cut) setClip(undefined);
                  }}
                >
                  <ha-icon .icon=${"mdi:content-paste"}></ha-icon> ${t("Paste")}: ${describeCard(clip.card).title}
                </button>`
              : nothing}
          </div>`}
    </div>`;
  }

  /** Sliders with the current value and a ✕ that resets a changed value to its default. */
  private _tuning(tu: TuningSpec, flat = false) {
    const defaults = (this.spec.defaults?.[tu.name] ?? {}) as Record<string, number>;
    const values = (this._config?.[tu.name] ?? {}) as Record<string, number>;
    const set = (key: string, v: number | undefined) => {
      const next = { ...values };
      if (v === undefined || v === defaults[key]) delete next[key];
      else next[key] = v;
      this._emit({ ...this._config, [tu.name]: Object.keys(next).length ? next : undefined });
    };
    const hint = html`<div class="list-hint">${t("Fine-tune the refraction and edge light. ✕ next to a slider returns the default.")}</div>`;
    // collapsed by default: it's fine-tuning most people never need
    const sliders = html`${tu.fields.map(([key, min, max, step]) => {
        const changed = values[key] !== undefined && values[key] !== defaults[key];
        const v = values[key] ?? defaults[key] ?? min;
        return html`<div class="tune ${changed ? "changed" : ""}">
          <span class="tune-label">${t(LABELS[key] ?? key)}</span>
          <input type="range" min=${min} max=${max} step=${step} .value=${String(v)} @input=${(e: Event) => set(key, Number((e.target as HTMLInputElement).value))} />
          <span class="tune-value">${v}</span>
          ${changed
            ? html`<button class="tune-reset" title="${t("Reset to default")} (${defaults[key]})" @click=${() => set(key, undefined)}>✕</button>`
            : html`<span class="tune-reset"></span>`}
        </div>`;
      })}`;
    if (flat) return html`<div class="src-title">${t(tu.title)}</div>${hint}${sliders}`;
    return html`<ha-expansion-panel outlined class="tuning" .header=${t(tu.title)}>
      ${hint}${sliders}
    </ha-expansion-panel>`;
  }

  private _views: Record<string, { value: string; label: string }[]> = {};

  /** Panels / Cards / Buttons: glass type and color, one collapsible group each. */
  /** The dashboard's cards on every device: its areas, its own pop-ups and those from another dashboard. */
  private _popupCards: Record<string, Record<string, any>[]> = {};
  private _dashCards(c: Record<string, any>): Record<string, any>[] {
    const out: Record<string, any>[] = [];
    for (const mode of ["tablet", "mobile"] as const) {
      const m = (configForMode(c as any, mode) ?? {}) as Record<string, any>;
      for (const k of LEGACY_AREAS) out.push(...deepCards(m[k]));
      for (const v of Object.values(m.areas ?? {})) out.push(...deepCards(v));
      out.push(...deepCards(m.overlay));
      const src = m.overlay_source;
      if (src?.dashboard && this.hass) {
        const key = JSON.stringify(src);
        if (!(key in this._popupCards)) {
          this._popupCards[key] = [];
          overlayCards(this.hass as any, src).then((l) => ((this._popupCards = { ...this._popupCards, [key]: deepCards(l ?? []) }), this.requestUpdate()));
        }
        out.push(...this._popupCards[key]);
      }
    }
    return out;
  }

  private _glassGroups(part: SectionBlock = "levels") {
    const c = this._config!;
    const dash = !!this.spec.looks;
    // the room bars only come as liquid, frosted or none
    const BAR = ["liquid", "frosted", "solid", "none"];
    const groups: [string, string, string, string, string[]?][] = dash
      ? [
          ["Panels", "The large glass panels.", "glass", "glass_tint"],
          ["Cards", "Cards inside the panels, e.g. rooms.", "tile_glass", "tile_tint"],
          ["Buttons, chips and people", "Round buttons, status chips and people.", "control_glass", "control_tint"],
          ["Room bars", "The glass bar of rooms laid out as a photo with a bar or a low strip.", "bar_glass", "bar_tint", BAR],
        ]
      : [
          ["This panel", "The glass of this panel. Empty = as set on the dashboard.", "glass", "glass_tint"],
          ["Cards inside", "All glass cards in this panel. Empty = as set on the dashboard.", "tile_glass", "tile_tint"],
          ["Buttons, chips and people", "Inside this panel. Empty = as set on the dashboard.", "control_glass", "control_tint"],
          ["Room bars", "Rooms in this panel with a photo and a bar or a low strip. Empty = as set on the dashboard.", "bar_glass", "bar_tint", BAR],
        ];
    // only the levels the cards use (a dashboard: its areas and its pop-ups), and on a panel
    // what "as on the dashboard" stands for now
    const inside = dash ? this._dashCards(c) : deepCards(c.cards);
    const kind = (o: Record<string, any>) => String(o?.type ?? "").replace("custom:glass-", "");
    const uses: Record<string, boolean> = {
      glass: true,
      tile_glass: dash ? inside.some((o) => TILE_CARDS(kind(o))) : (c.cards ?? []).some((o: any) => String(o?.type ?? "").startsWith("custom:glass-")),
      control_glass: inside.some((o) => CONTROL_CARDS.has(kind(o))),
      bar_glass: inside.some((o) => kind(o) === "room-card" && (!dash || BAR_LAYOUTS.has(o.layout ?? "stacked"))),
    };
    const own = resolveGlass(c.glass);
    const dashValue: Record<string, string | undefined> = {
      glass: resolveGlass(undefined),
      tile_glass: settings.tile_glass ? resolveGlass(settings.tile_glass) : (c.glass ?? own),
      control_glass: settings.control_glass ? resolveGlass(settings.control_glass) : undefined,
      bar_glass: (settings as any).bar_glass ?? "liquid",
    };
    const foreign = dash ? 0 : inside.filter((o) => isForeign(o)).length;
    // what control_glass reaches here, named by the cards that have it: "Light bars and buttons"
    const parts = [...new Set(inside.map(kind).filter((k) => CONTROL_CARDS.has(k)))].map((k) => t(CONTROL_PARTS[k]));
    if (parts.length)
      for (const g of groups)
        if (g[2] === "control_glass") {
          g[0] = parts.length === 1 ? parts[0] : "Buttons and controls";
          g[1] = `${parts.join(", ")}.${dash ? "" : ` ${t("Empty = as set on the dashboard.")}`}`;
        }
    // the dashboard's cards level: which cards it reaches here
    const tiles = [...new Set(inside.map(kind).filter(TILE_CARDS))].map(cardName);
    if (dash && tiles.length)
      for (const g of groups) if (g[2] === "tile_glass") g[1] = `${t("Cards inside the panels and pop-ups:")} ${tiles.slice(0, 8).join(", ")}${tiles.length > 8 ? "…" : ""}.`;
    const allTypes = (inherit: boolean) => [
      ...(inherit ? [{ value: "", label: t(dash ? "Same as the level above" : "As on the dashboard") }] : []),
      { value: "liquid", label: t("Liquid glass") },
      { value: "frosted", label: t("Frosted glass") },
      { value: "light", label: t("Light glass (no live blur)") },
      { value: "flat", label: t("No blur") },
      { value: "solid", label: t("Solid (fastest)") },
      { value: "none", label: t("None (no glass)") },
      { value: "home", label: t("Home (Apple Home look)") },
    ];
    const types = (inherit: boolean, only?: string[]) => allTypes(inherit).filter((o) => !only || !o.value || only.includes(o.value));
    const label = (v: string | undefined, inherit: boolean) => t(allTypes(inherit).find((o) => o.value === (v ?? (inherit ? "" : "liquid")))?.label ?? v ?? "");
    const picked: Look = (c.look as Look) ?? "liquid";
    const look = lookOf(picked);
    // a level set by hand on top of the look → "Custom"
    const custom =
      (["glass", "tile_glass", "control_glass"] as const).some((k) => c[k] !== undefined && c[k] !== look[k]) ||
      panelLists(c).some(([, list]) =>
        list.some((p) => p && (p.tile_glass !== undefined || p.control_glass !== undefined || (p.glass !== undefined && p.glass !== "none"))),
      );
    const current = custom ? "custom" : picked;
    // by night `c` is the night look (see _config); the look presets are the day's
    const night = this._open.night === 1;
    if (part === "wallpaper")
      return html`<div class="list-hint">${t("Behind every card, glass or not. An image URL, e.g. /local/wallpapers/day.jpg, or one that comes with the cards, e.g. glass:hills-day; empty = the HA theme's.")}</div>
        ${this._form({ wallpaper: c.wallpaper ?? "" }, [{ name: "wallpaper", selector: { text: {} } }], (v) => this._emit({ ...c, wallpaper: v.wallpaper || undefined }))}`;
    if (part === "foreign") {
      const n = dash ? foreignCards(c) : foreign;
      const where = dash ? "on this dashboard" : "in this panel";
      return n
        ? html`<div class="bubble-notice"><ha-icon .icon=${"mdi:information-outline"}></ha-icon><span>${n} ${t(n === 1 ? `card ${where} is not a glass card` : `cards ${where} are not glass cards`)} ${t("(from HA or HACS) – the glass and the colours set here do not reach them; they keep their own look.")}</span></div>`
        : html`<div class="list-hint">${t("Every card here is a glass card.")}</div>`;
    }
    if (part === "looks") {
      // top-level panels set to "No glass", named by what is in them: "Phone: Obývací pokoj, Pracovna…"
      const bare = panelLists(c).flatMap(([path, l]) =>
        l
          .filter((p) => p?.glass === "none")
          .map((p) => {
            const kids = (p.cards ?? []).map((k: any) => k?.name ?? k?.title ?? (String(k?.type ?? "").startsWith("custom:glass-") ? cardName(String(k.type).slice(13)) : "")).filter(Boolean);
            const what = p.title ?? (kids.length ? `${kids.slice(0, 3).join(", ")}${kids.length > 3 ? "…" : ""}` : t("empty panel"));
            const dev = path.includes(":") ? path.split(":")[0] : "";
            return dev ? `${t(dev === "mobile" ? "Mobile" : dev === "tablet" ? "Tablet" : "Desktop")}: ${what}` : what;
          }),
      );
      if (night) return html`<div class="list-hint">${t("The look is picked by day; at night change the levels below.")}</div>`;
      return html`<div class="looks">
        <div class="list-hint">${t("Look – picks the glass for panels, cards and buttons at once, on the dashboard and in its pop-ups (the pop-up window itself is Bubble Card's). Fine-tune each of them below. Panels with their own glass setting are switched to the look; panels without glass stay without.")}</div>
        <div class="look-row">
          ${LOOK_BUTTONS.map(
            ([name, key]) =>
              html`<button class="look ${current === key ? "on" : ""}" @click=${() => current !== key && this._emit(applyLook(c, key, custom))}>
                ${t(name)}
              </button>`,
          )}
          <button
            class="look ${custom ? "on" : ""}"
            ?disabled=${!custom && !c.custom_look}
            title=${t("Change a level below to customise the look; pick a look to reset it.")}
            @click=${() => !custom && c.custom_look && this._emit(restoreCustom(c))}
          >
            ${t("Custom")}
          </button>
        </div>
        ${dash ? html`<div class="list-hint">${lookHint(picked, c)}</div>` : nothing}
        ${dash && bare.length && picked !== "apple-home"
          ? html`<div class="bubble-notice bare-notice">
              <ha-icon .icon=${"mdi:information-outline"}></ha-icon>
              <div>
                <div>${t(bare.length === 1 ? "This panel is set to “No glass”, so it stays without glass in this look – only its cards have a background:" : "These panels are set to “No glass”, so they stay without glass in this look – only their cards have a background:")}</div>
                <ul>
                  ${bare.map((b) => html`<li>${b}</li>`)}
                </ul>
                <button class="look" @click=${() => this._emit(unbare(c))}>${t(bare.length === 1 ? "Give it the look's glass" : "Give them the look's glass")}</button>
              </div>
            </div>`
          : nothing}
      </div>`;
    }
    return html`${groups.filter(([, , gk]) => (dash ? uses[gk] || c[gk] !== undefined : uses[gk] && (gk === "glass" || gk === "tile_glass" || c[gk] !== undefined))).map(([title, hint, gk, tk, only]) => {
      // the dashboard's panels and room bars have no level above: liquid unless set
      const inherit = !dash || (gk !== "glass" && gk !== "bar_glass");
      const tint = c[tk] as { color?: number[]; strength?: number } | undefined;
      const lookDefault = dash ? look?.[gk as "glass" | "tile_glass" | "control_glass"] : undefined;
      // inherited on a panel: also say what that is now
      const now = !dash && c[gk] === undefined ? dashValue[gk] : undefined;
      const shown = now ? `${label(undefined, inherit)} – ${now ? t(allTypes(false).find((o) => o.value === now)?.label ?? now) : ""}` : label(c[gk] ?? lookDefault, inherit);
      const summary = [shown, tint?.color ? `${t("color")} ${tint.strength ?? 30} %` : ""]
        .filter(Boolean)
        .join(" · ");
      const strength = (name: string) => ({ name, selector: { number: { min: 0, max: 100, step: 5, mode: "slider", unit_of_measurement: "%" } } });
      return html`<ha-expansion-panel outlined class="group" .header=${t(title)} .secondary=${summary}>
        <div class="list-hint">${t(hint)}</div>
        ${this._form(
          {
            type: c[gk] ?? lookDefault ?? (inherit ? "" : "liquid"),
            color: tint?.color,
            strength: tint?.strength ?? 30,
          },
          [
            { name: "type", selector: { select: { mode: "dropdown", options: types(inherit, only) } } },
            { type: "grid", name: "", schema: [{ name: "color", selector: { color_rgb: {} } }, strength("strength")] },
          ],
          (v) => {
            const next: Record<string, any> = { ...c };
            if (v.type && v.type !== (lookDefault ?? (inherit ? "" : "liquid"))) next[gk] = v.type;
            else delete next[gk];
            next[tk] = Array.isArray(v.color) && Number(v.strength) > 0 ? { color: v.color, strength: Number(v.strength) } : undefined;
            if (!next[tk]) delete next[tk];
            this._emit(next);
          },
        )}
        ${tint?.color
          ? html`<button class="link" @click=${() => {
              const next = { ...c };
              delete next[tk];
              this._emit(next);
            }}>${t("Remove color")}</button>`
          : nothing}
      </ha-expansion-panel>`;
    })}
`;
  }

  /** A collapsible section of a tab (TabSpec.sections): its fields and blocks, what is set on its second line. */
  private _section(s: SectionSpec) {
    const c = this._config ?? {};
    const night = this._open.night === 1;
    const body =
      night && s.day
        ? html`<div class="list-hint">${t("Set by day – the same at night.")}</div>`
        : html`${s.form ? this._blocks(typeof s.form === "function" ? s.form(c) : s.form) : nothing}${(s.blocks ?? []).map((b) => this._block(b))}`;
    const key = `${this.spec.looks ? "dashboard" : "card"}.${s.key}`;
    return html`<ha-expansion-panel
      outlined
      class="group section"
      .header=${t(s.title)}
      .secondary=${s.summary?.(c, this.hass) ?? ""}
      .expanded=${sectionOpen(key, !!s.open)}
      @expanded-changed=${(e: CustomEvent) => e.target === e.currentTarget && rememberOpen(key, !!e.detail?.expanded)}
    >
      <div class="grp">${body}</div>
    </ha-expansion-panel>`;
  }

  private _block(b: SectionBlock) {
    switch (b) {
      case "layout":
        return this._layout();
      case "dock":
        return this._dock();
      case "popups":
        return this._popups();
      case "popupTheme":
        // pop-ups are Bubble Card's: without it nothing to theme (unless one is set already)
        if (!hasBubble() && !this._config?.overlay_theme) return nothing;
        return this._popupTheme();
      case "tuning":
        return this.spec.tuning ? this._tuning(this.spec.tuning, true) : nothing;
      default:
        return this._glassGroups(b);
    }
  }

  /** A glass card on a dashboard without glass-dashboard: say what it does not get there. */
  private _standalone() {
    const inStudio = !!this.closest("glass-studio") || (this.getRootNode() as ShadowRoot).host?.localName === "glass-studio";
    const views = (this.lovelace as { config?: unknown } | undefined)?.config;
    if (inStudio || !views || JSON.stringify(views).includes("custom:glass-dashboard")) return nothing;
    return html`<div class="bubble-notice"><ha-icon .icon=${"mdi:information-outline"}></ha-icon><span>${t("This dashboard has no glass dashboard card: the wallpaper and the dashboard's glass don't apply here. The card follows the HA theme, and its night look HA's dark mode.")}</span></div>`;
  }

  /** Another tab: back to the day look (night editing is only on Appearance). */
  private _tab(i: number) {
    if (this._open.night === 1) window.dispatchEvent(new CustomEvent("glass-preview-dark", { detail: false }));
    this._open = { ...this._open, tab: i, night: 0 };
  }

  /** Appearance's day / night switch: at night the fields show and change the night look (`dark:`). */
  private _dayNight() {
    const night = this._open.night === 1;
    const setNight = (on: boolean) => {
      this._open = { ...this._open, night: on ? 1 : 0 };
      window.dispatchEvent(new CustomEvent("glass-preview-dark", { detail: on }));
    };
    const n = Object.keys(this._cfg?.dark ?? {}).length;
    return html`<div class="look-row daynight">
        <button class="look ${night ? "" : "on"}" @click=${() => setNight(false)}><ha-icon .icon=${"mdi:weather-sunny"}></ha-icon> ${t("By day")}</button>
        <button class="look ${night ? "on" : ""}" @click=${() => setNight(true)}><ha-icon .icon=${"mdi:weather-night"}></ha-icon> ${t("At night")}</button>
      </div>
      <div class="list-hint">
        ${t(night ? "At night: what you change here is used only at night; the rest stays as by day." : "By day – switch to At night to set a different night look.")}
        ${n
          ? html`${t("Different at night:")} ${n}.
              <button class="link" @click=${() => {
                const { dark: _old, ...day } = this._cfg ?? {};
                this._open = { ...this._open, night: 0 };
                this._emit(day);
                setNight(night);
              }}>${t("Remove the night look")}</button>`
          : nothing}
      </div>`;
  }

  /** A card's Appearance: one group per part (the card, its bar, its icon…), each with its material and colours. */
  private _lookGroups(look: Schema[], cfg: Record<string, any> | undefined = this._config, form?: (fields: Schema[]) => unknown) {
    return groupLook(look).map(([title, fields]) => {
      const set = fields.some((f) => isSet(f, cfg));
      return html`<ha-expansion-panel outlined class="group" .header=${t(title)} .secondary=${t(set ? "Set" : "Automatic – from the panel / dashboard")}>
        <div class="grp">${form ? form(fields) : this._blocks(fields)}</div>
      </ha-expansion-panel>`;
    });
  }

  /** Pop-up source: the same two drop-downs for every device, mobile optionally different. */
  private _popups() {
    const c = this._config!;
    const hass = this.hass as any;
    const dashboards: { value: string; label: string }[] = Object.values(hass?.panels ?? {})
      .filter((p: any) => p.component_name === "lovelace")
      .map((p: any) => ({ value: p.url_path, label: `${p.title ?? p.url_path} (${p.url_path})` }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const viewOpts = (url?: string) => {
      if (!url) return [];
      if (!this._views[url] && this.hass) viewsOf(this.hass, url).then((v) => ((this._views = { ...this._views, [url]: v }), this.requestUpdate()));
      return this._views[url] ?? [];
    };
    const row = (title: string, src: Record<string, any> | undefined, set: (v: Record<string, any> | undefined) => void) =>
      html`<div class="src-row">
        <div class="src-title">${t(title)}</div>
        ${this._form(
          { dashboard: src?.dashboard ?? "", view: src?.view !== undefined ? String(src.view) : "" },
          [
            {
              type: "grid",
              name: "",
              schema: [
                { name: "dashboard", selector: { select: { mode: "dropdown", options: [{ value: "", label: "— no pop-ups —" }, ...dashboards] } } },
                {
                  name: "view",
                  selector: { select: { mode: "dropdown", options: [{ value: "", label: "All views" }, ...viewOpts(src?.dashboard)] } },
                },
              ],
            },
          ],
          (v) => {
            if (!v.dashboard) return set(undefined);
            set({ ...(src ?? {}), dashboard: v.dashboard, view: v.dashboard !== src?.dashboard || !v.view ? undefined : v.view });
          },
        )}
      </div>`;
    const mob = c.responsive?.mobile?.overlay_source;
    const setMobile = (v: Record<string, any> | undefined) => {
      const mobile = { ...(c.responsive?.mobile ?? {}) };
      if (v) mobile.overlay_source = v;
      else delete mobile.overlay_source;
      const responsive = { ...(c.responsive ?? {}), mobile };
      if (!Object.keys(mobile).length) delete responsive.mobile;
      this._emit({ ...c, responsive: Object.keys(responsive).length ? responsive : undefined });
    };
    return html`${bubbleNotice()}
      <div class="list-hint">
        ${t("Pop-ups are Bubble Card pop-ups. New ones live in this dashboard (Pop-ups in the tree); they can also come from another dashboard and are saved back there. Pop-ups from YAML dashboards can only be shown.")}
      </div>
      ${row("Tablet and desktop", c.overlay_source, (v) => this._emit({ ...c, overlay_source: v }))}
      <label class="src-toggle">
        <ha-switch
          .checked=${!!mob}
          @change=${(e: Event) => setMobile((e.target as HTMLInputElement).checked ? { ...(c.overlay_source ?? {}) } : undefined)}
        ></ha-switch>
        ${t("Different pop-ups on mobile")}
      </label>
      ${mob ? row("Mobile", mob, setMobile) : nothing}`;
  }

  /** The bottom bar: a dock card in the overlay (and in the mobile overlay when it has its own). */
  private _dock() {
    const c = this._config!;
    const isDock = (x: any) => x?.type === "custom:glass-dock";
    const mobOverlay = c.responsive?.mobile?.overlay;
    const setDock = (on: boolean) => {
      if (!on && !confirm(t("Remove the bottom bar with its icons?"))) return this.requestUpdate();
      const fix = (list?: any[]) => {
        const next = on ? (list?.some(isDock) ? list : [...(list ?? []), stubFor("custom:glass-dock", this.hass)]) : list?.filter((x) => !isDock(x));
        return next?.length ? next : undefined;
      };
      const next: Record<string, any> = { ...c, overlay: fix(c.overlay) };
      if (Array.isArray(mobOverlay)) next.responsive = { ...c.responsive, mobile: { ...c.responsive.mobile, overlay: fix(mobOverlay) ?? [] } };
      this._emit(next);
    };
    return html`<label class="src-toggle">
        <ha-switch .checked=${hasDock(c)} @change=${(e: Event) => setDock((e.target as HTMLInputElement).checked)}></ha-switch>
        ${t("Bottom bar (dock)")}
      </label>
      <div class="list-hint">${t("Icons at the bottom of the screen that open pop-ups. Set its icons in the tree under Bottom bar.")}</div>`;
  }

  /** The theme for pop-ups made of other cards (card_mod, button-card…); its night one with the day / night switch. */
  private _popupTheme() {
    const c = this._config!;
    const themes = Object.keys((this.hass as any)?.themes?.themes ?? {}).sort();
    const opts = [{ value: "", label: "— HA theme —" }, ...themes.map((name) => ({ value: name, label: name }))];
    return html`<div class="list-hint">
        ${t("For pop-ups built with other cards (card_mod, button-card…) that read the variables of the theme they were made for – independent of the theme picked in HA.")}
      </div>
      ${this._form({ overlay_theme: c.overlay_theme ?? "" }, [{ name: "overlay_theme", selector: { select: { mode: "dropdown", options: opts } } }], (v) =>
        this._emit({ ...c, overlay_theme: v.overlay_theme || undefined }),
      )}`;
  }

  /** Preset thumbnails, custom grid fields and a card list per area. */
  private _layout() {
    const c = this._config!;
    const custom = !!c.grid?.areas;
    const presetRows = (p: Preset) => parseAreas(PRESETS[p].areas.map((r) => `"${r}"`));
    const rows = custom ? parseAreas(c.grid.areas) : presetRows((c.preset ?? "classic") as Preset);
    // thumbnails: real proportions, each area marked with what usually goes there
    const AREA_ICON: Record<string, string> = {
      header: "mdi:calendar-today",
      top: "mdi:dots-horizontal",
      left: "mdi:clock-outline",
      right: "mdi:view-sequential-outline",
      main: "mdi:view-grid-outline",
    };
    const thumb = (r: string[][], on: boolean, label: string, pick: () => void, dims?: { cols: string; rows: string }) => html`<button
      class="preset ${on ? "on" : ""}"
      @click=${pick}
    >
      <span
        class="mini"
        style="grid-template-columns:${dims?.cols ?? `repeat(${Math.max(...r.map((x) => x.length))}, 1fr)`};grid-template-rows:${dims?.rows ?? "auto"};grid-template-areas:${r
          .map((x) => `"${x.join(" ")}"`)
          .join(" ")}"
      >
        ${areaOrder(r).map(
          (n) => html`<i style="grid-area:${n}" class=${n === "main" ? "main" : ""} title=${t(AREA_TITLES[n]?.[0] ?? n)}
            ><ha-icon .icon=${AREA_ICON[n] ?? "mdi:card-outline"}></ha-icon
          ></i>`,
        )}
      </span>
      <span>${t(label)}</span>
    </button>`;
    const setGrid = (g: Record<string, any> | undefined) => this._emit({ ...c, grid: g && Object.keys(g).length ? g : undefined });
    // areas: the layout's own, then any extra area that already holds cards
    const names = areaOrder(rows);
    for (const k of [...LEGACY_AREAS, ...Object.keys(c.areas ?? {})]) {
      const has = LEGACY_AREAS.includes(k) ? c[k]?.length : c.areas?.[k]?.length;
      if (has && !names.includes(k)) names.push(k);
    }
    return html`
      <div class="list-hint">
        ${t("The screen is made of areas, each with its own cards. The colored one is the main area (rooms); the icons show what usually goes in an area: date, status bar, clock and weather.")}
      </div>
      <div class="presets">
        ${(Object.keys(PRESETS) as Preset[]).map((p) =>
          thumb(
            presetRows(p),
            !custom && (c.preset ?? "classic") === p,
            PRESETS[p].label,
            () => this._emit(withEmptyPanels({ ...c, preset: p === "classic" ? undefined : p, grid: undefined }, presetRows(p))),
            PRESETS[p].thumb,
          ),
        )}
        ${thumb(custom ? rows : [["a", "b"], ["c", "c"]], custom, "Custom", () => {
          if (custom) return;
          // keep the template's widths and heights: the custom grid starts as what is shown
          const p = PRESETS[(c.preset ?? "classic") as Preset] ?? PRESETS.classic;
          setGrid({ areas: rows.map((r) => `"${r.join(" ")}"`).join("\n"), columns: p.columns(c.left_width ?? "minmax(320px, 0.36fr)"), rows: p.rows });
        })}
      </div>
      ${custom ? this._gridWizard(rows, setGrid) : nothing}
      ${names.map((n) => {
        const key = LEGACY_AREAS.includes(n) ? n : `areas.${n}`;
        const area = this._areaCards(key);
        // the usual case – one glass panel holding the cards: list the cards right
        // here and tuck the panel's own settings away in "Panel settings"
        const panel = area.cards.length === 1 && area.cards[0]?.type === "custom:glass-panel" ? area.cards[0] : undefined;
        const inner = panel ? ((panel.cards ?? []) as Record<string, any>[]) : area.cards;
        const count = inner.length;
        return html`<ha-expansion-panel
          outlined
          class="group"
          .header=${t(AREA_TITLES[n]?.[0] ?? n)}
          .secondary=${`${count} ${t(count === 1 ? "card" : "cards")}${panel ? ` · ${t("in a panel")}` : ""}`}
        >
          ${panel
            ? html`${this._cardList({ name: `${key}#panel`, title: n, hint: AREA_TITLES[n]?.[1] || undefined }, true, {
                  cards: inner,
                  set: (next) => area.set([{ ...panel, cards: next }]),
                })}
                <ha-expansion-panel outlined class="sub" .header=${t("Panel settings")} .secondary=${t("Layout, glass and colors of the frame around these cards")}>
                  ${this._panelEditor(key, panel, (p) => area.set([{ ...p, cards: panel.cards }]))}
                </ha-expansion-panel>`
            : this._cardList({ name: key, title: n, hint: AREA_TITLES[n]?.[1] || undefined }, true)}
        </ha-expansion-panel>`;
      })}
    `;
  }

  /** The area being painted in the custom-layout wizard. */
  private _paint = "main";
  private _painting = false;
  private _newArea = "";

  /**
   * Custom layout as a guide: grid size, areas painted onto cells, column widths and
   * row heights – instead of typing `grid-template-areas`. Writes `grid: { areas, columns, rows }`.
   */
  private _gridWizard(rows: string[][], setGrid: (g: Record<string, any> | undefined) => void) {
    const c = this._config!;
    const g = c.grid ?? {};
    const nCols = Math.max(1, ...rows.map((r) => r.length));
    const cells = rows.map((r) => [...r, ...Array(nCols - r.length).fill(".")]);
    const split = (v?: string) => (v ?? "").match(/(?:[^\s(]+\([^)]*\)|[^\s]+)/g) ?? [];
    const side = c.left_width ?? "minmax(320px, 0.36fr)";
    const colsNow = split(g.columns);
    const rowsNow = split(g.rows);
    const cols = [...Array(nCols).keys()].map((i) => colsNow[i] ?? "minmax(0, 1fr)");
    const rws = cells.map((_, i) => rowsNow[i] ?? (i === cells.length - 1 ? "minmax(0, 1fr)" : "auto"));
    const write = (nextCells: string[][], nextCols = cols, nextRows = rws) =>
      setGrid({
        ...g,
        areas: nextCells.map((r) => `"${r.join(" ")}"`).join("\n"),
        columns: nextCols.slice(0, Math.max(1, ...nextCells.map((r) => r.length))).join(" "),
        rows: nextRows.slice(0, nextCells.length).join(" "),
      });
    const resize = (dc: number, dr: number) => {
      let next = cells.map((r) => [...r]);
      if (dc > 0) next = next.map((r) => [...r, r[r.length - 1] ?? "."]);
      if (dc < 0 && nCols > 1) next = next.map((r) => r.slice(0, -1));
      if (dr > 0) next = [...next, next[next.length - 1].map(() => ".")];
      if (dr < 0 && next.length > 1) next = next.slice(0, -1);
      write(next, dc > 0 ? [...cols, "minmax(0, 1fr)"] : cols, dr > 0 ? [...rws, "auto"] : rws);
    };
    const paint = (ri: number, ci: number) => {
      if (cells[ri][ci] === this._paint) return;
      write(cells.map((r, i) => r.map((n, j) => (i === ri && j === ci ? this._paint : n))));
    };
    // every area must be one rectangle, or CSS grid ignores the whole template
    const bad = areaOrder(cells).filter((n) => {
      if (n === ".") return false;
      const at = cells.flatMap((r, i) => r.map((x, j) => (x === n ? [i, j] : null)).filter(Boolean)) as number[][];
      const r0 = Math.min(...at.map((p) => p[0])), r1 = Math.max(...at.map((p) => p[0]));
      const c0 = Math.min(...at.map((p) => p[1])), c1 = Math.max(...at.map((p) => p[1]));
      return at.length !== (r1 - r0 + 1) * (c1 - c0 + 1);
    });
    const palette = [...new Set([...LEGACY_AREAS, "right", ...areaOrder(cells).filter((n) => n !== ".")])];
    const HUE: Record<string, number> = { header: 280, top: 30, left: 200, main: 210, right: 160 };
    const hue = (n: string) => HUE[n] ?? [...n].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);
    const swatch = (n: string) => (n === "." ? "" : `--hue:${hue(n)}`);
    const label = (n: string) => (n === "." ? t("Empty") : t(AREA_TITLES[n]?.[0] ?? n));
    const widthOpt = (v: string) => (v === side ? "side" : v === "minmax(0, 1fr)" || v === "1fr" ? "fill" : v === "auto" ? "auto" : /^\d+px$/.test(v) ? "px" : "other");
    const heightOpt = (v: string) => (v === "minmax(0, 1fr)" || v === "1fr" ? "fill" : v === "auto" ? "auto" : /^\d+px$/.test(v) ? "px" : "other");
    const sizeSel = (kind: "w" | "h", v: string, set: (nv: string) => void) => {
      const o = kind === "w" ? widthOpt(v) : heightOpt(v);
      const opts: [string, string][] =
        kind === "w"
          ? [["fill", "Rest of the width"], ["side", "Narrow (side column)"], ["auto", "As wide as its cards"], ["px", "Fixed (px)"]]
          : [["auto", "As tall as its cards"], ["fill", "Rest of the height"], ["px", "Fixed (px)"]];
      return html`<span class="gsize">
        <select
          @change=${(e: Event) => {
            const x = (e.target as HTMLSelectElement).value;
            set(x === "fill" ? "minmax(0, 1fr)" : x === "side" ? side : x === "auto" ? "auto" : x === "px" ? (kind === "w" ? "360px" : "200px") : v);
          }}
        >
          ${opts.map(([val, l]) => html`<option value=${val} ?selected=${o === val}>${t(l)}</option>`)}
          ${o === "other" ? html`<option value="other" selected>${v}</option>` : nothing}
        </select>
        ${o === "px"
          ? html`<input type="number" min="40" step="10" .value=${String(parseInt(v))} @change=${(e: Event) => set(`${(e.target as HTMLInputElement).value}px`)} />`
          : nothing}
      </span>`;
    };
    return html`<div class="wizard" @pointerup=${() => (this._painting = false)} @pointerleave=${() => (this._painting = false)}>
      <div class="wstep">
        <b>1</b>
        <span>${t("Grid size")}</span>
        <span class="grow"></span>
        <span class="stepper">${t("Columns")} <button @click=${() => resize(-1, 0)} ?disabled=${nCols <= 1}>−</button>${nCols}<button @click=${() => resize(1, 0)} ?disabled=${nCols >= 6}>+</button></span>
        <span class="stepper">${t("Rows")} <button @click=${() => resize(0, -1)} ?disabled=${cells.length <= 1}>−</button>${cells.length}<button @click=${() => resize(0, 1)} ?disabled=${cells.length >= 6}>+</button></span>
      </div>
      <div class="wstep">
        <span>${t("Start from")}</span>
        <select
          class="gstart"
          @change=${(e: Event) => {
            const p = PRESETS[(e.target as HTMLSelectElement).value as Preset];
            (e.target as HTMLSelectElement).value = "";
            if (!p) return;
            setGrid({ areas: p.areas.map((r) => `"${r}"`).join("\n"), columns: p.columns(side), rows: p.rows });
          }}
        >
          <option value="">${t("— a template —")}</option>
          ${(Object.keys(PRESETS) as Preset[]).map((k) => html`<option value=${k}>${t(PRESETS[k].label)}</option>`)}
        </select>
      </div>
      <div class="wstep"><b>2</b><span>${t("Pick an area, then click or drag over the cells it should cover.")}</span></div>
      <div class="palette">
        ${palette.map(
          (n) => html`<button class="chip ${this._paint === n ? "on" : ""}" style=${swatch(n)} @click=${() => ((this._paint = n), this.requestUpdate())}>${label(n)}</button>`,
        )}
        <button class="chip empty ${this._paint === "." ? "on" : ""}" @click=${() => ((this._paint = "."), this.requestUpdate())}>${t("Empty")}</button>
        <span class="new-area">
          <input
            placeholder=${t("New area…")}
            .value=${this._newArea}
            @input=${(e: Event) => (this._newArea = (e.target as HTMLInputElement).value)}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key !== "Enter") return;
              const n = ident(this._newArea);
              if (n) ((this._paint = n), (this._newArea = ""), this.requestUpdate());
            }}
          />
        </span>
      </div>
      <div class="gpaint" style="grid-template-columns:repeat(${nCols}, minmax(0, 1fr))">
        ${cells.map((r, ri) =>
          r.map(
            (n, ci) => html`<div
              class="gcell ${n === "." ? "empty" : ""}"
              style=${swatch(n)}
              @pointerdown=${(e: PointerEvent) => {
                e.preventDefault();
                this._painting = true;
                paint(ri, ci);
              }}
              @pointerenter=${() => this._painting && paint(ri, ci)}
            >
              ${(ri === 0 || cells[ri - 1][ci] !== n) && (ci === 0 || r[ci - 1] !== n) ? html`<span>${label(n)}</span>` : nothing}
            </div>`,
          ),
        )}
      </div>
      ${bad.length
        ? html`<div class="gwarn">⚠ ${t("Each area has to be one rectangle:")} ${bad.map(label).join(", ")}</div>`
        : nothing}
      <div class="wstep"><b>3</b><span>${t("Column widths")}</span></div>
      <div class="gsizes" style="grid-template-columns:repeat(${nCols}, minmax(0, 1fr))">
        ${cols.map((v, i) => sizeSel("w", v, (nv) => write(cells, cols.map((x, k) => (k === i ? nv : x)))))}
      </div>
      <div class="wstep"><b>4</b><span>${t("Row heights")}</span></div>
      <div class="gsizes rows">
        ${rws.map(
          (v, i) => html`<span class="grow-row">${t("Row")} ${i + 1}</span>${sizeSel("h", v, (nv) => write(cells, cols, rws.map((x, k) => (k === i ? nv : x))))}`,
        )}
      </div>
      <ha-expansion-panel outlined class="sub" .header=${t("Advanced (CSS grid)")}>
        ${this._form({ ...g }, [{ name: "areas", selector: { text: { multiline: true } } }, grid({ name: "columns", selector: { text: {} } }, { name: "rows", selector: { text: {} } })], (v) =>
          setGrid({ ...g, ...v }),
        )}
      </ha-expansion-panel>
    </div>`;
  }

  /** The panel card's own editor without its card list, one per area (kept between renders). */
  private _panelEditors = new Map<string, GlassCardEditor>();
  private _panelEditor(key: string, panel: Record<string, any>, onChange: (p: Record<string, any>) => void) {
    let ed = this._panelEditors.get(key);
    if (!ed) {
      const cls = customElements.get("glass-panel") as unknown as { getConfigElement?: () => HTMLElement } | undefined;
      ed = cls?.getConfigElement?.() as GlassCardEditor | undefined;
      if (!ed) return nothing;
      ed.noCards = true;
      this._panelEditors.set(key, ed);
    }
    ed.hass = this.hass;
    ed.lovelace = this.lovelace;
    ed.setConfig(panel);
    (ed as any)._onChange = onChange;
    if (!(ed as any)._wired) {
      (ed as any)._wired = true;
      ed.addEventListener("config-changed", (e: Event) => {
        e.stopPropagation();
        const cfg = (e as CustomEvent).detail?.config;
        if (cfg) (ed as any)._onChange(cfg);
      });
    }
    return ed;
  }

  private _onLang = () => this.requestUpdate();

  private _studio?: HTMLElement & { hass?: HomeAssistant };

  /** The studio module (loaded by the bundle's entry) answers this with the opened studio. */
  private _openStudio() {
    const detail: Record<string, any> = {
      config: this._config ?? {},
      hass: this.hass,
      lovelace: this.lovelace,
      onChange: (c: Record<string, any>) => this._emit(c),
      dialog: this._haDialog(),
    };
    window.dispatchEvent(new CustomEvent("glass-open-studio", { detail }));
    this._studio = detail.studio;
  }

  /** HA's card-editor dialog this editor sits in (not when it is the studio's own dashboard settings). */
  private _haDialog(): (HTMLElement & Record<string, any>) | undefined {
    let n: Node | null = this;
    for (let i = 0; n && i < 60; i++) {
      const name = (n as Element).localName;
      if (name === "glass-studio") return undefined;
      if (name === "hui-dialog-edit-card") return n as HTMLElement & Record<string, any>;
      n = (n as Element).parentNode ?? (n as unknown as ShadowRoot).host ?? null;
    }
    return undefined;
  }

  /** The dashboard's own card dialog opens the large editor right away (screens wide enough for it). */
  private _autoOpened = false;

  protected override updated() {
    if (this._studio?.isConnected) this._studio.hass = this.hass;
    else this._studio = undefined;
    if (!this._autoOpened && this.spec.previewSwitch && this._config && this.hass && window.innerWidth >= 900 && this._haDialog()) {
      this._autoOpened = true;
      this._openStudio();
    }
  }

  override connectedCallback() {
    super.connectedCallback();
    window.addEventListener("glass-lang", this._onLang);
    window.addEventListener("glass-clipboard", this._onLang);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("glass-lang", this._onLang);
    window.removeEventListener("glass-clipboard", this._onLang);
  }

  /** Inside the large editor (through any shadow roots). */

  protected override render() {
    if (!this._config || !this.spec) return nothing;
    // the HA user's language for the cards; the editor's own when picked (the studio has it in its bar)
    syncLang(this.hass);
    return html`${this._inStudio() ? nothing : this._langSwitch()}${this._body()}`;
  }

  private _inStudio() {
    for (let n: Node | null = this; n; n = n instanceof ShadowRoot ? n.host : n.parentNode) if ((n as Element).localName === "glass-studio") return true;
    return false;
  }

  private _langSwitch() {
    return html`<div class="lang">
      <ha-icon icon="mdi:translate"></ha-icon>
      <select aria-label=${t("Editor language")} @change=${(e: Event) => setEditorLang((e.target as HTMLSelectElement).value)}>
        <option value="auto" ?selected=${editorLangPref() === "auto"}>${t("As Home Assistant")}</option>
        ${LANGS.map(([v, l]) => html`<option value=${v} ?selected=${editorLangPref() === v}>${l}</option>`)}
      </select>
    </div>`;
  }

  /** The spec's ha-form fields for the card's config (defaults shown, never written). */
  /** The card's texts and icons its config really shows (a layout without a name offers no name):
   *  a hidden copy of the card is rendered with it and asked. Styles don't change what's shown. */
  private _probe?: { key: string; parts?: PartDef[] };
  private _probeTimer?: number;
  private _shownParts(): PartDef[] {
    const c = this._config;
    if (!this.spec.parts?.length || !c?.type || !this.hass) return [];
    const { fonts: _f, icons: _i, ...rest } = c;
    const key = JSON.stringify(rest);
    if (this._probe?.key !== key) {
      // the last answer stays while the new one is found
      this._probe = { key, parts: this._probe?.parts };
      clearTimeout(this._probeTimer);
      this._probeTimer = window.setTimeout(() => this._runProbe(key, rest), 250);
    }
    return this._probe.parts ?? [];
  }
  private async _runProbe(key: string, cfg: Record<string, any>) {
    const el = document.createElement(String(cfg.type).replace("custom:", "")) as HTMLElement & {
      setConfig(c: unknown): void;
      hass?: HomeAssistant;
      updateComplete?: Promise<unknown>;
    };
    try {
      el.setConfig(cfg);
    } catch {
      return;
    }
    el.hass = this.hass;
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;left:-10000px;top:0;width:520px;visibility:hidden;pointer-events:none";
    box.appendChild(el);
    document.body.appendChild(box);
    await el.updateComplete;
    // some draw after loading (a radar's frames): give them a moment
    await new Promise((r) => setTimeout(r, 1200));
    const root = el.shadowRoot;
    const has = (s?: string) => {
      try {
        return !!s && !!root?.querySelector(s);
      } catch {
        return false;
      }
    };
    const shown = (this.spec.parts ?? []).filter((p) => p.always || has(p.sel) || has(p.on));
    box.remove();
    if (this._probe?.key !== key) return;
    this._probe = { key, parts: shown };
    this.requestUpdate();
  }

  private _specForm(schema: Schema[]) {
    return schema.length
      ? this._form({ ...this.spec.defaults, ...this._config }, schema, (v) => {
          // an empty YAML field reports {} as soon as it shows: not a change, don't write it
          for (const [k, x] of Object.entries(v))
            if (x && typeof x === "object" && !Array.isArray(x) && !Object.keys(x).length && this._config?.[k] === undefined) delete v[k];
          const was: Record<string, any> = { ...this.spec.defaults, ...this._config };
          if ([...new Set([...Object.keys(v), ...Object.keys(was)])].every((k) => JSON.stringify(v[k]) === JSON.stringify(was[k]))) return;
          this._emit(
            withoutDefaults(
              this.spec.adjust ? this.spec.adjust({ ...this._config, ...v }, this._config!, this.hass) : { ...this._config, ...v },
              this._config!,
              this.spec.defaults,
            ),
          );
        })
      : nothing;
  }

  /**
   * A form with blocks of our own between the ha-form fields:
   *   { custom: "section", key, title, secondary?, open?, schema }  – a collapsible group
   *   { custom: "tiles", name, options: [{ value, label, rows }], default? } – pictures to pick from
   *   { custom: "list", list }  – one of the spec's `lists`, here instead of at the top
   *   { custom: "list", list, at: [key, i], title } – that list kept in item i of list `key`
   *   { custom: "hint", text }  – a line of explanation
   */
  private _blocks(schema: Schema[]): unknown[] {
    const out: unknown[] = [];
    let run: Schema[] = [];
    const flush = () => {
      if (run.length) out.push(this._specForm(run));
      run = [];
    };
    for (const s of schema) {
      if (!s.custom) {
        run.push(s);
        continue;
      }
      flush();
      if (s.custom === "section") {
        const key = `sec:${s.key}`;
        // as left: in this editor, else as last time in this browser (per kind of card)
        const remembered = `${String(this._config?.type ?? "").replace("custom:glass-", "")}.${s.key}`;
        const open = this._open[key] !== undefined ? !!this._open[key] : sectionOpen(remembered, !!s.open);
        out.push(html`<ha-expansion-panel
          outlined
          class="group"
          .header=${t(s.title)}
          .secondary=${s.secondary ? t(s.secondary) : ""}
          .expanded=${open}
          @expanded-changed=${(e: CustomEvent) => {
            e.stopPropagation();
            if (!!e.detail.expanded !== open) {
              this._open = { ...this._open, [key]: e.detail.expanded ? 1 : 0 };
              rememberOpen(remembered, !!e.detail.expanded);
            }
          }}
          ><div class="sec">${this._blocks(s.schema)}</div></ha-expansion-panel
        >`);
      } else if (s.custom === "tiles") out.push(this._tiles(s));
      else if (s.custom === "list") {
        const l = this.spec.lists?.find((x) => x.name === s.list);
        if (l) out.push(s.at ? this._listAt(l, s.at, s.title) : this._list(l));
      } else if (s.custom === "hint") out.push(html`<div class="list-hint">${t(s.text)}</div>`);
      else if (s.custom === "size") out.push(this._sizeForm());
    }
    flush();
    return out;
  }

  /** Width / height being typed in the Size section, not saved yet. */
  private _sizeDraft?: { width: string; height: string };

  /** The card's own width / height inside a panel or column (view_layout), as a section. */
  private _sizeForm() {
    const c = this._config ?? {};
    // its own key (see CardSize in core/container): HA's card editor would put view_layout back
    const vl = (c.view_layout ?? {}) as Record<string, any>;
    const cs = (c.card_size ?? {}) as Record<string, any>;
    const cur = { width: cs.width ?? vl.width ?? "", height: cs.height ?? (vl.height && vl.height !== "auto" ? vl.height : ""), fill: cs.fill ?? Number(vl.grow) > 0 };
    const summary = [cur.width && `${t("Width")} ${cur.width}`, cur.height && `${t("Height")} ${cur.height}`, cur.fill && t("fills the rest")].filter(Boolean).join(" · ");
    const css = (v: unknown) => String(v ?? "").trim() || undefined;
    const put = (patch: Record<string, any>) => {
      const next: Record<string, any> = { ...cs, ...patch };
      for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === false) delete next[k];
      this._emit({ ...c, card_size: Object.keys(next).length ? next : undefined });
    };
    const key = "sec:size";
    const open = !!this._open[key];
    return html`<ha-expansion-panel
      outlined
      class="group"
      .header=${t("Size")}
      .secondary=${summary || t("Automatic")}
      .expanded=${open}
      @expanded-changed=${(e: CustomEvent) => {
        e.stopPropagation();
        if (!!e.detail.expanded !== open) this._open = { ...this._open, [key]: e.detail.expanded ? 1 : 0 };
      }}
      ><div class="sec">
        <div class="list-hint">${t("In a panel or a column. Empty = as the layout gives it. In a grid the cells it takes are set in the large editor.")}</div>
        <div
          @focusout=${() => {
            // leaving the field: it shows what is saved again
            if (!this._sizeDraft) return;
            this._sizeDraft = undefined;
            this.requestUpdate();
          }}
        >
          ${this._form(
            this._sizeDraft ?? { width: String(cur.width), height: String(cur.height) },
            [
              grid(
                { name: "width", label: "Width", helper: "e.g. 50% or 240", selector: { text: {} } },
                { name: "height", label: "Height", helper: "e.g. 200 (px)", selector: { text: {} } },
              ),
            ],
            // saved as it is typed, as long as it is a valid length – anything else is ignored
            // (the field keeps showing what is typed, so a config handed back can't overwrite it)
            (v) => {
              const d = { width: String(v.width ?? ""), height: String(v.height ?? "") };
              const was = this._sizeDraft ?? { width: String(cur.width), height: String(cur.height) };
              this._sizeDraft = d;
              const patch: Record<string, any> = {};
              for (const k of ["width", "height"] as const) if (d[k] !== was[k] && validLength(d[k])) patch[k] = css(d[k]);
              if (Object.keys(patch).length) put(patch);
            },
          )}
        </div>
        ${this._form({ fill: !!cur.fill }, [{ name: "fill", label: "Fill the rest of the column / row", selector: { boolean: {} } }], (v) => put({ fill: !!v.fill }))}
      </div></ha-expansion-panel
    >`;
  }

  /** Pictures to pick a value from (as the dashboard's screen layouts). */
  private _tiles(s: Schema) {
    const cur = this._config?.[s.name] ?? s.default;
    const icons: Record<string, string> = { p: "mdi:image-outline", b: "mdi:gesture-tap-button", s: "mdi:dots-horizontal", n: "mdi:format-text" };
    type Opt = { value: string; label: string; rows: string[][]; group?: string };
    // options with a `group` come under its heading, in the order the groups first appear
    const groups = new Map<string, Opt[]>();
    for (const o of s.options as Opt[]) groups.set(o.group ?? "", [...(groups.get(o.group ?? "") ?? []), o]);
    return [...groups].map(
      ([g, opts]) => html`${g ? html`<div class="tiles-group">${t(g)}</div>` : nothing}<div class="presets">
      ${opts.map(({ value, label, rows }) => {
        const cols = Math.max(...rows.map((r) => r.length));
        return html`<button
          class="preset ${cur === value ? "on" : ""}"
          @click=${() => this._emit({ ...this._config, [s.name]: value === s.default ? undefined : value })}
        >
          <div class="mini" style="grid-template-columns:repeat(${cols}, 1fr);grid-template-rows:repeat(${rows.length}, 1fr);grid-template-areas:${rows.map((r) => `"${r.join(" ")}"`).join(" ")}">
            ${[...new Set(rows.flat())].map((a) => html`<i class=${a === "p" ? "main" : ""} style="grid-area:${a}"><ha-icon .icon=${icons[a] ?? ""}></ha-icon></i>`)}
          </div>
          <span>${t(label)}</span>
        </button>`;
      })}
    </div>`,
    );
  }

  private _body() {
    const form = (schema: Schema[]) => this._blocks(schema);
    const specForm = typeof this.spec.form === "function" ? this.spec.form(this._config ?? {}) : this.spec.form;
    // lists the form places itself are not repeated at the top
    const placed = new Set<string>();
    const walk = (sc: Schema[]) => sc.forEach((x) => (x.custom === "list" ? placed.add(x.list) : x.schema && walk(x.schema)));
    walk(specForm);
    // a form that is a function places its lists itself (some only for some layouts)
    const topLists = typeof this.spec.form === "function" ? [] : (this.spec.lists ?? []).filter((l) => !placed.has(l.name));
    let tabs = this.noCards ? this.spec.tabs?.filter((tb) => !tb.cards?.length || tb.form?.length) : this.spec.tabs;
    if (!tabs?.length) {
      // a card: what it shows in "Settings", its glass and colours in "Appearance", rules /
      // styles / YAML in "Advanced" (as the panel's and the dashboard's tabs)
      const { content, look: own, adv } = splitForm(specForm, this._shownParts());
      // every card's Appearance starts with its background material (GlassElement.wrapTile)
      const hasGlass = (sc: Schema[]): boolean => sc.some((x) => x.name === "glass" || (Array.isArray(x.schema) && hasGlass(x.schema)));
      const look = this.spec.noGlass || hasGlass(own) ? own : [{ ...GLASS_FIELD, group: "Card" }, ...own];
      const settings = html`
        ${topLists.map((l) => this._list(l))} ${(this.spec.cards ?? []).map((l) => this._cardList(l))}
        ${topLists.length || this.spec.cards?.length ? html`<div class="list-title settings-title">${t("Settings")}</div>` : nothing}
        ${form(content)} ${this._sizeForm()}
      `;
      const cardTabs: [string, string, () => unknown][] = [
        ["Settings", "mdi:tune-variant", () => settings],
        ...(look.length || this.spec.tuning
          ? ([["Appearance", "mdi:palette-outline", () => html`${this._standalone()} ${this._dayNight()} ${this._lookGroups(look)} ${this.spec.tuning ? this._tuning(this.spec.tuning) : nothing}`]] as [string, string, () => unknown][])
          : []),
        ...(adv.length ? ([["Advanced", "mdi:code-braces", () => form(adv)]] as [string, string, () => unknown][]) : []),
        ...([["Credits", "mdi:heart-outline", () => this._credits()]] as [string, string, () => unknown][]),
      ];
      if (cardTabs.length === 1) return settings;
      const at = Math.min(this._open.tab ?? 0, cardTabs.length - 1);
      return html`<div class="tabs" role="tablist">
          ${cardTabs.map(
            ([label, icon], i) => html`<button
              role="tab"
              class="tab ${i === at ? "on" : ""}"
              aria-selected=${i === at ? "true" : "false"}
              @click=${() => this._tab(i)}
            >
              <ha-icon .icon=${icon}></ha-icon><span>${t(label)}</span>
            </button>`,
          )}
        </div>
        ${cardTabs[at][2]()}`;
    }
    // the credits close the tabs, as on a card
    // every card: what it is built on, and where to support the project
    tabs = [...tabs, { id: "credits", label: "Credits", icon: "mdi:heart-outline" }];
    const current = tabs[this._open.tab ?? 0] ?? tabs[0];
    // the large editor has its own device switch in its top bar
    const inStudio = !!this.closest("glass-studio") || (this.getRootNode() as ShadowRoot).host?.localName === "glass-studio";
    const pv = this.spec.previewSwitch && !inStudio
      ? html`<button class="add-card studio-open" @click=${() => this._openStudio()}>
            <ha-icon .icon=${"mdi:arrow-expand-all"}></ha-icon> ${t("Open the large editor")}
          </button>
          <div class="pv">
          <span>${t("Preview as")}</span>
          ${(
            [
              ["mobile", "Mobile", "mdi:cellphone"],
              ["tablet", "Tablet / desktop", "mdi:tablet"],
            ] as const
          ).map(
            ([m, l, i]) => html`<button
              class=${preview.mode === m ? "on" : ""}
              @click=${() => {
                setPreviewMode(m);
                this.requestUpdate();
              }}
            >
              <ha-icon .icon=${i}></ha-icon>${l}
            </button>`,
          )}
        </div>`
      : nothing;
    return html`${pv}
      <div class="tabs" role="tablist">
        ${tabs.map(
          (tab, i) => html`<button
            role="tab"
            class="tab ${tab === current ? "on" : ""}"
            aria-selected=${tab === current ? "true" : "false"}
            @click=${() => this._tab(i)}
          >
            <ha-icon .icon=${tab.icon}></ha-icon><span>${t(tab.label)}</span>
          </button>`,
        )}
      </div>
      ${current.dayNight ? this._dayNight() : nothing} ${(current.sections ?? []).filter((s) => !s.requires || customElements.get(s.requires) || s.keep?.(this._config ?? {})).map((s) => this._section(s))}
      ${form(typeof current.form === "function" ? current.form(this._config ?? {}) : (current.form ?? []))} ${current.glassGroups ? this._glassGroups() : nothing} ${current.layout ? this._layout() : nothing} ${current.popups ? this._popups() : nothing} ${current.id === "credits" ? this._credits() : nothing}
      ${current.tuning && this.spec.tuning ? this._tuning(this.spec.tuning) : nothing}
      ${(this.spec.lists ?? []).filter((l) => current.lists?.includes(l.name)).map((l) => this._list(l))}
      ${this.noCards ? nothing : (this.spec.cards ?? []).filter((l) => current.cards?.includes(l.name)).map((l) => this._cardList(l))}
    `;
  }

  /** The "Credits" tab: what the card wraps, needs and took its idea from, each with its author. */
  private _credits() {
    const link = (url: string, text: string) => html`<a href=${url} target="_blank" rel="noreferrer">${text}</a>`;
    return html`${CREDIT_KINDS.map(([kind, title]) => {
      const list = (this.spec.credits ?? []).filter((c) => c.kind === kind);
      return list.length
        ? html`<div class="list-title credits-title">${t(title)}</div>
            ${list.map(
              (c) => html`<div class="credit">
                <div>${link(c.url, c.name)} <span class="credit-by">${t("by")} ${link(c.author_url, c.author)}</span></div>
                ${c.note ? html`<div class="credit-note">${t(c.note)}</div>` : nothing}
              </div>`,
            )}`
        : nothing;
    })}
      ${(this.spec.credits ?? []).length ? nothing : html`<div class="credit-note">${t("This card is built on nothing but Home Assistant.")}</div>`}
      <div class="support">
        <span><b>${t("Like glass cards?")}</b><small>${t("A coffee keeps them growing.")}</small></span>
        <a href=${SUPPORT_URL} target="_blank" rel="noreferrer"><img src=${SUPPORT_BUTTON} alt="Buy Me a Coffee" /></a>
      </div>`;
  }

  static override styles = css`
    :host {
      display: block;
    }
    .credits-title {
      margin-top: 16px;
    }
    .support {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-top: 20px;
      padding: 12px 14px;
      border-radius: 12px;
      background: rgba(255, 221, 0, 0.16);
      color: var(--primary-text-color);
    }
    .support img {
      display: block;
      height: 40px;
    }
    .support span {
      display: flex;
      flex-direction: column;
      flex: 1;
    }
    .support small {
      color: var(--secondary-text-color);
    }
    .credits-title:first-child {
      margin-top: 0;
    }
    .credit {
      padding: 6px 0;
      font-size: 14px;
    }
    .credit a {
      color: var(--primary-color);
      text-decoration: none;
    }
    .credit-by,
    .credit-note {
      color: var(--secondary-text-color);
    }
    .credit-note {
      font-size: 13px;
      margin-top: 2px;
    }
    .list {
      margin-top: 20px;
    }
    .list-title {
      font-weight: 500;
      margin-bottom: 8px;
    }
    .menu-edit {
      margin-top: 12px;
      padding: 10px 12px;
      border-radius: 12px;
      background: var(--secondary-background-color, rgba(0, 0, 0, 0.04));
    }
    .menu-edit-head {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
      flex-wrap: wrap;
    }
    .menu-edit-head .grow {
      flex: 1;
    }
    .menu-labels {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 13px;
    }
    .pick-cond {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .pick-label {
      flex: none;
      font-size: 13px;
      color: var(--secondary-text-color);
    }
    .pick-cond input {
      flex: 1;
      min-width: 0;
      height: 32px;
      padding: 0 10px;
      border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
      border-radius: 8px;
      background: transparent;
      color: var(--primary-text-color);
      font: inherit;
    }
    .del-link {
      border: none;
      background: none;
      color: var(--error-color, #db4437);
      cursor: pointer;
      font: inherit;
      font-size: 13px;
    }
    .menu-make {
      display: flex;
      align-items: center;
      gap: 6px;
      --mdc-icon-size: 18px;
    }
    .bubble-notice {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      padding: 10px 12px;
      margin: 6px 0 10px;
      border-radius: 12px;
      background: rgba(255, 152, 0, 0.12);
      color: var(--primary-text-color);
      font-size: 13px;
      --mdc-icon-size: 20px;
    }
    .bare-notice ul {
      margin: 6px 0 8px;
      padding-left: 18px;
    }
    .bare-notice .look {
      flex: none;
      padding: 6px 12px;
      min-height: 0;
    }
    .bubble-notice ha-icon {
      color: var(--warning-color, #e65100);
      flex: none;
    }
    .bubble-notice a {
      color: var(--primary-color);
    }
    .settings-title {
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
    }
    .item {
      border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
      border-radius: 12px;
      margin-bottom: 8px;
      overflow: hidden;
    }
    .item-head {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px 8px 14px;
      cursor: pointer;
    }
    .item-head .grip {
      --mdc-icon-size: 18px;
      margin: 0 -6px 0 -8px;
      color: var(--secondary-text-color);
      cursor: grab;
    }
    .item.drop-before {
      box-shadow: 0 -3px 0 var(--primary-color);
    }
    .item.drop-after {
      box-shadow: 0 3px 0 var(--primary-color);
    }
    .list.drop-empty {
      outline: 2px dashed var(--primary-color);
      outline-offset: 4px;
      border-radius: 12px;
    }
    .item.menu-open {
      overflow: visible;
    }
    .more {
      position: relative;
    }
    .menu {
      position: absolute;
      right: 0;
      top: 100%;
      z-index: 5;
      display: flex;
      flex-direction: column;
      min-width: 200px;
      padding: 4px;
      border-radius: 10px;
      background: var(--mdc-theme-surface, var(--primary-background-color, #fff));
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.2);
    }
    .tools .menu button {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      color: var(--primary-text-color);
      text-align: start;
      white-space: nowrap;
    }
    .tools .menu button:hover {
      background: var(--secondary-background-color, rgba(0, 0, 0, 0.05));
    }
    .list-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 12px;
    }
    .list-actions ha-icon,
    .tools ha-icon {
      --mdc-icon-size: 18px;
    }
    .item.open .item-head {
      background: var(--secondary-background-color, rgba(0, 0, 0, 0.04));
    }
    .lang {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 4px;
      color: var(--secondary-text-color);
      margin-bottom: 4px;
    }
    .lang ha-icon {
      --mdc-icon-size: 16px;
    }
    .lang select {
      border: 0;
      background: none;
      color: var(--secondary-text-color);
      font: inherit;
      font-size: 13px;
      cursor: pointer;
    }
    .group {
      display: block;
      margin-top: 12px;
    }
    .tiles-group {
      font-size: 12px;
      color: var(--secondary-text-color);
      margin: 6px 0 -2px;
    }
    /* an Appearance group's content: room above and below, as a section's */
    .grp {
      display: grid;
      gap: 8px;
      padding: 4px 0 12px;
    }
    /* a section's content (custom: "section") */
    .sec {
      display: grid;
      gap: 8px;
      padding: 4px 12px 14px;
    }
    .sec > .list {
      margin-top: 4px;
    }
    .list.nested {
      margin-top: 12px;
    }
    .list.bare {
      margin-top: 4px;
    }
    .link {
      border: 0;
      background: none;
      color: var(--primary-color);
      font: inherit;
      font-size: 13px;
      cursor: pointer;
      padding: 4px 0 8px;
    }
    .tuning {
      display: block;
      margin-top: 20px;
    }
    .pv {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 12px;
      font-size: 13px;
      color: var(--secondary-text-color);
    }
    .pv button {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 5px 10px;
      border-radius: 16px;
      border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
      background: none;
      color: var(--primary-text-color);
      font: inherit;
      cursor: pointer;
    }
    .pv button ha-icon {
      --mdc-icon-size: 16px;
    }
    .pv button.on {
      border-color: var(--primary-color);
      color: var(--primary-color);
    }
    .tabs {
      display: flex;
      gap: 4px;
      margin-bottom: 18px;
      border-bottom: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
      overflow-x: auto;
    }
    .tab {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 12px;
      border: 0;
      border-bottom: 2px solid transparent;
      background: none;
      color: var(--secondary-text-color);
      font: inherit;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
    }
    .tab ha-icon {
      --mdc-icon-size: 18px;
    }
    .tab.on {
      color: var(--primary-color);
      border-bottom-color: var(--primary-color);
    }
    .src-row {
      margin-top: 8px;
    }
    .src-title {
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .src-toggle {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 14px 0 4px;
      font-size: 14px;
    }
    .presets {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
      gap: 8px;
      margin: 4px 0 14px;
    }
    .preset {
      display: flex;
      flex-direction: column;
      gap: 6px;
      align-items: stretch;
      padding: 8px;
      border-radius: 12px;
      border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
      background: none;
      color: var(--primary-text-color);
      font: inherit;
      font-size: 12px;
      cursor: pointer;
      text-align: center;
    }
    .preset.on {
      border-color: var(--primary-color);
      box-shadow: 0 0 0 1px var(--primary-color);
    }
    .mini {
      display: grid;
      gap: 3px;
      height: 48px;
    }
    .mini i {
      border-radius: 4px;
      background: color-mix(in srgb, var(--secondary-text-color) 22%, transparent);
      display: grid;
      place-items: center;
      color: var(--secondary-text-color);
    }
    .mini i ha-icon {
      --mdc-icon-size: 13px;
    }
    .mini i.main {
      background: color-mix(in srgb, var(--primary-color) 22%, transparent);
      color: var(--primary-color);
    }
    .wizard {
      display: grid;
      gap: 10px;
      margin: 4px 0 16px;
      padding: 12px;
      border-radius: 14px;
      border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
    }
    .wstep {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      font-weight: 500;
    }
    .wstep > b {
      width: 22px;
      height: 22px;
      display: grid;
      place-items: center;
      border-radius: 50%;
      background: var(--primary-color);
      color: var(--text-primary-color, #fff);
      font-size: 12px;
    }
    .wstep > span:not(.grow):not(.stepper) {
      flex: 1 1 200px;
      min-width: 0;
    }
    .wstep .grow {
      flex: 1;
    }
    .gstart {
      padding: 5px 8px;
      border-radius: 8px;
      border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
      background: var(--card-background-color, transparent);
      color: var(--primary-text-color);
      font: inherit;
      font-size: 13px;
    }
    .stepper {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-weight: 400;
    }
    .stepper button {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
      background: none;
      color: var(--primary-text-color);
      cursor: pointer;
      font: inherit;
    }
    .stepper button:disabled {
      opacity: 0.35;
      cursor: default;
    }
    .palette {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .palette .chip {
      padding: 5px 12px;
      border-radius: 999px;
      border: 1px solid hsl(var(--hue, 0) 45% 55% / 0.6);
      background: hsl(var(--hue, 0) 60% 60% / 0.16);
      color: var(--primary-text-color);
      cursor: pointer;
      font: inherit;
      font-size: 13px;
    }
    .palette .chip.empty {
      border-style: dashed;
      background: none;
      border-color: var(--divider-color, rgba(0, 0, 0, 0.3));
    }
    .palette .chip.on {
      outline: 2px solid var(--primary-color);
      outline-offset: 1px;
      font-weight: 600;
    }
    .new-area input {
      width: 120px;
      padding: 5px 10px;
      border-radius: 999px;
      border: 1px dashed var(--divider-color, rgba(0, 0, 0, 0.3));
      background: none;
      color: var(--primary-text-color);
      font: inherit;
      font-size: 13px;
    }
    .gpaint {
      display: grid;
      gap: 0;
      border-radius: 10px;
      overflow: hidden;
      border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.15));
      user-select: none;
      touch-action: none;
    }
    .gcell {
      min-height: 46px;
      display: flex;
      align-items: flex-start;
      padding: 5px 7px;
      background: hsl(var(--hue, 0) 60% 60% / 0.22);
      box-shadow: inset 0 0 0 0.5px rgba(127, 127, 127, 0.25);
      cursor: crosshair;
      font-size: 12px;
      font-weight: 500;
    }
    .gcell.empty {
      background: repeating-linear-gradient(45deg, transparent 0 6px, rgba(127, 127, 127, 0.12) 6px 12px);
      color: var(--secondary-text-color);
      font-weight: 400;
    }
    .gwarn {
      color: var(--error-color, #db4437);
      font-size: 13px;
    }
    .gsizes {
      display: grid;
      gap: 6px;
    }
    .gsizes.rows {
      grid-template-columns: auto minmax(0, 1fr);
      align-items: center;
    }
    .gsize {
      display: flex;
      gap: 4px;
      min-width: 0;
    }
    .gsize select,
    .gsize input {
      min-width: 0;
      flex: 1;
      padding: 6px 8px;
      border-radius: 8px;
      border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
      background: var(--card-background-color, transparent);
      color: var(--primary-text-color);
      font: inherit;
      font-size: 13px;
    }
    .gsize input {
      max-width: 80px;
    }
    .grow-row {
      font-size: 13px;
      color: var(--secondary-text-color);
    }
    .custom-grid code {
      font-size: 11.5px;
    }
    .group-title {
      font-size: 13px;
      font-weight: 600;
      margin: 14px 0 4px;
      color: var(--primary-text-color);
    }
    .group-title small {
      font-weight: 500;
      color: var(--secondary-text-color);
      margin-left: 4px;
    }
    .picker {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 8px;
      margin-top: 8px;
    }
    /* needs another card installed first: shown, not clickable */
    .pick:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .pick:disabled small {
      color: var(--warning-color, #e65100);
    }
    .pick {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      text-align: left;
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
      background: var(--card-background-color, transparent);
      color: var(--primary-text-color);
      font: inherit;
      cursor: pointer;
    }
    .pick:hover {
      border-color: var(--primary-color);
    }
    .pick span {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .pick small {
      color: var(--secondary-text-color);
      font-size: 12px;
    }
    .pick.other {
      justify-content: center;
      align-items: center;
    }
    .daynight .look {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      --mdc-icon-size: 18px;
    }
    .look-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 14px;
    }
    .look {
      flex: 1;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid var(--divider-color);
      background: none;
      color: var(--primary-text-color);
      font: inherit;
      cursor: pointer;
    }
    .look:disabled {
      cursor: default;
      opacity: 0.6;
    }
    .look.on:disabled {
      opacity: 1;
    }
    .look.on {
      border-color: var(--primary-color);
      background: color-mix(in srgb, var(--primary-color) 12%, transparent);
      font-weight: 600;
    }
    .list-hint {
      font-size: 12.5px;
      color: var(--secondary-text-color);
      margin: -4px 0 10px;
      line-height: 1.4;
    }
    .item-text {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }
    .item-sub {
      font-size: 12px;
      color: var(--secondary-text-color);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .badge {
      font-size: 11px;
      font-weight: 500;
      padding: 2px 8px;
      border-radius: 10px;
      background: var(--secondary-background-color, rgba(0, 0, 0, 0.06));
      color: var(--secondary-text-color);
      flex: none;
    }
    .item-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .item-body {
      padding: 12px 14px 14px;
    }
    /* two rows, each under its own title: the devices (shown, order), the view it picks */
    .devices {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      align-items: end;
      gap: 8px 12px;
      margin-bottom: 12px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
    }
    .visibility {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 12px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
    }
    .vis-hint {
      font-size: 12px;
      color: var(--secondary-text-color);
    }
    .devices-title {
      grid-column: 1 / -1;
      font-weight: 500;
      color: var(--secondary-text-color);
    }
    .devices-title:not(:first-child) {
      margin-top: 6px;
    }
    .device {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
    }
    .device-on {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      white-space: nowrap;
      cursor: pointer;
    }
    .device-order {
      width: 100%;
      box-sizing: border-box;
      padding: 6px 8px;
      border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
      border-radius: 8px;
      background: var(--card-background-color, transparent);
      color: var(--primary-text-color);
      font: inherit;
    }
    .device-order:disabled {
      opacity: 0.4;
    }
    .tools button,
    .add {
      border: none;
      background: none;
      color: var(--primary-color);
      cursor: pointer;
      font: inherit;
      padding: 4px 6px;
      border-radius: 6px;
    }
    .tools button:disabled {
      opacity: 0.3;
      cursor: default;
    }
    .tools .del {
      color: var(--error-color, #db4437);
    }
    .add {
      padding: 8px 4px;
      font-weight: 500;
    }
    .tune {
      display: grid;
      grid-template-columns: minmax(120px, 1fr) 2fr 44px 24px;
      align-items: center;
      gap: 8px;
      padding: 2px 0;
      font-size: 13px;
    }
    .tune input {
      width: 100%;
      accent-color: var(--primary-color);
    }
    .tune-value {
      text-align: right;
      font-variant-numeric: tabular-nums;
      color: var(--secondary-text-color);
    }
    .tune.changed .tune-value {
      color: var(--primary-color);
      font-weight: 600;
    }
    .tune-reset {
      border: none;
      background: none;
      color: var(--secondary-text-color);
      cursor: pointer;
      font: inherit;
      padding: 0;
    }
    .studio-open {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      justify-content: center;
      margin: 0 0 12px;
      cursor: pointer;
    }
    .add-card {
      margin-top: 4px;
      padding: 8px 10px;
      border-radius: 8px;
      border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
      background: var(--card-background-color, transparent);
      color: var(--primary-color);
      font: inherit;
      font-weight: 500;
    }
  `;
}

export function move<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

/** Drops keys that only carry the default and weren't set by the user before. */
function withoutDefaults(next: Record<string, any>, prev: Record<string, any>, defaults?: Record<string, any>) {
  if (!defaults) return next;
  const out = { ...next };
  const same = (a: unknown, b: unknown) => a === b || (typeof a === "object" && JSON.stringify(a) === JSON.stringify(b));
  for (const [k, v] of Object.entries(defaults)) if (same(out[k], v) && prev[k] === undefined) delete out[k];
  return out;
}

function stripEmpty(o: Record<string, any>) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "" && v !== null));
}

if (!customElements.get("glass-card-editor")) customElements.define("glass-card-editor", GlassCardEditor);

/** Returns an editor element for a card class. */
export function makeEditor(spec: EditorSpec): HTMLElement {
  const el = document.createElement("glass-card-editor") as GlassCardEditor;
  el.spec = spec;
  return el;
}

// ── shared schema pieces ────────────────────────────────────────────────

const opt = (value: string, label: string) => ({ value, label });

/** Look presets → `look:` (core/settings LOOKS). */
const LOOK_BUTTONS: [string, Look][] = [
  ["Liquid glass", "liquid"],
  ["Apple Home", "apple-home"],
  ["Frosted glass", "frosted"],
  ["Light glass", "light"],
  ["Solid", "solid"],
];

/** Picks a look: drops the level overrides and the panels' own glass so the look
 *  applies everywhere – except panels deliberately without glass (`glass: none`). */
const LEVELS = ["glass", "tile_glass", "control_glass"] as const;
const PANEL_KEYS = ["glass", "tile_glass", "control_glass"] as const;

/** Every panel list of the dashboard (areas of each responsive mode included), keyed by path. */
function panelLists(c: Record<string, any>): [string, Record<string, any>[]][] {
  const out: [string, Record<string, any>[]][] = [];
  const walk = (o: Record<string, any> | undefined, prefix: string) => {
    if (!o) return;
    for (const k of ["header", "top", "left", "main"]) if (Array.isArray(o[k])) out.push([`${prefix}${k}`, o[k]]);
    for (const [k, list] of Object.entries(o.areas ?? {})) if (Array.isArray(list)) out.push([`${prefix}areas.${k}`, list as Record<string, any>[]]);
  };
  walk(c, "");
  for (const [m, o] of Object.entries(c.responsive ?? {})) walk(o as Record<string, any>, `${m}:`);
  return out;
}

/** The hand-made part of the current setup: the look plus every level / panel override. */
function snapshot(c: Record<string, any>): Record<string, any> {
  const levels: Record<string, any> = {};
  for (const k of LEVELS) if (c[k] !== undefined) levels[k] = c[k];
  const panels: Record<string, Record<string, any>> = {};
  for (const [path, list] of panelLists(c))
    list.forEach((card, i) => {
      if (!card || typeof card !== "object") return;
      const own: Record<string, any> = {};
      for (const k of PANEL_KEYS) if (card[k] !== undefined) own[k] = card[k];
      if (Object.keys(own).length) panels[`${path}[${i}]`] = own;
    });
  return { look: c.look, ...levels, panels };
}

/** Picks a look: drops the level overrides and the panels' own glass so the look
 *  applies everywhere – except panels deliberately without glass (`glass: none`).
 *  A custom setup is remembered in `custom_look`, so "Custom" brings it back. */
function applyLook(c: Record<string, any>, look: Look, wasCustom: boolean): Record<string, any> {
  const next: Record<string, any> = structuredClone(c);
  if (wasCustom) next.custom_look = snapshot(c);
  if (look === "liquid") delete next.look;
  else next.look = look;
  for (const k of LEVELS) delete next[k];
  for (const [, list] of panelLists(next))
    for (const card of list) {
      if (!card || typeof card !== "object") continue;
      if (card.glass !== "none") delete card.glass;
      delete card.tile_glass;
      delete card.control_glass;
    }
  return next;
}

/** The top-level panels set to "No glass" take the look's glass again. */
function unbare(c: Record<string, any>): Record<string, any> {
  const next: Record<string, any> = structuredClone(c);
  for (const [, list] of panelLists(next)) for (const card of list) if (card?.glass === "none") delete card.glass;
  return next;
}

/** Restores the remembered custom setup. */
function restoreCustom(c: Record<string, any>): Record<string, any> {
  const snap = c.custom_look as Record<string, any> | undefined;
  if (!snap) return c;
  const next: Record<string, any> = structuredClone(c);
  if (snap.look) next.look = snap.look;
  else delete next.look;
  for (const k of LEVELS) {
    if (snap[k] !== undefined) next[k] = snap[k];
    else delete next[k];
  }
  for (const [path, list] of panelLists(next))
    list.forEach((card, i) => {
      if (!card || typeof card !== "object") return;
      const own = snap.panels?.[`${path}[${i}]`] as Record<string, any> | undefined;
      for (const k of PANEL_KEYS) {
        if (own?.[k] !== undefined) card[k] = own[k];
        else if (!(k === "glass" && card.glass === "none")) delete card[k];
      }
    });
  return next;
}

export const GLASS_FIELD: Schema = {
  name: "glass",
  selector: {
    select: {
      mode: "dropdown",
      options: [opt("", "Automatic – from the panel / dashboard"), opt("liquid", "Liquid glass"), opt("frosted", "Frosted glass"), opt("light", "Light glass (no live blur)"), opt("flat", "No blur"), opt("solid", "Solid (fastest)"), opt("none", "None (no glass)"), opt("home", "Home (Apple Home look)")],
    },
  },
};

/** Same choices as GLASS_FIELD, for the cards inside a panel. */
export const TILE_GLASS_FIELD: Schema = { ...GLASS_FIELD, name: "tile_glass" };
export const CONTROL_GLASS_FIELD: Schema = { ...GLASS_FIELD, name: "control_glass" };

/** `fonts:` editor – one collapsible group per text part (nested object fonts.<part>.*). */
/** The text of one part of a card: colour, size and weight – with `active`, the same for its
 *  active / picked state (`fonts.<part>_on`, see core/typography). Put it in the part's group. */
export function TEXT_FIELD(part: string, title: string, active = false, size = true): Schema {
  const row = (name: string, on: boolean): Schema => ({
    type: "grid",
    name,
    schema: [
      { ...COLOR_FIELD("color"), label: on ? "Active colour" : "Colour" },
      ...(size ? [{ name: "size", label: on ? "Active size" : "Size", selector: { number: { min: 6, max: 120, mode: "box", unit_of_measurement: "px" } } }] : []),
      { name: "weight", label: on ? "Active weight" : "Weight", selector: { select: { mode: "dropdown", options: WEIGHTS.map(([v, l]) => opt(v, l)) } } },
    ],
  });
  return { type: "expandable", name: "fonts", title, schema: [row(part, false), ...(active ? [row(`${part}_on`, true)] : [])] } as Schema;
}

/** A card's text and icon parts (core/parts) → their fields, each in its part's Appearance group. */
export function PARTS_LOOK(parts: PartDef[]): Schema[] {
  return parts.map((p) => ({ ...(p.kind === "icon" ? ICON_FIELD(p.key, p.title, !!p.on) : TEXT_FIELD(p.key, p.title, !!p.on, p.size !== false)), group: p.group }));
}

/** The icons of one part: colour and size – with `active`, also for its active state (`icons.<part>_on`). */
export function ICON_FIELD(part: string, title: string, active = false): Schema {
  const row = (name: string, on: boolean): Schema => ({
    type: "grid",
    name,
    schema: [
      { ...COLOR_FIELD("color"), label: on ? "Active colour" : "Colour" },
      { name: "size", label: on ? "Active size" : "Size", selector: { number: { min: 8, max: 96, mode: "box", unit_of_measurement: "px" } } },
    ],
  });
  return { type: "expandable", name: "icons", title, schema: [row(part, false), ...(active ? [row(`${part}_on`, true)] : [])] } as Schema;
}

const WEIGHTS: [string, string][] = [
  ["100", "100 – Thin"],
  ["200", "200 – Extra light"],
  ["300", "300 – Light"],
  ["400", "400 – Regular"],
  ["500", "500 – Medium"],
  ["600", "600 – Semibold"],
  ["700", "700 – Bold"],
  ["800", "800 – Extra bold"],
  ["900", "900 – Black"],
];

/** Color tint of a glass level: RGB picker + strength (nested object <name>.color / .strength). */
export const TINT_FIELD = (name: string, title: string): Schema => ({
  type: "expandable",
  name,
  title,
  schema: [
    {
      type: "grid",
      name: "",
      schema: [
        { name: "color", selector: { color_rgb: {} } },
        { name: "strength", selector: { number: { min: 0, max: 100, step: 5, mode: "slider", unit_of_measurement: "%" } } },
      ],
    },
  ],
});

export const COLOR_FIELD = (name = "color"): Schema => ({ name, selector: { ui_color: { include_none: true } } });

export const ANIMATION_FIELD: Schema = {
  name: "animation",
  selector: {
    select: {
      mode: "dropdown",
      options: [
        opt("none", "None"),
        opt("pulse", "Pulse"),
        opt("glow", "Glow"),
        opt("blink", "Blink"),
        opt("breathe", "Breathe"),
        opt("bounce", "Bounce"),
        opt("shake", "Shake"),
        opt("ping", "Ping"),
        opt("spin", "Spinning icon"),
        opt("flicker", "Flickering icon"),
      ],
    },
  },
};

export const YAML = (name: string): Schema => ({ name, selector: { object: {} } });

/** tap/hold/double actions; `menu` (our own action) is edited as YAML. */
export function actionFields(item: Record<string, any>, kinds = ["tap_action", "hold_action", "double_tap_action"]): Schema[] {
  // a radial menu has its own editor under the form (see _menu)
  return kinds.filter((k) => item?.[k]?.action !== "menu").map((k) => ({ name: k, selector: { ui_action: {} } }));
}

export const grid = (...schema: Schema[]): Schema => ({ type: "grid", name: "", schema });
export const expandable = (title: string, schema: Schema[]): Schema => ({ type: "expandable", name: "", flatten: true, title, schema });
export const select = (name: string, options: [string, string][]): Schema => ({
  name,
  selector: { select: { mode: "dropdown", options: options.map(([v, l]) => opt(v, l)) } },
});
