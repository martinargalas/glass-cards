import { scheduleAll, setWallpaper, wallpaperUrl } from "../core/liquid-gl";

/** The wallpaper last shown: put back as soon as the page loads, before the dashboard
 *  knows day from night – so a reload at night doesn't flash the bright day picture. */
const WALLPAPER_KEY = "glass-wallpaper";
(() => {
  let url: string | null = null;
  try {
    url = localStorage.getItem(WALLPAPER_KEY);
  } catch {
    return;
  }
  if (!url) return;
  const until = Date.now() + 10000;
  const tick = () => {
    if (!setWallpaper(url!) && Date.now() < until) requestAnimationFrame(tick);
  };
  tick();
})();
import { css, html, nothing, type LitElement } from "lit";
import { GlassElement } from "../core/glass-element";
import { dayVars, gridGrips, nightVars, selectable, sideDayVars, sideFrostedVars, sideMonoVars, sideVars } from "../core/styles";
import type { BaseCardConfig, GlassMode, HomeAssistant } from "../core/types";
import { registerCard } from "../core/registry";
import { makeEditor } from "../editor/editor";
import { dashboardSpec } from "../editor/specs";
import { preview, previewSize, resolveGlass, settings, lookOf, type Look } from "../core/settings";
import { nightConfig } from "../core/night";
import { PRESETS, areaOrder, cardKind, ident, overlayCards, parseAreas, dragGridLine, dragResult, rememberPopups, splitTracks, trackList, trackOne, type OverlaySource, type Preset } from "../core/layout";
import { buildChildren, configForMode, forward, type ChildEl, type Mode } from "../core/container";
import { demoHass, onDemoChange } from "../demo/hass";

/**
 * Whole-screen layout for a `panel` view. The screen is a CSS grid of named
 * areas; each area holds a column of cards.
 *
 *   type: custom:glass-dashboard
 *   preset: classic       # classic | right | stacked | three | single (ignored when grid.areas is set)
 *   grid:                 # optional, a fully custom layout
 *     columns: 380px 1fr 320px
 *     rows: auto 1fr
 *     areas: |
 *       "datum  stav      stav"
 *       "pocasi mistnosti kamery"
 *   areas:
 *     datum: [ cards ]
 *     pocasi: [ cards ]
 *   header / top / left / main: [ cards ]   # shorthand for areas of the same name
 *   overlay: [ cards ]   # outside the grid, e.g. bubble-card pop-ups and navigation
 *   overlay_source:      # …or taken from another dashboard (YAML or UI), not copied
 *     dashboard: adaptive-dash
 *     view: home         # optional; filter: popups (default) | all
 *
 * Mobile (narrower than breakpoints.mobile) stacks the areas in reading order
 * unless `responsive: { mobile: { grid: … } }` says otherwise. Every card – and
 * the dashboard itself – can adapt with `responsive:` and `visible_on:`.
 *
 *   look: apple-home     # liquid (default) | frosted | apple-home – sets everything below at once
 *   glass: auto          # auto | liquid | frosted | flat | none | home – the panels (large glass)
 *   tile_glass: frosted  # optional: cards inside panels (room cards…); default = glass
 *   control_glass: liquid # optional: buttons, chips, people; default = the card they sit on
 */
const LEGACY = ["header", "top", "left", "main"] as const;
let warnedBubble = false;

interface DashboardConfig extends BaseCardConfig {
  look?: Look;
  glass?: GlassMode;
  tile_glass?: GlassMode;
  control_glass?: GlassMode;
  layout?: "auto" | "mobile" | "tablet" | "desktop";
  /** Legacy single breakpoint = breakpoints.mobile. */
  breakpoint?: number;
  breakpoints?: { mobile?: number; desktop?: number };
  left_width?: string;
  /** Exact width of each layout column, as a panel's: "340px 1" (1 = the rest), "30% 1", "300px 1 300px". */
  column_widths?: string | (string | number)[];
  /** Height of each layout row, as column_widths: "120px 1". Rows not given keep the layout's own. */
  row_heights?: string | (string | number)[];
  gap?: number;
  padding?: string;
  max_width?: string;
  offset?: string;
  fill_height?: boolean;
  /** Space kept free at the bottom for a floating dock (bubble navigation). */
  dock_space?: number | "auto";
  appearance?: "auto" | "light" | "dark" | "sun";
  /** Wallpaper over the HA theme's; the night one in `dark: { wallpaper }`, switched with the appearance. */
  wallpaper?: string;
  /** Liquid glass shader parameters (edge_intensity, rim_intensity, blur, tint, dispersion…). */
  liquid?: Record<string, number>;
  time_tint?: boolean;
  preset?: Preset;
  grid?: { columns?: string; rows?: string; areas?: string | string[] };
  areas?: Record<string, BaseCardConfig[]>;
  header?: BaseCardConfig[];
  top?: BaseCardConfig[];
  left?: BaseCardConfig[];
  main?: BaseCardConfig[];
  overlay?: BaseCardConfig[];
  /** Load pop-ups / navigation from another dashboard instead of listing them here. */
  overlay_source?: OverlaySource | OverlaySource[];
  /**
   * HA theme whose variables the pop-ups get (their card_mod styles usually read
   * theme variables), independent of the theme the user has selected. A name, or
   * { light, dark } following the dashboard's appearance.
   */
  overlay_theme?: string;
  /** Run every card on the made-up demo home instead of this Home Assistant's devices (src/demo). */
  demo?: boolean;
}

