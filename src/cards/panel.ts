import { tr } from "../i18n";
import type { PropertyValues } from "lit";
import { css, html, nothing } from "lit";
import { GlassElement } from "../core/glass-element";
import type { BaseCardConfig, GlassMode, HomeAssistant } from "../core/types";
import { registerCard } from "../core/registry";
import { makeEditor } from "../editor/editor";
import { panelSpec } from "../editor/specs";
import { gridGrips, selectable, sideDayVars, sideFrostedVars, sideMonoVars, sideVars, surface } from "../core/styles";
import { buildChildren, forward, visibleChildren, type ChildEl, type Mode } from "../core/container";
import { conditionEntities, usesScreen, usesSelect } from "../core/conditions";
import { onAnySelected } from "../core/select";
import { resolveGlass, settings } from "../core/settings";
import { LiquidController } from "../core/liquid";
import { dragGridLine, dragResult, screenUnits, trackCss as tracks, trackList } from "../core/layout";
import { PANEL_PARTS } from "../core/card-parts";

/**
 * Glass container that composes other cards. The panel owns the only backdrop blur;
 * glass cards inside render flat, which is what keeps the dashboard fast.
 *
 *   type: custom:glass-panel
 *   layout: row            # row | column | grid
 *   columns: 3             # grid only
 *   gap: 16
 *   padding: 20
 *   align: center          # cross axis
 *   justify: space-between # main axis
 *   title: Obývák          # optional heading with a separator line (inside a panel: a room card name)
 *   icon: mdi:sofa
 *   masonry: true          # grid: cards as tall as their content, packed without gaps
 *   masonry_fill: true     # … stretched so every column ends at the panel's bottom
 *   min_column_width: 180  # grid: as many columns as fit at this width, instead of `columns`
 *   tile_glass: frosted    # optional glass tier for the cards inside (default: dashboard tile_glass, else the panel's)
 *   bar: true              # optional: the liquid glass bars' material (clear, bright rims) instead of a tile
 *   role: sidebar          # optional: look's side-column material (panel = look's panel glass), even when nested
 *   control_glass: liquid  # optional tier for their buttons / chips / people (default: dashboard control_glass, else the card's)
 *   cards:
 *     - type: custom:glass-status-bar
 *       view_layout: { grow: 1 }
 *     - type: custom:glass-people
 */
interface PanelConfig extends BaseCardConfig {
  cards: BaseCardConfig[];
  tile_glass?: GlassMode;
  /** Grid: every card the same height (default on tablets / computers) or each row as tall as it needs (phones). */
  equal_rows?: boolean | "true" | "false";
  /** Grid: each card only as tall as its content, packed into the columns without gaps (left to right, like a wall). */
  masonry?: boolean;
  /** masonry: the cards share out the height the panel has beyond its tallest column */
  masonry_fill?: boolean;
  /** Grid: as many columns as fit at this width (px) instead of a fixed `columns` – e.g. two on a wide phone, one on a narrow one. */
  min_column_width?: number;
  control_glass?: GlassMode;
  layout?: "row" | "column" | "grid";
  wrap?: boolean;
  /** Row: a strip that scrolls sideways (swipe), the cards snapping to its start – e.g. rooms on a phone. */
  scroll?: boolean;
  /** scroll: each card's width (px or CSS); its height is the panel's `height` / the row's */
  item_width?: number | string;
  columns?: number;
  rows?: number;
  /** grid: own column widths, e.g. "2 1" (shares), "60% 40%", "300px 1" – the number of columns follows. */
  column_widths?: string | (string | number)[];
  /** grid: own row heights, as column_widths. */
  row_heights?: string | (string | number)[];
  gap?: number;
  padding?: number | string;
  align?: string;
  justify?: string;
  title?: string;
  icon?: string;
  height?: string;
  /**
   * A top-level surface wherever the panel sits (e.g. inside a pop-up layout): `panel` takes
   * the look's panel glass, `sidebar` the look's side-column material (Apple Home: dark liquid).
   */
  role?: "panel" | "sidebar";
  /** The material of the liquid glass bars (thermostat, light, period bar) instead of a tile. */
  bar?: boolean;
}

