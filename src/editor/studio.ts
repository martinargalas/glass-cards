import { LitElement, css, html, nothing } from "lit";
import { keyed } from "lit/directives/keyed.js";
import type { HomeAssistant } from "../core/types";
import { buildChildren, cardSource, configForMode, forward, type ChildEl } from "../core/container";
import { PRESETS, areaOrder, overlayCards, parseAreas, popupOf, trackList, type OverlaySource, type Preset } from "../core/layout";
import { preview, previewSize, setPreviewMode } from "../core/settings";
import { LiquidController } from "../core/liquid";
import { addStarterDashboard } from "./starter";
import { addDemoDashboard, backup, dropBackup, findGlass, lastBackup, listDashboards, loadConfig, putAt, saveConfig, type DashInfo } from "./store";
import { AREA_TITLES, DEVICE_MODES, MODE_NAMES, NEW_CARDS, SUPPORT_BUTTON, SUPPORT_URL, bubbleNotice, hasBubble, missingFor,
  foreignNotice, describeCard, getClip, makeEditor, move, orderOn, setClip, shownOn, stubFor, withOrder, withShown } from "./editor";
import { dashboardSpec } from "./specs";
import { editorLangPref, setEditorLang, t } from "./i18n";
import { LANGS, syncLang } from "../i18n";

/**
 * Dashboard Studio: the dashboard editor on the whole screen, laid out like Home
 * Assistant's automation editor – the structure on the left (areas → panels →
 * cards, drag to move anything anywhere), a live preview in the middle (click a
 * card to pick it) and the picked item's settings on the right.
 *
 * It edits a copy of the dashboard card's config and hands every change back to
 * the card editor it was opened from; saving stays HA's own Save button.
 */

type Cfg = Record<string, any>;
/** Keys from the dashboard config down to a node: ["main", 0, "cards", 2]. */
type Path = (string | number)[];
type DashEl = HTMLElement & { setConfig(c: Cfg): void; hass?: HomeAssistant; preview?: boolean };
type EditorEl = HTMLElement & { setConfig(c: Cfg): void; hass?: HomeAssistant; lovelace?: unknown };

const BASE_AREAS = ["header", "top", "left", "main", "right"];

const get = (o: any, p: Path) => p.reduce((x, k) => (x == null ? undefined : x[k]), o);
const same = (a: Path, b: Path) => a.length === b.length && a.every((k, i) => k === b[i]);
const within = (p: Path, root: Path) => p.length >= root.length && root.every((k, i) => p[i] === k);

/** A card's children: `cards: [...]` (panels, stacks, grids) or `card: {...}` (conditional). */
function kids(c: Cfg): { key: string; list: Cfg[] } | undefined {
  if (Array.isArray(c?.cards)) return { key: "cards", list: c.cards };
  return undefined;
}

/** Devices the preview can show, in CSS px (landscape for tablets / computers). */
const DEVICES: { name: string; w: number; h: number }[] = [
  { name: "Phone – small (iPhone SE)", w: 375, h: 667 },
  { name: "Phone (Galaxy S24)", w: 360, h: 780 },
  { name: "Phone (iPhone 16)", w: 393, h: 852 },
  { name: "Phone (Pixel 8)", w: 412, h: 915 },
  { name: "Phone – large (iPhone 16 Pro Max)", w: 440, h: 956 },
  { name: "Galaxy Tab A8", w: 1280, h: 800 },
  { name: "Nest Hub Max", w: 1280, h: 800 },
  { name: "iPad mini", w: 1133, h: 744 },
  { name: "iPad", w: 1180, h: 820 },
  { name: "iPad Pro 13\"", w: 1376, h: 1032 },
  { name: "Laptop", w: 1440, h: 900 },
  { name: "Computer (Full HD)", w: 1920, h: 1080 },
];
const SIZE_KEY = "glass-studio-size";
/** Widths of the structure / settings panels, as the user dragged them. */
const PANES_KEY = "glass-studio-panes";
/** The preview's scale as picked (none = fit the width). */
const ZOOM_KEY = "glass-studio-zoom";
/** Whether the card's Placement box is open, remembered per browser. */
const PLACE_KEY = "glass-studio-placement";
/** Standalone: the dashboard edited last. */
const LAST_KEY = "glass-studio-dashboard";
const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 2];
const PANE_DEFAULT = { tree: 280, insp: 420, yaml: 640 };
const PANE_MIN = { tree: 180, insp: 280, yaml: 360 };

/** The size of the screen the dashboard is shown on here: this window, less HA's top bar. */
const WINDOW = "This window";
function windowSize(): { w: number; h: number } {
  const bar = parseFloat(getComputedStyle(document.querySelector("home-assistant") ?? document.documentElement).getPropertyValue("--header-height")) || 56;
  return { w: window.innerWidth, h: window.innerHeight - bar };
}

/**
 * The size last picked per mode, remembered per browser. "This window" follows the window; a
 * tablet / computer never picked is this window, so the preview shows what saving will show.
 */
function savedSizes(): Partial<Record<"mobile" | "tablet", { w: number; h: number; name?: string }>> {
  let saved: Partial<Record<"mobile" | "tablet", { w: number; h: number; name?: string }>> = {};
  try {
    saved = JSON.parse(localStorage.getItem(SIZE_KEY) ?? "{}");
  } catch {
    /* private mode */
  }
  const win = windowSize();
  for (const m of ["mobile", "tablet"] as const) if (saved[m]?.name === WINDOW) saved[m] = { ...win, name: WINDOW };
  if (!saved.tablet && win.w >= 700) saved.tablet = { ...win, name: WINDOW };
  return saved;
}

export class GlassStudio extends LitElement {
  static override properties = {
    _config: { state: true },
    _sel: { state: true },
    _hover: { state: true },
    _drop: { state: true },
    _picker: { state: true },
    _pdrag: { state: true },
    _target: { state: true },
    _fast: { state: true },
    _pvZoom: { state: true },
    _pvBg: { state: true },
    _pvDark: { state: true },
    _tdrag: { state: true },
    _plus: { state: true },
    _yaml: { state: true },
    _confirmCancel: { state: true },
    _q: { state: true },
    _impDash: { state: true },
    _impCards: { state: true },
    _wire: { state: true },
    _srcPops: { state: true },
    _host: { state: true },
    _dashList: { state: true },
    _notice: { state: true },
    _busy: { state: true },
    _resizing: { state: true },
    _popOpen: { state: true },
    _popTop: { state: true },
    _newPop: { state: true },
    _wdrag: { state: true },
    _guiAvail: { state: true },
    _del: { state: true },
    _addAt: { state: true },
    _hideTree: { state: true },
    _collapsed: { state: true },
    _selBox: { state: true },
    _menu: { state: true },
    _hideInspector: { state: true },
    _wide: { state: true },
    _yamlErr: { state: true },
  };
  /** Widths of the side panels in px (dragged on their edges); `yaml` is the wide YAML editor's. */
  private _panes: { tree: number; insp: number; yaml: number };
  /** The wide YAML editor in place of the settings: what it shows (undefined = off). */
  declare _wide?: "card" | "panel" | "dashboard";
  /** Its text doesn't parse: not applied. */
  declare _yamlErr?: boolean;
  /** What the YAML editor was last filled with or applied (JSON): a different config there is a change from elsewhere. */
  private _yamlShown?: string;
  private _yamlRev = 0;
  private _yamlTimer?: number;
  /** The scale the preview is drawn at now (1 = the device's real size). */
  declare _pvZoom: number;
  /** The scale picked for the preview; undefined = fit the width. */
  private _zoomPick?: number;
  /** Performance: the preview without blur (glass is the slowest part to draw). */
  declare _fast: boolean;
  /** The wallpaper behind the preview. */
  declare _pvBg: boolean;
  /** Preview by day / by night; undefined = as the appearance setting says. */
  declare _pvDark?: boolean;
  declare _hideTree: boolean;
  /** Tree branches rolled up (areas, panels, overlay groups), remembered per browser. */
  declare _collapsed: Set<string>;
  declare _hideInspector: boolean;
  declare _config: Cfg;
  declare _sel: Path;
  declare _hover?: { x: number; y: number; w: number; h: number };
  declare _drop?: { list: Path; i: number; into?: boolean };
  declare _picker?: Path;
  private _hass?: HomeAssistant;
  lovelace?: unknown;
  private _shown?: Cfg;
  private _shownKey?: string;
  /** every change goes back to the card editor */
  onChange?: (c: Cfg) => void;
  onClose?: () => void;
  /** HA's card dialog the studio was opened from: Save / Cancel act on it */
  haDialog?: HTMLElement & Record<string, any>;
  /** Opened on its own (not from HA's card dialog): picks a dashboard and saves straight to HA. */
  standalone = false;
  /** The note at the bottom (opened from a card editor); "" hides it – the web demo saves nothing. */
  footer?: string;
  /** Standalone: the dashboard being edited and where its glass-dashboard card sits. */
  declare _host?: {
    url: string | null;
    mode: "storage" | "yaml";
    /** the dashboard's config as loaded / last saved, and its JSON */
    full: Cfg;
    base: string;
    path: Path;
    /** the card's JSON as loaded – changed when the edited config differs */
    card: string;
    /** no glass-dashboard yet: saving adds a view "Glass" with one */
    newView: boolean;
    hits: { path: Path; label: string }[];
    which: number;
  };
  declare _dashList?: DashInfo[];
  /** A message over the preview: saved, a conflict, an error. */
  declare _notice?: { text: string; kind: "ok" | "warn" | "error" };
  declare _busy: boolean;
  /**
   * Pop-up dashboards opened for editing live in the config under `__sources` (by url_path),
   * so the tree, the inspector, drag and undo work on them as on the rest. This is their
   * stored config as loaded: what changed is saved there, and only if nobody saved meanwhile.
   */
  private _srcBase: Record<string, string> = {};

  private _past: Cfg[] = [];
  private _future: Cfg[] = [];
  private _dash?: DashEl;
  private _dashEditor?: EditorEl;

  constructor() {
    super();
    this._config = {};
    this._sel = [];
    try {
      this._collapsed = new Set(JSON.parse(localStorage.getItem("glass-studio-collapsed") ?? "[]"));
    } catch {
      this._collapsed = new Set();
    }
    this._fast = localStorage.getItem("glass-studio-fast") !== "0";
    this._pvBg = localStorage.getItem("glass-studio-bg") !== "0";
    this._hideTree = false;
    this._hideInspector = false;
    try {
      this._panes = { ...PANE_DEFAULT, ...JSON.parse(localStorage.getItem(PANES_KEY) ?? "{}") };
    } catch {
      this._panes = { ...PANE_DEFAULT };
    }
    this._pvZoom = 1;
    try {
      const z = Number(localStorage.getItem(ZOOM_KEY));
      this._zoomPick = ZOOMS.includes(z) ? z : undefined;
    } catch {
      /* private mode */
    }
    this._yaml = false;
    this._guiAvail = true;
    this._confirmCancel = false;
    try {
      this._wire = localStorage.getItem("glass-studio-wire") === "1";
    } catch {
      this._wire = false;
    }
  }

  protected override willUpdate(changed: Map<string, unknown>) {
    // another card: its editor starts in visual mode again
    if (changed.has("_sel")) {
      this._yaml = false;
      this._guiAvail = true;
    }
  }

  set config(c: Cfg) {
    this._config = c;
  }

  /** New states go straight to the preview and the open editor (no re-render of the studio). */
  set hass(h: HomeAssistant | undefined) {
    const first = !this._hass;
    syncLang(h);
    this._hass = h;
    if (this._dash) this._dash.hass = h;
    if (h && this._popEls.length) forward(this._popEls, h);
    if (this._dashEditor) this._dashEditor.hass = h;
    this.renderRoot?.querySelectorAll?.("hui-card-element-editor").forEach((e) => ((e as any).hass = h));
    if (first) this.requestUpdate();
  }
  get hass() {
    return this._hass;
  }

  /* ── state ─────────────────────────────────────────────────────────────── */

  private _set(next: Cfg, keepHistory = true) {
    if (keepHistory) {
      this._past = [...this._past.slice(-49), this._config];
      this._future = [];
    }
    this._config = next;
    // HA's dialog behind this window re-renders its own (hidden) preview on every
    // change: hand it the result once the edits pause
    clearTimeout(this._emitTimer);
    this._emitTimer = window.setTimeout(() => this.flush(), 600);
  }

  private _emitTimer?: number;
  /** Hands the pending change to the card editor now (e.g. on close). */
  flush() {
    clearTimeout(this._emitTimer);
    this._emitTimer = undefined;
    if (this._sent !== this._main()) {
      this._sent = this._main();
      this.onChange?.(this._main());
    }
  }
  private _sent?: Cfg;

  private _undo() {
    const prev = this._past.pop();
    if (!prev) return;
    this._future.push(this._config);
    this._set(prev, false);
    this.requestUpdate();
  }

  private _redo() {
    const next = this._future.pop();
    if (!next) return;
    this._past.push(this._config);
    this._set(next, false);
    this.requestUpdate();
  }

  /** Copy of the config with the node at `path` replaced (undefined removes a list item / key). */
  /**
   * A copy of the config to change: the dashboard's own part in full; of the pop-up
   * dashboards (large) only the parts at `touch` – the rest stays shared with the history.
   */
  private _draft(...touch: Path[]): Cfg {
    const { __sources, ...main } = this._config;
    const root = structuredClone(main) as Cfg;
    if (!__sources) return root;
    root.__sources = __sources;
    for (const p of touch) {
      if (p[0] !== "__sources") continue;
      let o: any = root;
      for (let i = 0; i < p.length; i++) {
        const v = o?.[p[i]];
        if (!v || typeof v !== "object") break;
        o[p[i]] = i === p.length - 1 ? structuredClone(v) : Array.isArray(v) ? [...v] : { ...v };
        o = o[p[i]];
      }
    }
    return root;
  }

  /** The dashboard card's own config (what HA, the preview and the settings get). */
  private _mainOf?: { from: Cfg; main: Cfg };
  private _main(): Cfg {
    if (this._mainOf?.from !== this._config) {
      const { __sources: _, ...main } = this._config;
      this._mainOf = { from: this._config, main: this._config.__sources ? main : this._config };
    }
    return this._mainOf.main;
  }

  private _with(path: Path, value: Cfg | undefined): Cfg {
    const root = this._draft(path.slice(0, -1));
    const parent = get(root, path.slice(0, -1));
    const k = path[path.length - 1];
    if (Array.isArray(parent) && typeof k === "number") {
      if (value === undefined) parent.splice(k, 1);
      else parent[k] = value;
    } else if (parent) {
      if (value === undefined) delete parent[k];
      else parent[k] = value;
    }
    return root;
  }

  /** The areas shown for the device being previewed: its own (responsive) list if it has one. */
  private _areas(): { name: string; path: Path; own: boolean }[] {
    const c = this._config;
    const mode = preview.mode;
    const over = c.responsive?.[mode] ?? {};
    // the areas a custom grid names, even before they hold cards
    const gridNames = areaOrder(parseAreas((over.grid ?? c.grid)?.areas)).filter((n) => n !== "." && !BASE_AREAS.includes(n) && !(n in (c.areas ?? {})));
    const names = [...BASE_AREAS, ...Object.keys(c.areas ?? {}).map((k) => `areas.${k}`), ...gridNames.map((n) => `areas.${n}`), "overlay"];
    const out: { name: string; path: Path; own: boolean }[] = [];
    for (const n of names) {
      const base: Path = n.startsWith("areas.") ? ["areas", n.slice(6)] : [n];
      const ownList = n.startsWith("areas.") ? over.areas?.[n.slice(6)] : over[n];
      if (ownList === null) continue; // switched off on this device
      if (Array.isArray(ownList)) out.push({ name: n, path: ["responsive", mode, ...base], own: true });
      // the overlay and a custom grid's areas are listed even when empty: new cards go there
      else if (Array.isArray(get(c, base)) || n === "overlay" || (n.startsWith("areas.") && gridNames.includes(n.slice(6))) || (BASE_AREAS.includes(n) && areaOrder(parseAreas((over.grid ?? c.grid)?.areas)).includes(n)))
        out.push({ name: n, path: base, own: false });
    }
    return out;
  }

  /** Every node of the shown tree by object and by content, built once per config. */
  private _index?: { cfg: Cfg; mode: string; byObj: Map<Cfg, Path>; byJson: Map<string, Path> };
  private _json = new WeakMap<Cfg, string>();
  private _jsonOf(c: Cfg) {
    let j = this._json.get(c);
    if (j === undefined) this._json.set(c, (j = JSON.stringify(c)));
    return j;
  }

  /** Where a config object sits (same object, else the first equal one). */
  private _find(target: Cfg): Path | undefined {
    let ix = this._index;
    if (!ix || ix.cfg !== this._config || ix.mode !== preview.mode) {
      ix = { cfg: this._config, mode: preview.mode, byObj: new Map(), byJson: new Map() };
      const visit = (c: Cfg, p: Path) => {
        ix!.byObj.set(c, p);
        const j = this._jsonOf(c);
        if (!ix!.byJson.has(j)) ix!.byJson.set(j, p);
        const k = kids(c);
        if (k) walk(k.list, [...p, k.key]);
      };
      const walk = (list: Cfg[], path: Path) => list.forEach((c, i) => visit(c, [...path, i]));
      for (const a of this._areas()) walk((get(this._config, a.path) ?? []) as Cfg[], a.path);
      // pop-ups of the pop-up dashboards opened for editing (only them: the rest is large)
      for (const l of this._srcLists())
        l.list.forEach((c, i) => {
          if (popupOf(c)) visit(c, [...l.path, i]);
        });
      this._index = ix;
    }
    return ix.byObj.get(target) ?? ix.byJson.get(this._jsonOf(target));
  }

  /* ── moving ────────────────────────────────────────────────────────────── */

  /**
   * A drop from the preview: next to `anchor`, or around it in a new row / column
   * (both cards wrapped in a panel of their own), keeping per-device order right.
   */
  private _dropAt(from: Path, tg: NonNullable<GlassStudio["_target"]>) {
    if (tg.group) return this._group(from, tg.group.anchor, tg.group.layout, tg.group.after);
    this._move(from, tg.list, tg.i);
    if (tg.anchor) this._reorder(tg.list, tg.anchor, tg.after!);
  }

  /** Wraps the card at `anchor` and the dragged one into a new row / column panel. */
  private _group(from: Path, anchor: Path, layout: "row" | "column", after: boolean) {
    if (within(anchor, from) || same(anchor, from)) return;
    const root = this._draft(from.slice(0, -1), anchor.slice(0, -1));
    const dragged = get(root, from) as Cfg;
    const target = get(root, anchor) as Cfg;
    // the two cards share the target's place; the group takes over its placement
    const { view_layout, ...rest } = target;
    const group: Cfg = {
      type: "custom:glass-panel",
      layout,
      gap: 14,
      padding: 0,
      transparent: true,
      ...(view_layout ? { view_layout } : {}),
      cards: after ? [rest, dragged] : [dragged, rest],
    };
    const list = get(root, anchor.slice(0, -1)) as Cfg[];
    list[anchor[anchor.length - 1] as number] = group;
    const src = get(root, from.slice(0, -1)) as Cfg[];
    src.splice(src.indexOf(dragged), 1);
    this._set(root);
    const at = this._findIn(root, group);
    this._sel = at ? [...at, "cards", after ? 1 : 0] : [];
  }

  /**
   * A new card beside `anchor`, across its container's axis. The only card of a panel:
   * the panel turns that way; otherwise the anchor and the new card become a group.
   */
  private _groupAdd(g: { anchor: Path; layout: "row" | "column"; after: boolean }, card: Cfg) {
    const root = this._draft(g.anchor.slice(0, -2));
    const list = get(root, g.anchor.slice(0, -1)) as Cfg[];
    const holder = get(root, g.anchor.slice(0, -2)) as Cfg | Cfg[];
    const i = g.anchor[g.anchor.length - 1] as number;
    if (!Array.isArray(holder) && holder?.type === "custom:glass-panel" && list.length === 1) {
      holder.layout = g.layout;
      list.splice(g.after ? 1 : 0, 0, card);
      this._set(root);
      this._sel = [...g.anchor.slice(0, -1), g.after ? 1 : 0];
      return;
    }
    const target = list[i];
    const { view_layout, ...rest } = target;
    const group: Cfg = {
      type: "custom:glass-panel",
      layout: g.layout,
      gap: 14,
      padding: 0,
      transparent: true,
      ...(view_layout ? { view_layout } : {}),
      cards: g.after ? [rest, card] : [card, rest],
    };
    list[i] = group;
    this._set(root);
    this._sel = [...g.anchor, "cards", g.after ? 1 : 0];
  }

  private _findIn(root: Cfg, node: Cfg): Path | undefined {
    const walk = (o: any, p: Path): Path | undefined => {
      if (o === node) return p;
      if (o && typeof o === "object")
        for (const [k, v] of Object.entries(o)) {
          const hit = walk(v, [...p, Array.isArray(o) ? Number(k) : k]);
          if (hit) return hit;
        }
      return undefined;
    };
    return walk(root, []);
  }

  /**
   * The list's cards have their own order on this device: the preview shows that
   * order, not the list's – so the moved card is put next to the anchor there too
   * (every card of the list gets its place on this device).
   */
  private _reorder(list: Path, anchor: Cfg, after: boolean) {
    const mode = preview.mode;
    const cards = get(this._config, list) as Cfg[] | undefined;
    const moved = this._sel.length ? (get(this._config, this._sel) as Cfg) : undefined;
    if (!cards || !moved || !cards.some((c) => orderOn(c, mode) !== "")) return;
    const pos = (c: Cfg, i: number) => (orderOn(c, mode) === "" ? 0 : Number(orderOn(c, mode))) * 1000 + i;
    const seen = cards.map((c, i) => ({ c, k: pos(c, i) })).sort((a, b) => a.k - b.k).map((x) => x.c);
    const visual = seen.filter((c) => c !== moved);
    const a = visual.findIndex((c) => this._jsonOf(c) === this._jsonOf(anchor));
    if (a < 0) return;
    visual.splice(after ? a + 1 : a, 0, moved);
    const root = this._draft(list);
    const arr = get(root, list) as Cfg[];
    cards.forEach((c, i) => (arr[i] = withOrder(arr[i], mode, String(visual.indexOf(c) + 1))));
    this._set(root, false);
  }