/**
 * Container of the overlay cards. Bubble Card's standalone pop-ups hide the
 * nearest <hui-card> above them when closed – which would be the card holding
 * this whole dashboard. They stop looking at an element whose tag ends in
 * "-view", so the overlay is one.
 */
class GlassOverlayView extends HTMLElement {
  connectedCallback() {
    this.style.display = "contents";
  }
}
if (!customElements.get("glass-overlay-view")) customElements.define("glass-overlay-view", GlassOverlayView);

class GlassDashboard extends GlassElement<DashboardConfig> {
  /** HA's own hass; with `demo` the cards get the demo home's built on it. */
  private _realHass?: HomeAssistant;
  private _demoUnsub?: () => void;

  override set hass(hass: HomeAssistant) {
    this._realHass = hass;
    super.hass = this._rawConfig?.demo ? demoHass(hass) : hass;
  }

  override get hass(): HomeAssistant | undefined {
    return super.hass;
  }

  /** Demo on: follow the demo home's changes; off: back to HA's states. */
  private _syncDemo() {
    const on = !!this._rawConfig?.demo;
    if (on && !this._demoUnsub && this.isConnected) this._demoUnsub = onDemoChange(() => this._realHass && (this.hass = this._realHass));
    if (!on && this._demoUnsub) {
      this._demoUnsub();
      this._demoUnsub = undefined;
    }
    if (this._realHass && !!(this._hass as { demo?: unknown } | undefined)?.demo !== on) this.hass = this._realHass;
  }
  static getConfigElement() {
    return makeEditor(dashboardSpec);
  }

  static override properties = { ...GlassElement.properties, _mode: { state: true } };
  declare _mode: Mode;
  /** Config with the current mode's `responsive` overrides applied. */
  private _eff?: DashboardConfig;
  private _areas: Record<string, ChildEl[]> = {};
  /** Editor preview: the overlay's bottom bar (no pop-ups), drawn at the bottom of the preview. */
  private _pvBar: ChildEl[] = [];
  /** Grid of the current mode: column / row tracks and area rows. */
  private _grid: { columns: string; rows: string; template: string[][]; rowIdx: number[]; rowCount: number; resizable: boolean } = {
    columns: "",
    rows: "",
    template: [],
    rowIdx: [],
    rowCount: 0,
    resizable: false,
  };
  /** Large editor: lines between the layout's columns / rows to drag (writes column_widths / row_heights). */
  gridGrips = false;
  private _ro?: ResizeObserver;
  /** Built children per area, reused while that area's config, mode and glass stay the same. */
  private _cache = new Map<string, { key: string; els: ChildEl[] }>();
  private _pending?: number;
  /** Pop-ups / navigation still to build (retried until the page is ready for them). */
  private _overlayJob?: { c: DashboardConfig; key: string; srcs: OverlaySource[]; glass: string; mode: Mode; tries: number };
  private _overlayBusy = false;
  private _overlayRetry?: number;
  /** In HA's card editor: fixed preview mode, scaled to fit, no pop-ups, cheap glass. */
  private _preview = false;
  /** Editor preview of a custom grid: empty areas stay, as placeholders. */
  private _keepEmpty = false;
  /** The large editor showing a pop-up: build the overlay in the preview too. */
  studioOverlay = false;
  /** Editor preview: the wallpaper behind it, as on the device. */
  previewBackground = false;
  /** Editor preview: day (false) or night (true) instead of the appearance setting. */
  previewDark?: boolean;
  private _pvDarkShown?: boolean;
  private _zoom = 1;
  private _swallowVisibility = (e: Event) => e.stopPropagation();
  private _onPreviewMode = () => {
    if (!this._preview || !this._config) return;
    // a preview nobody sees (schematic view, HA's dialog behind the large editor) waits until shown
    if (this._hiddenPreview()) {
      this._stale = true;
      return;
    }
    this._stale = false;
    this._build(preview.mode);
    this._fitZoom();
  };
  /** Preview: the device changed while this one was hidden – rebuild once it shows. */
  private _stale = false;
  private _hiddenPreview(): boolean {
    if (!this.offsetWidth) return true;
    let inStudio = false;
    for (let n: Node | null = this; n; n = n instanceof ShadowRoot ? n.host : n.parentNode) if ((n as Element).localName === "glass-studio") inStudio = true;
    return !inStudio && !!document.querySelector("home-assistant")?.shadowRoot?.querySelector("dialog.glass-studio-dialog");
  }
  /** Preview: the phone's content scrolled – the WebGL glass follows. */
  private _onPvScroll = () => scheduleAll();
  /** Preview: the width it has to fit in. */
  private _fitWidth = 0;
  /** Preview: scale the device-sized layout down to the width it has. */
  private _fitZoom() {
    if (!this._fitWidth) return;
    const z = this._fixedZoom ?? Math.min(1, this._fitWidth / previewSize(this._mode).w);
    if (Math.abs(z - this._zoom) > 0.005) {
      this._zoom = z;
      this.requestUpdate();
    }
    // the large editor shows the scale the preview is drawn at
    this.dispatchEvent(new CustomEvent("glass-preview-zoom", { detail: { zoom: this._zoom, fixed: this._fixedZoom !== undefined } }));
  }
  /** Preview: a scale picked in the editor (1 = the device's real size); undefined = fit the width. */
  private _fixedZoom?: number;
  setPreviewZoom(z: number | undefined) {
    this._fixedZoom = z;
    this._fitZoom();
  }
  private _measure?: number;