class GlassPanel extends GlassElement<PanelConfig> {
  static override parts = PANEL_PARTS;
  static getConfigElement() {
    return makeEditor(panelSpec);
  }

  private _children: ChildEl[] = [];
  private _mode: Mode = settings.mode;

  static getStubConfig() {
    return { layout: "column", cards: [] };
  }

  protected override validateConfig(c: PanelConfig) {
    if (!Array.isArray(c.cards)) throw new Error("`cards` must be a list");
    return c;
  }

  /** The entities the cards' visibility conditions read: a change shows or hides a card. */
  protected watchedEntities(c: PanelConfig) {
    const out = new Set<string>();
    for (const card of c.cards ?? []) conditionEntities((card as { visibility?: any }).visibility, undefined, out);
    return out;
  }

  /** A card with a screen condition: the window's size decides – checked again when it changes. */
  private _onResize = () => {
    if ((this._config?.cards ?? []).some((card) => usesScreen((card as { visibility?: any }).visibility))) this.requestUpdate();
  };

  /** A card shown by what is picked in a group: a tap elsewhere on the screen decides. */
  private _unsel?: () => void;
  private _onSelect = () => {
    if ((this._config?.cards ?? []).some((card) => usesSelect((card as { visibility?: any }).visibility))) this.requestUpdate();
  };

  constructor() {
    super();
    new LiquidController(this, ".panel:not(.transparent)", undefined, ".panel.transparent:not(.tiles)");
  }

  /**
   * The panel is the glass (with lens); children render nested – no blur of their
   * own, because inside a backdrop-filter parent they could only refract the
   * parent ("backdrop root"). They still get the glass tier so liquid styling
   * (luminous bezel) applies to them.
   */
  private _build() {
    this._children = buildChildren(this._config.cards, this._hass, {
      nested: true,
      // tiles may use their own tier (tile_glass on the panel or the dashboard)
      glass: resolveGlass(this._config.tile_glass ?? settings.tile_glass ?? this._config.glass),
      // and their buttons / chips a third one (panel control_glass; else each card decides)
      controlGlass: this._config.control_glass ? resolveGlass(this._config.control_glass) : undefined,
      mode: this._mode,
      reuse: this._children,
    });
    // new children: measure them again for the masonry rows
    this._masonryDone = false;
  }

  override setConfig(config: PanelConfig) {
    super.setConfig(config);
    this._build();
  }

  /** Called by the parent container; rebuilds children with that mode's overrides. */
  setMode(mode: Mode) {
    if (mode === this._mode) return;
    this._mode = mode;
    if (this._config) {
      this._build();
      this.requestUpdate();
    }
  }

  protected override forwardHass(hass: HomeAssistant) {
    forward(this._children, hass);
  }

  override getCardSize() {
    return Math.max(1, this._children.length * 2);
  }

  protected override willUpdate(changed: PropertyValues) {
    super.willUpdate(changed);
    const role = this._config?.role;
    if (!role) return;
    // a surface of its own, as on the dashboard: not nested, the look's material
    this.removeAttribute("nested");
    this.removeAttribute("on-bare");
    this.removeAttribute("own-tile");
    const look = role === "sidebar" ? (settings.sidebar ?? settings.glass) : settings.glass;
    // a look without a sidebar material (liquid, frosted): keep the sidebar's colours
    this.toggleAttribute("side", role === "sidebar" && !settings.sidebar);
    this.setAttribute("glass", resolveGlass(this._config.glass ?? look));
  }

  /** Whether this panel draws no glass – its own `glass: none` or none handed down. */
  private get _bare() {
    return this._config?.glass === "none" || this.getAttribute("glass") === "none";
  }