  /** Moves the node at `from` into list `to` before index `i`. */
  private _move(from: Path, to: Path, i: number) {
    if (within(to, from)) return; // into itself
    const root = this._draft(from.slice(0, -1), to);
    const src = get(root, from.slice(0, -1)) as Cfg[];
    const dst = get(root, to) as Cfg[] | undefined;
    const fi = from[from.length - 1] as number;
    if (!Array.isArray(src) || !Array.isArray(dst)) return;
    if (src === dst) {
      if (i === fi || i === fi + 1) return;
      const next = move(src, fi, i > fi ? i - 1 : i);
      src.splice(0, src.length, ...next);
      this._set(root);
      this._sel = [...to, i > fi ? i - 1 : i];
      return;
    }
    const [node] = src.splice(fi, 1);
    // `to` may run through the list the node left, past its index
    const shifted = same(to.slice(0, from.length - 1), from.slice(0, -1)) && typeof to[from.length - 1] === "number" && (to[from.length - 1] as number) > fi;
    dst.splice(i, 0, node);
    this._set(root);
    const toPath = shifted ? [...to.slice(0, from.length - 1), (to[from.length - 1] as number) - 1, ...to.slice(from.length)] : to;
    this._sel = [...toPath, i];
  }

  private _insert(list: Path, card: Cfg, i?: number) {
    const root = this._draft(list);
    let arr = get(root, list) as Cfg[] | undefined;
    if (!Array.isArray(arr)) {
      // an area without cards yet (creating `areas:` on the way)
      let parent: any = root;
      for (const k of list.slice(0, -1)) parent = parent[k] ??= {};
      arr = parent[list[list.length - 1]] = [];
    }
    const at = i ?? arr!.length;
    arr!.splice(at, 0, card);
    this._set(root);
    this._sel = [...list, at];
  }

  /* ── preview ───────────────────────────────────────────────────────────── */

  /** Cards under the pointer, innermost first, each with where its config sits. */
  private _cards(e: Event): { el: Element; path: Path }[] {
    const out: { el: Element; path: Path }[] = [];
    for (const n of e.composedPath()) {
      if (n === this._dash) break;
      if (n instanceof Element && cardSource.has(n)) {
        const path = this._find(cardSource.get(n) as Cfg);
        if (path) out.push({ el: n, path });
      }
    }
    return out;
  }

  /** The dashboard area under the pointer (its `section.area`), if any. */
  private _areaAt(e: Event): { el: Element; path: Path } | undefined {
    for (const n of e.composedPath()) {
      if (n === this._dash) break;
      if (n instanceof Element && n.localName === "section" && n.classList.contains("area")) {
        const name = (n.getAttribute("style") ?? "").match(/grid-area:\s*([\w-]+)/)?.[1];
        const a = this._areas().find((x) => x.name === name || x.name === `areas.${name}`);
        if (a) return { el: n, path: a.path };
      }
    }
    return undefined;
  }

  private _rect(el: Element) {
    // third-party cards sit in a display:contents holder
    const box = el.firstElementChild && !(el as HTMLElement).shadowRoot ? el.firstElementChild : el;
    return box.getBoundingClientRect();
  }

  /** A viewport rect in the stage's (scrolling) coordinates. */
  private _box(r: DOMRect | undefined) {
    if (!r) return undefined;
    const stage = this.renderRoot.querySelector(".stage") as HTMLElement;
    const w = stage.getBoundingClientRect();
    return { x: r.left - w.left + stage.scrollLeft, y: r.top - w.top + stage.scrollTop, w: r.width, h: r.height };
  }

  /* drag in the preview: the card under the pointer moves like a card in HA's sections editor */
  private _press?: { path: Path; x: number; y: number; w: number; h: number; dx: number; dy: number };
  declare _pdrag?: { x: number; y: number; w: number; h: number };
  declare _target?: {
    list: Path;
    i: number;
    line?: { x: number; y: number; w: number; h: number };
    into?: { x: number; y: number; w: number; h: number };
    label: string;
    /** next to this card (its config): for the per-device order */
    anchor?: Cfg;
    after?: boolean;
    /** a new row / column made of this card and the dragged one */
    group?: { anchor: Path; layout: "row" | "column"; after: boolean };
  };
  private _dragged = false;

  /** Where a drop at the pointer would go. */
  private _targetAt(e: PointerEvent): typeof this._target {
    const from = this._press!.path;
    const name = (p: Path) => describeCard(get(this._config, p) as Cfg);
    const title = (p: Path) => {
      const d = name(p);
      return d.sub && d.title === t("Room") ? d.sub : d.sub ? `${d.title} ${d.sub}` : d.title;
    };
    const EDGE = 16;
    for (const { el, path } of this._cards(e)) {
      // over the dragged card itself (or inside it): it stays where it is
      if (within(path, from)) return undefined;
      const r = this._rect(el);
      const node = get(this._config, path) as Cfg;
      const k = kids(node);
      const inner = e.clientX > r.left + EDGE && e.clientX < r.right - EDGE && e.clientY > r.top + EDGE && e.clientY < r.bottom - EDGE;
      // a panel's inside (between its cards): into the panel, at the end
      if (k && inner) return { list: [...path, k.key], i: k.list.length, into: this._box(r), label: `${t("Into")} ${title(path)}` };
      // next to this card, in its own list: the axis its container lays cards out on
      const list = path.slice(0, -1);
      const i = path[path.length - 1] as number;
      const parent = get(this._config, list.slice(0, -1)) as Cfg | undefined;
      const layout = Array.isArray(parent) ? "column" : (parent?.layout ?? "column");
      const across = layout === "row" || layout === "grid";
      const fx = (e.clientX - r.left) / r.width;
      const fy = (e.clientY - r.top) / r.height;
      // the other axis' outer quarter of a card (not in a grid, which wraps by itself):
      // a new row / column with the two cards
      if (!k && layout !== "grid") {
        const side = across ? (fy < 0.25 ? "before" : fy > 0.75 ? "after" : "") : fx < 0.25 ? "before" : fx > 0.75 ? "after" : "";
        if (side) {
          const after = side === "after";
          const line = across
            ? this._box(new DOMRect(r.left, (after ? r.bottom : r.top) - 2, r.width, 4))
            : this._box(new DOMRect((after ? r.right : r.left) - 2, r.top, 4, r.height));
          return {
            list,
            i,
            line,
            group: { anchor: path, layout: across ? "column" : "row", after },
            label: `${t(across ? (after ? "Below" : "Above") : after ? "Right of" : "Left of")} ${title(path)} (${t(across ? "new column" : "new row")})`,
          };
        }
      }
      const after = across ? fx > 0.5 : fy > 0.5;
      const line = across
        ? this._box(new DOMRect((after ? r.right : r.left) - 2, r.top, 4, r.height))
        : this._box(new DOMRect(r.left, (after ? r.bottom : r.top) - 2, r.width, 4));
      return { list, i: after ? i + 1 : i, line, anchor: node, after, label: `${t(after ? "After" : "Before")} ${title(path)}` };
    }
    // the empty part of an area: at its end
    const a = this._areaAt(e);
    if (a) {
      const list = (get(this._config, a.path) ?? []) as Cfg[];
      return { list: a.path, i: list.length, into: this._box(this._rect(a.el)), label: `${t("At the end of")} ${t(AREA_TITLES[a.path[a.path.length - 1] as string]?.[0] ?? String(a.path[a.path.length - 1]))}` };
    }
    return undefined;
  }

  private _onPreviewClick = (e: Event) => {
    // the lines between the layout's columns / rows: the dashboard drags them itself
    if (e.composedPath().some((n) => (n as Element).classList?.contains("grid-grip") || (n as Element).classList?.contains("flex-grip"))) return;
    // design mode: a click picks the card instead of switching a light
    e.stopPropagation();
    e.preventDefault();
    if (e.type === "pointerdown") {
      const pe = e as PointerEvent;
      if (pe.button !== 0) return;
      const hit = this._cards(e)[0];
      if (!hit) return;
      const r = this._rect(hit.el);
      this._press = { path: hit.path, x: pe.clientX, y: pe.clientY, w: r.width, h: r.height, dx: pe.clientX - r.left, dy: pe.clientY - r.top };
      this._dragged = false;
      return;
    }
    if (e.type === "pointerup") {
      if (this._dragged && this._press && this._target) this._dropAt(this._press.path, this._target);
      this._autoScroll(undefined);
      this._press = undefined;
      this._pdrag = undefined;
      this._target = undefined;
      return;
    }
    if (e.type !== "click" || this._dragged) return;
    if (this._addAt || this._del) {
      this._addAt = undefined;
      this._del = undefined;
      return;
    }
    const hit = this._cards(e)[0];
    if (hit) this._sel = hit.path;
    // the pop-up's own background: the pop-up itself
    else if (this._popAt && e.composedPath().some((n) => (n as Element).classList?.contains("glass-studio-pop"))) this._sel = this._popAt;
  };

  /** While dragging near the edge of something that scrolls (the phone's room strip, the stage): scroll it. */
  private _scroll?: { el: Element; dx: number; dy: number; raf: number };
  private _autoScroll(e: PointerEvent | undefined) {
    if (this._scroll) cancelAnimationFrame(this._scroll.raf);
    this._scroll = undefined;
    if (!e) return;
    const ZONE = 48;
    for (const n of e.composedPath()) {
      if (!(n instanceof Element)) continue;
      const cs = getComputedStyle(n);
      const sx = n.scrollWidth > n.clientWidth + 1 && /(auto|scroll)/.test(cs.overflowX);
      const sy = n.scrollHeight > n.clientHeight + 1 && /(auto|scroll)/.test(cs.overflowY);
      if (!sx && !sy) {
        if (n === this.renderRoot.querySelector(".stage")) break;
        continue;
      }
      const r = n.getBoundingClientRect();
      const dx = sx ? (e.clientX < r.left + ZONE ? -1 : e.clientX > r.right - ZONE ? 1 : 0) : 0;
      const dy = sy ? (e.clientY < r.top + ZONE ? -1 : e.clientY > r.bottom - ZONE ? 1 : 0) : 0;
      if (!dx && !dy) continue;
      const step = () => {
        n.scrollBy(dx * 12, dy * 12);
        this._scroll = { el: n, dx, dy, raf: requestAnimationFrame(step) };
      };
      step();
      return;
    }
  }

  /* "+" in the gaps: hovering the free space of a panel or area offers a new card right there */
  declare _plus?: { list: Path; i: number; x: number; y: number; group?: { anchor: Path; layout: "row" | "column"; after: boolean } };
  /** HA's card editor of the picked card: showing YAML, and whether it has a visual editor at all */
  declare _yaml: boolean;
  declare _guiAvail: boolean;
  /** the hovered card (for its trash button) and a delete waiting for confirmation */
  private _hoverPath?: Path;
  declare _del?: { path: Path; x: number; y: number; label: string };
  declare _addAt?: GlassStudio["_plus"];

  /** The cards of a list as they sit in the preview: their elements, by index. */
  private _childEls(list: Path, within: Element | ShadowRoot): Map<number, Element> {
    const out = new Map<number, Element>();
    const walk = (n: Element | ShadowRoot, depth: number) => {
      for (const el of n.querySelectorAll("*")) {
        if (cardSource.has(el)) {
          const p = this._find(cardSource.get(el) as Cfg);
          if (p && p.length === list.length + 1 && same(p.slice(0, -1), list)) out.set(p[p.length - 1] as number, el);
          continue; // not into a child's own children
        }
        if (el.shadowRoot && depth < 8) walk(el.shadowRoot, depth + 1);
      }
    };
    walk(within, 0);
    return out;
  }

  /** Where a "+" goes for the pointer in the free space of a container (panel or area). */
  private _gapAt(e: PointerEvent): typeof this._plus {
    const cards = this._cards(e);
    let list: Path | undefined;
    let root: Element | ShadowRoot | undefined;
    let layout = "column";
    const top = cards[0];
    if (top) {
      const node = get(this._config, top.path) as Cfg;
      const k = kids(node);
      if (!k) return this._edgeAt(e, top); // over a card: a "+" only at its edges
      list = [...top.path, k.key];
      root = (top.el as HTMLElement).shadowRoot ?? top.el;
      layout = node.layout === "grid" && node.masonry ? "masonry" : (node.layout ?? "column");
    } else {
      const a = this._areaAt(e);
      if (!a) return undefined;
      list = a.path;
      root = a.el;
    }
    const els = this._childEls(list, root);
    const n = ((get(this._config, list) as Cfg[] | undefined) ?? []).length;
    const rects = [...Array(n).keys()].map((i) => (els.get(i) ? this._rect(els.get(i)!) : undefined));
    return this._gapPlus(e, list, rects, layout, () => this._rect(top ? top.el : (root as Element)));
  }

  /** The "+" between the cards of a container: the insertion index before the pointer and its spot. */
  private _gapPlus(e: PointerEvent, list: Path, rects: (DOMRect | undefined)[], layout: string, box: () => DOMRect): typeof this._plus {
    if (layout === "masonry") {
      // masonry: columns packed independently – the pointer's column, under the card above it
      const col = rects.flatMap((r, k) => (r && e.clientX >= r.left && e.clientX <= r.right ? [{ r, k }] : [])).sort((a, b) => a.r.top - b.r.top);
      if (col.length) {
        const above = col.filter((c) => c.r.top + c.r.height / 2 < e.clientY);
        const prev = above[above.length - 1];
        const next = col[above.length];
        const ref = (prev ?? next)!.r;
        const y = prev && next ? (prev.r.bottom + next.r.top) / 2 : prev ? prev.r.bottom + 8 : next!.r.top - 8;
        const b = this._box(new DOMRect(ref.left + ref.width / 2, y, 0, 0))!;
        return { list, i: prev ? prev.k + 1 : next!.k, x: b.x, y: b.y };
      }
      layout = "grid";
    }
    const across = layout === "row";
    const grid = layout === "grid";
    // insertion index: the cards before the pointer (reading order in a grid)
    let i = 0;
    rects.forEach((r, k) => {
      if (!r) return;
      const before = across
        ? e.clientX > r.left + r.width / 2
        : grid
          ? e.clientY > r.bottom || (e.clientY >= r.top && e.clientX > r.left + r.width / 2)
          : e.clientY > r.top + r.height / 2;
      if (before) i = k + 1;
    });
    const prev = rects[i - 1];
    const next = rects[i];
    let x: number;
    let y: number;
    if (!prev && !next) {
      const r = box();
      x = r.left + r.width / 2;
      y = r.top + r.height / 2;
    } else if (across || (grid && prev && next && Math.abs(prev.top - next.top) < 4) || (grid && prev && !next)) {
      // between two cards side by side / after the last one in its row
      const ref = (prev ?? next)!;
      x = prev && next ? (prev.right + next.left) / 2 : prev ? prev.right + 8 : next!.left - 8;
      y = ref.top + ref.height / 2;
    } else {
      const ref = (prev ?? next)!;
      x = ref.left + ref.width / 2;
      y = prev && next ? (prev.bottom + next.top) / 2 : prev ? prev.bottom + 8 : next!.top - 8;
    }
    const b = this._box(new DOMRect(x, y, 0, 0))!;
    return { list, i, x: b.x, y: b.y };
  }

  /**
   * Near the edge of a card along its container's axis (left / right in a row or
   * grid, top / bottom in a column): a "+" on that edge. The first and last card of
   * a row or column have no gap outside them, so this is the way to add there.
   */
  private _edgeAt(e: PointerEvent, top: { el: Element; path: Path }, rect?: DOMRect): typeof this._plus {
    const EDGE = 16;
    const r = rect ?? this._rect(top.el);
    const list = top.path.slice(0, -1);
    const i = top.path[top.path.length - 1] as number;
    const parent = get(this._config, list.slice(0, -1)) as Cfg | undefined;
    const layout = Array.isArray(parent) ? "column" : (parent?.layout ?? "column");
    const across = layout === "row" || layout === "grid";
    const nearX = e.clientX < r.left + EDGE ? -1 : e.clientX > r.right - EDGE ? 1 : 0;
    const nearY = e.clientY < r.top + EDGE ? -1 : e.clientY > r.bottom - EDGE ? 1 : 0;
    const at = (side: "x" | "y", d: number) => {
      const b = this._box(new DOMRect(side === "x" ? (d > 0 ? r.right : r.left) : r.left + r.width / 2, side === "y" ? (d > 0 ? r.bottom : r.top) : r.top + r.height / 2, 0, 0))!;
      return { x: b.x, y: b.y };
    };
    // along the container's axis: a new card before / after this one
    const along = across ? nearX : nearY;
    if (along) return { list, i: along > 0 ? i + 1 : i, ...at(across ? "x" : "y", along) };
    // across it (not in a grid, which wraps by itself): a new row / column with this card
    const cross = across ? nearY : nearX;
    if (cross && layout !== "grid")
      return { list, i, ...at(across ? "y" : "x", cross), group: { anchor: top.path, layout: across ? "column" : "row", after: cross > 0 } };
    return undefined;
  }

  private _onPreviewMove = (e: PointerEvent) => {
    const p = this._press;
    if (p && (e.buttons & 1) && (this._dragged || Math.hypot(e.clientX - p.x, e.clientY - p.y) > 6)) {
      this._dragged = true;
      this._hover = undefined;
      const b = this._box(new DOMRect(e.clientX - p.dx, e.clientY - p.dy, p.w, p.h))!;
      this._pdrag = b;
      this._target = this._targetAt(e);
      this._autoScroll(e);
      return;
    }
    if (p && !(e.buttons & 1)) this._press = undefined;
    const hit = this._cards(e)[0];
    this._hover = hit ? this._box(this._rect(hit.el)) : undefined;
    this._hoverPath = hit?.path;
    // the "+": at most once a frame (it measures the cards around the pointer)
    // composedPath() is empty once the event is over: keep it for the frame
    const path = e.composedPath();
    this._gapEvent = { clientX: e.clientX, clientY: e.clientY, composedPath: () => path } as unknown as PointerEvent;
    if (!this._addAt && !this._gapRaf)
      this._gapRaf = requestAnimationFrame(() => {
        this._gapRaf = 0;
        const g = this._gapEvent && this._gapAt(this._gapEvent);
        if (!g) this._plus = undefined;
        else if (!this._plus || !same(g.list, this._plus.list) || g.i !== this._plus.i || Math.abs(g.x - this._plus.x) > 1 || Math.abs(g.y - this._plus.y) > 1) this._plus = g;
      });
  };
  private _gapEvent?: PointerEvent;
  private _gapRaf = 0;