  constructor() {
    super();
    this._mode = settings.mode;
  }

  /**
   * HA sets `preview` on cards in its card editor – and on every card while the
   * dashboard is in edit mode. Only the editor dialog gets the preview treatment
   * (fixed device mode, cheap glass); edit mode renders the real dashboard, and
   * leaving either rebuilds it as it was.
   */
  set preview(v: boolean) {
    const want = !!v && this._inDialog();
    if (want === this._preview) return;
    this._preview = want;
    if (this._config) this._build(want ? preview.mode : this._modeFor(this.offsetWidth || window.innerWidth));
  }

  private _inEditor(): boolean {
    return this._preview || this._inDialog();
  }

  private _inDialog(): boolean {
    let n: Node | null = this;
    for (let i = 0; n && i < 40; i++) {
      const el = n as Element;
      if (el.localName === "hui-card-preview" || el.localName === "hui-dialog-edit-card" || el.localName === "hui-card-element-editor" || el.localName === "glass-studio") return true;
      n = (n as Element).parentNode ?? ((n as unknown as ShadowRoot).host ?? null);
    }
    return false;
  }

  private _modeFor(width: number): Mode {
    if (this._preview) return preview.mode;
    const c = this._config;
    if (c?.layout && c.layout !== "auto") return c.layout;
    const mobile = c?.breakpoints?.mobile ?? c?.breakpoint ?? 700;
    const desktop = c?.breakpoints?.desktop ?? 1500;
    return width < mobile ? "mobile" : width >= desktop ? "desktop" : "tablet";
  }

  /** (Re)builds every area for a mode. Runs on config change and when the mode flips. */
  /**
   * The cards of every area for a mode. Cached per area and mode, so flipping
   * mobile ↔ tablet swaps in the other mode's cards instead of rebuilding them all.
   */
  private _areasFor(mode: Mode) {
    const c = configForMode(this._config, mode) as DashboardConfig;
    const look = lookOf(c.look);
    const glass = resolveGlass(c.glass ?? look?.glass);
    // every area with cards: the legacy shorthand keys plus `areas:`
    const sources: Record<string, BaseCardConfig[] | undefined> = {};
    for (const k of LEGACY) if (c[k]) sources[k] = c[k];
    for (const [k, v] of Object.entries(c.areas ?? {})) sources[ident(k)] = v;
    const g = glass;
    const area = (name: string, cfg: BaseCardConfig[] | undefined) => {
      // the look's sidebar material for the left column
      const ag = look?.sidebar && (look.sidebar_areas?.[mode] ?? ["left"]).includes(name) ? look.sidebar : g;
      const key = `${ag}|${JSON.stringify(cfg ?? null)}`;
      const hit = this._cache.get(`${mode}|${name}`);
      if (hit && hit.key === key) return hit.els;
      const els = buildChildren(cfg, this._hass, { nested: false, glass: ag, mode, reuse: hit?.els });
      this._cache.set(`${mode}|${name}`, { key, els });
      return els;
    };
    const areas: Record<string, ChildEl[]> = {};
    for (const [k, v] of Object.entries(sources)) areas[k] = area(k, v);
    return { c, look, g, sources, areas, area };
  }

  /** Preview: builds the other device's cards while idle, so switching to it is quick. */
  private _prewarmJob?: number;
  private _prewarm() {
    const idle = (window as any).requestIdleCallback as ((f: () => void, o: object) => number) | undefined;
    (idle ? (window as any).cancelIdleCallback : clearTimeout)(this._prewarmJob);
    if (!this._preview) return;
    const run = () => {
      if (!this._preview || !this._config) return;
      for (const m of ["mobile", "tablet"] as Mode[]) if (m !== this._mode) this._areasFor(m);
    };
    this._prewarmJob = idle ? idle(run, { timeout: 4000 }) : window.setTimeout(run, 500);
  }