  /**
   * Masonry: 1px grid rows, each card spans as many as it is tall (plus the gap), so
   * cards keep their reading order left to right and short ones pack under tall ones.
   */
  private _masonryRo?: ResizeObserver;
  private _masonryDone = false;
  private _masonry() {
    const on = this._config?.layout === "grid" && !!this._config.masonry;
    this._masonryRo?.disconnect();
    for (const el of this._children ?? []) {
      if (!on) {
        el.style.removeProperty("grid-row-end");
        continue;
      }
      el.style.alignSelf = "start";
      el.style.height = "auto";
    }
    if (!on) return;
    let queued = false;
    this._masonryRo ??= new ResizeObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => ((queued = false), this._layMasonry()));
    });
    const body = this.shadowRoot?.querySelector(".body");
    if (body) this._masonryRo.observe(body);
    for (const el of this._children) this._masonryRo.observe(el);
    this._layMasonry();
  }

  /**
   * Each card spans as many 1px rows as it is tall. With masonry_fill, a panel given more height
   * than its tallest column shares the rest out among each column's cards, so they end at its bottom.
   * Layout px (offsetHeight), not the screen's: the editor preview is scaled down.
   */
  private _layMasonry() {
    const body = this.shadowRoot?.querySelector<HTMLElement>(".body");
    const kids = (this._children ?? []).filter((el) => el.isConnected);
    if (!body || !kids.length || !this._config?.masonry) return;
    const gap = this._config.gap ?? 16;
    const span = (el: HTMLElement, h: number) => (el.style.gridRowEnd = `span ${Math.max(1, Math.ceil(h + gap))}`);
    for (const el of kids) el.style.height = "auto";
    const nat = kids.map((el) => el.offsetHeight);
    kids.forEach((el, i) => span(el, nat[i]));
    const cols = new Map<number, number[]>();
    kids.forEach((el, i) => {
      if (!nat[i]) return;
      const x = Math.round(el.offsetLeft);
      cols.set(x, [...(cols.get(x) ?? []), i]);
    });
    const tall = (ix: number[]) => ix.reduce((n, i) => n + nat[i] + gap, 0) - gap;
    const tallest = Math.max(0, ...[...cols.values()].map(tall));
    const room = body.clientHeight;
    if (!this._config.masonry_fill || room - tallest < 2) return;
    for (const ix of cols.values()) {
      const extra = (room - tall(ix)) / ix.length;
      for (const i of ix) {
        kids[i].style.height = `${nat[i] + extra}px`;
        span(kids[i], nat[i] + extra);
      }
    }
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("resize", this._onResize);
    this._unsel?.();
    this._flexRo?.disconnect();
    this._flexRo = undefined;
    this._masonryRo?.disconnect();
  }

  override connectedCallback() {
    super.connectedCallback();
    window.addEventListener("resize", this._onResize);
    this._unsel = onAnySelected(this._onSelect);
    this._studio = this._inStudio();
    if (this.hasUpdated) this._masonry();
  }

  protected override updated(changed: PropertyValues) {
    super.updated(changed);
    if (!this._masonryDone) {
      this._masonryDone = true;
      this._masonry();
    }
    // the dashboard sets our glass attribute after the children were built:
    // keep their on-bare flag in step with what the panel really is
    const bare = this._bare;
    for (const el of this._children ?? []) {
      if (!el.hasAttribute("nested")) continue;
      el.toggleAttribute("on-bare", bare);
      // with no glass around it a card with glass (its own or the panel's "cards inside")
      // is a tile of its own, as on the dashboard; on a glass panel only a card that picked
      // its own background material (not the one passed down) draws a tile
      // (by the card's config: its glass attribute may not be set yet when the panel is drawn)
      const g = el.getAttribute("glass");
      const mine = (el as { _config?: { glass?: string } })._config?.glass;
      const own = bare ? g !== "none" : !!mine && mine !== "none";
      if (own !== el.hasAttribute("own-tile")) {
        el.toggleAttribute("own-tile", own);
        (el as any).requestUpdate?.();
      }
    }
    // large editor: as many lines to drag as the grid has tracks (rows come from the cards)
    const b = this._gripsOn() ? this.shadowRoot?.querySelector<HTMLElement>(".body") : undefined;
    const cs = b && getComputedStyle(b);
    const n = (v?: string) => (!v || v === "none" ? 0 : v.trim().split(/\s+/).length);
    const cols = n(cs?.gridTemplateColumns);
    const rows = n(cs?.gridTemplateRows);
    if (cols !== this._tracks.cols || rows !== this._tracks.rows) {
      this._tracks = { cols, rows };
      this.requestUpdate();
    }
    // a line / column: the handles follow their cards' edges
    if (this._flexGripsOn()) {
      this._flexRo ??= new ResizeObserver(() => requestAnimationFrame(this._placeFlex));
      this._flexRo.disconnect();
      const body = this.shadowRoot?.querySelector(".body");
      if (body) this._flexRo.observe(body);
      for (const el of this._children) this._flexRo.observe(el);
      this._placeFlex();
    } else {
      this._flexRo?.disconnect();
    }
  }

  /** Large editor, line / column panel: a handle on each card's end edge sets its own width / height. */
  private _flexRo?: ResizeObserver;
  private _flexGripsOn() {
    const l = this._config?.layout ?? "column";
    return this._studio && (l === "row" || l === "column") && !this._config?.scroll;
  }

  private _flexGrips() {
    if (!this._flexGripsOn()) return nothing;
    const dir = this._config?.layout === "row" ? "col" : "row";
    return this._children.map(
      (_, i) => html`<div
        class="flex-grip ${dir}"
        data-i=${i}
        title=${tr("Drag to size the card, double-click for automatic")}
        @pointerdown=${(e: PointerEvent) => this._flexDown(i, e)}
        @dblclick=${() => this._emitCardSize(this._children[i], undefined)}
      ></div>`,
    );
  }

  /** Puts each handle on its card's end edge, in the middle of the gap (in % – right at any preview scale). */
  private _placeFlex = () => {
    const body = this.shadowRoot?.querySelector<HTMLElement>(".body");
    if (!body) return;
    const br = body.getBoundingClientRect();
    if (!br.width || !br.height) return;
    const row = this._config?.layout === "row";
    const scale = br.width / (parseFloat(getComputedStyle(body).width) || br.width);
    const half = ((this._config?.gap ?? 16) * scale) / 2;
    const pct = (v: number, total: number) => `${(v / total) * 100}%`;
    for (const g of body.querySelectorAll<HTMLElement>(":scope > .flex-grip")) {
      const r = this._children[Number(g.dataset.i)]?.getBoundingClientRect();
      g.style.display = r && r.width && r.height ? "" : "none";
      if (!r || !r.width || !r.height) continue;
      if (row) Object.assign(g.style, { left: pct(r.right - br.left + half, br.width), top: pct(r.top - br.top, br.height), height: pct(r.height, br.height) });
      else Object.assign(g.style, { top: pct(r.bottom - br.top + half, br.height), left: pct(r.left - br.left, br.width), width: pct(r.width, br.width) });
    }
  };

  /** Drag on a card's edge: its width (line) / height (column) follows the pointer, in layout px. */
  private _flexDown(i: number, e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = this._children[i];
    const grip = e.currentTarget as HTMLElement;
    const body = grip.parentElement as HTMLElement;
    if (!el) return;
    const row = this._config?.layout === "row";
    const scale = body.getBoundingClientRect().width / (parseFloat(getComputedStyle(body).width) || 1) || 1;
    const s0 = parseFloat(row ? getComputedStyle(el).width : getComputedStyle(el).height) || 0;
    const p0 = row ? e.clientX : e.clientY;
    let size = s0;
    grip.setPointerCapture(e.pointerId);
    grip.classList.add("on");
    const move = (ev: PointerEvent) => {
      size = Math.max(40, s0 + ((row ? ev.clientX : ev.clientY) - p0) / scale);
      el.style.flexGrow = "0";
      if (row) {
        el.style.flexBasis = "auto";
        el.style.width = `${size}px`;
      } else el.style.height = `${size}px`;
      this._placeFlex();
    };
    const up = () => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", up);
      grip.classList.remove("on");
      if (size !== s0) this._emitCardSize(el, Math.round(size));
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", up);
  }

  /** A card's new size to the editor: view_layout width (line) / height (column); undefined = automatic. */
  private _emitCardSize(card: Element | undefined, px: number | undefined) {
    if (!card) return;
    this.dispatchEvent(
      new CustomEvent("glass-card-resize", {
        detail: { card, key: this._config?.layout === "row" ? "width" : "height", value: px === undefined ? undefined : `${px}px`, mode: this._mode },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** In the large editor: lines between a grid's columns / rows to drag (writes column_widths / row_heights). */
  private _studio = false;
  private _tracks = { cols: 0, rows: 0 };
  private _gripsOn() {
    return this._studio && this._config?.layout === "grid" && !this._config.masonry;
  }

  private _inStudio(): boolean {
    for (let n: Node | null = this; n; n = n instanceof ShadowRoot ? n.host : n.parentNode) if ((n as Element).localName === "glass-studio") return true;
    return false;
  }

  private _grips() {
    if (!this._gripsOn()) return nothing;
    const { cols, rows } = this._tracks;
    const down = (axis: "columns" | "rows", k: number) => (e: PointerEvent) =>
      dragGridLine(e, axis, k, (px) =>
        this.dispatchEvent(
          new CustomEvent("glass-panel-resize", {
            detail: { panel: this, key: axis === "columns" ? "column_widths" : "row_heights", value: dragResult(px).join(" "), mode: this._mode },
            bubbles: true,
            composed: true,
          }),
        ),
      );
    return html`${Array.from({ length: Math.max(0, cols - 1) }, (_, k) => html`<div class="grid-grip col" style="grid-column-start:${k + 2}" @pointerdown=${down("columns", k)}></div>`)}${Array.from(
      { length: Math.max(0, rows - 1) },
      (_, k) => html`<div class="grid-grip row" style="grid-row-start:${k + 2}" @pointerdown=${down("rows", k)}></div>`,
    )}`;
  }

  protected override render() {
    if (!this._config) return nothing;
    const c = this._config;
    const layout = c.layout ?? "column";

    // no glass → nothing to pad: the cards line up with the other areas' edges
    const pad = this._bare ? "0" : typeof c.padding === "number" ? `${c.padding}px` : (c.padding ?? "20px");
    const er = c.equal_rows as boolean | string | undefined; // the editor's drop-down stores "true" / "false"
    const masonry = layout === "grid" && !!c.masonry;
    const equal = masonry ? false : er === undefined || er === "" ? this._mode !== "mobile" : er === true || er === "true";
    // a grid of same-height rows shares out the height it is given; rows by content, a line or a
    // column are as tall as their cards
    this.toggleAttribute("grid", layout === "grid" && equal && !trackList(c.row_heights).length);
    const body =
      layout === "grid"
        ? `display:grid;grid-template-columns:${tracks(c.column_widths) ?? (c.min_column_width ? `repeat(auto-fill,minmax(min(100%,${c.min_column_width}px),1fr))` : `repeat(${c.columns ?? 3},minmax(0,1fr))`)};${masonry ? `grid-auto-rows:1px;row-gap:0;--masonry-gap:${c.gap ?? 16}px;` : tracks(c.row_heights) ? `grid-template-rows:${tracks(c.row_heights)};` : c.rows ? `grid-template-rows:repeat(${c.rows},${equal ? "minmax(0,1fr)" : "auto"});${equal ? "" : "align-content:start;"}` : equal ? "grid-auto-rows:1fr;" : "grid-auto-rows:auto;"}--room-grow:${equal ? 0 : 1};${this._mode === "mobile" ? "" : "--room-min:0px;--room-max:100%;"}`
        : `display:flex;flex-direction:${layout};${c.wrap ? "flex-wrap:wrap;" : ""}`;
    // own `glass: none` or none inherited from the dashboard
    const bare = this._bare;
    // home tiles bring their own backing – no legibility shading behind them
    const tiles = resolveGlass(c.tile_glass ?? settings.tile_glass ?? c.glass) === "home";
    return html`<div class="panel surface ${bare ? "transparent" : ""} ${c.bar ? "barglass" : ""} ${bare && tiles ? "tiles" : ""}" style="padding:${pad};${c.height ? `height:${screenUnits(c.height)};` : ""}">
      ${c.title || c.icon
        ? html`<div class="title">
            ${c.icon ? html`<ha-icon .icon=${c.icon}></ha-icon>` : nothing}${c.title ? html`<span>${c.title}</span>` : nothing}<i></i>
          </div>`
        : nothing}
      <div
        class="body ${c.scroll && layout === "row" ? "scroll" : ""} ${layout !== "grid" && !c.scroll && c.height && this._children.length === 1 ? "lone" : ""}"
        style="${body}${masonry ? "column-gap" : "gap"}:${c.gap ?? 16}px;--grip-gap:${c.gap ?? 16}px;${this._gripsOn() || this._flexGripsOn() ? "position:relative;" : ""}align-items:${c.align ?? "stretch"};justify-content:${c.justify ?? "start"};${c.item_width !== undefined ? `--item-width:${typeof c.item_width === "number" ? `${c.item_width}px` : screenUnits(c.item_width)};` : ""}"
      >
        ${this._children.length || !this._inEditor()
          ? visibleChildren(this._children, this._hass)
          : html`<div class="empty">${tr("Empty panel – add a card")}</div>`}${this._grips()}${this._flexGrips()}
      </div>
    </div>`;
  }

  /** In an editor (HA's card dialog or the large editor) an empty panel stays visible, to drop or add cards into. */
  private _inEditor(): boolean {
    let n: Node | null = this;
    for (let i = 0; n && i < 60; i++) {
      const name = (n as Element).localName;
      if (name === "glass-studio" || name === "hui-card-preview" || name === "hui-dialog-edit-card") return true;
      n = (n as Element).parentNode ?? (n as unknown as ShadowRoot).host ?? null;
    }
    return false;
  }

  static override styles = [
    GlassElement.styles,
    selectable,
    surface,
    gridGrips,
    css`
      :host {
        display: block;
        height: 100%;
      }
      /* a row / column panel inside a panel or column: as tall as its cards (a grid cell or a
         row still stretches it; view_layout grow lets it take the rest of a column) */
      :host([nested]:not([grid])) {
        height: auto;
      }
      /* large editor: a card's end edge in a line / column, dragged to size it */
      .flex-grip {
        position: absolute;
        z-index: 4;
        touch-action: none;
      }
      .flex-grip.col {
        width: 12px;
        margin-left: -6px;
        cursor: col-resize;
      }
      .flex-grip.row {
        height: 12px;
        margin-top: -6px;
        cursor: row-resize;
      }
      .flex-grip::after {
        content: "";
        position: absolute;
        border-radius: 2px;
        background: var(--primary-color, #03a9f4);
        opacity: 0;
        transition: opacity 0.15s;
      }
      .flex-grip.col::after {
        top: 0;
        bottom: 0;
        left: 4px;
        width: 4px;
      }
      .flex-grip.row::after {
        left: 0;
        right: 0;
        top: 4px;
        height: 4px;
      }
      .flex-grip:hover::after,
      .flex-grip.on::after {
        opacity: 0.9;
      }
      .empty {
        flex: 1;
        min-height: 96px;
        display: grid;
        place-items: center;
        border: 2px dashed rgba(127, 127, 127, 0.45);
        border-radius: 14px;
        color: rgba(127, 127, 127, 0.9);
        font-size: 13px;
      }
      /* the heat pump's settings open inside its card and take the room of the panel's
         other cards (its graphs) until they close – the panel keeps its height */
      .body:has(> glass-heat-pump[glass-expanded]) > :not(glass-heat-pump) {
        display: none !important;
      }
      /* same as the dashboard's side column (.area.side) */
      :host([side]) {
        ${sideDayVars}
        ${sideMonoVars}
      }
      :host([side][glass="frosted"]:not([dark])),
      :host([side][glass="light"]:not([dark])) {
        ${sideFrostedVars}
      }
      :host([side][dark]) {
        ${sideVars}
        ${sideMonoVars}
      }
      .panel {
        height: 100%;
        border-radius: var(--g-radius-lg);
        display: flex;
        flex-direction: column;
        gap: 14px;
        contain: layout;
        /* other cards inside (charts, …) take the panel's text colours */
        --primary-text-color: var(--g-text);
        --secondary-text-color: var(--g-text-2);
      }
      /* bar material: as the liquid glass bars (core/styles.ts liquidBar), night via --glass-bar */
      :host([glass]) .panel.surface.barglass {
        border: 0 !important;
        background: var(--glass-panel-bar, var(--glass-bar, linear-gradient(180deg, rgba(255, 255, 255, 0.62), rgba(255, 255, 255, 0.22) 55%, rgba(255, 255, 255, 0.34)))) !important;
        box-shadow: var(
          --glass-bar-shadow,
          inset 0 1px 0 rgba(255, 255, 255, 0.95),
          inset 0 -1px 0 rgba(255, 255, 255, 0.45),
          inset 0 0 14px rgba(255, 255, 255, 0.35),
          0 1px 2px rgba(0, 0, 0, 0.06),
          0 6px 18px rgba(0, 0, 0, 0.08)
        ) !important;
        -webkit-backdrop-filter: blur(calc(10px * var(--glass-blur-scale, 1))) saturate(170%) brightness(1.04) !important;
        backdrop-filter: blur(calc(10px * var(--glass-blur-scale, 1))) saturate(170%) brightness(1.04) !important;
      }
      /* stronger than a glass tier's .surface (a nested panel on home tiles takes their glass) */
      .panel.transparent,
      :host([glass]) .panel.surface.transparent {
        background: none !important;
        border: none !important;
        box-shadow: none !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
      }
      .panel.transparent::before,
      .panel.transparent::after {
        display: none;
      }
      /* scroll: a sideways strip – swipe on a phone, the cards snap to the start */
      .body.scroll {
        overflow-x: auto;
        overscroll-behavior-x: contain;
        scroll-snap-type: x mandatory;
        scrollbar-width: none;
        -webkit-overflow-scrolling: touch;
        /* room for the cards' shadows inside the clipping box */
        padding: 4px 0 10px;
        margin: -4px 0 -10px;
      }
      .body.scroll::-webkit-scrollbar {
        display: none;
      }
      .body.scroll > * {
        flex: none !important;
        width: var(--item-width, 158px);
        scroll-snap-align: start;
      }
      .body {
        flex: 1;
        min-height: 0;
      }
      /* a line / column of one card given a height: the card takes all of it (its own
         view_layout grow / basis, set inline, still wins) */
      .body.lone > * {
        flex-grow: 1;
      }
      .title {
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 16px;
        font-weight: 600;
        text-shadow: var(--g-text-shadow);
      }
      .title ha-icon {
        --mdc-icon-size: 22px;
      }
      .title i {
        flex: 1;
        height: 6px;
        border-radius: 3px;
        background: rgba(255, 255, 255, 0.35);
      }
      /* a tile among tiles: the name top left as on the room cards, no rule */
      :host([nested]) .title {
        gap: 8px;
        padding: 0 4px;
        font-size: var(--glass-room-title-size, 15px);
        letter-spacing: -0.01em;
        color: var(--glass-room-title-color, var(--g-text));
        text-shadow: none;
      }
      :host([nested]) .title ha-icon {
        --mdc-icon-size: 18px;
      }
      :host([nested]) .title i {
        display: none;
      }
    `,
  ];
}

registerCard("glass-panel", GlassPanel, {
  name: "Glass – panel",
  description: "Glass container that arranges other cards in a row, column or grid.",
});