  private _mountPreview() {
    const stage = this.renderRoot.querySelector(".stage-inner");
    if (!stage) return;
    if (!this._dash) {
      this._dash = document.createElement("glass-dashboard") as DashEl;
      stage.appendChild(this._dash!);
      this._dash!.preview = true;
      // its own layer: what it draws on top (an open pop-up) stays under the studio's outlines and "+"
      this._dash!.style.isolation = "isolate";
      (this._dash as any).gridGrips = true;
      this._dash!.addEventListener("glass-grid-resize", (e) => this._gridResize((e as CustomEvent).detail));
      this._dash!.addEventListener("glass-panel-resize", (e) => this._panelResize((e as CustomEvent).detail));
      this._dash!.addEventListener("glass-card-resize", (e) => this._cardResize((e as CustomEvent).detail));
      this._dash!.addEventListener("glass-preview-zoom", (e) => {
        const z = (e as CustomEvent).detail.zoom as number;
        if (Math.abs(z - this._pvZoom) > 0.001) this._pvZoom = z;
      });
      (this._dash as any).setPreviewZoom(this._zoomPick);
      for (const ev of ["click", "pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend", "contextmenu"])
        stage.addEventListener(ev, this._onPreviewClick, { capture: true });
      stage.addEventListener("pointermove", this._onPreviewMove as EventListener);
      stage.addEventListener("pointerleave", (e) => {
        // onto the card's own trash button: keep the card highlighted
        const to = (e as PointerEvent).relatedTarget as Element | null;
        if (to?.closest?.(".trash, .pvmenu")) return;
        this._hover = undefined;
      });
      window.addEventListener("keydown", (e) => {
        const typing = (e.composedPath()[0] as HTMLElement)?.matches?.("input, textarea, [contenteditable]");
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !typing && this.isConnected) {
          e.preventDefault();
          e.stopPropagation();
          if (e.shiftKey) this._redo();
          else this._undo();
          return;
        }
        if (e.key === "Escape" && (this._addAt || this._del || this._menu)) {
          // only the pop-over closes: the dialog's own Escape (closing the editor) must not follow
          e.preventDefault();
          e.stopPropagation();
          this._addAt = undefined;
          this._del = undefined;
          this._menu = undefined;
          return;
        }
        // the picked card: Del removes, ⌘D duplicates, ⌘C / ⌘X / ⌘V copy, cut and paste after it
        if (!typing && this.isConnected && this._sel.length && typeof this._sel[this._sel.length - 1] === "number") {
          const mod = e.metaKey || e.ctrlKey;
          const key = e.key.toLowerCase();
          const label = e.key === "Delete" || e.key === "Backspace" ? "Remove" : mod && key === "d" ? "Duplicate" : mod && key === "c" ? "Copy" : mod && key === "x" ? "Cut" : mod && key === "v" ? "Paste after" : "";
          const act = label && this._actions(this._sel).find((a) => a.label === label && !a.disabled);
          if (act) {
            e.preventDefault();
            e.stopPropagation();
            act.run();
            return;
          }
        }
        if (e.key !== "Escape" || !this._pdrag) return;
        e.stopPropagation();
        this._press = undefined;
        this._pdrag = undefined;
        this._target = undefined;
      }, { capture: true });
    }
    const d = this._dash as any;
    if (d.previewBackground !== this._pvBg || d.previewDark !== this._pvDark) {
      d.previewBackground = this._pvBg;
      d.previewDark = this._pvDark;
      d.requestUpdate();
    }
    const key = this._fast ? "fast" : "glass";
    if (this._shown === this._config && this._shownKey === key) return;
    const reopen = this._popOpen;
    const flipped = this._shownKey !== key;
    this._shown = this._config;
    this._shownKey = key;
    this._dash!.hass = this.hass;
    try {
      // fast: no blur anywhere in the preview – it is what makes big dashboards slow to redraw.
      // Every glass surface scales its blur by --glass-blur-scale, so the look stays the same.
      this._dash!.style.setProperty("--glass-blur-scale", this._fast ? "0" : "1");
      // the WebGL bars over room photos don't blur by CSS: they step back to their CSS glass
      this._dash!.toggleAttribute("glass-fast", this._fast);
      // only when fast mode flips: it re-renders every room card (photo bars), not just the changed one
      if (flipped) LiquidController.refreshPreview();
      this._dash!.setConfig(this._main());
      if (reopen) requestAnimationFrame(() => this._popOpen === reopen && this._showPopup(reopen));
    } catch (err) {
      console.warn("glass-studio: preview", err);
    }
  }

  protected override updated() {
    this._mountPreview();
    // a new pick (in the tree, the preview or the schematic): show it in the other two
    if (this._sel !== this._selShown) {
      this._selShown = this._sel;
      const pop = this._popOfSel(this._sel);
      if (pop && pop !== this._popOpen) this._showPopup(pop);
      else if (!pop && this._popOpen && this._sel.length) this._closePopup();
      this._revealSel();
    } else requestAnimationFrame(() => this._placeSelBox());
    this._fitAddPop();
    void this._loadSources();
    if (this._dashEditor && (this._dashEditor as any)._studioCfg !== this._main()) {
      (this._dashEditor as any)._studioCfg = this._main();
      this._dashEditor.hass = this.hass;
      this._dashEditor.lovelace = this.lovelace;
      this._dashEditor.setConfig(this._main());
    }
  }

  /* ── card actions: one menu for the tree, the schematic and the preview ─── */

  /** The "⋮" menu of a card, at a viewport point (the button that opened it). */
  declare _menu?: { path: Path; x: number; y: number };

  /** What one can do with the card at `path` (also the keyboard shortcuts). */
  private _actions(path: Path): { icon: string; label: string; key?: string; run: () => void; disabled?: boolean; danger?: boolean }[] {
    const card = get(this._config, path) as Cfg | undefined;
    if (!card || typeof path[path.length - 1] !== "number") return [];
    const list = path.slice(0, -1);
    const i = path[path.length - 1] as number;
    const n = ((get(this._config, list) as Cfg[] | undefined) ?? []).length;
    const clip = getClip();
    const k = kids(card);
    const remove = () => {
      this._set(this._with(path, undefined));
      if (within(this._sel, path)) this._sel = n > 1 ? [...list, Math.min(i, n - 2)] : list;
    };
    const paste = (into: Path, at?: number) => {
      if (!clip) return;
      this._insert(into, structuredClone(clip.card), at);
      if (clip.cut) setClip(undefined);
    };
    return [
      { icon: "mdi:arrow-up", label: "Move up", run: () => this._move(path, list, i - 1), disabled: i === 0 },
      { icon: "mdi:arrow-down", label: "Move down", run: () => this._move(path, list, i + 2), disabled: i >= n - 1 },
      { icon: "mdi:content-duplicate", label: "Duplicate", key: "⌘D", run: () => this._insert(list, structuredClone(card), i + 1) },
      { icon: "mdi:content-copy", label: "Copy", key: "⌘C", run: () => setClip({ card: structuredClone(card), cut: false }) },
      {
        icon: "mdi:content-cut",
        label: "Cut",
        key: "⌘X",
        run: () => {
          setClip({ card: structuredClone(card), cut: true });
          remove();
        },
      },
      ...(clip ? [{ icon: "mdi:content-paste", label: "Paste after", key: "⌘V", run: () => paste(list, i + 1) }] : []),
      ...(clip && k ? [{ icon: "mdi:tray-arrow-down", label: "Paste into", run: () => paste([...path, k.key]) }] : []),
      { icon: "mdi:delete-outline", label: "Remove", key: "Del", run: remove, danger: true },
    ];
  }

  /** The "⋮" button that opens the menu for `path`. */
  private _menuBtn(path: Path, cls = "") {
    return html`<button
      class="menubtn ${cls}"
      title=${t("More actions")}
      @pointerdown=${(e: Event) => e.stopPropagation()}
      @click=${(e: Event) => {
        e.stopPropagation();
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        this._menu = this._menu && same(this._menu.path, path) ? undefined : { path, x: r.right, y: r.bottom + 4 };
      }}
    >
      <ha-icon .icon=${"mdi:dots-vertical"}></ha-icon>
    </button>`;
  }

  private _menuView() {
    const m = this._menu;
    if (!m) return nothing;
    const acts = this._actions(m.path).filter((a) => !a.danger);
    if (!acts.length) return nothing;
    // inside the window: right-aligned to the button, above it when there is no room below
    const h = acts.length * 36 + 12;
    const top = m.y + h > window.innerHeight - 8 ? Math.max(8, m.y - h - 40) : m.y;
    return html`<div class="ctxmenu" style="left:${Math.max(200, m.x)}px;top:${top}px" @pointerdown=${(e: Event) => e.stopPropagation()}>
      ${acts.map(
        (a) => html`<button
          class=${a.danger ? "warn" : ""}
          ?disabled=${a.disabled}
          @click=${() => {
            this._menu = undefined;
            a.run();
          }}
        >
          <ha-icon .icon=${a.icon}></ha-icon><span>${t(a.label)}</span>${a.key ? html`<kbd>${a.key}</kbd>` : nothing}
        </button>`,
      )}
    </div>`;
  }

  /* ── the picked card everywhere ─────────────────────────────────────────── */

  private _selShown?: Path;
  /** The picked card's outline in the preview (stage coordinates). */
  declare _selBox?: { x: number; y: number; w: number; h: number };

  /** The picked card's element in the preview. */
  private _selEl(): Element | undefined {
    if (!this._sel.length || !this._dash?.shadowRoot) return undefined;
    const walk = (root: ShadowRoot | Element): Element | undefined => {
      for (const el of root.querySelectorAll("*")) {
        if (cardSource.has(el)) {
          const p = this._find(cardSource.get(el) as Cfg);
          if (p && same(p, this._sel)) return el;
        }
        if (el.shadowRoot) {
          const hit = walk(el.shadowRoot);
          if (hit) return hit;
        }
      }
      return undefined;
    };
    return walk(this._dash.shadowRoot);
  }

  /** Opens the tree down to the picked card and scrolls it into view in the tree, the preview and the schematic. */
  private _revealSel() {
    const sel = this._sel;
    if (sel.length && this._collapsed?.size) {
      const next = new Set(this._collapsed);
      for (let i = 1; i < sel.length; i++) next.delete(JSON.stringify(sel.slice(0, i)));
      if (sel[0] === "overlay") ["bar", "pops"].forEach((k) => next.delete(k));
      if (next.size !== this._collapsed.size) this._collapsed = next;
    }
    requestAnimationFrame(() => {
      const key = JSON.stringify(sel);
      const near: ScrollIntoViewOptions = { block: "nearest", inline: "nearest" };
      [...this.renderRoot.querySelectorAll<HTMLElement>(".left .node[data-path]")].find((n) => n.dataset.path === key)?.scrollIntoView(near);
      if (this._wire) [...this.renderRoot.querySelectorAll<HTMLElement>(".wire [data-path]")].find((n) => n.dataset.path === key)?.scrollIntoView(near);
      else this._selEl()?.scrollIntoView(near);
      this._placeSelBox();
    });
  }

  private _placeSelBox() {
    const el = this._wire ? undefined : this._selEl();
    const b = el ? this._box(this._rect(el)) : undefined;
    const cur = this._selBox;
    if (!b ? cur : !cur || Math.abs(b.x - cur.x) > 0.5 || Math.abs(b.y - cur.y) > 0.5 || Math.abs(b.w - cur.w) > 0.5 || Math.abs(b.h - cur.h) > 0.5) this._selBox = b;
  }

  /* ── render ────────────────────────────────────────────────────────────── */

  /** Drag on a side panel's edge: the panel follows the pointer; the width is kept for next time. */
  private _resizePane(side: "tree" | "insp" | "yaml", e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    const grip = e.currentTarget as HTMLElement;
    const body = grip.parentElement!;
    grip.setPointerCapture(e.pointerId);
    grip.classList.add("on");
    const x0 = e.clientX;
    const w0 = this._panes[side];
    const move = (ev: PointerEvent) => {
      // the preview keeps at least 360 px between the panels
      const other = side === "tree" ? (this._hideInspector ? 0 : this._panes[this._wide ? "yaml" : "insp"]) : this._hideTree ? 0 : this._panes.tree;
      const max = Math.max(PANE_MIN[side], body.clientWidth - other - 360);
      const dx = ev.clientX - x0;
      const w = Math.round(Math.min(max, Math.max(PANE_MIN[side], w0 + (side === "tree" ? dx : -dx))));
      this._panes[side] = w;
      body.style.setProperty(side === "tree" ? "--tree-w" : "--insp-w", `${w}px`);
    };
    const up = () => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", up);
      grip.classList.remove("on");
      this._savePanes();
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", up);
  }

  /** A line between the layout's columns / rows dragged in the preview: its own grid on a phone, else the main one. */
  private _gridResize(d: { key: "column_widths" | "row_heights"; value: string; mode: string }) {
    const c = this._config as Record<string, any>;
    if (d.mode === "mobile" && c.responsive?.mobile?.grid) {
      this._set({ ...c, responsive: { ...c.responsive, mobile: { ...c.responsive.mobile, [d.key]: d.value } } });
    } else this._set({ ...c, [d.key]: d.value });
    this.requestUpdate();
  }

  /** A line between a grid panel's columns / rows dragged in the preview: on a phone its own mobile sizes if it has them. */
  private _panelResize(d: { panel: Element; key: "column_widths" | "row_heights"; value: string; mode: string }) {
    const path = this._find(cardSource.get(d.panel) as Cfg);
    if (!path) return;
    const card = get(this._config, path) as Cfg;
    const mob = d.mode === "mobile" ? card.responsive?.mobile : undefined;
    const own = mob && (d.key in mob || "layout" in mob || "columns" in mob || "rows" in mob);
    const next = own ? { ...card, responsive: { ...card.responsive, mobile: { ...mob, [d.key]: d.value } } } : { ...card, [d.key]: d.value };
    this._set(this._with(path, next));
    this._sel = path;
    this.requestUpdate();
  }

  /** A card's edge dragged in a line / column panel: its view_layout width / height (on a phone its own mobile one if it has it). */
  private _cardResize(d: { card: Element; key: "width" | "height"; value?: string; mode: string }) {
    const path = this._find(cardSource.get(d.card) as Cfg);
    if (!path) return;
    const card = get(this._config, path) as Cfg;
    const size = (vl: Cfg | undefined): Cfg | undefined => {
      const n = { ...(vl ?? {}) };
      if (d.value === undefined) delete n[d.key];
      else {
        n[d.key] = d.value;
        // a fixed size: no longer stretched to fill
        delete n.grow;
      }
      return Object.keys(n).length ? n : undefined;
    };
    const put = (c: Cfg, vl: Cfg | undefined): Cfg => {
      const { view_layout: _, ...rest } = c;
      return vl ? { ...rest, view_layout: vl } : rest;
    };
    const mob = d.mode === "mobile" ? card.responsive?.mobile : undefined;
    const next = mob?.view_layout ? { ...card, responsive: { ...card.responsive, mobile: put(mob, size(mob.view_layout)) } } : put(card, size(card.view_layout));
    this._set(this._with(path, next));
    this._sel = path;
    this.requestUpdate();
  }

  private _resetPane(side: "tree" | "insp" | "yaml") {
    this._panes[side] = PANE_DEFAULT[side];
    this._savePanes();
    this.requestUpdate();
  }

  private _savePanes() {
    try {
      localStorage.setItem(PANES_KEY, JSON.stringify(this._panes));
    } catch {
      /* private mode */
    }
  }

  private _device(m: (typeof DEVICE_MODES)[number]) {
    const pop = this._popOpen;
    const wasIn = pop && this._popAt && within(this._sel, this._popAt);
    setPreviewMode(m, savedSizes()[m]);
    if (pop) this._reopen(pop, !!wasIn);
    // the tree shows the device's own lists: a picked node may not exist there
    if (this._sel.length && get(this._config, this._sel) === undefined) this._sel = [];
    this.requestUpdate();
  }

  /** A screen size: mobile below the dashboard's mobile breakpoint, tablet / computer above. */
  private _setSize(w: number, h: number, name?: string) {
    w = Math.round(Math.min(3840, Math.max(240, w || 0)));
    h = Math.round(Math.min(2400, Math.max(240, h || 0)));
    const c = this._config as Record<string, any>;
    const m = w < (c.breakpoints?.mobile ?? c.breakpoint ?? 700) ? "mobile" : "tablet";
    try {
      localStorage.setItem(SIZE_KEY, JSON.stringify({ ...savedSizes(), [m]: { w, h, name } }));
    } catch {
      /* private mode */
    }
    if (m !== preview.mode) this._device(m);
    else {
      setPreviewMode(m, { w, h });
      this.requestUpdate();
    }
  }

  private _sizeBar() {
    const { w, h } = previewSize(preview.mode);
    // two devices may share a size: the one picked by name, else the first that fits
    const picked = savedSizes()[preview.mode as "mobile" | "tablet"]?.name;
    const fits = (d: (typeof DEVICES)[number]) => d.w === w && d.h === h;
    const named = DEVICES.findIndex((d) => fits(d) && d.name === picked);
    const win = windowSize();
    const isWin = picked === WINDOW && win.w === w && win.h === h;
    const hit = isWin ? -2 : named >= 0 ? named : DEVICES.findIndex(fits);
    const num = (v: number, set: (n: number) => void, title: string) =>
      html`<input type="number" title=${t(title)} .value=${String(v)} min="240" max="3840" @change=${(e: Event) => set(Number((e.target as HTMLInputElement).value))} />`;
    return html`<span class="size">
      <select
        title=${t("Device")}
        @change=${(e: Event) => {
          const v = Number((e.target as HTMLSelectElement).value);
          const d = v === -2 ? { ...windowSize(), name: WINDOW } : DEVICES[v];
          if (d) this._setSize(d.w, d.h, d.name);
        }}
      >
        <option value="-2" ?selected=${isWin}>${t(WINDOW)} (${win.w} × ${win.h})</option>
        ${DEVICES.map((d, i) => html`<option value=${i} ?selected=${i === hit}>${t(d.name)}</option>`)}
        <option value="-1" ?selected=${hit === -1} disabled>${t("Custom size")}</option>
      </select>
      ${num(w, (n) => this._setSize(n, h), "Width (px)")}<span class="x">×</span>${num(h, (n) => this._setSize(w, n), "Height (px)")}
      <button class="icon small" title=${t("Rotate")} @click=${() => this._setSize(h, w)}><ha-icon .icon=${"mdi:phone-rotate-landscape"}></ha-icon></button>
      <select
        class="zoom ${Math.abs(this._pvZoom - 1) > 0.005 ? "scaled" : ""}"
        title=${t("Preview scale – 100 % is the device's real size")}
        @change=${(e: Event) => this._setZoom((e.target as HTMLSelectElement).value)}
      >
        <option value="fit" ?selected=${this._zoomPick === undefined}>${t("Fit")} (${Math.round(this._pvZoom * 100)} %)</option>
        ${ZOOMS.map((z) => html`<option value=${z} ?selected=${this._zoomPick === z}>${Math.round(z * 100)} %</option>`)}
      </select>
    </span>`;
  }

  /** The preview's scale: a fixed one (larger than the stage scrolls), or "fit" to the width. */
  private _setZoom(v: string) {
    this._zoomPick = v === "fit" ? undefined : Number(v);
    try {
      if (this._zoomPick === undefined) localStorage.removeItem(ZOOM_KEY);
      else localStorage.setItem(ZOOM_KEY, String(this._zoomPick));
    } catch {
      /* private mode */
    }
    (this._dash as any)?.setPreviewZoom(this._zoomPick);
    this.requestUpdate();
  }

  private _isOpen(key: string) {
    return !this._collapsed?.has(key);
  }

  private _toggle(key: string) {
    const next = new Set(this._collapsed ?? []);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this._collapsed = next;
    try {
      localStorage.setItem("glass-studio-collapsed", JSON.stringify([...next]));
    } catch {
      /* private mode: only for this session */
    }
  }

  /** The chevron of a branch that can roll up; an empty slot keeps rows aligned. */
  private _twisty(key?: string) {
    if (!key) return html`<span class="tw"></span>`;
    const open = this._isOpen(key);
    return html`<button
      class="tw"
      title=${t(open ? "Collapse" : "Expand")}
      @pointerdown=${(e: Event) => e.stopPropagation()}
      @click=${(e: Event) => {
        e.stopPropagation();
        this._toggle(key);
      }}
    >
      <ha-icon .icon=${open ? "mdi:chevron-down" : "mdi:chevron-right"}></ha-icon>
    </button>`;
  }

  private _row(label: string, sub: string, icon: string, path: Path, depth: number, extra?: { badges?: string[]; draggable?: boolean; fold?: string }) {
    const on = same(path, this._sel);
    const isItem = typeof path[path.length - 1] === "number";
    const list = isItem ? path.slice(0, -1) : undefined;
    const i = isItem ? (path[path.length - 1] as number) : 0;
    const n = list ? ((get(this._config, list) as Cfg[] | undefined)?.length ?? 0) : 0;
    const mark = list && this._drop && same(this._drop.list, list) ? (this._drop.i === i ? "before" : this._drop.i === i + 1 && i === n - 1 ? "after" : "") : "";
    return html`<div
      class="node ${on ? "on" : ""} ${mark} ${this._tdrag && same(this._tdrag.path, path) ? "dragging" : ""}"
      style="--depth:${depth}"
      data-path=${JSON.stringify(path)}
      @click=${() => {
        if (this._tclick) return;
        this._sel = path;
      }}
      @pointerdown=${(e: PointerEvent) => {
        if (!extra?.draggable || e.button !== 0) return;
        this._tpress = { path, label, x: e.clientX, y: e.clientY };
      }}
    >
      ${this._twisty(extra?.fold)}
      <ha-icon .icon=${icon}></ha-icon>
      <span class="label"><b>${label}</b>${sub ? html`<small>${sub}</small>` : nothing}</span>
      ${(extra?.badges ?? []).map((b) => html`<span class="badge">${b}</span>`)}
      ${isItem && extra?.draggable
        ? html`<span class="rowtools">
            ${this._actions(path)
              .filter((a) => a.icon === "mdi:arrow-up" || a.icon === "mdi:arrow-down" || a.danger)
              .map(
                (a) => html`<button
                  class="menubtn ${a.danger ? "warn" : ""}"
                  title=${t(a.label)}
                  ?disabled=${a.disabled}
                  @pointerdown=${(e: Event) => e.stopPropagation()}
                  @click=${(e: Event) => {
                    e.stopPropagation();
                    a.run();
                  }}
                >
                  <ha-icon .icon=${a.icon}></ha-icon>
                </button>`,
              )}
          </span>`
        : nothing}
    </div>`;
  }

  /* tree drag: by pointer (as in the preview), so it can show exactly where the card goes */
  private _tpress?: { path: Path; label: string; x: number; y: number };
  declare _tdrag?: { path: Path; label: string; x: number; y: number };
  private _tclick = false;

  /** The tree row under the pointer → where the dragged node would go. */
  private _treeTarget(e: PointerEvent): { list: Path; i: number; into?: boolean } | undefined {
    const from = this._tdrag!.path;
    const row = e
      .composedPath()
      .find((n) => n instanceof HTMLElement && n.classList.contains("node") && this.renderRoot.contains(n)) as HTMLElement | undefined;
    if (!row?.dataset.path) return undefined;
    const path = JSON.parse(row.dataset.path) as Path;
    const r = row.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    const isItem = typeof path[path.length - 1] === "number";
    if (!path.length) return undefined; // the dashboard row
    if (!isItem) return { list: path, i: y < 0.5 ? 0 : ((get(this._config, path) as Cfg[] | undefined)?.length ?? 0) };
    if (within(path, from)) return undefined;
    const k = kids(get(this._config, path) as Cfg);
    // the middle of a panel's row: into it, at the end
    if (k && y > 0.25 && y < 0.75) return { list: [...path, k.key], i: k.list.length, into: true };
    const i = path[path.length - 1] as number;
    return { list: path.slice(0, -1), i: y < 0.5 ? i : i + 1 };
  }

  private _onWinMove = (e: PointerEvent) => {
    // schematic
    const wp = this._wpress;
    if (wp && (e.buttons & 1) && (this._wdrag || Math.hypot(e.clientX - wp.x, e.clientY - wp.y) > 5)) {
      if (!this._wdrag) {
        this._wdrag = { path: wp.path, label: wp.label };
        // the copy sits next to the original, so the schematic's styles still apply to it
        const c = wp.el.cloneNode(true) as HTMLElement;
        c.classList.remove("on", "dragging");
        c.classList.add("wclone");
        c.style.width = `${wp.w}px`;
        c.style.height = `${wp.h}px`;
        // icons are set as a property (not copied by cloneNode)
        const icons = wp.el.querySelectorAll("ha-icon");
        c.querySelectorAll("ha-icon").forEach((ic, i) => ((ic as any).icon = (icons[i] as any)?.icon));
        wp.el.parentElement?.appendChild(c);
        this._wclone = c;
      }
      this._dragged = true;
      this._target = this._wireTarget(e);
      if (this._wclone) {
        this._wclone.style.left = `${e.clientX - wp.dx}px`;
        this._wclone.style.top = `${e.clientY - wp.dy}px`;
      }
      // the drop place under the copy
      const chip = this.renderRoot.querySelector<HTMLElement>(".chip");
      this._chipAt = { x: e.clientX - wp.dx - 14, y: e.clientY - wp.dy + wp.h - 2 };
      if (chip) {
        chip.style.left = `${this._chipAt.x + 14}px`;
        chip.style.top = `${this._chipAt.y + 10}px`;
      }
      this._autoScroll(e);
      return;
    }
    // tree
    const tp = this._tpress;
    if (tp && (e.buttons & 1) && (this._tdrag || Math.hypot(e.clientX - tp.x, e.clientY - tp.y) > 5)) {
      // the chip follows the pointer directly; state (a re-render) only to start the drag
      if (!this._tdrag) this._tdrag = { ...tp, x: e.clientX, y: e.clientY };
      // kept current for a re-render (a new drop place) without being a change itself
      this._tdrag.x = e.clientX;
      this._tdrag.y = e.clientY;
      const chip = this.renderRoot.querySelector<HTMLElement>(".chip");
      if (chip) {
        chip.style.left = `${e.clientX + 14}px`;
        chip.style.top = `${e.clientY + 10}px`;
      }
      // a new value only when the place changes: no re-render (flicker) on every move
      const d = this._treeTarget(e);
      const cur = this._drop;
      if (!d !== !cur || (d && cur && (!same(d.list, cur.list) || d.i !== cur.i || !!d.into !== !!cur.into))) this._drop = d;
      this._autoScroll(e);
      return;
    }
    // preview: a drag that left the preview goes on (the ghost follows), dropping there does nothing
    const p = this._press;
    if (p && this._dragged && (e.buttons & 1) && !e.composedPath().includes(this.renderRoot.querySelector(".stage")!)) {
      this._pdrag = this._box(new DOMRect(e.clientX - p.dx, e.clientY - p.dy, p.w, p.h));
      this._target = undefined;
      this._autoScroll(undefined);
    }
  };

  private _chipAt?: { x: number; y: number };

  private _onWinUp = () => {
    if (this._wdrag) {
      if (this._target) this._move(this._wdrag.path, this._target.list, this._target.i);
      this._target = undefined;
      setTimeout(() => (this._dragged = false));
    }
    this._wpress = undefined;
    this._wdrag = undefined;
    this._wclone?.remove();
    this._wclone = undefined;
    if (this._tdrag) {
      if (this._drop) this._move(this._tdrag.path, this._drop.list, this._drop.i);
      // the click that ends a drag doesn't pick the row
      this._tclick = true;
      setTimeout(() => (this._tclick = false));
    }
    this._tpress = undefined;
    this._tdrag = undefined;
    this._drop = undefined;
    // a preview drag let go outside the preview: no change
    if (this._press) {
      this._press = undefined;
      this._pdrag = undefined;
      this._target = undefined;
    }
    this._autoScroll(undefined);
  };

  private _tree() {
    const nodes = (list: Cfg[], path: Path, depth: number, only?: (c: Cfg) => boolean): unknown[] =>
      list.map((c, i) => {
        if (only && !only(c)) return nothing;
        const p = [...path, i];
        const d = describeCard(c);
        const k = kids(c);
        // the dashed frame only when dropping into the panel itself, not next to one of its cards
        const into = this._drop?.into && k && same(this._drop.list, [...p, k.key]) ? "into" : "";
        const fold = k ? JSON.stringify(p) : undefined;
        return html`<div class="branch ${into}">
          ${this._row(c.name ? String(c.name) : d.title, c.name ? d.title : d.sub, d.icon, p, depth, { badges: d.badges, draggable: true, fold })}
          ${k && this._isOpen(fold!) ? nodes(k.list, [...p, k.key], depth + 1) : nothing}
        </div>`;
      });
    return html`<div class="tree">
      ${this._row(t("Dashboard"), t("Layout, look, sizes"), "mdi:view-dashboard-outline", [], 0)}
      ${this._areas().map((a) => {
        if (a.name === "overlay") return nothing;
        const title = t(AREA_TITLES[a.name.replace(/^areas\./, "")]?.[0] ?? a.name.replace(/^areas\./, ""));
        const list = (get(this._config, a.path) ?? []) as Cfg[];
        return html`<div class="area">
          ${this._row(title, `${list.length} ${t(list.length === 1 ? "card" : "cards")}`, "mdi:view-grid-outline", a.path, 0, {
            badges: a.own ? [t(MODE_NAMES[preview.mode])] : [],
            fold: JSON.stringify(a.path),
          })}
          ${this._isOpen(JSON.stringify(a.path)) ? nodes(list, a.path, 1) : nothing}
        </div>`;
      })}
      ${this._overlayTree(nodes)}
    </div>`;
  }

  private _addPicker(list: Path) {
    return this._choices((card) => {
      this._picker = undefined;
      this._insert(list, card);
    });
  }

  /* ── pop-ups (Bubble Card): from the overlay and from a pop-up dashboard ──── */

  /** Pop-ups of the overlay sources for the previewed device. */
  declare _srcPops: { label: string; url: string; dashboard: string; src: OverlaySource; editable: boolean; items: { hash: string; name?: string; icon?: string; card: Cfg }[] }[];
  /** The pop-up shown in the preview. */
  declare _popOpen?: string;
  /** The "close the pop-up preview" button: just above the pop-up's top edge. */
  declare _popTop?: number;
  declare _newPop: string;
  private _srcKey?: string;

  private _sources(): OverlaySource[] {
    const c = this._config;
    const own = c.responsive?.[preview.mode]?.overlay_source;
    const src = own === null ? undefined : (own ?? c.overlay_source);
    return src ? (Array.isArray(src) ? src : [src]) : [];
  }

  private async _loadSources() {
    const srcs = this._sources();
    const key = JSON.stringify(srcs);
    if (key === this._srcKey || !this.hass) return;
    this._srcKey = key;
    const out: GlassStudio["_srcPops"] = [];
    // pop-up dashboards made in the UI open for editing here; YAML ones are only shown.
    // From HA's card dialog the dashboard it saves is left out: its Save would write its own old copy over ours.
    const here = this.standalone ? undefined : (this.lovelace as any)?.urlPath;
    this._dashList ??= await listDashboards(this.hass as any).catch(() => []);
    const open: Record<string, Cfg> = {};
    for (const src of srcs) {
      const cards = (await overlayCards(this.hass as any, src).catch(() => undefined)) ?? [];
      const ui = this._dashList.find((d) => d.url === src.dashboard)?.mode === "storage" && src.dashboard !== here;
      if (ui && !this._config.__sources?.[src.dashboard]) {
        const full = await loadConfig(this.hass as any, src.dashboard).catch(() => undefined);
        if (full) {
          open[src.dashboard] = full;
          this._srcBase[src.dashboard] = JSON.stringify(full);
        }
      }
      out.push({
        label: `${src.dashboard}${src.view !== undefined ? ` / ${src.view}` : ""}`,
        url: `/${src.dashboard}/${src.view ?? ""}`,
        dashboard: src.dashboard,
        src,
        editable: ui && !!(open[src.dashboard] ?? this._config.__sources?.[src.dashboard]),
        items: cards.map((c) => (popupOf(c) ? { ...popupOf(c)!, card: c } : undefined)).filter(Boolean) as { hash: string; name?: string; icon?: string; card: Cfg }[],
      });
    }
    if (key !== this._srcKey) return;
    if (Object.keys(open).length) this._attachSources(open);
    this._srcPops = out;
  }

  /** Pop-up dashboards into the config (and its history, so undo keeps them) – not a change of its own. */
  private _attachSources(add: Record<string, Cfg>) {
    const put = (c: Cfg) => ({ ...c, __sources: { ...(c.__sources ?? {}), ...add } });
    this._config = put(this._config);
    this._past = this._past.map(put);
    this._future = this._future.map(put);
    this._sent = this._main();
  }

  /** The lists of the opened pop-up dashboards that hold pop-ups (only the views the source names). */
  private _srcLists(only?: OverlaySource): { url: string; list: Cfg[]; path: Path }[] {
    const out: { url: string; list: Cfg[]; path: Path }[] = [];
    for (const [url, cfg] of Object.entries((this._config.__sources ?? {}) as Record<string, Cfg>)) {
      if (only && only.dashboard !== url) continue;
      const wanted = only && (only.views ?? (only.view !== undefined ? [only.view] : undefined));
      (cfg.views ?? []).forEach((v: Cfg, vi: number) => {
        if (wanted && !wanted.some((w) => w === vi || w === v.path || w === v.title || String(w) === String(vi))) return;
        if (Array.isArray(v.cards)) out.push({ url, list: v.cards, path: ["__sources", url, "views", vi, "cards"] });
        if (Array.isArray(v.sections)) out.push({ url, list: v.sections, path: ["__sources", url, "views", vi, "sections"] });
      });
    }
    return out;
  }

  /** "#hash" links used anywhere but in the pop-ups themselves (dock, actions, menus). */
  private _usedLinks(): Set<string> {
    const strip = (o: any): any => {
      if (Array.isArray(o)) return o.map(strip);
      if (!o || typeof o !== "object") return o;
      if (popupOf(o)) return null;
      return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, strip(v)]));
    };
    return new Set(JSON.stringify(strip(this._main())).match(/#[A-Za-z0-9_-]+/g) ?? []);
  }

  /** What a pop-up shows: a standalone pop-up's own `cards`, or the cards after it in its stack. */
  private _popContent(card: Cfg): Cfg[] {
    if (card.type === "custom:bubble-card" && Array.isArray(card.cards)) return card.cards;
    const list: Cfg[] = Array.isArray(card.cards) ? card.cards : [];
    const i = list.findIndex((c) => popupOf(c));
    if (i < 0) return [];
    const p = list[i];
    return p.type === "custom:bubble-card" && Array.isArray(p.cards) ? p.cards : list.slice(i + 1);
  }

  private _popEls: ChildEl[] = [];

  /**
   * Shows a pop-up in the preview: its content drawn in a sheet over the dashboard
   * (inside it, so it gets the dashboard's look). Bubble Card opens its pop-ups from
   * the URL, which HA rewrites while editing – so the studio draws them itself.
   */
  private _showPopup(hash: string) {
    const at = this._popPath(hash);
    const card = (at ? get(this._config, at) : undefined) ?? this._srcPops?.flatMap((s) => s.items).find((p) => p.hash === hash)?.card;
    const phone = preview.mode === "mobile";
    // on a phone over its screen (the page scrolls under it), else over the dashboard
    const dash = (this._dash as any)?.shadowRoot?.querySelector(phone ? ".pv-frame.phone, .dash" : ".dash") as HTMLElement | undefined;
    if (!card || !dash) return;
    const info = popupOf(card)!;
    const p = info.card;
    // the same one again (after a change): its cards are updated in place, unchanged ones kept
    let sheet = this._popOpen === hash ? dash.querySelector<HTMLElement>(":scope > .glass-studio-pop") : null;
    if (!sheet) {
      this._closePopup();
      sheet = document.createElement("div");
      sheet.className = "glass-studio-pop";
      // the cards in a box as tall as they are: Bubble Card stacks them, it does not stretch them
      const body = document.createElement("div");
      body.className = "pop-body";
      body.style.cssText = "display:flex;flex-direction:column;gap:14px";
      sheet.appendChild(body);
      if (getComputedStyle(dash).position === "static") dash.style.position = "relative";
      dash.appendChild(sheet);
    }
    const body = sheet.querySelector<HTMLElement>(":scope > .pop-body")!;
    // drawn as Bubble Card draws it: from its top margin down to the bottom of the screen (a negative
    // margin only takes back the room of a hidden header – the pop-up still starts at the top),
    // width_desktop wide (540px by default; the whole screen on a phone), its own background
    const top = String((phone ? p.margin_top_mobile : p.margin_top_desktop) ?? "0px");
    const width = phone ? "100%" : `min(100%, ${p.width_desktop ?? "540px"})`;
    const bg = `color-mix(in srgb, ${p.bg_color ?? "var(--card-background-color, #fff)"} ${p.bg_opacity ?? 88}%, transparent)`;
    const blur = `${parseFloat(p.bg_blur ?? 10) || 0}px`;
    sheet.style.cssText =
      `position:absolute;z-index:50;left:50%;top:max(0px, ${/^-?\d+$/.test(top) ? `${top}px` : top});bottom:0;transform:translateX(-50%);width:${width};box-sizing:border-box;overflow:auto;padding:18px;` +
      `border-radius:${p.border_radius ?? "32px"} ${p.border_radius ?? "32px"} 0 0;background:${bg};-webkit-backdrop-filter:blur(${blur});backdrop-filter:blur(${blur});` +
      "box-shadow:0 -6px 40px rgba(0,0,0,.2);color:var(--primary-text-color)";
    const content = this._popContent(card);
    const els = buildChildren(content as any, this.hass, { nested: false, glass: "frosted", mode: preview.mode as any, reuse: this._popEls });
    const keep = new Set<Element>(els);
    for (const n of [...body.children]) if (!keep.has(n)) n.remove();
    // Bubble's header as Bubble draws it: not when hidden (show_header: false), nor when the
    // pop-up has its own header card (name, close button) – also one nested in a panel
    if (p.show_header !== false && !JSON.stringify(content).includes('"custom:glass-popup-header"')) {
      const head = document.createElement("div");
      head.className = "pop-head";
      head.style.cssText = "display:flex;align-items:center;gap:10px;font-size:20px;font-weight:600";
      // built from elements, not markup: the name and icon come from the dashboard's config
      const icon = document.createElement("ha-icon") as HTMLElement & { icon?: string };
      icon.icon = info.icon ?? "mdi:window-maximize";
      const name = document.createElement("span");
      name.textContent = info.name ?? hash;
      head.append(icon, name);
      body.appendChild(head);
    }
    for (const el of els) body.appendChild(el);
    if (!els.length) {
      const empty = document.createElement("div");
      empty.style.cssText = "opacity:.7;padding:30px;text-align:center;border:2px dashed rgba(127,127,127,.4);border-radius:16px";
      empty.textContent = t("This pop-up has no cards yet – add them in its settings.");
      body.appendChild(empty);
    }
    if (this.hass) forward(els, this.hass);
    this._popEls = els;
    this._popOpen = hash;
    requestAnimationFrame(() => sheet!.isConnected && (this._popTop = Math.max(8, sheet!.getBoundingClientRect().top - 44)));
    this._popAt = at;
  }

  /**
   * After the device changed: the same pop-up again, as this device has it (its own view of the
   * source may still be loading – then once it is). A pick inside the old one moves to the new one.
   */
  private _reopen(hash: string, moveSel: boolean, tries = 0) {
    requestAnimationFrame(() => {
      const at = this._popPath(hash);
      const loading = this._srcKey !== JSON.stringify(this._sources()) || this._sources().some((s) => !this._srcPops?.some((p) => p.dashboard === s.dashboard));
      if (!at && loading && tries < 40) return void setTimeout(() => this._reopen(hash, moveSel, tries + 1), 150);
      this._closePopup();
      if (!at && !this._srcPops?.some((s) => s.items.some((p) => p.hash === hash))) {
        if (moveSel) this._sel = [];
        return;
      }
      if (moveSel && at) this._sel = at;
      this._showPopup(hash);
    });
  }

  /** Where the open pop-up sits in the config (undefined: shown only, from a YAML dashboard). */
  declare _popAt?: Path;

  /** A pop-up's place: this dashboard's own overlay, else an opened pop-up dashboard. */
  private _popPath(hash: string): Path | undefined {
    const ov = this._areas().find((a) => a.name === "overlay");
    const local = (ov ? (get(this._config, ov.path) ?? []) : []) as Cfg[];
    const i = local.findIndex((c) => popupOf(c)?.hash === hash);
    if (ov && i >= 0) return [...ov.path, i];
    // the previewed device's sources only: a phone may take its pop-ups from another view
    for (const l of this._sources().flatMap((src) => this._srcLists(src))) {
      const j = l.list.findIndex((c) => popupOf(c)?.hash === hash);
      if (j >= 0) return [...l.path, j];
    }
    return undefined;
  }

  /** The list a pop-up's cards are in: a standalone pop-up's `cards`, else its stack's (after the pop-up card). */
  private _popList(at: Path): Path {
    const node = get(this._config, at) as Cfg;
    if (node?.type === "custom:bubble-card" && Array.isArray(node.cards)) return [...at, "cards"];
    const list: Cfg[] = Array.isArray(node?.cards) ? node.cards : [];
    const i = list.findIndex((c) => popupOf(c));
    const p = list[i];
    return p?.type === "custom:bubble-card" && Array.isArray(p.cards) ? [...at, "cards", i, "cards"] : [...at, "cards"];
  }

  /** The pop-up a picked node belongs to (the pop-up itself or anything in it). */
  private _popOfSel(sel: Path): string | undefined {
    const ov = this._areas().find((a) => a.name === "overlay");
    const inOverlay = ov && within(sel, ov.path) && sel.length > ov.path.length;
    const inSource = sel[0] === "__sources";
    if (!inOverlay && !inSource) return undefined;
    // the item in its list: one past the overlay, or a view's cards / sections entry
    const n = inOverlay ? ov!.path.length + 1 : 6;
    if (sel.length < n) return undefined;
    return popupOf((get(this._config, sel.slice(0, n)) ?? {}) as Cfg)?.hash;
  }

  private _closePopup() {
    this._popOpen = undefined;
    this._popAt = undefined;
    this._popEls = [];
    (this._dash as any)?.shadowRoot?.querySelectorAll(".glass-studio-pop").forEach((n: Element) => n.remove());
  }

  private _createPopup(list: Path) {
    const name = this._newPop.trim();
    if (!name) return;
    const slug = name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    this._newPop = "";
    this._insert(list, {
      type: "custom:bubble-card",
      card_type: "pop-up",
      hash: `#${slug || "popup"}`,
      name,
      icon: "mdi:window-maximize",
      cards: [{ type: "custom:glass-panel", layout: "column", cards: [] }],
    });
  }

  /**
   * The overlay split the way people think of it: the bottom bar (dock and anything else
   * floating) and one Pop-ups group – this dashboard's own and those loaded from another.
   */
  private _overlayTree(nodes: (list: Cfg[], path: Path, depth: number, only?: (c: Cfg) => boolean) => unknown[]) {
    const ov = this._areas().find((a) => a.name === "overlay");
    if (!ov) return nothing;
    const list = (get(this._config, ov.path) ?? []) as Cfg[];
    const bar = list.filter((c) => !popupOf(c));
    const own = list.filter((c) => popupOf(c));
    const srcs = this._srcPops ?? [];
    const used = this._usedLinks();
    const unused = (hash: string) => (used.has(hash) ? [] : [t("unused")]);
    const badges = ov.own ? [t(MODE_NAMES[preview.mode])] : [];
    return html`${bar.length
        ? html`<div class="area">
            <div class="node static" style="--depth:0">
              ${this._twisty("bar")}
              <ha-icon .icon=${"mdi:dock-bottom"}></ha-icon>
              <span class="label"><b>${t("Bottom bar")}</b><small>${t("Over the whole dashboard")}</small></span>
              ${badges.map((b) => html`<span class="badge">${b}</span>`)}
            </div>
            ${this._isOpen("bar") ? nodes(list, ov.path, 1, (c) => !popupOf(c)) : nothing}
          </div>`
        : nothing}
      ${!hasBubble() && !own.length && !srcs.length
        ? nothing
        : html`<div class="area">
        ${this._row(t("Pop-ups"), `${own.length + srcs.reduce((n, s) => n + s.items.length, 0)} · ${t("opened by a #link")}`, "mdi:window-maximize", ov.path, 0, { badges, fold: "pops" })}
        ${hasBubble() ? nothing : html`<div class="tree-notice">${bubbleNotice()}</div>`}
        ${this._isOpen("pops")
          ? html`${nodes(list, ov.path, 1, (c) => !!popupOf(c))}
        ${srcs.map((src) =>
          src.editable
            ? html`<div class="node static" style="--depth:1">
                  ${this._twisty()}
                  <ha-icon .icon=${"mdi:link-variant"}></ha-icon>
                  <span class="label"><b>${src.label}</b><small>${t("Pop-ups from another dashboard")} · ${t("saved there with Save")}</small></span>
                  <a class="ext" href=${`${src.url}?edit=1`} target="_blank" title=${t("Edit there")}><ha-icon .icon=${"mdi:open-in-new"}></ha-icon></a>
                </div>
                ${this._srcLists(src.src).map((l) => nodes(l.list, l.path, 2, (c) => !!popupOf(c)))}`
            : src.items.map(
            (p) => html`<div class="node ${this._popOpen === p.hash ? "on" : ""}" style="--depth:1" @click=${() => this._showPopup(p.hash)}>
              ${this._twisty()}
              <ha-icon .icon=${p.icon ?? "mdi:window-maximize"}></ha-icon>
              <span class="label"><b>${p.name ?? p.hash}</b><small>${p.hash} · ${t("edited in")} ${src.label}</small></span>
              ${unused(p.hash).map((b) => html`<span class="badge warn" title=${t("Nothing on this dashboard opens it")}>${b}</span>`)}
              <a class="ext" href=${`${src.url}?edit=1`} target="_blank" title=${t("Edit there")} @click=${(e: Event) => e.stopPropagation()}
                ><ha-icon .icon=${"mdi:open-in-new"}></ha-icon
              ></a>
            </div>`,
          ),
        )}
        <div class="node add" style="--depth:1" @click=${() => (this._sel = ov.path)}>
          ${this._twisty()}
          <ha-icon .icon=${"mdi:plus"}></ha-icon>
          <span class="label"><b>${t("New pop-up")}</b></span>
        </div>`
          : nothing}
      </div>`}`;
  }

  /* ── schematic view: the layout as labelled boxes, no real cards ─────────── */

  /** Schematic (wireframe) instead of the live preview. */
  declare _wire: boolean;
  private _wpress?: { path: Path; label: string; x: number; y: number; el: HTMLElement; dx: number; dy: number; w: number; h: number };
  /** Schematic drag: a 1:1 copy of the box under the pointer. */
  private _wclone?: HTMLElement;
  declare _wdrag?: { path: Path; label: string };

  /** The dashboard's grid for the previewed device, as the dashboard card builds it. */
  private _wireGrid() {
    const mode = preview.mode;
    const c = (configForMode(this._config as any, mode) ?? this._config) as Cfg;
    const preset = PRESETS[(c.preset ?? "classic") as Preset] ?? PRESETS.classic;
    const own = parseAreas(c.grid?.areas);
    let template = own.length ? own : parseAreas(preset.areas.map((r: string) => `"${r}"`));
    const shown = new Map(this._areas().map((a) => [a.name.replace(/^areas\./, ""), a]));
    const width = Math.max(1, ...template.map((r) => r.length));
    for (const n of shown.keys()) if (n !== "overlay" && !areaOrder(template).includes(n)) template = [...template, Array(width).fill(n)];
    // empty areas stay visible in the schematic: that is where new cards go
    template = template.filter((r) => r.some((n) => shown.has(n)));
    let columns = c.grid?.columns ?? (own.length ? `repeat(${width}, minmax(0, 1fr))` : preset.columns(c.left_width ?? "minmax(320px, 0.36fr)"));
    if (mode === "mobile" && !c.grid) {
      template = areaOrder(template).map((n) => [n]);
      columns = "minmax(0, 1fr)";
    }
    return { template, columns, shown };
  }

  /* spans in a grid panel: view_layout.span (columns) and row_span (rows) */
  declare _resizing?: { path: Path; span: number; rows: number };
  private _rz?: { path: Path; x: number; y: number; w: number; h: number; span: number; rows: number; cols: number };

  private _spanOf(card: Cfg): { span: number; rows: number } {
    const eff = (configForMode(card as any, preview.mode as any) ?? card) as Cfg;
    return { span: Number(eff.view_layout?.span) || 1, rows: Number(eff.view_layout?.row_span) || 1 };
  }

  /** The card with a new span (1 = no key). */
  private _withSpan(card: Cfg, span: number, rows: number): Cfg {
    const vl = { ...(card.view_layout ?? {}) };
    if (span > 1) vl.span = span;
    else delete vl.span;
    if (rows > 1) vl.row_span = rows;
    else delete vl.row_span;
    const { view_layout: _, ...rest } = card;
    return Object.keys(vl).length ? { ...rest, view_layout: vl } : rest;
  }

  /** Columns of the grid panel a card sits in (0: not in a grid). */
  private _gridCols(path: Path): number {
    const parent = get(this._config, path.slice(0, -2)) as Cfg | undefined;
    if (!parent || Array.isArray(parent) || parent.layout !== "grid") return 0;
    const eff = (configForMode(parent as any, preview.mode as any) ?? parent) as Cfg;
    return trackList(eff.column_widths).length || Number(eff.columns) || 3;
  }

  /** How the container of a card lays it out: "grid", "row" or "column" (an area is a column). */
  private _parentLayout(path: Path): "grid" | "row" | "column" {
    if (path[path.length - 2] !== "cards") return "column";
    const parent = get(this._config, path.slice(0, -2)) as Cfg | undefined;
    if (!parent || Array.isArray(parent)) return "column";
    const eff = (configForMode(parent as any, preview.mode as any) ?? parent) as Cfg;
    return eff.layout === "grid" ? "grid" : eff.layout === "row" ? "row" : "column";
  }

  /**
   * Width and height of a card in its container, as view_layout:
   *   row:    width as its content / fill (grow) / fixed (basis px or %); height as the row / fixed px
   *   column: height as its content / fill (grow) / fixed px; width full / fixed px or %
   *   grid:   the cells it spans, plus a fixed height
   */
  /**
   * Where the card shows: the devices it is on and, in a grid, the cells it takes – one
   * collapsible box with that on its second line (open or closed as left, per browser).
   */
  private _placement(sel: Path, card: Cfg) {
    const grid = this._parentLayout(sel) === "grid";
    const cols = grid ? this._gridCols(sel) : 0;
    const cur = this._spanOf(card);
    const setS = (span: number, rows: number) => this._set(this._with(sel, this._withSpan(card, span, rows)));
    const on = DEVICE_MODES.filter((m) => shownOn(card, m));
    const summary = [
      grid ? `${cur.span} × ${cur.rows}` : "",
      on.length === DEVICE_MODES.length ? t("everywhere") : on.length ? on.map((m) => t(MODE_NAMES[m])).join(", ") : t("hidden"),
    ]
      .filter(Boolean)
      .join(" · ");
    const step = (label: string, v: number, max: number, set: (n: number) => void) =>
      html`<span class="stepper"
        >${t(label)} <button ?disabled=${v <= 1} @click=${() => set(v - 1)}>−</button><b>${v}</b><button ?disabled=${v >= max} @click=${() => set(v + 1)}>+</button></span
      >`;
    return html`<ha-expansion-panel
      outlined
      class="place"
      .header=${t("Placement")}
      .secondary=${summary}
      .expanded=${this._placeOpen}
      @expanded-changed=${(e: CustomEvent) => {
        if (e.target !== e.currentTarget) return;
        this._placeOpen = !!e.detail?.expanded;
        try {
          localStorage.setItem(PLACE_KEY, this._placeOpen ? "1" : "0");
        } catch {
          /* private mode */
        }
      }}
    >
      <div class="place-grid">
        <span>${t("Shown on")}</span>
        <span class="chips">
          ${DEVICE_MODES.map(
            (m) => html`<button class=${shownOn(card, m) ? "on" : ""} @click=${() => this._set(this._with(sel, withShown(card, m, !shownOn(card, m))))}>
              ${t(MODE_NAMES[m])}
            </button>`,
          )}
        </span>
        ${grid
          ? html`<span>${t("Size in the grid")}</span>
              <span class="steppers">${step("Width", cur.span, cols, (n) => setS(n, cur.rows))} ${step("Height", cur.rows, 6, (n) => setS(cur.span, n))}</span>`
          : nothing}
      </div>
    </ha-expansion-panel>`;
  }
  private _placeOpen = (() => {
    try {
      return localStorage.getItem(PLACE_KEY) === "1";
    } catch {
      return false;
    }
  })();

  private _onResizeMove = (e: PointerEvent) => {
    const r = this._rz;
    if (!r) return;
    const GAP = 8;
    const cw = (r.w - GAP * (r.span - 1)) / r.span;
    const ch = (r.h - GAP * (r.rows - 1)) / r.rows;
    const span = Math.max(1, Math.min(r.cols, Math.round((r.w + e.clientX - r.x + GAP) / (cw + GAP))));
    const rows = Math.max(1, Math.min(6, Math.round((r.h + e.clientY - r.y + GAP) / (ch + GAP))));
    if (span !== this._resizing?.span || rows !== this._resizing?.rows) this._resizing = { path: r.path, span, rows };
  };

  private _onResizeUp = () => {
    window.removeEventListener("pointermove", this._onResizeMove);
    window.removeEventListener("pointerup", this._onResizeUp);
    const r = this._rz;
    const z = this._resizing;
    this._rz = undefined;
    this._resizing = undefined;
    if (!r || !z || (z.span === r.span && z.rows === r.rows)) return;
    this._set(this._with(r.path, this._withSpan(get(this._config, r.path) as Cfg, z.span, z.rows)));
    this._sel = r.path;
  };

  private _wireBox(card: Cfg, path: Path, parentLayout: string): unknown {
    const mode = preview.mode;
    if (!shownOn(card, mode as any)) return nothing;
    const sp = this._resizing && same(this._resizing.path, path) ? this._resizing : this._spanOf(card);
    const place = parentLayout === "grid" ? `grid-column:span ${sp.span};grid-row:span ${sp.rows}` : "";
    const handle =
      parentLayout === "grid"
        ? html`<span
            class="wresize"
            title=${t("Drag to span more columns or rows")}
            @click=${(e: Event) => e.stopPropagation()}
            @pointerdown=${(e: PointerEvent) => {
              e.stopPropagation();
              e.preventDefault();
              const box = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect();
              const cur = this._spanOf(card);
              this._rz = { path, x: e.clientX, y: e.clientY, w: box.width, h: box.height, span: cur.span, rows: cur.rows, cols: this._gridCols(path) || 3 };
              window.addEventListener("pointermove", this._onResizeMove);
              window.addEventListener("pointerup", this._onResizeUp);
            }}
          ></span>${sp.span > 1 || sp.rows > 1 ? html`<span class="wspan">${sp.span}×${sp.rows}</span>` : nothing}`
        : nothing;
    const d = describeCard(card);
    const k = kids(card);
    const on = same(path, this._sel);
    const name = card.name ? String(card.name) : d.title;
    const dragging = this._wdrag && same(this._wdrag.path, path);
    const common = (cls: string) => `wbox ${cls} ${on ? "on" : ""} ${dragging ? "dragging" : ""}`;
    const press = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const el = e.currentTarget as HTMLElement;
      const r = el.getBoundingClientRect();
      this._wpress = { path, label: name, x: e.clientX, y: e.clientY, el, dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height };
    };
    const click = (e: Event) => {
      e.stopPropagation();
      if (!this._dragged) this._sel = path;
    };
    const tools = html`<span class="wtools">
      ${this._menuBtn(path, "plain")}
      <button title=${t("Remove")} @pointerdown=${(e: Event) => e.stopPropagation()} @click=${(e: Event) => {
        e.stopPropagation();
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const b = this._box(r)!;
        this._del = { path, x: b.x + 20, y: b.y + 30, label: name };
      }}><ha-icon .icon=${"mdi:delete-outline"}></ha-icon></button>
    </span>`;
    if (k) {
      const layout = card.layout ?? "column";
      const cols = card.columns ?? 3;
      const style =
        layout === "grid"
          ? `display:grid;grid-template-columns:repeat(${mode === "mobile" && card.responsive?.mobile?.columns ? card.responsive.mobile.columns : cols},minmax(0,1fr))`
          : `display:flex;flex-direction:${layout === "row" ? "row" : "column"}`;
      return html`<div class=${common("wpanel")} style=${place} data-path=${JSON.stringify(path)} data-layout=${layout} @pointerdown=${press} @click=${click}>
        <div class="whead"><ha-icon .icon=${"mdi:view-dashboard-outline"}></ha-icon>${name}<small>${t(layout === "grid" ? "Grid" : layout === "row" ? "Line" : "Column")}${layout === "grid" ? ` ${cols}` : ""}</small>${tools}</div>
        <div class="wbody" style=${style}>
          ${k.list.map((c, i) => this._wireBox(c, [...path, k.key, i], layout))}
          ${this._wireAdd([...path, k.key], k.list.length)}
        </div>
        ${handle}
      </div>`;
    }
    return html`<div class=${common("wcard")} style=${place} data-path=${JSON.stringify(path)} @pointerdown=${press} @click=${click}>
      <ha-icon .icon=${d.icon}></ha-icon>
      <span class="wname"><b>${name}</b>${card.name ? html`<small>${d.title}</small>` : d.sub ? html`<small>${d.sub}</small>` : nothing}</span>
      ${tools} ${handle}
    </div>`;
  }

  /** The always visible "+" at the end of a panel or area in the schematic. */
  private _wireAdd(list: Path, i: number) {
    // with a mouse the blue "+" follows the pointer: this one stays only where nothing is yet
    return html`<button
      class="wadd ${i > 0 ? "filled" : ""}"
      title=${t("Add a card here")}
      @pointerdown=${(e: Event) => e.stopPropagation()}
      @click=${(e: Event) => {
        e.stopPropagation();
        const b = this._box((e.currentTarget as HTMLElement).getBoundingClientRect())!;
        this._addAt = { list, i, x: b.x + b.w / 2, y: b.y + b.h / 2 };
      }}
    >
      <ha-icon .icon=${"mdi:plus"}></ha-icon>
    </button>`;
  }

  private _wireView() {
    // an open pop-up: its cards, as the dashboard's areas are drawn
    if (this._popOpen) {
      const at = this._popAt;
      if (!at) return html`<div class="hint">${t("This pop-up is in a YAML dashboard – it can only be shown here, not edited.")}</div>`;
      const list = this._popList(at);
      const cards = (get(this._config, list) ?? []) as Cfg[];
      const info = popupOf((get(this._config, at) ?? {}) as Cfg);
      return html`<div class="wire" style="grid-template-columns:minmax(0, 1fr)" @pointermove=${this._onWireMove} @pointerleave=${this._onWireLeave}>
        <section class="warea" data-path=${JSON.stringify(list)} data-layout="column">
          <div class="wlabel">${t("Pop-up")}: ${info?.name ?? this._popOpen}</div>
          ${cards.map((c, i) => this._wireBox(c, [...list, i], "column"))}
          ${this._wireAdd(list, cards.length)}
        </section>
      </div>`;
    }
    const { template, columns, shown } = this._wireGrid();
    const names = areaOrder(template);
    const overlay = shown.get("overlay");
    const area = (n: string) => {
      const a = shown.get(n);
      if (!a) return nothing;
      const list = (get(this._config, a.path) ?? []) as Cfg[];
      const title = t(AREA_TITLES[n]?.[0] ?? (n === "overlay" ? "Bottom bar and pop-ups" : n));
      return html`<section class="warea" style="grid-area:${n}" data-path=${JSON.stringify(a.path)} data-layout="column">
        <div class="wlabel">${title}</div>
        ${list.map((c, i) => this._wireBox(c, [...a.path, i], "column"))}
        ${this._wireAdd(a.path, list.length)}
      </section>`;
    };
    return html`<div
        class="wire"
        style="grid-template-columns:${columns};grid-template-areas:${template.map((r) => `"${r.join(" ")}"`).join(" ")}"
        @pointermove=${this._onWireMove}
        @pointerleave=${this._onWireLeave}
      >
        ${names.map(area)}
      </div>
      ${overlay ? html`<div class="wire wire-overlay" @pointermove=${this._onWireMove} @pointerleave=${this._onWireLeave}>${area("overlay")}</div>` : nothing}`;
  }

  /** Schematic: the "+" for the pointer – between the boxes of an area / panel, or on a card's edge. */
  private _wireGapAt(e: PointerEvent): typeof this._plus {
    const el = e
      .composedPath()
      .find((n) => n instanceof HTMLElement && n.dataset?.path && this.renderRoot.contains(n) && !n.classList.contains("wclone")) as HTMLElement | undefined;
    if (!el) return undefined;
    const path = JSON.parse(el.dataset.path!) as Path;
    const isArea = el.classList.contains("warea");
    const node = isArea ? undefined : (get(this._config, path) as Cfg);
    const k = node && kids(node);
    if (!isArea && !k) return this._edgeAt(e, { el, path }, el.getBoundingClientRect());
    const list = isArea ? path : [...path, k!.key];
    const rects: (DOMRect | undefined)[] = [];
    for (const c of el.querySelectorAll<HTMLElement>("[data-path]")) {
      if (c.classList.contains("wclone")) continue;
      const p = JSON.parse(c.dataset.path!) as Path;
      if (p.length === list.length + 1 && same(p.slice(0, -1), list)) rects[p[p.length - 1] as number] = c.getBoundingClientRect();
    }
    const n = ((get(this._config, list) as Cfg[] | undefined) ?? []).length;
    rects.length = n;
    return this._gapPlus(e, list, rects, isArea ? "column" : node!.layout === "grid" && node!.masonry ? "masonry" : (node!.layout ?? "column"), () => el.getBoundingClientRect());
  }

  private _onWireMove = (e: PointerEvent) => {
    if (this._wpress || this._wdrag || this._addAt) return;
    const path = e.composedPath();
    if (path.some((n) => n instanceof Element && n.classList.contains("wtools"))) {
      if (this._plus) this._plus = undefined;
      return;
    }
    this._gapEvent = { clientX: e.clientX, clientY: e.clientY, composedPath: () => path } as unknown as PointerEvent;
    if (!this._gapRaf)
      this._gapRaf = requestAnimationFrame(() => {
        this._gapRaf = 0;
        const g = this._gapEvent && this._wireGapAt(this._gapEvent);
        if (!g) this._plus = undefined;
        else if (!this._plus || !same(g.list, this._plus.list) || g.i !== this._plus.i || Math.abs(g.x - this._plus.x) > 1 || Math.abs(g.y - this._plus.y) > 1) this._plus = g;
      });
  };

  private _onWireLeave = (e: PointerEvent) => {
    // onto the "+" itself: keep it
    if ((e.relatedTarget as Element | null)?.closest?.(".plus")) return;
    this._plus = undefined;
  };

  /** Where a schematic drop goes: before / after a box (its container's axis), into a panel's middle. */
  private _wireTarget(e: PointerEvent): GlassStudio["_target"] {
    const from = this._wdrag!.path;
    const el = e
      .composedPath()
      .find((n) => n instanceof HTMLElement && n.dataset?.path && this.renderRoot.contains(n) && !n.classList.contains("wclone")) as HTMLElement | undefined;
    // over its own place (or inside itself): stays where it is
    if (!el || within(JSON.parse(el.dataset.path!), from)) return undefined;
    const path = JSON.parse(el.dataset.path!) as Path;
    const r = el.getBoundingClientRect();
    const isArea = el.classList.contains("warea");
    const node = isArea ? undefined : (get(this._config, path) as Cfg);
    const k = node && kids(node);
    const inner = e.clientX > r.left + 16 && e.clientX < r.right - 16 && e.clientY > r.top + 16 && e.clientY < r.bottom - 16;
    if (isArea || (k && inner)) {
      const list = isArea ? path : [...path, k!.key];
      const n = ((get(this._config, list) as Cfg[]) ?? []).length;
      return { list, i: n, into: this._box(r), label: `${t("Into")} ${isArea ? t(AREA_TITLES[String(path[path.length - 1])]?.[0] ?? "") : (node!.name ?? describeCard(node!).title)}` };
    }
    const list = path.slice(0, -1);
    const i = path[path.length - 1] as number;
    const parent = get(this._config, list.slice(0, -1)) as Cfg | undefined;
    const layout = Array.isArray(parent) ? "column" : (parent?.layout ?? "column");
    const across = layout === "row" || layout === "grid";
    const after = across ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
    const line = across
      ? this._box(new DOMRect((after ? r.right : r.left) - 2, r.top, 4, r.height))
      : this._box(new DOMRect(r.left, (after ? r.bottom : r.top) - 2, r.width, 4));
    const nm = node?.name ?? (node ? describeCard(node).title : "");
    return { list, i: after ? i + 1 : i, line, label: `${t(after ? "After" : "Before")} ${nm}` };
  }

  /** Text typed into the card search. */
  declare _q: string;
  /** Card picker, "From another dashboard": the dashboard chosen and its cards. */
  declare _impDash?: string;
  declare _impCards?: { card: Cfg; depth: number; where: string }[] | "loading" | "error";

  /** Every card of a dashboard (also inside stacks, panels and areas), for importing one. */
  private async _loadImport(url: string) {
    this._impDash = url;
    this._impCards = "loading";
    try {
      const cfg = await loadConfig(this.hass as any, url === "" ? null : url);
      const out: { card: Cfg; depth: number; where: string }[] = [];
      const walk = (c: any, depth: number, where: string) => {
        if (!c || typeof c !== "object" || depth > 6) return;
        if (typeof c.type === "string") out.push({ card: c, depth, where });
        for (const [k, v] of Object.entries(c)) {
          if (k === "type") continue;
          if (Array.isArray(v)) v.forEach((x) => x && typeof x === "object" && typeof x.type === "string" && walk(x, depth + 1, where));
          else if (v && typeof v === "object" && typeof (v as any).type === "string") walk(v, depth + 1, where);
          else if (v && typeof v === "object" && !Array.isArray(v) && k === "areas")
            for (const list of Object.values(v)) if (Array.isArray(list)) list.forEach((x) => walk(x, depth + 1, where));
        }
      };
      (cfg.views ?? []).forEach((v: any, vi: number) => {
        const where = String(v.title ?? v.path ?? vi + 1);
        (v.cards ?? []).forEach((c: any) => walk(c, 0, where));
        (v.sections ?? []).forEach((x: any) => (x.cards ?? []).forEach((c: any) => walk(c, 0, where)));
      });
      if (this._impDash === url) this._impCards = out;
    } catch {
      if (this._impDash === url) this._impCards = "error";
    }
  }

  /** The picker's "From another dashboard": a dashboard, then any of its cards – a copy is added. */
  private _importGroup(pick: (card: Cfg) => void, hit: (...s: (string | undefined)[]) => boolean) {
    if (!this._dashList) listDashboards(this.hass as any).then((l) => (this._dashList = l)).catch(() => (this._dashList = []));
    const list = Array.isArray(this._impCards) ? this._impCards.filter((c) => { const d = describeCard(c.card); return hit(d.title, d.sub, c.card.type, c.where); }) : [];
    return html`<select
        class="search"
        @change=${(e: Event) => {
          const v = (e.target as HTMLSelectElement).value;
          if (v !== "-") this._loadImport(v);
        }}
      >
        <option value="-" ?selected=${this._impDash === undefined}>${t("Choose a dashboard…")}</option>
        ${(this._dashList ?? []).map((d) => html`<option value=${d.url ?? ""} ?selected=${this._impDash === (d.url ?? "")}>${d.title}</option>`)}
      </select>
      ${this._impCards === "loading"
        ? html`<div class="hint">${t("Loading…")}</div>`
        : this._impCards === "error"
          ? html`<div class="hint">${t("The dashboard could not be loaded.")}</div>`
          : this._impCards && !list.length
            ? html`<div class="hint">${t("No cards")}</div>`
            : list.map(({ card, depth, where }) => {
                const d = describeCard(card);
                return html`<button class="pick" style=${depth ? `margin-left:${Math.min(depth, 4) * 14}px` : ""} @click=${() => pick(structuredClone(card))}>
                  <ha-icon .icon=${d.icon}></ha-icon>
                  <span><b>${d.title}</b><small>${[where, d.sub].filter(Boolean).join(" · ")}</small></span>
                </button>`;
              })}`;
  }

  /**
   * Every card one can add: the glass cards first, then Home Assistant's own and all
   * custom cards installed (HACS) – the ones the user already has elsewhere.
   */
  private _choices(pick: (card: Cfg) => void) {
    const q = (this._q ?? "").trim().toLowerCase();
    const hit = (...s: (string | undefined)[]) => !q || s.some((x) => x?.toLowerCase().includes(q));
    const glass = NEW_CARDS.filter(([type, name, , desc]) => type !== "markdown" && hit(type, t(name), t(desc), name));
    const firstOf = (d: string) => Object.keys(this.hass?.states ?? {}).find((e) => e.startsWith(`${d}.`)) ?? "";
    const all: [string, string, string, () => Cfg][] = [
      ["tile", "Tile", "mdi:card-outline", () => ({ type: "tile", entity: firstOf("light") || firstOf("switch") })],
      ["entities", "Entities", "mdi:format-list-bulleted", () => ({ type: "entities", entities: [firstOf("light") || firstOf("sensor")].filter(Boolean) })],
      ["button", "Button", "mdi:gesture-tap-button", () => ({ type: "button", entity: firstOf("light") || firstOf("switch") })],
      ["markdown", "Markdown", "mdi:language-markdown", () => ({ type: "markdown", content: "Text" })],
      ["weather-forecast", "Weather forecast", "mdi:weather-partly-cloudy", () => ({ type: "weather-forecast", entity: firstOf("weather") })],
      ["thermostat", "Thermostat", "mdi:thermostat", () => ({ type: "thermostat", entity: firstOf("climate") })],
      ["media-control", "Media control", "mdi:play-pause", () => ({ type: "media-control", entity: firstOf("media_player") })],
      ["history-graph", "History graph", "mdi:chart-line", () => ({ type: "history-graph", entities: [firstOf("sensor")].filter(Boolean) })],
      ["gauge", "Gauge", "mdi:gauge", () => ({ type: "gauge", entity: firstOf("sensor") })],
      ["picture-entity", "Picture entity", "mdi:image-outline", () => ({ type: "picture-entity", entity: firstOf("camera") || firstOf("light") })],
      ["map", "Map", "mdi:map-outline", () => ({ type: "map", entities: [firstOf("person")].filter(Boolean) })],
      ["area", "Area", "mdi:texture-box", () => ({ type: "area", area: Object.keys((this.hass as any)?.areas ?? {})[0] ?? "" })],
    ];
    const builtIn = all.filter(([type, name]) => hit(type, name, t(name)));
    const custom = ((window as any).customCards ?? [])
      .filter((c: any) => c?.type && !String(c.type).startsWith("glass-") && hit(c.type, c.name, c.description))
      .sort((a: any, b: any) => String(a.name ?? a.type).localeCompare(String(b.name ?? b.type)));
    const stubOf = (type: string): Cfg => {
      const cls = customElements.get(type) as unknown as { getStubConfig?: (h?: HomeAssistant) => Cfg } | undefined;
      try {
        return { type: `custom:${type}`, ...(cls?.getStubConfig?.(this.hass) ?? {}) };
      } catch {
        return { type: `custom:${type}` };
      }
    };
    // missing: what to install first – shown, not clickable
    const btn = (icon: string, name: string, desc: string, card: () => Cfg, missing?: string) => html`<button class="pick" ?disabled=${!!missing} @click=${() => pick(card())}>
      <ha-icon .icon=${icon}></ha-icon>
      <span><b>${name}</b>${missing ? html`<small class="missing">${missing}</small>` : desc ? html`<small>${desc}</small>` : nothing}</span>
    </button>`;
    // each kind of card folds away; a search opens the ones with hits
    const group = (key: string, title: string, n: number, body: unknown) =>
      n === 0
        ? nothing
        : html`<details class="pick-fold" ?open=${!!q && n > 0}>
            <summary class="pick-group">${title}${n > 0 ? html`<span class="count">${n}</span>` : nothing}</summary>
            <div class="picker">${body}</div>
          </details>`;
    return html`<div class="picker">
      <input
        class="search"
        type="search"
        placeholder=${t("Search cards (also HACS)…")}
        .value=${this._q ?? ""}
        @input=${(e: Event) => (this._q = (e.target as HTMLInputElement).value)}
      />
      ${group("glass", t("Glass cards"), glass.length, glass.map(([type, name, icon, desc]) => btn(icon, t(name), t(desc), () => stubFor(type, this.hass), missingFor(type))))}
      ${group("ha", t("Home Assistant cards"), builtIn.length, builtIn.map(([, name, icon, make]) => btn(icon, t(name), "", make)))}
      ${group("custom", t("Custom cards (HACS)"), custom.length, custom.map((c: any) => btn("mdi:puzzle-outline", c.name ?? c.type, c.description ?? "", () => stubOf(c.type))))}
      ${group("import", t("From another dashboard"), -1, this._importGroup(pick, hit))}
      ${group("other", t("Anything else"), -1, btn("mdi:code-braces", t("Other card (YAML)"), t("Any card by its YAML – switch the editor to code after adding"), () => ({ type: "markdown", content: "Change `type:` in this card's YAML to any card you like." })))}
    </div>`;
  }


  /** The wide YAML editor on / off: it opens on the picked card, else on the whole dashboard. */
  private _toggleWide() {
    this._wide = this._wide ? undefined : this._yamlScopes().card ? "card" : "dashboard";
    if (this._wide) this._hideInspector = false;
    this._yamlShown = undefined;
  }

  /** What the YAML editor can show for the picked node: the card itself and the panel it is in. */
  private _yamlScopes(): { card?: Path; panel?: Path } {
    const sel = this._sel;
    const node = sel.length ? get(this._config, sel) : undefined;
    const card = node && typeof node === "object" && !Array.isArray(node) ? sel : undefined;
    let panel: Path | undefined;
    for (let i = sel.length; i > 0 && !panel; i--) if ((get(this._config, sel.slice(0, i)) as Cfg)?.type === "custom:glass-panel") panel = sel.slice(0, i);
    return { card, panel };
  }

  /**
   * The wide YAML editor: the card, its panel or the whole dashboard as YAML, the preview
   * beside it following as you type. Text that doesn't parse is not applied.
   */
  private _yamlPane() {
    const scopes = this._yamlScopes();
    const scope = this._wide === "card" && !scopes.card ? (scopes.panel ? "panel" : "dashboard") : this._wide === "panel" && !scopes.panel ? "dashboard" : this._wide!;
    const path = scope === "card" ? scopes.card! : scope === "panel" ? scopes.panel! : [];
    const { __sources, ...dash } = this._config;
    const node = path.length ? get(this._config, path) : dash;
    // changed elsewhere (the tree, the preview, undo) or another node: fill the editor anew
    const json = JSON.stringify(node);
    const key = `${scope}|${JSON.stringify(path)}`;
    if (json !== this._yamlShown || key !== this._yamlKey) {
      this._yamlShown = json;
      this._yamlKey = key;
      this._yamlRev++;
      this._yamlErr = false;
    }
    const apply = (v: unknown) => {
      clearTimeout(this._yamlTimer);
      this._yamlTimer = window.setTimeout(() => {
        if (!v || typeof v !== "object" || Array.isArray(v) || (path.length && !(v as Cfg).type)) return void (this._yamlErr = true);
        this._yamlShown = JSON.stringify(v);
        this._set(path.length ? this._with(path, v as Cfg) : __sources ? { ...(v as Cfg), __sources } : (v as Cfg));
      }, 350);
    };
    const d = scopes.card ? describeCard(get(this._config, scopes.card) as Cfg) : undefined;
    const tab = (s: "card" | "panel" | "dashboard", label: string, on: boolean) =>
      html`<button class=${scope === s ? "on" : ""} ?disabled=${!on} @click=${() => ((this._wide = s), (this._yamlShown = undefined))}>${label}</button>`;
    return html`<div class="pane-title">
        <ha-icon .icon=${"mdi:code-json"}></ha-icon><span>${t("YAML")}</span>
        <span class="grow"></span>
        <span class="seg">
          ${tab("card", d?.title ?? t("Card"), !!scopes.card)} ${tab("panel", t("Panel"), !!scopes.panel)} ${tab("dashboard", t("Dashboard"), true)}
        </span>
        <button class="icon small" title=${t("Close")} @click=${() => this._toggleWide()}><ha-icon .icon=${"mdi:close"}></ha-icon></button>
      </div>
      <div class="hint">
        ${t(scope === "dashboard" ? "The whole dashboard." : scope === "panel" ? "The panel with all its cards." : "The picked card.")}
        ${t("The preview follows as you type; YAML that doesn't parse is not applied.")}
      </div>
      ${this._yamlErr ? html`<div class="yaml-err"><ha-icon .icon=${"mdi:alert-circle-outline"}></ha-icon>${t("Not valid YAML for this – the last valid version stays.")}</div>` : nothing}
      ${customElements.get("ha-yaml-editor")
        ? keyed(
            `${key}|${this._yamlRev}`,
            html`<ha-yaml-editor
              .hass=${this.hass}
              .defaultValue=${node}
              @value-changed=${(e: CustomEvent) => {
                e.stopPropagation();
                if (e.detail?.isValid === false) {
                  clearTimeout(this._yamlTimer);
                  this._yamlErr = true;
                } else {
                  this._yamlErr = false;
                  apply(e.detail?.value);
                }
              }}
            ></ha-yaml-editor>`,
          )
        : html`<div class="hint">${t("Home Assistant's YAML editor is not loaded yet – open a card's code editor once, then come back.")}</div>`}`;
  }
  private _yamlKey?: string;

  private _inspector() {
    const sel = this._sel;
    if (!sel.length) {
      if (!this._dashEditor) {
        this._dashEditor = makeEditor(dashboardSpec) as EditorEl;
        this._dashEditor!.addEventListener("config-changed", (e: Event) => {
          e.stopPropagation();
          const c = (e as CustomEvent).detail?.config;
          if (c) this._set(this._config.__sources ? { ...c, __sources: this._config.__sources } : c);
        });
      }
      return html`<div class="pane-title">${t("Dashboard")}</div>
        ${this._dashEditor}`;
    }
    this._dashEditor = undefined;
    const node = get(this._config, sel);
    // an area: its cards and adding one
    if (Array.isArray(node) || node === undefined) {
      const isOverlay = sel[sel.length - 1] === "overlay";
      return html`${isOverlay
          ? html`<div class="pane-title">${t("New pop-up")}</div>
              <div class="hint">${t("A Bubble Card pop-up opened by a #link – from the dock, a room or a radial menu.")}</div>
              ${bubbleNotice()}
              <div class="newpop">
                <input
                  placeholder=${t("Name, e.g. Kitchen")}
                  .value=${this._newPop ?? ""}
                  @input=${(e: Event) => (this._newPop = (e.target as HTMLInputElement).value)}
                  @keydown=${(e: KeyboardEvent) => e.key === "Enter" && this._createPopup(sel)}
                />
                <button class="done" ?disabled=${!(this._newPop ?? "").trim() || !customElements.get("bubble-card")} @click=${() => this._createPopup(sel)}>${t("Create")}</button>
              </div>`
          : nothing}
        <div class="pane-title">${t("Cards in this area")}</div>
        <div class="hint">${t("Drag cards in the tree on the left to reorder them or move them to another area or panel.")}</div>
        ${this._paste(sel)} ${this._addPicker(sel)}`;
    }
    const card = node as Cfg;
    const d = describeCard(card);
    const k = kids(card);
    return html`<div class="pane-title">
        <ha-icon .icon=${d.icon}></ha-icon><span>${d.title}</span>
        <span class="grow"></span>
        ${customElements.get("hui-card-element-editor")
          ? html`<button
              class="menubtn ${this._yaml ? "on" : ""}"
              title=${t(this._yaml ? "Visual editor" : "Code editor (YAML)")}
              ?disabled=${!this._guiAvail && !this._yaml}
              @click=${() => (this.renderRoot.querySelector("hui-card-element-editor") as any)?.toggleMode?.()}
            >
              <ha-icon .icon=${this._yaml ? "mdi:form-select" : "mdi:code-braces"}></ha-icon>
            </button>`
          : nothing}
        ${this._menuBtn(sel)}
        <button
          class="menubtn warn"
          title=${t("Remove")}
          @click=${() => this._actions(sel).find((a) => a.danger)?.run()}
        >
          <ha-icon .icon=${"mdi:delete-outline"}></ha-icon>
        </button>
      </div>
      ${popupOf(card) ? bubbleNotice() : foreignNotice(card)}
      ${popupOf(card)
        ? html`<div class="popline">
            <ha-icon .icon=${"mdi:link-variant"}></ha-icon><code>${popupOf(card)!.hash}</code>
            <span class="grow"></span>
            <button class="link" @click=${() => this._showPopup(popupOf(card)!.hash)}><ha-icon .icon=${"mdi:eye-outline"}></ha-icon> ${t("Show in the preview")}</button>
          </div>`
        : nothing}
      ${this._placement(sel, card)}
      ${k
        ? html`<div class="sub-add">
            ${this._paste([...sel, k.key])}
            ${this._picker && same(this._picker, [...sel, k.key])
              ? this._addPicker([...sel, k.key])
              : html`<button class="link" @click=${() => (this._picker = [...sel, k.key])}>${t("+ Add card into this panel")}</button>`}
          </div>`
        : nothing}
      ${customElements.get("hui-card-element-editor")
        ? html`${keyed(
              // a fresh editor per card: one without a visual editor leaves HA's editor in YAML for the next
              `${JSON.stringify(sel)}|${card.type}`,
              html`<hui-card-element-editor
                .hass=${this.hass}
                .lovelace=${this.lovelace}
                .value=${card}
                @GUImode-changed=${(e: CustomEvent) => {
                  e.stopPropagation();
                  this._yaml = !e.detail?.guiMode;
                  this._guiAvail = e.detail?.guiModeAvailable !== false;
                }}
                @config-changed=${(e: CustomEvent) => {
                  e.stopPropagation();
                  const c = e.detail?.config;
                  if (c && JSON.stringify(c) !== JSON.stringify(get(this._config, sel))) this._set(this._with(sel, c));
                }}
              ></hui-card-element-editor>`,
            )}`
        : this._ownEditor(card, sel)}`;
  }

  /** "Paste: …" for the card on the clipboard (shared with the small editor and other dashboards). */
  private _paste(list: Path, at?: number) {
    const c = getClip();
    if (!c) return nothing;
    return html`<button
      class="link paste"
      title=${t(c.cut ? "Moves the cut card here" : "Adds a copy of the copied card here")}
      @click=${() => {
        this._addAt = undefined;
        this._insert(list, structuredClone(c.card), at);
        if (c.cut) setClip(undefined);
      }}
    >
      <ha-icon .icon=${"mdi:content-paste"}></ha-icon> ${t("Paste")}: ${describeCard(c.card).title}${c.card.name ? ` ${c.card.name}` : ""}
    </button>`;
  }

  private _setWire(on: boolean) {
    this._wire = on;
    this._hover = undefined;
    this._plus = undefined;
    try {
      localStorage.setItem("glass-studio-wire", on ? "1" : "0");
    } catch {
      /* private mode */
    }
  }

  private _close() {
    this.flush();
    this.onClose?.();
  }

  /** Unsaved changes made here. */
  private get _dirty() {
    return this._past.length > 0;
  }

  declare _confirmCancel: boolean;

  /** Pop-up dashboards changed here: what to write to each (checked against what was loaded). */
  private _sourceTargets(): Map<string | null, { base: string; next: Cfg }> {
    const out = new Map<string | null, { base: string; next: Cfg }>();
    for (const [url, cfg] of Object.entries((this._config.__sources ?? {}) as Record<string, Cfg>))
      if (this._srcBase[url] !== undefined && JSON.stringify(cfg) !== this._srcBase[url]) out.set(url, { base: this._srcBase[url], next: cfg });
    return out;
  }

  /**
   * Writes dashboards straight to HA. Each is read again first: if it is not what was
   * loaded here, someone saved it meanwhile and nothing is written. The version saved
   * over is kept in this browser (Undo the last save).
   */
  private async _write(targets: Map<string | null, { base: string; next: Cfg }>): Promise<boolean> {
    const hass = this.hass as any;
    const fresh = new Map<string | null, Cfg>();
    for (const [url, tg] of targets) {
      const now = await loadConfig(hass, url);
      if (JSON.stringify(now) !== tg.base) {
        this._notice = { kind: "error", text: `${t("The dashboard was changed elsewhere after it was opened here – nothing was saved:")} ${url ?? "Overview"}. ${t("Reopen it to see the change.")}` };
        return false;
      }
      fresh.set(url, now);
    }
    for (const [url, tg] of targets) {
      await backup(url, fresh.get(url)!);
      await saveConfig(hass, url, tg.next);
      if (url !== null && this._srcBase[url] !== undefined) this._srcBase[url] = JSON.stringify(tg.next);
    }
    return true;
  }

  /** Standalone Save: the pop-up dashboards changed here and the dashboard with the edited card. */
  private async _saveDirect() {
    const h = this._host;
    if (!h || this._busy) return;
    if (h.mode === "yaml") {
      this._notice = { kind: "warn", text: t("This dashboard is kept in YAML files – the editor shows it but cannot save it.") };
      return;
    }
    this._busy = true;
    try {
      const targets = this._sourceTargets();
      const main = this._main();
      const json = JSON.stringify(main);
      if (json !== h.card || h.newView) {
        // the dashboard may be a pop-up source of its own: one write with both changes
        const own = targets.get(h.url) ?? { base: h.base, next: h.full };
        let next: Cfg;
        let path = h.path;
        if (h.newView) {
          next = structuredClone(own.next);
          next.views = [...(next.views ?? []), { title: "Glass", path: "glass", type: "panel", cards: [main] }];
          path = ["views", next.views.length - 1, "cards", 0];
        } else next = putAt(own.next, h.path, main);
        targets.set(h.url, { base: own.base, next });
        if (!(await this._write(targets))) return;
        this._host = { ...h, full: next, base: JSON.stringify(next), path, card: json, newView: false, hits: findGlass(next) };
        // a pop-up source that is this dashboard: its copy carries the saved card too
        if (h.url !== null && this._config.__sources?.[h.url]) this._attachSources({ [h.url]: next });
      } else {
        if (!targets.size) {
          this._notice = { kind: "ok", text: t("Nothing to save") };
          return;
        }
        if (!(await this._write(targets))) return;
      }
      this._past = [];
      this._future = [];
      this._notice = { kind: "ok", text: t("Saved") };
    } catch (e: any) {
      this._notice = { kind: "error", text: `${t("Saving failed:")} ${e?.message ?? e}` };
    } finally {
      this._busy = false;
    }
  }

  /** Standalone: puts back the version of the dashboard this browser kept before the last save. */
  private async _restore() {
    const h = this._host;
    if (!h || h.mode === "yaml") return;
    const b = await lastBackup(h.url);
    if (!b) {
      this._notice = { kind: "warn", text: t("No earlier version of this dashboard is kept in this browser.") };
      return;
    }
    if (!confirm(`${t("Put back the version saved over at")} ${new Date(b.time).toLocaleString()}? ${t("Changes not saved here are lost.")}`)) return;
    try {
      await saveConfig(this.hass as any, h.url, b.config);
      await dropBackup(b.id!);
      this._past = [];
      await this.openDashboard(h.url, h.which);
      this._notice = { kind: "ok", text: t("The earlier version is back") };
    } catch (e: any) {
      this._notice = { kind: "error", text: `${t("Saving failed:")} ${e?.message ?? e}` };
    }
  }

  /** Standalone: edits a dashboard's glass-dashboard card (the `which`-th); none yet – a new one on Save. */
  async openDashboard(url: string | null, which = 0) {
    if (this._dirty && !confirm(t("Discard the changes?"))) {
      this.requestUpdate();
      return;
    }
    this._busy = true;
    try {
      this._dashList ??= await listDashboards(this.hass as any);
      const info = this._dashList.find((d) => d.url === url) ?? { url, title: url ?? "Overview", mode: "storage" as const };
      const full = await loadConfig(this.hass as any, url);
      const hits = findGlass(full);
      const hit = hits[which] ?? hits[0];
      const card = hit ? (get(full, hit.path) as Cfg) : { type: "custom:glass-dashboard" };
      this._host = { url, mode: info.mode, full, base: JSON.stringify(full), path: hit?.path ?? [], card: hit ? JSON.stringify(card) : "", newView: !hit, hits, which: hit ? hits.indexOf(hit) : 0 };
      this.lovelace = { config: full, urlPath: url, mode: info.mode, editMode: true, locale: (this.hass as any)?.locale };
      this._closePopup();
      this._srcKey = undefined;
      this._srcBase = {};
      this._srcPops = [];
      this._config = structuredClone(card);
      this._past = [];
      this._future = [];
      this._sel = [];
      this._notice =
        info.mode === "yaml"
          ? { kind: "warn", text: t("This dashboard is kept in YAML files – the editor shows it but cannot save it.") }
          : hit
            ? undefined
            : { kind: "warn", text: t("This dashboard has no glass dashboard yet – Save adds a view “Glass” with one.") };
      try {
        localStorage.setItem(LAST_KEY, JSON.stringify(url));
      } catch {
        /* private mode */
      }
    } catch (e: any) {
      this._notice = { kind: "error", text: `${t("The dashboard could not be loaded:")} ${e?.message ?? e}` };
    } finally {
      this._busy = false;
    }
  }

  /** Standalone: which dashboard (and which of its glass dashboards) is edited. */
  private _hostBar() {
    const h = this._host;
    const list = this._dashList ?? [];
    return html`<span class="host">
      <ha-icon .icon=${"mdi:view-dashboard-edit-outline"}></ha-icon>
      <select
        title=${t("Dashboard to edit")}
        ?disabled=${this._busy}
        @change=${(e: Event) => {
          const v = (e.target as HTMLSelectElement).value;
          void this.openDashboard(v === "" ? null : v);
        }}
      >
        ${list.map((d) => html`<option value=${d.url ?? ""} ?selected=${h?.url === d.url}>${d.url === null ? t("Overview") : d.title}${d.mode === "yaml" ? " (YAML)" : ""}</option>`)}
      </select>
      ${h && h.hits.length > 1
        ? html`<select title=${t("Glass dashboard in it")} @change=${(e: Event) => void this.openDashboard(h.url, Number((e.target as HTMLSelectElement).value))}>
            ${h.hits.map((x, i) => html`<option value=${i} ?selected=${i === h.which}>${x.label}</option>`)}
          </select>`
        : nothing}
      ${this.hass?.user?.is_admin
        ? html`<button class="quiet" title=${t("A made-up home with every glass card on it – nothing it does reaches your devices")} ?disabled=${this._busy} @click=${() => void this._addDemo()}>
            <ha-icon .icon=${"mdi:creation-outline"}></ha-icon>${t("Demo dashboard")}
          </button>
          <button class="quiet" title=${t("A Glass dashboard from your own areas: their lights, blinds and temperatures")} ?disabled=${this._busy} @click=${() => void this._addStarter()}>
            <ha-icon .icon=${"mdi:home-variant-outline"}></ha-icon>${t("From your rooms")}
          </button>`
        : nothing}
    </span>`;
  }

  /** Adds the dashboard built from the user's areas (once) and opens it here. */
  private async _addStarter() {
    this._busy = true;
    try {
      const url = await addStarterDashboard(this.hass as any);
      this._dashList = await listDashboards(this.hass as any).catch(() => this._dashList);
      this._busy = false;
      await this.openDashboard(url);
      this._notice = { kind: "ok", text: t("The dashboard is in the sidebar as “Glass”. Rooms without lights, blinds or a temperature were left out.") };
    } catch (e: any) {
      this._busy = false;
      this._notice = { kind: "error", text: `${t("The dashboard could not be created:")} ${e?.message ?? e}` };
    }
  }

  /** Adds the demo dashboard to HA (once) and opens it here. */
  private async _addDemo() {
    this._busy = true;
    try {
      const url = await addDemoDashboard(this.hass as any);
      this._dashList = await listDashboards(this.hass as any).catch(() => this._dashList);
      this._busy = false;
      await this.openDashboard(url);
      this._notice = { kind: "ok", text: t("The demo dashboard is in the sidebar as “Glass demo”. Change anything – it runs on a made-up home.") };
    } catch (e: any) {
      this._busy = false;
      this._notice = { kind: "error", text: `${t("The demo dashboard could not be added:")} ${e?.message ?? e}` };
    }
  }

  /** Save: the change goes to HA's dialog, which saves the dashboard as its own Save button does. */
  private async _save() {
    // pop-up dashboards changed here are written first: a conflict stops before anything else
    const targets = this._sourceTargets();
    if (targets.size) {
      try {
        if (!(await this._write(targets))) return;
      } catch (e: any) {
        this._notice = { kind: "error", text: `${t("Saving failed:")} ${e?.message ?? e}` };
        return;
      }
    }
    this.flush();
    const d = this.haDialog;
    // let the dialog take the last change before saving
    await new Promise((r) => setTimeout(r, 50));
    const save = d && (typeof d._save === "function" ? d._save : undefined);
    this.onClose?.();
    if (!save) return; // not in HA's dialog (or HA changed it): the change waits there for its Save
    try {
      await save.call(d);
    } catch (e) {
      console.warn("glass-studio: save", e);
    }
  }

  /** Cancel: closes HA's dialog too, without saving. */
  private _cancel(force = false) {
    if (this._dirty && !force) {
      this._confirmCancel = true;
      return;
    }
    clearTimeout(this._emitTimer);
    this.onClose?.();
    const d = this.haDialog;
    try {
      d?.closeDialog?.();
    } catch (e) {
      console.warn("glass-studio: close", e);
    }
  }

  /** The small editor (HA's dialog behind): for YAML or a quick change. */
  private _quick() {
    this._close();
  }

  private _onLang = () => this.requestUpdate();

  override connectedCallback() {
    super.connectedCallback();
    window.addEventListener("glass-clipboard", this._onClip);
    window.addEventListener("glass-lang", this._onLang);
    window.addEventListener("pointermove", this._onWinMove);
    window.addEventListener("pointerup", this._onWinUp);
    window.addEventListener("pointerdown", this._onWinDown, true);
    window.addEventListener("glass-preview-dark", this._onPreviewDark);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("glass-clipboard", this._onClip);
    window.removeEventListener("glass-lang", this._onLang);
    window.removeEventListener("pointermove", this._onWinMove);
    if (this._popOpen) this._closePopup();
    window.removeEventListener("pointerup", this._onWinUp);
    window.removeEventListener("pointerdown", this._onWinDown, true);
    window.removeEventListener("glass-preview-dark", this._onPreviewDark);
    this._autoScroll(undefined);
  }

  private _onClip = () => this.requestUpdate();
  /** The settings' day / night switch shows that time in the preview. */
  private _onPreviewDark = (e: Event) => (this._pvDark = !!(e as CustomEvent).detail);

  /** "Add a card here" closes on any press outside it (tree, inspector, top bar too). */
  private _onWinDown = (e: PointerEvent) => {
    if (this._menu && !e.composedPath().some((n) => n instanceof Element && (n.classList.contains("ctxmenu") || n.classList.contains("menubtn")))) this._menu = undefined;
    if (!this._addAt) return;
    const path = e.composedPath();
    if (path.some((n) => n instanceof Element && (n.classList.contains("add-pop") || n.classList.contains("plus")))) return;
    this._addAt = undefined;
  };

  /** Keeps "Add a card here" inside the preview: shifted from the edges, above the + when there is no room below. */
  private _fitAddPop() {
    const pop = this.shadowRoot?.querySelector(".add-pop") as HTMLElement | null;
    const box = pop?.offsetParent as HTMLElement | null;
    if (!pop || !box || !this._addAt) return;
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const left = Math.min(Math.max(this._addAt.x, box.scrollLeft + w / 2 + 8), box.scrollLeft + box.clientWidth - w / 2 - 8);
    const below = this._addAt.y + 22;
    const bottom = box.scrollTop + box.clientHeight - 8;
    const top = below + h <= bottom ? below : this._addAt.y - 22 - h >= box.scrollTop + 8 ? this._addAt.y - 22 - h : Math.max(box.scrollTop + 8, bottom - h);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }

  /** Outside HA's card dialog its card editor isn't loaded: a glass card's own editor instead. */
  private _own?: { type: string; el: EditorEl };
  private _ownEditor(card: Cfg, sel: Path) {
    const tag = String(card.type ?? "").replace(/^custom:/, "");
    const cls = customElements.get(tag) as unknown as { getConfigElement?: () => EditorEl } | undefined;
    if (!cls?.getConfigElement) return html`<div class="hint">${t("Open the editor from the dashboard card's settings to edit this card.")}</div>`;
    if (this._own?.type !== tag) {
      const el = cls.getConfigElement();
      el.addEventListener("config-changed", (e: Event) => {
        e.stopPropagation();
        const c = (e as CustomEvent).detail?.config;
        const at = this._sel;
        if (c && JSON.stringify(c) !== JSON.stringify(get(this._config, at))) this._set(this._with(at, { type: card.type, ...c }));
      });
      this._own = { type: tag, el };
    }
    const el = this._own.el;
    el.hass = this.hass;
    el.lovelace = this.lovelace;
    if ((el as any)._studioCfg !== card) {
      (el as any)._studioCfg = card;
      el.setConfig(card);
    }
    void sel;
    return el;
  }

  protected override render() {
    const modes = [
      ["mobile", "mdi:cellphone"],
      ["tablet", "mdi:tablet"],
    ] as const;
    return html`<div class="bar">
        <button class="icon" title=${t(this.haDialog ? "Cancel" : "Close")} @click=${() => (this.haDialog || this.standalone ? this._cancel() : this._close())}>
          <ha-icon .icon=${"mdi:close"}></ha-icon>
        </button>
        ${this.standalone ? this._hostBar() : html`<span class="title">Dashboard Studio</span>`}
        <span class="seg">
          ${modes.map(
            ([m, icon]) => html`<button class=${preview.mode === m ? "on" : ""} @click=${() => this._device(m)}>
              <ha-icon .icon=${icon}></ha-icon>${t(MODE_NAMES[m])}
            </button>`,
          )}
        </span>
        <span class="seg">
          <button class=${this._wire ? "" : "on"} @click=${() => this._setWire(false)}><ha-icon .icon=${"mdi:eye-outline"}></ha-icon>${t("Preview")}</button>
          <button class=${this._wire ? "on" : ""} @click=${() => this._setWire(true)}><ha-icon .icon=${"mdi:view-quilt-outline"}></ha-icon>${t("Schematic")}</button>
        </span>
        <span class="grow"></span>
        <label class="lang" title=${t("Language of the studio – the cards follow your HA profile")}>
          <ha-icon .icon=${"mdi:translate"}></ha-icon>
          <select @change=${(e: Event) => setEditorLang((e.target as HTMLSelectElement).value)}>
            <option value="auto" ?selected=${editorLangPref() === "auto"}>${t("As Home Assistant")}</option>
            ${LANGS.map(([v, l]) => html`<option value=${v} ?selected=${editorLangPref() === v}>${l}</option>`)}
          </select>
        </label>
        ${(this.hass as any)?.demo
          ? nothing
          : html`<a class="coffee" href=${SUPPORT_URL} target="_blank" rel="noreferrer" title=${t("Support glass cards")}>
              <img src=${SUPPORT_BUTTON} alt="Buy Me a Coffee" />
            </a>`}
        <button class="icon ${this._hideTree ? "" : "on"}" title=${t("Structure panel")} @click=${() => (this._hideTree = !this._hideTree)}>
          <ha-icon .icon=${"mdi:file-tree-outline"}></ha-icon>
        </button>
        <button class="icon ${this._hideInspector ? "" : "on"}" title=${t("Settings panel")} @click=${() => (this._hideInspector = !this._hideInspector)}>
          <ha-icon .icon=${"mdi:tune-vertical"}></ha-icon>
        </button>
        <button class="icon ${this._wide ? "on" : ""}" title=${t("Wide YAML editor, the preview next to it")} @click=${() => this._toggleWide()}>
          <ha-icon .icon=${"mdi:code-json"}></ha-icon>
        </button>
        <button class="icon" title=${t("Undo")} ?disabled=${!this._past.length} @click=${() => this._undo()}><ha-icon .icon=${"mdi:undo"}></ha-icon></button>
        <button class="icon" title=${t("Redo")} ?disabled=${!this._future.length} @click=${() => this._redo()}><ha-icon .icon=${"mdi:redo"}></ha-icon></button>
        ${this.haDialog
          ? html`<button class="quiet" title=${t("The small editor of Home Assistant (YAML of the whole card)")} @click=${() => this._quick()}>
                <ha-icon .icon=${"mdi:dock-window"}></ha-icon>${t("Classic editor")}
              </button>
              <button class="quiet" @click=${() => this._cancel()}>${t("Cancel")}</button>
              <button class="done" @click=${() => this._save()}>${t("Save")}</button>`
          : this.standalone
            ? html`<button class="icon" title=${t("Undo the last save (the version kept in this browser)")} ?disabled=${this._busy || this._host?.mode !== "storage"} @click=${() => this._restore()}>
                  <ha-icon .icon=${"mdi:backup-restore"}></ha-icon>
                </button>
                <button class="quiet" @click=${() => this._cancel()}>${t("Close")}</button>
                <button class="done" ?disabled=${this._busy || this._host?.mode !== "storage"} @click=${() => this._saveDirect()}>${t(this._busy ? "Saving…" : "Save")}</button>`
            : html`<button class="done" @click=${() => this._close()}>${t("Done")}</button>`}
        ${this._confirmCancel
          ? html`<div class="bar-confirm">
              ${t("Discard the changes?")}
              <button class="quiet" @click=${() => (this._confirmCancel = false)}>${t("Keep editing")}</button>
              <button class="danger" @click=${() => this._cancel(true)}>${t("Discard")}</button>
            </div>`
          : nothing}
      </div>
      ${this._notice
        ? html`<div class="notice ${this._notice.kind}">
            <ha-icon .icon=${this._notice.kind === "ok" ? "mdi:check-circle-outline" : this._notice.kind === "warn" ? "mdi:information-outline" : "mdi:alert-circle-outline"}></ha-icon>
            <span>${this._notice.text}</span>
            <button class="icon small" title=${t("Close")} @click=${() => (this._notice = undefined)}><ha-icon .icon=${"mdi:close"}></ha-icon></button>
          </div>`
        : nothing}
      <div
        class="body ${this._hideTree ? "no-tree" : ""} ${this._hideInspector ? "no-inspector" : ""}"
        style="--tree-w:${this._panes.tree}px;--insp-w:${this._wide ? this._panes.yaml : this._panes.insp}px"
      >
        ${this._hideTree
          ? nothing
          : html`<div
              class="grip grip-tree"
              title=${t("Drag to change the width, double-click for the default")}
              @pointerdown=${(e: PointerEvent) => this._resizePane("tree", e)}
              @dblclick=${() => this._resetPane("tree")}
            ></div>`}
        ${this._hideInspector
          ? nothing
          : html`<div
              class="grip grip-insp"
              title=${t("Drag to change the width, double-click for the default")}
              @pointerdown=${(e: PointerEvent) => this._resizePane(this._wide ? "yaml" : "insp", e)}
              @dblclick=${() => this._resetPane(this._wide ? "yaml" : "insp")}
            ></div>`}
        ${this._hideTree ? nothing : html`<aside class="left">${this._tree()}</aside>`}
        <main class="stage ${this._wire ? "wired" : ""}">
          ${this._wire ? nothing : html`<div class="stage-bar">
          ${this._sizeBar()}
                <label class="fast" title=${t("On: the preview with glass as on the device – slower to redraw")}>
              <input
                type="checkbox"
                .checked=${!this._fast}
                @change=${(e: Event) => {
                  this._fast = !(e.target as HTMLInputElement).checked;
                  try {
                    localStorage.setItem("glass-studio-fast", this._fast ? "1" : "0");
                  } catch {
                    /* private mode */
                  }
                }}
              />${t("Glass")}
            </label>
            <label class="fast" title=${t("The wallpaper behind the preview, as on the device")}>
              <input
                type="checkbox"
                .checked=${this._pvBg}
                @change=${(e: Event) => {
                  this._pvBg = (e.target as HTMLInputElement).checked;
                  try {
                    localStorage.setItem("glass-studio-bg", this._pvBg ? "1" : "0");
                  } catch {
                    /* private mode */
                  }
                }}
              />${t("Background")}
            </label>
            <button
              class="icon ${this._pvDark === undefined ? "" : "on"}"
              title=${t(this._pvDark === undefined ? "Day / night: by the appearance setting" : this._pvDark ? "Preview at night" : "Preview by day")}
              @click=${() => (this._pvDark = this._pvDark === undefined ? false : this._pvDark === false ? true : undefined)}
            >
              <ha-icon .icon=${this._pvDark === undefined ? "mdi:theme-light-dark" : this._pvDark ? "mdi:weather-night" : "mdi:weather-sunny"}></ha-icon>
            </button>
          </div>`}
          <div class="stage-inner"></div>
          ${this._wire ? this._wireView() : nothing}
          ${this._selBox && !this._wire
            ? html`<div class="selbox" style="left:${this._selBox.x}px;top:${this._selBox.y}px;width:${this._selBox.w}px;height:${this._selBox.h}px"></div>`
            : nothing}
          ${this._hover ? html`<div class="hover" style="left:${this._hover.x}px;top:${this._hover.y}px;width:${this._hover.w}px;height:${this._hover.h}px"></div>` : nothing}
          ${this._target?.into ? html`<div class="into" style="left:${this._target.into.x}px;top:${this._target.into.y}px;width:${this._target.into.w}px;height:${this._target.into.h}px"></div>` : nothing}
          ${this._target?.line ? html`<div class="line" style="left:${this._target.line.x}px;top:${this._target.line.y}px;width:${this._target.line.w}px;height:${this._target.line.h}px"></div>` : nothing}
          ${this._hover && this._hoverPath && !this._pdrag && !this._del
            ? html`<button
                class="trash"
                style="left:${this._hover.x + this._hover.w - 40}px;top:${this._hover.y + 8}px"
                title=${t("Remove")}
                @click=${() => {
                  const path = this._hoverPath!;
                  const c = get(this._config, path) as Cfg;
                  const d = describeCard(c);
                  this._del = { path, x: this._hover!.x + this._hover!.w - 20, y: this._hover!.y + 44, label: c.name ? String(c.name) : d.title };
                }}
              >
                <ha-icon .icon=${"mdi:delete-outline"}></ha-icon>
              </button>
              <span class="pvmenu" style="left:${this._hover.x + this._hover.w - 76}px;top:${this._hover.y + 8}px">${this._menuBtn(this._hoverPath)}</span>`
            : nothing}
          ${this._del
            ? html`<div class="confirm" style="left:${this._del.x}px;top:${this._del.y}px">
                <div>${t("Remove the card")} <b>${this._del.label}</b>?</div>
                <div class="confirm-row">
                  <button class="link" @click=${() => (this._del = undefined)}>${t("Cancel")}</button>
                  <button
                    class="danger"
                    @click=${() => {
                      const path = this._del!.path;
                      this._del = undefined;
                      this._hover = undefined;
                      this._hoverPath = undefined;
                      this._set(this._with(path, undefined));
                      if (within(this._sel, path)) this._sel = path.slice(0, -1);
                    }}
                  >
                    ${t("Remove")}
                  </button>
                </div>
              </div>`
            : nothing}
          ${this._plus && !this._pdrag
            ? html`<button
                class="plus"
                style="left:${this._plus.x}px;top:${this._plus.y}px"
                title=${t(this._plus.group ? (this._plus.group.layout === "row" ? "Add a card beside (new row)" : "Add a card above / below (new column)") : "Add a card here")}
                @click=${() => (this._addAt = this._plus)}
              >
                <ha-icon .icon=${"mdi:plus"}></ha-icon>
              </button>`
            : nothing}
          ${this._addAt
            ? html`<div class="add-pop" style="left:${this._addAt.x}px;top:${this._addAt.y + 22}px" @pointerdown=${(e: Event) => e.stopPropagation()}>
                <div class="add-head">
                  <b>${t("Add a card here")}</b>
                  <button class="icon" title=${t("Close")} @click=${() => (this._addAt = undefined)}><ha-icon .icon=${"mdi:close"}></ha-icon></button>
                </div>
                ${this._paste(this._addAt.list, this._addAt.i)}
                ${this._choices((card) => {
                  const at = this._addAt!;
                  this._addAt = undefined;
                  this._plus = undefined;
                  if (at.group) this._groupAdd(at.group, card);
                  else this._insert(at.list, card, at.i);
                })}
              </div>`
            : nothing}
          ${this._pdrag ? html`<div class="ghost" style="left:${this._pdrag.x}px;top:${this._pdrag.y}px;width:${this._pdrag.w}px;height:${this._pdrag.h}px"></div>` : nothing}
          ${this._pdrag && this._target
            ? html`<div class="tip" style="left:${this._pdrag.x + this._pdrag.w / 2}px;top:${this._pdrag.y + this._pdrag.h + 8}px">${this._target.label}</div>`
            : nothing}
        </main>
        ${this._hideInspector ? nothing : html`<aside class="right ${this._wide ? "yaml" : ""}">${this._wide ? this._yamlPane() : this._inspector()}</aside>`}
      </div>
      ${this._popOpen
        ? html`<button class="popclose" style=${this._popTop !== undefined ? `top:${this._popTop}px` : ""} @click=${() => this._closePopup()}>
            <ha-icon .icon=${"mdi:close"}></ha-icon>${t("Close the pop-up preview")} <code>${this._popOpen}</code>
          </button>`
        : nothing}
      ${this._menuView()}
      ${this._wdrag
        ? html`<div class="chip" style="left:${(this._chipAt?.x ?? 0) + 14}px;top:${(this._chipAt?.y ?? 0) + 10}px">
            <ha-icon .icon=${"mdi:drag"}></ha-icon>${this._target?.label ?? `${this._wdrag.label} – ${t("no change")}`}
          </div>`
        : nothing}
      ${this._tdrag
        ? html`<div class="chip" style="left:${this._tdrag.x + 14}px;top:${this._tdrag.y + 10}px">
            <ha-icon .icon=${"mdi:drag"}></ha-icon>${this._tdrag.label}${this._drop ? nothing : html` – ${t("no change")}`}
          </div>`
        : nothing}
      ${this.haDialog || this.standalone || this.footer === "" ? nothing : html`<div class="foot">${this.footer ?? t("Changes go to the card editor behind this window – save them there with Save.")}</div>`}`;
  }

  static override styles = css`
    :host {
      position: fixed;
      inset: 0;
      display: flex;
      flex-direction: column;
      background: var(--primary-background-color, #f5f5f5);
      color: var(--primary-text-color);
      font-family: var(--ha-font-family-body, Roboto, sans-serif);
      z-index: 10;
    }
    button {
      font: inherit;
      color: inherit;
      background: none;
      border: none;
      cursor: pointer;
      border-radius: 8px;
    }
    button:disabled {
      opacity: 0.35;
      cursor: default;
    }
    .bar {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 56px;
      padding: 0 12px;
      background: var(--app-header-background-color, var(--card-background-color, #fff));
      color: var(--app-header-text-color, var(--primary-text-color));
      border-bottom: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
      flex: none;
    }
    .bar .title {
      font-size: 20px;
      margin: 0 16px 0 4px;
    }
    /* support: a yellow pill that hops now and then (once 20 s after opening, then every 2 min);
       in Home Assistant only – the web demo has its own on the page */
    .coffee {
      display: inline-flex;
      animation: coffee-hop 120s ease-in-out 20s infinite;
      transform-origin: 50% 100%;
    }
    .coffee img {
      display: block;
      height: 32px;
    }
    .coffee:hover {
      animation-play-state: paused;
      filter: brightness(1.05);
    }
    @keyframes coffee-hop {
      0%, 2.5%, 100% { transform: none; }
      0.5% { transform: translateY(-6px) rotate(-6deg); }
      1% { transform: translateY(0) rotate(0); }
      1.5% { transform: translateY(-3px) rotate(5deg); }
      2% { transform: translateY(0) rotate(0); }
    }
    @media (prefers-reduced-motion: reduce) {
      .coffee { animation: none; }
    }
    .icon {
      width: 40px;
      height: 40px;
      display: grid;
      place-items: center;
      border-radius: 50%;
    }
    .icon:hover:not(:disabled) {
      background: rgba(127, 127, 127, 0.14);
    }
    .seg {
      display: inline-flex;
      border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
      border-radius: 999px;
      overflow: hidden;
    }
    .seg button {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 0;
      --mdc-icon-size: 18px;
    }
    .lang {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-right: 8px;
      color: var(--secondary-text-color);
      --mdc-icon-size: 18px;
    }
    .lang select {
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      font-size: 14px;
      cursor: pointer;
    }
    .size {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .size select,
    .size input {
      font: inherit;
      font-size: 13px;
      color: inherit;
      background: transparent;
      border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
      border-radius: 8px;
      padding: 5px 6px;
    }
    .size select {
      max-width: 190px;
      min-width: 70px;
      flex: 0 1 auto;
    }
    /* a full bar: the device picker narrows first, the buttons keep their text */
    .bar > .seg,
    .bar > .icon,
    .bar > button,
    .bar > .fast {
      flex: none;
    }
    .size {
      flex: 0 1 auto;
      min-width: 0;
    }
    .size input {
      width: 58px;
    }
    .size .x {
      opacity: 0.6;
    }
    .icon.small {
      width: 32px;
      height: 32px;
      --mdc-icon-size: 18px;
    }
    .seg button.on {
      background: var(--primary-color);
      color: var(--text-primary-color, #fff);
    }
    .quiet {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      border-radius: 999px;
      font-weight: 500;
      --mdc-icon-size: 18px;
    }
    .quiet:hover {
      background: rgba(127, 127, 127, 0.14);
    }
    .bar {
      position: relative;
    }
    .bar-confirm {
      position: absolute;
      right: 12px;
      top: 60px;
      z-index: 30;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px 10px 16px;
      border-radius: 14px;
      background: var(--card-background-color, #fff);
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
    }
    .done {
      background: var(--primary-color);
      color: var(--text-primary-color, #fff);
      padding: 8px 20px;
      border-radius: 999px;
      font-weight: 500;
    }
    .grow {
      flex: 1;
    }
    .icon.on {
      color: var(--primary-color);
    }
    .fast {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin: 0 8px;
      font-size: 14px;
      cursor: pointer;
      white-space: nowrap;
    }
    .bar .seg button,
    .bar .title {
      white-space: nowrap;
    }
    /* checkboxes drawn by hand: the browser's own one comes out as a dark filled box in HA */
    .fast input {
      appearance: none;
      -webkit-appearance: none;
      width: 16px;
      height: 16px;
      margin: 0 6px 0 0;
      border: 2px solid var(--secondary-text-color, #727272);
      border-radius: 3px;
      background: transparent center / 12px no-repeat;
      cursor: pointer;
      flex: none;
    }
    .fast input:checked {
      border-color: var(--primary-color);
      background-color: var(--primary-color);
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='none' stroke='white' stroke-width='3.2' d='M5 12.5l4.5 4.5L19 7.5'/%3E%3C/svg%3E");
    }
    .fast input:focus-visible {
      outline: 2px solid var(--primary-color);
      outline-offset: 2px;
    }
    .paste {
      display: flex;
      align-items: center;
      gap: 6px;
      --mdc-icon-size: 18px;
    }
    .body.no-tree {
      grid-template-columns: minmax(0, 1fr) var(--insp-w, 420px);
    }
    .body.no-inspector {
      grid-template-columns: var(--tree-w, 280px) minmax(0, 1fr);
    }
    .body.no-tree.no-inspector {
      grid-template-columns: minmax(0, 1fr);
    }
    .body {
      position: relative;
      flex: 1;
      min-height: 0;
      display: grid;
      grid-template-columns: var(--tree-w, 280px) minmax(0, 1fr) var(--insp-w, 420px);
    }
    /* the side panels' edges: drag to resize (a line shows on hover) */
    /* standalone: the dashboard picker in the bar */
    .host {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      --mdc-icon-size: 20px;
    }
    .host select {
      max-width: 240px;
      font: inherit;
      font-weight: 600;
      padding: 4px 6px;
      border-radius: 8px;
      border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
      background: var(--card-background-color, #fff);
      color: var(--primary-text-color);
    }
    /* saved / conflict / error, between the bar and the panels */
    .notice {
      flex: none;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 16px;
      font-size: 14px;
      --mdc-icon-size: 20px;
      border-bottom: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
    }
    .notice span {
      flex: 1;
    }
    .notice.ok {
      background: rgba(var(--rgb-success-color, 67, 160, 71), 0.14);
    }
    .notice.warn {
      background: rgba(var(--rgb-warning-color, 255, 166, 0), 0.16);
    }
    .notice.error {
      background: rgba(var(--rgb-error-color, 219, 68, 55), 0.16);
    }
    /* the preview's scale: highlighted while it is not the device's real size */
    .size select.zoom.scaled {
      color: var(--warning-color, #ffa600);
      font-weight: 600;
    }
    .grip {
      position: absolute;
      top: 0;
      bottom: 0;
      z-index: 6;
      width: 9px;
      cursor: col-resize;
      touch-action: none;
    }
    .grip-tree {
      left: calc(var(--tree-w, 280px) - 5px);
    }
    .grip-insp {
      right: calc(var(--insp-w, 420px) - 4px);
    }
    .grip::after {
      content: "";
      position: absolute;
      top: 0;
      bottom: 0;
      left: 3px;
      width: 3px;
      border-radius: 2px;
      background: var(--primary-color);
      opacity: 0;
      transition: opacity 0.15s;
    }
    .grip:hover::after,
    .grip.on::after {
      opacity: 1;
    }
    aside {
      overflow: auto;
      background: var(--card-background-color, #fff);
    }
    .left {
      border-right: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
      padding: 8px 0;
    }
    .right {
      border-left: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
      padding: 16px;
    }
    /* the wide YAML editor: the text fills the panel's height */
    .right.yaml {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .right.yaml ha-yaml-editor {
      flex: 1;
      min-height: 0;
      overflow: auto;
      font-size: 13px;
    }
    .yaml-err {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--error-color, #db4437);
      font-size: 13px;
      --mdc-icon-size: 18px;
    }
    .stage {
      position: relative;
      overflow: auto;
      padding: 24px;
    }
    /* the preview's own toolbar: what it shows and how (device, schematic, glass, day / night) */
    .stage-bar {
      position: sticky;
      top: -24px;
      z-index: 5;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin: -24px -24px 16px;
      padding: 8px 24px;
      background: var(--primary-background-color, #fafafa);
      border-bottom: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
    }
    .stage-bar .grow {
      flex: 1;
    }
    .stage-inner {
      max-width: 100%;
      margin: 0 auto;
    }
    /* the picked card in the preview */
    .selbox {
      position: absolute;
      pointer-events: none;
      border: 2px solid var(--primary-color);
      border-radius: 14px;
    }
    .hover {
      position: absolute;
      pointer-events: none;
      border: 2px solid var(--primary-color);
      border-radius: 14px;
      box-shadow: 0 0 0 4px rgba(3, 169, 244, 0.15);
    }
    .stage {
      user-select: none;
    }
    .stage.wired .stage-inner {
      display: none;
    }
    .wire {
      display: grid;
      gap: 16px;
      align-items: start;
    }
    .wire-overlay {
      display: block;
      margin-top: 16px;
    }
    .warea {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 10px;
      border-radius: 16px;
      background: rgba(127, 127, 127, 0.06);
      border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.1));
      min-width: 0;
    }
    .wlabel {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--secondary-text-color);
    }
    .wbox {
      position: relative;
      min-width: 0;
      cursor: grab;
      border-radius: 12px;
    }
    .wbox.on {
      outline: 2px solid var(--primary-color);
      outline-offset: 1px;
    }
    .wbox.dragging {
      opacity: 0.4;
    }
    .wpanel {
      border: 1.5px dashed rgba(127, 127, 127, 0.5);
      padding: 6px 8px 8px;
    }
    .whead {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 500;
      color: var(--secondary-text-color);
      margin-bottom: 6px;
      --mdc-icon-size: 16px;
    }
    .whead small {
      opacity: 0.8;
      font-weight: 400;
    }
    .wbody {
      gap: 8px;
      align-items: stretch;
    }
    .wcard {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 48px;
      padding: 8px 10px;
      background: var(--card-background-color, #fff);
      border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
      flex: 1 1 0;
      --mdc-icon-size: 20px;
    }
    .wcard:hover,
    .wpanel:hover {
      border-color: var(--primary-color);
    }
    .wname {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .wname b {
      font-weight: 500;
      font-size: 13px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .wname small {
      font-size: 11px;
      color: var(--secondary-text-color);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    /* space kept even when hidden: showing the trash on hover must not change heights */
    .wtools {
      margin-left: auto;
      display: inline-flex;
      visibility: hidden;
    }
    .wbox:hover > .wtools,
    .wbox:hover > .whead > .wtools {
      visibility: visible;
    }
    .wtools button {
      width: 26px;
      height: 26px;
      display: grid;
      place-items: center;
      border-radius: 50%;
      color: var(--error-color, #db4437);
      --mdc-icon-size: 16px;
    }
    .wtools button:hover {
      background: rgba(219, 68, 55, 0.12);
    }
    .wresize {
      position: absolute;
      right: 2px;
      bottom: 2px;
      width: 14px;
      height: 14px;
      cursor: nwse-resize;
      border-right: 3px solid rgba(127, 127, 127, 0.6);
      border-bottom: 3px solid rgba(127, 127, 127, 0.6);
      border-bottom-right-radius: 8px;
      opacity: 0;
    }
    .wbox:hover > .wresize,
    .wbox.on > .wresize {
      opacity: 1;
    }
    .wresize:hover {
      border-color: var(--primary-color);
    }
    .wspan {
      position: absolute;
      right: 20px;
      bottom: 3px;
      font-size: 10px;
      color: var(--secondary-text-color);
    }
    .sizebox {
      display: grid;
      gap: 6px;
      margin: 4px 0 8px;
    }
    .sizeline {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
    }
    .sizeline > span {
      min-width: 64px;
      color: var(--secondary-text-color);
    }
    .sizeline select,
    .sizeline input {
      font: inherit;
      color: inherit;
      background: transparent;
      border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
      border-radius: 8px;
      padding: 4px 6px;
    }
    .sizeline input {
      width: 64px;
    }
    .sizeline small {
      color: var(--secondary-text-color);
    }
    /* the card's Placement box: labels left, controls right */
    .place {
      display: block;
      margin-bottom: 12px;
      border-radius: 12px;
      --expansion-panel-summary-padding: 0 12px;
      --ha-card-border-radius: 12px;
    }
    .place-grid {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      align-items: center;
      gap: 10px 14px;
      padding: 4px 0 8px;
      color: var(--secondary-text-color);
      font-size: 14px;
    }
    .chips,
    .steppers {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 14px;
    }
    .chips {
      gap: 6px;
    }
    .chips button {
      padding: 4px 12px;
      border-radius: 16px;
      border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
      background: none;
      color: var(--primary-text-color);
      font: inherit;
      cursor: pointer;
    }
    .chips button.on {
      border-color: var(--primary-color);
      background: color-mix(in srgb, var(--primary-color) 12%, transparent);
      color: var(--primary-color);
    }
    .stepper {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
      color: var(--primary-text-color);
    }
    .stepper button {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
      background: none;
      color: inherit;
      cursor: pointer;
    }
    .stepper button:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .wadd {
      align-self: center;
      justify-self: center;
      width: 28px;
      height: 28px;
      min-height: 28px;
      display: grid;
      place-items: center;
      border-radius: 50%;
      border: 1.5px dashed rgba(127, 127, 127, 0.6);
      color: var(--secondary-text-color);
      --mdc-icon-size: 16px;
    }
    .wadd:hover {
      border-color: var(--primary-color);
      color: var(--primary-color);
    }
    @media (hover: hover) and (pointer: fine) {
      .wadd.filled {
        display: none;
      }
    }
    .into,
    .line,
    .ghost,
    .tip {
      position: absolute;
      pointer-events: none;
    }
    .into {
      border: 2px dashed var(--primary-color);
      border-radius: 16px;
      background: rgba(3, 169, 244, 0.06);
    }
    .line {
      background: var(--primary-color);
      border-radius: 2px;
    }
    .ghost {
      border: 2px solid var(--primary-color);
      border-radius: 14px;
      background: rgba(3, 169, 244, 0.12);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.25);
    }
    /* the "⋮" of a card: in the tree (on hover / when picked), the schematic and the preview */
    .menubtn {
      width: 26px;
      height: 26px;
      display: grid;
      place-items: center;
      border-radius: 50%;
      color: var(--secondary-text-color);
      --mdc-icon-size: 18px;
      flex: none;
    }
    .menubtn:hover {
      background: rgba(127, 127, 127, 0.16);
      color: var(--primary-text-color);
    }
    /* a tree row's own buttons: up, down and "⋮" – shown on hover and on the picked row */
    /* over the row's right end, so they take no room from the label while hidden */
    .node {
      position: relative;
    }
    .node .rowtools {
      position: absolute;
      right: 4px;
      top: 50%;
      transform: translateY(-50%);
      display: none;
      border-radius: 999px;
      background: var(--card-background-color, #fff);
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
    }
    .node:hover .rowtools,
    .node.on .rowtools {
      display: inline-flex;
    }
    .rowtools .menubtn {
      width: 24px;
      height: 24px;
      --mdc-icon-size: 16px;
    }
    .menubtn:disabled {
      opacity: 0.3;
    }
    .wtools .menubtn {
      color: var(--secondary-text-color);
    }
    .wtools .menubtn:hover {
      background: rgba(127, 127, 127, 0.16);
    }
    .menubtn.warn {
      color: var(--error-color, #db4437);
    }
    .menubtn.warn:hover {
      background: rgba(219, 68, 55, 0.12);
      color: var(--error-color, #db4437);
    }
    .pvmenu {
      position: absolute;
      z-index: 3;
    }
    .pvmenu .menubtn {
      width: 32px;
      height: 32px;
      background: var(--card-background-color, #fff);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    }
    .ctxmenu {
      position: fixed;
      z-index: 30;
      transform: translateX(-100%);
      min-width: 200px;
      padding: 6px;
      border-radius: 12px;
      background: var(--card-background-color, #fff);
      color: var(--primary-text-color);
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.28);
      display: grid;
    }
    .ctxmenu button {
      display: flex;
      align-items: center;
      gap: 10px;
      height: 36px;
      padding: 0 10px;
      border-radius: 8px;
      text-align: left;
      font: inherit;
      font-size: 14px;
      --mdc-icon-size: 18px;
    }
    .ctxmenu button:hover:not(:disabled) {
      background: rgba(127, 127, 127, 0.14);
    }
    .ctxmenu button span {
      flex: 1;
    }
    .ctxmenu kbd {
      font: inherit;
      font-size: 12px;
      color: var(--secondary-text-color);
    }
    .ctxmenu button.warn {
      color: var(--error-color, #db4437);
    }
    .trash {
      position: absolute;
      z-index: 3;
      width: 32px;
      height: 32px;
      display: grid;
      place-items: center;
      border-radius: 50%;
      background: var(--card-background-color, #fff);
      color: var(--error-color, #db4437);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
      --mdc-icon-size: 18px;
    }
    .trash:hover {
      background: var(--error-color, #db4437);
      color: #fff;
    }
    .confirm {
      position: absolute;
      z-index: 5;
      transform: translateX(-100%);
      margin-left: 20px;
      width: 260px;
      padding: 12px 14px;
      border-radius: 14px;
      background: var(--card-background-color, #fff);
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
    }
    .confirm-row {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 10px;
    }
    .danger {
      background: var(--error-color, #db4437);
      color: #fff;
      padding: 6px 14px;
      border-radius: 999px;
      font-weight: 500;
    }
    .plus {
      position: absolute;
      z-index: 3;
      width: 28px;
      height: 28px;
      margin: -14px 0 0 -14px;
      display: grid;
      place-items: center;
      border-radius: 50%;
      background: var(--primary-color);
      color: var(--text-primary-color, #fff);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
      --mdc-icon-size: 18px;
      transition: transform 0.12s;
    }
    .plus:hover {
      transform: scale(1.15);
    }
    .add-pop {
      position: absolute;
      z-index: 4;
      width: 320px;
      max-height: 60vh;
      overflow: auto;
      transform: translateX(-50%);
      padding: 8px 12px 12px;
      border-radius: 14px;
      background: var(--card-background-color, #fff);
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
    }
    .add-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 6px;
    }
    .tip {
      transform: translateX(-50%);
      padding: 4px 10px;
      border-radius: 999px;
      background: var(--primary-color);
      color: var(--text-primary-color, #fff);
      font-size: 12px;
      white-space: nowrap;
    }
    .tree {
      user-select: none;
    }
    .area + .area {
      margin-top: 6px;
      border-top: 1px solid var(--divider-color, rgba(0, 0, 0, 0.08));
      padding-top: 6px;
    }
    .node {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 6px 12px 6px calc(12px + var(--depth) * 18px);
      cursor: pointer;
      --mdc-icon-size: 20px;
      border-left: 3px solid transparent;
    }
    .node[draggable="true"] {
      cursor: grab;
    }
    .node:hover {
      background: rgba(127, 127, 127, 0.08);
    }
    .node.static {
      cursor: default;
    }
    .tw {
      flex: none;
      width: 18px;
      height: 18px;
      margin-right: -6px;
      display: grid;
      place-items: center;
      padding: 0;
      border: none;
      background: none;
      color: var(--secondary-text-color);
      cursor: pointer;
      --mdc-icon-size: 18px;
    }
    span.tw {
      cursor: inherit;
    }
    .node.add {
      color: var(--primary-color);
    }
    .ext {
      color: var(--secondary-text-color);
      --mdc-icon-size: 18px;
    }
    .badge.warn {
      background: rgba(255, 152, 0, 0.18);
      color: var(--warning-color, #e65100);
    }
    .bubble-notice {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      padding: 10px 12px;
      margin: 0 0 12px;
      border-radius: 12px;
      background: rgba(255, 152, 0, 0.12);
      font-size: 13px;
      --mdc-icon-size: 20px;
    }
    .bubble-notice ha-icon {
      color: var(--warning-color, #e65100);
      flex: none;
    }
    .bubble-notice a {
      color: var(--primary-color);
    }
    .tree-notice {
      padding: 6px 12px 0;
    }
    .newpop {
      display: flex;
      gap: 8px;
      margin-bottom: 18px;
    }
    .newpop input {
      flex: 1;
      padding: 8px 12px;
      border-radius: 10px;
      border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
      background: var(--card-background-color, #fff);
      color: var(--primary-text-color);
      font: inherit;
    }
    .popline {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
      --mdc-icon-size: 18px;
    }
    .popline .link {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .popclose {
      position: fixed;
      top: 64px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 100;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      border-radius: 999px;
      background: var(--primary-color);
      color: var(--text-primary-color, #fff);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
      --mdc-icon-size: 18px;
    }
    .node.dragging {
      opacity: 0.4;
    }
    .wclone {
      box-sizing: border-box;
      position: fixed !important;
      z-index: 19;
      margin: 0 !important;
      pointer-events: none;
      opacity: 0.92;
      box-shadow: 0 14px 34px rgba(0, 0, 0, 0.28);
    }
    .chip {
      position: fixed;
      z-index: 20;
      pointer-events: none;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 999px;
      background: var(--primary-color);
      color: var(--text-primary-color, #fff);
      font-size: 13px;
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
      --mdc-icon-size: 16px;
    }
    .node.on {
      background: rgba(3, 169, 244, 0.12);
      border-left-color: var(--primary-color);
    }
    .node.before {
      box-shadow: inset 0 2px 0 var(--primary-color);
    }
    .node.after {
      box-shadow: inset 0 -2px 0 var(--primary-color);
    }
    .branch.into > .node {
      outline: 2px dashed var(--primary-color);
      outline-offset: -2px;
    }
    .label {
      display: flex;
      flex-direction: column;
      min-width: 0;
      flex: 1;
    }
    .label b {
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .label small {
      color: var(--secondary-text-color);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .badge {
      font-size: 11px;
      padding: 1px 6px;
      border-radius: 999px;
      background: rgba(127, 127, 127, 0.16);
      color: var(--secondary-text-color);
    }
    .pane-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 18px;
      font-weight: 500;
      margin-bottom: 12px;
    }
    .pane-title button {
      width: 36px;
      height: 36px;
      display: grid;
      place-items: center;
      border-radius: 50%;
      --mdc-icon-size: 20px;
    }
    .pane-title button:hover:not(:disabled) {
      background: rgba(127, 127, 127, 0.14);
    }
    .pane-title button.on {
      color: var(--primary-color);
    }
    .pane-title .del {
      color: var(--error-color, #db4437);
    }
    .hint {
      color: var(--secondary-text-color);
      margin-bottom: 12px;
    }
    .link {
      color: var(--primary-color);
      font-weight: 500;
      padding: 6px 0;
    }
    .sub-add {
      margin-bottom: 12px;
    }
    .picker {
      display: grid;
      gap: 6px;
    }
    .search {
      width: 100%;
      box-sizing: border-box;
      padding: 9px 12px;
      border-radius: 10px;
      border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
      background: var(--card-background-color, #fff);
      color: var(--primary-text-color);
      font: inherit;
      margin-bottom: 4px;
    }
    .pick-fold > summary {
      cursor: pointer;
      list-style: none;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 0;
    }
    .pick-fold > summary::-webkit-details-marker {
      display: none;
    }
    .pick-fold > summary::before {
      content: "▸";
      transition: transform 0.15s;
    }
    .pick-fold[open] > summary::before {
      transform: rotate(90deg);
    }
    .pick-fold > summary .count {
      margin-left: auto;
      font-weight: 400;
    }
    .pick-fold > .picker {
      padding-bottom: 6px;
    }
    .pick-group {
      margin: 8px 0 2px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--secondary-text-color);
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
      align-items: center;
      gap: 12px;
      text-align: start;
      padding: 10px 12px;
      border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
      border-radius: 12px;
    }
    .pick:hover {
      background: rgba(127, 127, 127, 0.08);
    }
    .pick span {
      display: flex;
      flex-direction: column;
    }
    .pick small {
      color: var(--secondary-text-color);
    }
    .foot {
      flex: none;
      padding: 6px 16px;
      font-size: 12px;
      color: var(--secondary-text-color);
      border-top: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
      background: var(--card-background-color, #fff);
    }
    @media (max-width: 1100px) {
      .grip {
        display: none;
      }
      .body {
        grid-template-columns: minmax(0, 1fr) minmax(320px, 400px);
        grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
      }
      .left {
        grid-column: 2;
        grid-row: 1;
      }
      .stage {
        grid-column: 1;
        grid-row: 1 / span 2;
      }
      .right {
        grid-column: 2;
        grid-row: 2;
        border-top: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
      }
    }
  `;
}