  private _build(mode: Mode) {
    const flipped = mode !== this._mode;
    this._mode = mode;
    settings.mode = mode;
    this.setAttribute("mode", mode);
    const { c, g, sources, areas, area } = this._areasFor(mode);
    this._eff = c;
    this._areas = areas;
    // cards kept from the last time this mode was shown missed the states since
    if (flipped && this._hass) for (const list of Object.values(areas)) forward(list, this._hass);
    this._prewarm();
    // pop-ups / navigation: not in the editor preview; otherwise built once the
    // visible layout is up (they are the heaviest cards and start hidden)
    const srcs = c.overlay_source ? (Array.isArray(c.overlay_source) ? c.overlay_source : [c.overlay_source]) : [];
    const okey = `${mode}|${g}|${JSON.stringify(c.overlay ?? null)}|${JSON.stringify(srcs)}`;
    const cached = this._cache.get("overlay");
    rememberPopups(c.overlay as Record<string, any>[] | undefined, "overlay");
    if (!customElements.get("bubble-card") && (srcs.length || (c.overlay ?? []).some((x) => cardKind(x as any) === "popup")) && !warnedBubble) {
      warnedBubble = true;
      console.warn("glass-cards: pop-ups need Bubble Card (HACS) – it is not installed, so they stay empty");
    }
    const noOverlay = this._preview && !this.studioOverlay;
    this._pvBar = noOverlay ? area("preview-bar", (c.overlay ?? []).filter((x) => cardKind(x as any) !== "popup")) : [];
    this._areas.overlay = noOverlay ? [] : cached?.key === okey ? cached.els : [];
    this._overlayJob = undefined;
    if (!noOverlay && this._areas.overlay.length === 0 && (c.overlay?.length || srcs.length)) {
      this._overlayJob = { c, key: okey, srcs, glass: g, mode, tries: 0 };
      this._scheduleOverlay();
    }

    // grid: explicit `grid.areas`, else a preset; mobile stacks unless it has its own grid
    const side = c.left_width ?? "minmax(320px, 0.36fr)";
    const preset = PRESETS[c.preset ?? "classic"] ?? PRESETS.classic;
    const own = parseAreas(c.grid?.areas);
    let template = own.length ? own : parseAreas(preset.areas.map((r) => `"${r}"`));
    const filled = Object.keys(sources).filter((k) => this._areas[k]?.length);
    // areas with cards that the template doesn't place go below, full width
    const placed = areaOrder(template);
    const width = Math.max(1, ...template.map((r) => r.length));
    for (const k of filled) if (!placed.includes(k)) template = [...template, Array(width).fill(k)];
    let columns = c.grid?.columns ?? (own.length ? `repeat(${width}, minmax(0, 1fr))` : preset.columns(side));
    let rows = c.grid?.rows ?? (own.length ? "" : preset.rows);
    // column_widths / row_heights: exact sizes, one per column / row of the template;
    // the ones not given keep the layout's own
    const cw = trackList(c.column_widths);
    if (cw.length) {
      const base = splitTracks(columns);
      columns = Array.from({ length: width }, (_, i) => (cw[i] ? trackOne(cw[i]) : (base[i] ?? "minmax(0, 1fr)"))).join(" ");
    }
    const rh = trackList(c.row_heights);
    const baseRows = splitTracks(rows);
    const rowTracks = template.map((_, i) => (rh[i] ? trackOne(rh[i]) : (baseRows[i] ?? "auto")));
    const rowCount = template.length;
    // empty areas collapse: drop rows whose areas are all empty – except in an editor's
    // preview of a custom grid, where a new area shows up right away to put cards in
    this._keepEmpty = this._preview && own.length > 0;
    const keep = (n: string) => n !== "." && (this._keepEmpty || !!this._areas[n]?.length);
    const rowIdx = template.map((r, i) => (r.some(keep) ? i : -1)).filter((i) => i >= 0);
    template = rowIdx.map((i) => template[i]);
    if (rh.length) rows = rowIdx.map((i) => rowTracks[i]).join(" ");
    let resizable = true;
    if (mode === "mobile" && !(this._config.responsive as any)?.mobile?.grid) {
      // stacked: only areas that have cards here (an empty one would still cost a gap)
      template = areaOrder(template)
        .filter(keep)
        .map((n) => [n]);
      columns = "minmax(0, 1fr)";
      rows = "";
      resizable = false;
    }
    this._grid = { columns, rows, template, rowIdx, rowCount, resizable };
    this.requestUpdate();
  }

  protected watchedEntities() {
    return ["sun.sun"];
  }

  /** Large editor: the lines between columns / rows, placed on the grid's own lines. */
  private _grips() {
    const g = this._grid;
    if (!this._preview || !this.gridGrips || !g.resizable) return nothing;
    const cols = Math.max(1, ...g.template.map((r) => r.length));
    return html`${Array.from(
      { length: cols - 1 },
      (_, k) => html`<div class="grid-grip col" style="grid-column-start:${k + 2};grid-row:1 / -1" @pointerdown=${(e: PointerEvent) => this._gripDown("columns", k, e)}></div>`,
    )}${Array.from(
      { length: g.template.length - 1 },
      (_, k) => html`<div class="grid-grip row" style="grid-row-start:${k + 2};grid-column:1 / -1" @pointerdown=${(e: PointerEvent) => this._gripDown("rows", k, e)}></div>`,
    )}`;
  }

  private _gripDown(axis: "columns" | "rows", k: number, e: PointerEvent) {
    dragGridLine(e, axis, k, (px) => this._emitGrid(axis, px));
  }