if (!customElements.get("glass-studio")) customElements.define("glass-studio", GlassStudio);

/**
 * Opens the studio over everything (a modal <dialog> is in the top layer, above
 * HA's own card-editor dialog) on a copy of `config`.
 */
export function openStudio(opts: { config: Cfg; hass?: HomeAssistant; lovelace?: unknown; onChange: (c: Cfg) => void; dialog?: HTMLElement & Record<string, any>; standalone?: boolean; footer?: string; mode?: "mobile" | "tablet" }) {
  if (opts.mode) preview.mode = opts.mode;
  // the desktop is edited as the tablet
  if (preview.mode === "desktop") preview.mode = "tablet";
  // the size last picked for this mode
  const size = savedSizes()[preview.mode as "mobile" | "tablet"];
  preview.w = size?.w;
  preview.h = size?.h;
  const dlg = document.createElement("dialog");
  dlg.className = "glass-studio-dialog";
  dlg.style.cssText = "position:fixed;inset:0;width:100vw;height:100dvh;max-width:none;max-height:none;margin:0;padding:0;border:none;background:transparent;overflow:hidden";
  const st = document.createElement("glass-studio") as GlassStudio;
  st.hass = opts.hass;
  st.lovelace = opts.lovelace;
  st.config = structuredClone(opts.config);
  st.onChange = opts.onChange;
  const close = () => {
    st.flush();
    dlg.close();
    dlg.remove();
    // previews that waited behind the editor (HA's card dialog) catch up with the device now
    window.dispatchEvent(new CustomEvent("glass-preview-mode", { detail: preview.mode }));
  };
  st.onClose = close;
  st.haDialog = opts.dialog;
  st.standalone = !!opts.standalone;
  st.footer = opts.footer;
  dlg.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  dlg.appendChild(st);
  // inside <home-assistant> as HA's own dialogs: its pickers (entity, area…) get hass
  // from a context that root provides – outside it the entity picker stays empty
  (document.querySelector("home-assistant")?.shadowRoot ?? document.body).appendChild(dlg);
  dlg.showModal();
  return st;
}

window.addEventListener("glass-open-studio", (e) => {
  const d = (e as CustomEvent).detail;
  d.studio = openStudio(d);
});

/**
 * The studio on its own, over any page with HA's frontend: pick a dashboard, edit its
 * glass dashboard (or add one), save straight to HA. Opened by `?glass-studio` in the
 * address (`?glass-studio=<dashboard>` for a given one) or `glassStudio()` in the console.
 */
export async function openStandaloneStudio(url?: string | null) {
  const ha = document.querySelector("home-assistant") as (HTMLElement & { hass?: HomeAssistant }) | null;
  if (!ha?.hass) return;
  if (document.querySelector("home-assistant")?.shadowRoot?.querySelector("dialog.glass-studio-dialog")) return;
  // HA's card editor (for cards that are not glass ones) loads with its stack card's editor
  void (async () => {
    if (customElements.get("hui-card-element-editor")) return;
    try {
      const helpers = await (window as any).loadCardHelpers?.();
      // a built-in card is created first as a placeholder, its class loads after
      helpers?.createCardElement({ type: "vertical-stack", cards: [] });
      const stack = await customElements.whenDefined("hui-vertical-stack-card");
      await (stack as any).getConfigElement?.();
    } catch {
      /* the glass cards' own editors still work */
    }
  })();
  let last: string | null | undefined;
  try {
    last = JSON.parse(localStorage.getItem(LAST_KEY) ?? "undefined");
  } catch {
    last = undefined;
  }
  // the dashboard on screen, else the one edited last
  const shown = location.pathname.split("/")[1];
  const want = url !== undefined ? url : shown && shown !== "lovelace" && !shown.startsWith("config") ? shown : (last ?? null);
  const st = openStudio({ config: {}, hass: ha.hass, onChange: () => {}, standalone: true });
  void customElements.whenDefined("hui-card-element-editor").then(() => st.requestUpdate());
  // no card dialog hands new states over: follow HA's own
  const tick = window.setInterval(() => {
    if (!st.isConnected) return window.clearInterval(tick);
    if (ha.hass && st.hass !== ha.hass) st.hass = ha.hass;
  }, 1000);
  await st.openDashboard(want);
  return st;
}
(window as any).glassStudio = openStandaloneStudio;

function studioFromUrl() {
  const q = new URLSearchParams(location.search);
  if (!q.has("glass-studio")) return;
  const v = q.get("glass-studio");
  q.delete("glass-studio");
  history.replaceState(history.state, "", `${location.pathname}${q.toString() ? `?${q}` : ""}${location.hash}`);
  // HA's frontend may still be starting: wait for it (up to ~20 s)
  let tries = 0;
  const go = () => {
    const ha = document.querySelector("home-assistant") as (HTMLElement & { hass?: HomeAssistant }) | null;
    if (ha?.hass) void openStandaloneStudio(v ? v : undefined);
    else if (++tries < 40) setTimeout(go, 500);
  };
  go();
}
studioFromUrl();
window.addEventListener("location-changed", () => setTimeout(studioFromUrl, 0));