  /** The dragged sizes to the editor (column_widths / row_heights). */
  private _emitGrid(axis: "columns" | "rows", px: number[]) {
    let list = dragResult(px);
    if (axis === "rows") {
      // the rows shown → the template's rows (collapsed ones keep what they had)
      const old = trackList(this._eff?.row_heights);
      const full = Array.from({ length: this._grid.rowCount }, (_, i) => old[i] ?? "auto");
      this._grid.rowIdx.forEach((ti, i) => (full[ti] = list[i]));
      list = full;
    }
    this.dispatchEvent(
      new CustomEvent("glass-grid-resize", {
        detail: { key: axis === "columns" ? "column_widths" : "row_heights", value: list.join(" "), mode: this._mode },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Builds the overlay once the visible layout is up (pop-ups are the heaviest
   * cards and start hidden). Kept pending – not dropped – while the dashboard is
   * detached, HA is not connected yet or a source dashboard fails to load;
   * connecting, the next hass and a timer try again.
   */
  private _scheduleOverlay(delay = 0) {
    clearTimeout(this._overlayRetry);
    const run = () => void this._loadOverlay();
    if (delay) this._overlayRetry = window.setTimeout(run, delay);
    else {
      const idle = (window as any).requestIdleCallback;
      if (idle) idle(run, { timeout: 1500 });
      else this._overlayRetry = window.setTimeout(run, 200);
    }
  }

  private async _loadOverlay() {
    const job = this._overlayJob;
    if (!job || this._overlayBusy || (this._preview && !this.studioOverlay) || !this.isConnected || !this._hass) return;
    this._overlayBusy = true;
    try {
      const lists = await Promise.all(job.srcs.map((s) => overlayCards(this._hass!, s).then((l) => l, () => undefined)));
      if (this._overlayJob !== job) return;
      if (lists.some((l) => l === undefined) && job.tries < 5) {
        job.tries++;
        this._scheduleOverlay(2000 * job.tries);
        return;
      }
      const loaded = lists.flatMap((l) => l ?? []);
      const els = buildChildren([...loaded, ...(job.c.overlay ?? [])] as BaseCardConfig[], this._hass, { nested: false, glass: job.glass as any, mode: job.mode });
      this._cache.set("overlay", { key: job.key, els });
      this._areas.overlay = els;
      this._overlayJob = undefined;
      if (this._hass) forward(els, this._hass);
      this.requestUpdate();
    } finally {
      this._overlayBusy = false;
    }
  }

  /**
   * Variables of `overlay_theme` (and its light/dark mode) set on the overlay one
   * by one – a single style attribute would be cut short by the first value the
   * CSS parser rejects.
   */
  private _themeProps: string[] = [];
  private _applyOverlayTheme() {
    const el = this.shadowRoot?.querySelector<HTMLElement>(".overlay");
    if (!el) return;
    for (const k of this._themeProps) el.style.removeProperty(k);
    this._themeProps = [];
    const t = (this._eff ?? this._config)?.overlay_theme;
    if (!t) return;
    const dark = this.hasAttribute("dark");
    const theme = this._hass?.themes?.themes?.[t];
    if (!theme) return;
    const vars: Record<string, any> = { ...theme, ...(theme.modes?.[dark ? "dark" : "light"] ?? {}) };
    for (const [k, v] of Object.entries(vars)) {
      if (k === "modes" || k.startsWith("card-mod") || (typeof v !== "string" && typeof v !== "number")) continue;
      el.style.setProperty(`--${k}`, String(v));
      this._themeProps.push(`--${k}`);
    }
  }

  protected override updated(changed: Map<string, unknown>) {
    super.updated(changed);
    this._applyOverlayTheme();
  }

  /** `styles:` of the current mode (responsive overrides included). */
  protected override styleConfig() {
    return this._eff ?? this._config;
  }

  /** Grid currently in use (for the editor). */
  get layoutAreas(): string[] {
    return areaOrder(this._grid.template);
  }

  /** Bubble-card horizontal button stacks float at the bottom; keep room for them. */
  private _dock(): number {
    const c = this._eff ?? this._config;
    const d = c.dock_space ?? "auto";
    if (typeof d === "number") return d;
    const hasDock =
      !!c.overlay_source ||
      (c.overlay ?? []).some((c) => c.type === "custom:bubble-card" && c.card_type === "horizontal-buttons-stack");
    return hasDock ? 78 : 0;
  }

  /** Distance of the floating dock's top edge from the bottom of the screen, if there is one. */
  private _dockTop?: number;

  /** Tablet/desktop: end the layout at the dock's top edge, so it sits centred between screen top and dock. */
  private _measureDock() {
    const c = this._eff ?? this._config;
    let top: number | undefined;
    if (c && !this._preview && this._mode !== "mobile" && typeof c.dock_space !== "number") {
      const find = (n: Element | ShadowRoot, depth: number): Element | null => {
        const hit = n.querySelector("glass-dock:not([inline])");
        if (hit || !depth) return hit;
        for (const el of n.querySelectorAll("*")) {
          const r = el.shadowRoot && find(el.shadowRoot, depth - 1);
          if (r) return r;
        }
        return null;
      };
      const ov = this.shadowRoot?.querySelector(".overlay");
      const bar = ov && find(ov, 3)?.shadowRoot?.querySelector(".dock");
      const r = bar?.getBoundingClientRect();
      if (r?.height) top = Math.round(window.innerHeight - r.top);
    }
    if (top !== this._dockTop) {
      this._dockTop = top;
      this.requestUpdate();
    }
  }

  /**
   * Subtle tint of every glass surface by time of day, like macOS wallpapers:
   * warm at dawn, neutral during the day, amber at dusk, deep blue at night.
   */
  private _tint(hass: HomeAssistant | undefined): string {
    if (this._config.time_tint === false || !hass) return "transparent";
    // editor preview forced to day / night: no sunset tones, the night tint by the switch
    if (this._preview && this.previewDark !== undefined) return this.previewDark ? "rgba(40, 60, 150, 0.12)" : "transparent";
    const sun = hass.states["sun.sun"];
    if (!sun) return "transparent";
    const el = Number(sun.attributes.elevation);
    const rising = !!sun.attributes.rising;
    if (Number.isNaN(el)) return "transparent";
    if (el < -6) return "rgba(40, 60, 150, 0.12)";
    if (el < 8) return rising ? "rgba(255, 176, 120, 0.09)" : "rgba(255, 130, 90, 0.11)";
    return "transparent";
  }

  private _wallpaper?: string;
  private _wallpaperTries = 0;

  /** The configured day / night wallpaper on HA's view background (it may not exist yet on first render). */
  private _applyWallpaper(dark: boolean) {
    // the page's wallpaper belongs to the real dashboard, not to an editor preview
    if (this._preview) return;
    // from the config as set: this one may still be the other time of day's
    const url = nightConfig<DashboardConfig>(this._rawConfig ?? ({} as DashboardConfig), dark).wallpaper;
    if (url === this._wallpaper) return;
    if (setWallpaper(url)) {
      this._wallpaper = url;
      try {
        url ? localStorage.setItem(WALLPAPER_KEY, url) : localStorage.removeItem(WALLPAPER_KEY);
      } catch {
        /* private mode: no head start next time */
      }
      this._wallpaperTries = 0;
      requestAnimationFrame(() => scheduleAll());
    } else if (this._wallpaperTries++ < 20) setTimeout(() => this._applyWallpaper(dark), 250);
  }

  protected override willUpdate(changed: Map<string, unknown>) {
    super.willUpdate(changed);
    if (!this._config) return;
    const dark = this._night(this._hass);
    settings.dark = dark;
    // the preview's day / night switch: cards with their own night look (room photos) re-render too
    if (this._preview && this.previewDark !== this._pvDarkShown) {
      this._pvDarkShown = this.previewDark;
      rerenderAll(this.renderRoot);
      // the WebGL glass samples the preview's wallpaper: repaint once it has swapped
      requestAnimationFrame(() => requestAnimationFrame(() => scheduleAll()));
    }
    this._applyWallpaper(dark);
    if (dark !== this.hasAttribute("dark")) {
      this.toggleAttribute("dark", dark);
      // the cards inside only re-check day / night on a hass update: hand it down again
      if (this._hass) this.forwardHass(this._hass);
      // the WebGL glass only re-renders on resize / scroll; repaint it for the new tint
      requestAnimationFrame(() => scheduleAll());
    }
    this.style.setProperty("--glass-tint", this._tint(this._hass));
    // liquid: { rim_intensity: 0.05 } → --glass-liquid-rim-intensity, inherited by every card
    for (const [k, v] of Object.entries(this._config.liquid ?? {})) {
      this.style.setProperty(`--glass-liquid-${k.replace(/_/g, "-")}`, String(v));
    }
  }

  protected override nightNow(): boolean {
    return this._night(this._hass);
  }

  override setConfig(config: DashboardConfig) {
    // Global defaults first, so children created below already see them – by night with its `dark:`
    this._rawConfig = config;
    const c = nightConfig(config, this.nightNow());
    const look = lookOf(c.look);
    settings.glass = c.glass ?? look?.glass ?? "auto";
    settings.tile_glass = c.tile_glass ?? look?.tile_glass;
    settings.control_glass = c.control_glass ?? look?.control_glass;
    settings.sidebar = look?.sidebar;
    settings.bar_glass = look?.bar_glass;
    super.setConfig(config);
    this._syncDemo();
    // Editor typing sends a config per keystroke: rebuild once it settles.
    if (this._preview || (this.isConnected && this._inEditor())) {
      this._preview = true;
      clearTimeout(this._pending);
      // a preview nobody sees (HA's dialog behind the large editor, the schematic) builds once shown
      if (this.isConnected && this._hiddenPreview()) {
        this._stale = true;
        return;
      }
      // unchanged cards are reused, a changed one only gets its new config: short enough to follow typing
      this._pending = window.setTimeout(() => this._build(this._modeFor(0)), this._areas.main || Object.keys(this._areas).length ? 40 : 0);
      return;
    }
    this._build(this._modeFor(this.offsetWidth || window.innerWidth));
    // tint / tuning may have changed: repaint the WebGL glass once styles are applied
    requestAnimationFrame(() => requestAnimationFrame(() => scheduleAll()));
  }

  /** Day / night for the cards inside (read by isDark); undefined until configured. */
  glassNight(): boolean | undefined {
    return this._config ? this._night(this._hass) : undefined;
  }

  /** Editor preview's day / night switch (read by previewNight); undefined = not forced. */
  glassPreviewNight(): boolean | undefined {
    return this._preview ? this.previewDark : undefined;
  }

  /** Night by the dashboard's appearance: HA's dark mode (auto), fixed, or the sun. */
  private _night(hass?: HomeAssistant): boolean {
    if (this._preview && this.previewDark !== undefined) return this.previewDark;
    // the config as set: `dark:` never says when it is night
    const a = (this._rawConfig ?? this._config)?.appearance ?? "auto";
    return a === "dark" || (a === "auto" && !!hass?.themes?.darkMode) || (a === "sun" && hass?.states["sun.sun"]?.state === "below_horizon");
  }

  protected override forwardHass(hass: HomeAssistant) {
    // the cards inside see the dashboard's day / night already on this update
    if (this._config) settings.dark = this._night(hass);
    for (const list of Object.values(this._areas)) if (list) forward(list, hass);
    if (this._overlayJob && !this._overlayBusy) this._scheduleOverlay();
  }

  override connectedCallback() {
    super.connectedCallback();
    this._syncDemo();
    if (!this._preview && this._inEditor()) {
      this._preview = true;
      if (this._config) this._build(preview.mode);
    }
    window.addEventListener("glass-preview-mode", this._onPreviewMode);
    if (this._overlayJob) this._scheduleOverlay();
    // Cards inside (e.g. Bubble Card standalone pop-ups) announce their own
    // visibility with `card-visibility-changed`; HA's <hui-card> wrapper around
    // this dashboard would take it as ours and hide the whole screen.
    this.addEventListener("card-visibility-changed", this._swallowVisibility);
    this._ro = new ResizeObserver(([e]) => {
      if (!this._config) return;
      if (this._preview) {
        this._fitWidth = e.contentRect.width;
        if (this._stale && !this._hiddenPreview()) this._onPreviewMode();
        else this._fitZoom();
        return;
      }
      const mode = this._modeFor(e.contentRect.width);
      if (mode !== this._mode) this._build(mode);
    });
    this._ro.observe(this);
    // Toolbars get hidden/shown after load (WallPanel, kiosk-mode); re-measuring
    // the space above once a second costs one getBoundingClientRect.
    const measure = () => {
      if (this._config?.offset) return;
      const top = Math.max(0, Math.round(this.getBoundingClientRect().top + window.scrollY));
      const v = `${top}px`;
      if (this.style.getPropertyValue("--auto-offset") !== v) this.style.setProperty("--auto-offset", v);
    };
    // HA's edit mode wraps the card in hui-card-options with an "Edit" bar at the
    // bottom of the screen – the dock would cover it, so it hides while editing
    const editing = () => {
      let n: Node | null = this.parentNode;
      let on = false;
      for (let i = 0; n && i < 12 && !on; i++) {
        on = (n as Element).localName === "hui-card-options";
        n = (n as Element).parentNode ?? ((n as unknown as ShadowRoot).host ?? null);
      }
      if (on !== this.hasAttribute("editing")) this.toggleAttribute("editing", on);
    };
    const tick = () => {
      measure();
      editing();
      this._measureDock();
    };
    tick();
    this._measure = window.setInterval(tick, 1000);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._demoUnsub?.();
    this._demoUnsub = undefined;
    window.removeEventListener("glass-preview-mode", this._onPreviewMode);
    this.removeEventListener("card-visibility-changed", this._swallowVisibility);
    clearTimeout(this._pending);
    clearTimeout(this._overlayRetry);
    this._ro?.disconnect();
    clearInterval(this._measure);
  }

  override getCardSize() {
    return 12;
  }

  protected override render() {
    if (!this._config) return nothing;
    const c = this._eff ?? this._config;
    const mobile = this._mode === "mobile";
    const docked = !mobile && this._dockTop != null;
    // looks without a sidebar material (liquid, frosted): the side column still gets
    // the sidebar's colours – white text, accent icons, monochrome weather
    const look = lookOf(c.look);
    const side = look.sidebar ? [] : (look.sidebar_areas?.[this._mode] ?? ["left"]);
    // light glass looks frosted: the frosted side colours (graphite by day)
    const frosted = ["frosted", "light"].includes(resolveGlass(c.glass ?? look.glass));
    const vars = [
      `--left:${c.left_width ?? "minmax(320px, 0.36fr)"}`,
      `--gap:${c.gap ?? 22}px`,
      `--pad:${c.padding ?? (mobile ? "12px 14px 16px" : docked ? "30px 24px 14px" : "14px 24px 24px")}`,
      `--offset:${c.offset ?? "var(--auto-offset, var(--header-height, 56px))"}`,
      `--dock:${docked ? this._dockTop : this._dock()}px`,
      c.max_width ? `--max:${c.max_width}` : "",
    ].join(";");
    const g = this._grid;
    const tracks = [
      `grid-template-columns:${g.columns}`,
      g.rows ? `grid-template-rows:${g.rows}` : "",
      `grid-template-areas:${g.template.map((r) => `"${r.join(" ")}"`).join(" ")}`,
    ]
      .filter(Boolean)
      .join(";");
    // preview: the device's screen; --glass-vw / --glass-vh stand in for vw / vh in card sizes
    const { w: pvW, h: pvH } = previewSize(this._mode);
    const pv = this._preview
      ? `;width:${pvW}px;height:${this._mode === "mobile" ? "auto" : `${pvH}px`};--offset:0px;--glass-vw:${pvW / 100}px;--glass-vh:${pvH / 100}px`
      : "";
    const dash = html`<div class="dash ${mobile ? "mobile" : ""} ${c.fill_height === false || this._preview ? "" : "fill"}" style="${vars};${tracks}${pv}">
      ${areaOrder(g.template).map((a) =>
        this._areas[a]?.length
          ? html`<section class="area ${a === "header" ? "header" : ""} ${side.includes(a) ? `side ${frosted ? "frosted" : ""}` : ""}" style="grid-area:${a}">${this._areas[a]}</section>`
          : this._keepEmpty && a !== "."
            ? html`<section class="area empty-area" style="grid-area:${a}"><span>${a}</span></section>`
            : nothing,
      )}${this._grips()}
    </div>`;
    const overlay = html`<glass-overlay-view class="overlay">${this._areas.overlay ?? nothing}</glass-overlay-view>`;
    if (!this._preview) return html`${dash}${overlay}`;
    // editor preview: the dashboard with its dock below, scaled to fit, on the wallpaper if asked
    let bg = "";
    if (this.previewBackground) {
      const url = wallpaperUrl(nightConfig<DashboardConfig>(this._rawConfig ?? ({} as DashboardConfig), this.hasAttribute("dark")).wallpaper);
      bg = `background:${url ? `url('${url}') center / cover no-repeat` : "var(--lovelace-background, var(--primary-background-color))"}`;
    }
    // a phone: its screen's height, the content scrolling under the dock at the bottom edge
    const phone = this._mode === "mobile";
    return html`<div
        class="pv-frame ${bg ? "bg" : ""} ${phone ? "phone" : ""}"
        style="zoom:${this._zoom};${phone ? `height:${previewSize("mobile").h}px;` : ""}${bg}"
      >
        ${phone ? html`<div class="pv-scroll" @scroll=${this._onPvScroll}>${dash}<div class="pv-room"></div></div>` : dash}${this._pvBar.length
          ? html`<div class="pv-bar">${this._pvBar}</div>`
          : nothing}
      </div>
      ${overlay}`;
  }

  static override styles = [
    GlassElement.styles,
    selectable,
    gridGrips,
    css`
      :host {
        display: block;
        /* the room-card tile as it looks on the wallpaper – also inside the dark
           sidebar, which re-tints the --glass-home-* tokens for its own content */
        ${dayVars}
      }
      /* Dark appearance: same tokens, darker glass (core/styles nightVars). Inherited by every card inside. */
      :host([dark]) {
        ${nightVars}
      }
      .dash {
        box-sizing: border-box;
        /* the large editor draws pop-up previews over it */
        position: relative;
        display: grid;
        gap: var(--gap);
        padding: var(--pad);
        max-width: var(--max, none);
        margin: 0 auto;
      }
      .dash {
        margin-bottom: calc(var(--dock, 0px) + env(safe-area-inset-bottom, 0px));
      }
      .dash.fill {
        height: calc(100dvh - var(--offset) - var(--dock, 0px));
      }
      .dash.mobile {
        align-content: start;
        height: auto;
        min-height: calc(100dvh - var(--offset) - var(--dock, 0px));
      }
      .area {
        min-width: 0;
        min-height: 0;
        display: flex;
        flex-direction: column;
        gap: var(--gap);
      }
      .area > * {
        flex: 1 1 auto;
      }
      .area.empty-area {
        min-height: 120px;
        display: grid;
        place-items: center;
        border: 2px dashed rgba(127, 127, 127, 0.5);
        border-radius: 20px;
        color: rgba(127, 127, 127, 0.95);
        font-size: 14px;
      }
      .area.side {
        ${sideDayVars}
        ${sideMonoVars}
      }
      .area.side.frosted {
        ${sideFrostedVars}
      }
      :host([dark]) .area.side {
        ${sideVars}
        ${sideMonoVars}
      }
      .header {
        justify-content: center;
      }
      .overlay {
        display: contents;
      }
      .pv-frame {
        width: fit-content;
        margin: 0 auto;
      }
      /* the space kept for the floating dock: the preview draws the dock right below instead */
      .pv-frame .dash {
        margin-bottom: 0;
      }
      .pv-frame.phone {
        position: relative;
        overflow: hidden;
        border-radius: 18px;
        outline: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
      }
      /* the phone's screen scrolls; the dock stays on its bottom edge */
      .pv-scroll {
        height: 100%;
        overflow-x: hidden;
        overflow-y: auto;
        scrollbar-width: none;
      }
      .pv-scroll::-webkit-scrollbar {
        display: none;
      }
      /* room below the last cards for the dock, as on the phone */
      .pv-room {
        height: 84px;
      }
      .pv-frame.phone .dash {
        min-height: 0;
      }
      .pv-frame.phone .pv-bar {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        padding-bottom: 14px;
        isolation: isolate;
      }
      /* as the dock's fade on the phone: what scrolls below it blurs out */
      .pv-frame.phone .pv-bar::before {
        content: "";
        position: absolute;
        inset: -28px 0 0;
        z-index: -1;
        -webkit-backdrop-filter: blur(14px);
        backdrop-filter: blur(14px);
        -webkit-mask-image: linear-gradient(to bottom, transparent, #000 55%);
        mask-image: linear-gradient(to bottom, transparent, #000 55%);
        pointer-events: none;
      }
      .pv-frame.bg {
        border-radius: 18px;
        overflow: hidden;
      }
      /* the dock in the editor preview: below the preview, where it sits on the screen */
      .pv-bar {
        display: flex;
        justify-content: center;
        padding: 4px 0 8px;
        /* as wide as the device: a scrolling dock must not widen the frame */
        width: 0;
        min-width: 100%;
      }
      .pv-bar > * {
        max-width: 100%;
        min-width: 0;
      }
      .pv-bar > * {
        position: static !important;
        left: auto !important;
        transform: none !important;
        pointer-events: auto;
      }
      :host([editing]) .overlay {
        /* the overlay view sets display inline */
        display: none !important;
      }
      /* room for HA's edit bar (about 65 px) instead of the dock */
      :host([editing]) .dash {
        margin-bottom: 0;
      }
      :host([editing]) .dash.fill {
        height: calc(100dvh - var(--offset) - 72px);
      }
    `,
  ];
}

registerCard("glass-dashboard", GlassDashboard, {
  name: "Glass – dashboard",
  description: "Full-screen layout of named areas (presets or a custom grid). Use it in a Panel view.",
});

/** requestUpdate() on every Lit element below, through shadow roots. */
function rerenderAll(root: ParentNode) {
  for (const el of root.querySelectorAll("*")) {
    (el as Partial<LitElement>).requestUpdate?.();
    if (el.shadowRoot) rerenderAll(el.shadowRoot);
  }
}
