import { tr } from "../i18n";
import { css, html, nothing, svg, type PropertyValues } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { GlassElement } from "../core/glass-element";
import type { ActionConfig, BaseCardConfig, HomeAssistant } from "../core/types";
import { registerCard } from "../core/registry";
import { makeEditor } from "../editor/editor";
import { statusBarSpec } from "../editor/specs";
import { applyRules, conditionEntities, evalCondition, ruleEntities, type Condition, type Rule } from "../core/conditions";
import { displayText, isUnavailable, type ValueOptions } from "../core/format";
import { cssColor, tint } from "../core/colors";
import { animations, animationOf, control, surface } from "../core/styles";
import { pressHandlers, runAction, withDefaults, type ActionKind } from "../core/actions";
import { LiquidController } from "../core/liquid";
import { hour12, language } from "../core/settings";
import { fetchHistory, resample, smoothPath, stateValue, type Point } from "../core/history";
import { SHEEN, materials, matTint, type Material } from "../core/materials";
import { STATUS_PARTS } from "../core/card-parts";

/** "just now", "5 min ago", "today 18:12", "yesterday 7:30", "3/10" – when something last happened. */
function whenText(iso: string | undefined, hass: HomeAssistant, lang: string): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return "";
  const now = new Date();
  const min = Math.round((now.getTime() - t) / 60000);
  if (min < 1) return tr("just now");
  if (min < 60) return tr("{n} min ago", { n: min });
  const d = new Date(t);
  const time = new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit", hour12: hour12(hass) }).format(d);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(now) - day(d)) / 86400000);
  if (days === 0) return tr("today {time}", { time });
  if (days === 1) return tr("yesterday {time}", { time });
  return new Intl.DateTimeFormat(lang, { day: "numeric", month: "numeric" }).format(d);
}

/**
 * Row of status chips.
 *
 *   type: custom:glass-status-bar
 *   items:
 *     - entity: sensor.dhw_temperature
 *       icon: dot                 # dot = coloured status dot
 *       text: "TUV {value} {unit}"
 *       precision: 1
 *       color: blue
 *       rules:
 *         - { above: 43, color: yellow }
 *         - { above: 45, color: red }
 *         - { entity: sensor.water_heating_on, state: "on", animation: glow }
 *     - entity: sensor.grid_power
 *       format: power
 *       abs: true
 *       icon: mdi:arrow-up-bold
 *       rules: [{ below: 0, icon: mdi:arrow-down-bold }]
 *     - entity: binary_sensor.compressor
 *       icon: mdi:heat-pump
 *       text: TČ
 *       visible: { state: "on" }
 *       animation: spin
 *
 *   layout: list      # plain rows (icon + text, no pills), e.g. in a side panel
 *   layout: pills     # equal pills in a grid: icon in a round button, `name` over the text
 *   columns: 2        # list / pills: side by side
 *   detail: last_triggered   # pills: an attribute on the right – a time shows as "před 5 min" / "dnes 18:12"
 *   pill_glass: dark         # pills: the pill's own material (core/materials), else the control glass
 *   icon_glass: liquid       # pills: the round icon's material; lit by the item's color when on
 *   icon_background: blue    # pills: the round icon's backing (none = the material only); the item's colour then lights the symbol
 *   icons: { icon: { color: grey }, icon_on: { color: white } }   # pills: the symbol off / on; fonts / icons for
 *                            #   every text and icon (core/card-parts)
 *   text: "{changed}"        # when the entity last changed, the same way
 *
 *   items:                   # pills: a select / input_select as a drop-down of its options
 *     - entity: select.camera_nightvision
 *       dropdown: true
 *       option_names: { "Off": Vypnuto, "Color Night Vision": Barevné }
 *
 *   layout: figures   # figures side by side: the name small over the value, `secondary` below
 *   items:
 *     - name: Měsíc
 *       entity: sensor.battery_month
 *       secondary: { entity: sensor.price_month }
 *   graph: { entity: sensor.battery_day, hours: 24, color: orange }   # a soft line under them
 */
export interface ChipConfig extends ValueOptions {
  icon?: string;
  color?: string;
  icon_color?: string;
  background?: string;
  animation?: string | Record<string, string>;
  visible?: Condition;
  hidden?: boolean;
  rules?: Rule[];
  hide_unavailable?: boolean;
  tap_action?: ActionConfig;
  hold_action?: ActionConfig;
  double_tap_action?: ActionConfig;
  /** Pills: tap opens the select's options (select / input_select). */
  dropdown?: boolean;
  /** Pills drop-down: display names of the options (also used as the pill's text). */
  option_names?: Record<string, string>;
  /** Figures: a second, smaller value under the main one. */
  secondary?: ValueOptions;
}

interface GraphConfig {
  entity: string;
  hours?: number;
  color?: string;
  smoothing?: number;
}

interface StatusBarConfig extends BaseCardConfig {
  items: ChipConfig[];
  wrap?: boolean;
  /** wrap: reorder the chips so each row is as full as it can be (order kept within a row) */
  pack?: boolean;
  /** pack: chips glide to their new place (default true) */
  pack_animation?: boolean;
  gap?: number;
  align?: "start" | "center" | "end";
  size?: number;
  layout?: "chips" | "list" | "pills" | "figures";
  /** Pills: an attribute of each item's entity on the right (times are shown relative). */
  detail?: string;
  columns?: number;
  pill_glass?: Material;
  icon_glass?: Material;
  icon_background?: string;
  /** pills: a tint over the pill (a colour alone gives it frosted glass), its height in px */
  pill_color?: string;
  pill_height?: number;
  /** pills: the icon's material while on (icon_glass is the one while off) */
  icon_on_glass?: Material;
  /** A soft history line under the items (figures). */
  graph?: GraphConfig;
}

class GlassStatusBar extends GlassElement<StatusBarConfig> {
  static override parts = STATUS_PARTS;
  static override properties = { ...GlassElement.properties, _menu: { state: true } };
  /** The pill whose drop-down is open. */
  declare _menu?: number;

  constructor() {
    super();
    new LiquidController(this, ".chip");
  }

  private _packRo?: ResizeObserver;
  private _packWatched = new WeakSet<Element>();

  protected override updated(changed: PropertyValues) {
    super.updated(changed);
    this._pack();
  }

  /**
   * pack: fills each row with the subset of the remaining chips that uses the most of
   * its width (all subsets for up to 14 chips, else first fit), row by row, and sets
   * CSS `order` accordingly – the chips keep their config order within a row.
   */
  private _pack() {
    const c = this._config;
    const bar = this.shadowRoot?.querySelector<HTMLElement>(".bar");
    if (!bar) return;
    const kids = [...bar.children] as HTMLElement[];
    if (!c?.pack || c.wrap === false || (c.layout ?? "chips") !== "chips") {
      kids.forEach((k) => k.style.removeProperty("order"));
      return;
    }
    // the bar and every chip: a chip grows when its value or icon arrives, without a render
    // (runs after layout, before paint – reordering changes no size, so no observer loop)
    this._packRo ??= new ResizeObserver(() => this._pack());
    for (const el of [bar, ...kids])
      if (!this._packWatched.has(el)) {
        this._packWatched.add(el);
        this._packRo.observe(el);
      }
    const W = bar.clientWidth;
    const gap = parseFloat(getComputedStyle(bar).columnGap) || 0;
    // layout widths – getBoundingClientRect would catch the chips mid entrance animation (scaled)
    const w = kids.map((k) => k.offsetWidth);
    if (!W || w.some((x) => !x)) return;
    let left = kids.map((_, i) => i);
    const rows: number[][] = [];
    while (left.length) {
      let best: number[] = [left[0]];
      let bestW = -1;
      if (left.length <= 14) {
        for (let m = 1; m < 1 << left.length; m++) {
          const pick = left.filter((_, j) => m & (1 << j));
          const used = pick.reduce((s, i) => s + w[i], 0) + gap * (pick.length - 1);
          if (used <= W + 0.5 && used > bestW + 0.5) {
            best = pick;
            bestW = used;
          }
        }
      } else {
        let used = 0;
        best = [];
        for (const i of left) {
          const add = w[i] + (best.length ? gap : 0);
          if (!best.length || used + add <= W + 0.5) {
            best.push(i);
            used += add;
          }
        }
      }
      rows.push(best);
      left = left.filter((i) => !best.includes(i));
    }
    rows.forEach((row, r) =>
      row.forEach((i, j) => {
        const o = String(r * 100 + j);
        if (kids[i].style.order !== o) kids[i].style.order = o;
      }),
    );
    this._glide(kids);
  }

  /** Where each chip was last painted (layout position in the bar, transforms aside). */
  private _packPos = new WeakMap<HTMLElement, { x: number; y: number }>();

  /**
   * FLIP: chips that moved (another one appeared, a row re-packed) glide from where
   * they were to their new place; a new chip has its own entrance animation.
   */
  private _glide(kids: HTMLElement[]) {
    const still = this._config?.pack_animation === false || matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const k of kids) {
      const now = { x: k.offsetLeft, y: k.offsetTop };
      const was = this._packPos.get(k);
      this._packPos.set(k, now);
      if (!was || still) continue;
      const dx = was.x - now.x;
      const dy = was.y - now.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      // `translate` (not transform) so it adds to the press / entrance transforms
      k.animate([{ translate: `${dx}px ${dy}px` }, { translate: "0 0" }], { duration: 460, easing: "cubic-bezier(0.34, 1.2, 0.64, 1)" });
    }
  }

  private _outside = (e: Event) => {
    if (!e.composedPath().includes(this)) this._openMenu(undefined);
  };

  private _openMenu(i: number | undefined) {
    this._menu = i;
    if (i === undefined) document.removeEventListener("pointerdown", this._outside, true);
    else document.addEventListener("pointerdown", this._outside, true);
  }

  private _pick(entity: string, option: string) {
    const domain = entity.split(".")[0];
    this._hass?.callService(domain, "select_option", { entity_id: entity, option });
    this._openMenu(undefined);
  }

  static getConfigElement() {
    return makeEditor(statusBarSpec);
  }

  static getStubConfig(hass: HomeAssistant) {
    const sensor = Object.keys(hass.states).find((e) => e.startsWith("sensor.")) ?? "sensor.example";
    return { items: [{ entity: sensor }] };
  }

  protected override validateConfig(c: StatusBarConfig) {
    if (!Array.isArray(c.items)) throw new Error("`items` must be a list");
    return c;
  }

  protected watchedEntities(c: StatusBarConfig) {
    const out = new Set<string>();
    for (const it of c.items) {
      if (it.entity) out.add(it.entity);
      it.entities?.forEach((e) => out.add(e));
      if (it.secondary?.entity) out.add(it.secondary.entity);
      conditionEntities(it.visible, it.entity, out);
      ruleEntities(it.rules, it.entity, out);
    }
    if (c.graph?.entity) out.add(c.graph.entity);
    return out;
  }

  /* ── graph: recorder history, refreshed every few minutes, live states added ── */
  private _points: Point[] = [];
  private _fetchedAt = 0;
  private _loading = false;

  private _ensureHistory() {
    const g = this._config?.graph;
    if (!g?.entity || !this._hass || this._loading || Date.now() - this._fetchedAt < 10 * 60 * 1000) return;
    this._loading = true;
    fetchHistory(this._hass, [g.entity], g.hours ?? 24)
      .then((res) => {
        this._points = res[g.entity] ?? [];
        this._fetchedAt = Date.now();
        this.requestUpdate();
      })
      .finally(() => (this._loading = false));
  }

  protected override hassChanged(hass: HomeAssistant) {
    const id = this._config.graph?.entity;
    const st = id ? hass.states[id] : undefined;
    if (st && this._fetchedAt) {
      const v = stateValue(st.state);
      const t = Date.parse(st.last_updated);
      const last = this._points[this._points.length - 1];
      if (!Number.isNaN(v) && (!last || last.t < t)) this._points.push({ t, v });
    }
    this._ensureHistory();
  }

  private _graph() {
    const g = this._config.graph;
    if (!g?.entity) return nothing;
    const end = Date.now();
    const start = end - (g.hours ?? 24) * 3600 * 1000;
    const values = resample(this._points, start, end, 72, Math.max(0, Math.min(12, Math.round(g.smoothing ?? 2))));
    const nums = values.filter((v): v is number => v !== undefined);
    const color = cssColor(g.color);
    if (!nums.length) return html`<div class="graph"></div>`;
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const span = max - min || 1;
    const d = smoothPath(values, min - span * 0.1, max + span * 0.15);
    return html`<div class="graph" style=${color ? `--glass-graph-color:${color}` : ""}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="currentColor" style="stop-opacity:0.4"></stop>
            <stop offset="0.7" stop-color="currentColor" style="stop-opacity:0.1"></stop>
            <stop offset="1" stop-color="currentColor" stop-opacity="0"></stop>
          </linearGradient>
        </defs>
        ${d ? svg`<path class="area" d=${`${d}L100,100L0,100Z`}></path>` : nothing}
      </svg>
      ${d ? html`<svg class="lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path class="line" d=${d}></path></svg>` : nothing}
    </div>`;
  }

  private _chip(item: ChipConfig, index: number) {
    const hass = this._hass!;
    if (!evalCondition(item.visible, hass, item.entity)) return nothing;
    const c = applyRules(item, item.rules, hass, item.entity);
    if (c.hidden) return nothing;
    const st = c.entity ? hass.states[c.entity] : undefined;
    if ((c.hide_unavailable ?? true) && c.entity && !c.entities && isUnavailable(st)) return nothing;

    // {changed}: when the entity last changed, as "před 5 min" / "dnes 12:41" (e.g. when a camera last saw a dog)
    const changed = c.text?.includes("{changed}") ? whenText(st?.last_changed, hass, language(hass)) || "–" : "";
    const t = displayText(hass, changed ? { ...c, text: c.text!.replace("{changed}", changed) } : c);
    const isDot = c.icon === "dot";
    const icon = isDot ? undefined : (c.icon ?? st?.attributes.icon);
    const anim = animationOf(c.animation);
    const accent = cssColor(c.icon_color ?? c.color);
    const target = withDefaults(c);
    const fire = (kind: ActionKind, el: HTMLElement) => runAction(this, hass, withDefaults(c), kind, el);
    const h = pressHandlers(() => target, fire);
    const iconOnly = !t.text;

    if (this._config.layout === "pills") {
      const fill = accent ? tint(c.icon_color ?? c.color) : undefined;
      const { icon_background: iconBg, pill_color: pillCol } = this._config;
      const onCol: string | undefined = this._config.icons?.icon_on?.color;
      const offCol: string | undefined = this._config.icons?.icon?.color;
      const pillMat = this._config.pill_glass ?? (pillCol && pillCol !== "none" ? "frosted" : undefined);
      // off and on each with its own material (icon_glass / icon_on_glass); unset → the control glass
      const iconMat = fill ? (this._config.icon_on_glass ?? this._config.icon_glass) : this._config.icon_glass;
      // icon_background: the icon's own backing in every state ("none" = the material only);
      // the item's colour then lights the symbol. Without it the colour fills the icon when on.
      const ownBg = !!iconBg;
      const bgNone = iconBg === "none";
      const lit = fill && !ownBg;
      // the symbol: icons.icon_on / icon, else the item's colour on an own backing
      const sym = fill ? (onCol && onCol !== "none" ? cssColor(onCol) : ownBg ? accent : undefined) : offCol && offCol !== "none" ? cssColor(offCol) : undefined;
      const icoStyle = iconMat
        ? `${ownBg ? (bgNone ? "" : `${matTint(iconBg)};`) : lit ? `${matTint(c.icon_color ?? c.color, 70)};` : ""}${sym ? `color:${sym};` : ""}`
        : `${ownBg ? (bgNone ? "--bg:transparent;" : `--bg:${tint(iconBg)};--sheen:${SHEEN};`) : lit ? `--bg:${fill};--accent:${accent};` : ""}${sym ? `--fg:${sym};` : ""}`;
      const options: string[] = c.dropdown ? (st?.attributes.options ?? []) : [];
      const name = (o: string) => c.option_names?.[o] ?? o;
      const drop = c.dropdown && options.length && c.entity;
      const open = drop && this._menu === index;
      return html`<div class="pill-wrap">
        <div
        class="pill ${pillMat ? `mat mat-${pillMat}` : "control"} ${drop ? "has-drop" : ""}"
        style=${pillMat && pillCol && pillCol !== "none" ? matTint(pillCol) : ""}
        role=${drop ? nothing : "button"}
        tabindex=${drop ? nothing : "0"}
        data-i=${index}
        @pointerdown=${drop ? nothing : h.down}
        @pointermove=${drop ? nothing : h.move}
        @pointerup=${drop ? nothing : h.up}
        @pointercancel=${drop ? nothing : h.cancel}
        @keydown=${drop ? nothing : h.key}
        @click=${nothing}
        @contextmenu=${h.context}
      >
        <span
          class="ico ${iconMat ? `mat mat-${iconMat} ${lit ? "on" : ""}` : `control ${lit ? "active" : ""} ${ownBg ? "own-bg" : ""} ${sym ? "own-fg" : ""}`} ${anim.cls}"
          style="${icoStyle}--glow:${anim.glow ? cssColor(anim.glow) : (accent ?? "#fff")}"
          >${icon && !isDot ? html`<ha-icon .icon=${icon}></ha-icon>` : nothing}</span
        >
        <span class="words">
          ${c.name ? html`<span class="primary">${c.name}</span>` : nothing}
          ${drop && st ? html`<span class="secondary">${name(st.state)}</span>` : t.text ? html`<span class="secondary">${t.text}</span>` : nothing}
        </span>
        ${drop
          ? html`<button
              class="chev ${open ? "open" : ""}"
              aria-haspopup="listbox"
              aria-expanded=${open ? "true" : "false"}
              aria-label=${c.name ?? ""}
              @click=${(e: Event) => (e.stopPropagation(), this._openMenu(open ? undefined : index))}
            >
              <ha-icon icon="mdi:chevron-down"></ha-icon>
            </button>`
          : this._detail(st)}
        </div>
        ${open
          ? html`<div class="menu" role="listbox">
              ${options.map(
                (o) => html`<button role="option" aria-selected=${o === st?.state ? "true" : "false"} class=${o === st?.state ? "cur" : ""} @click=${() => this._pick(c.entity!, o)}>
                  <span>${name(o)}</span>${o === st?.state ? html`<ha-icon icon="mdi:check"></ha-icon>` : nothing}
                </button>`,
              )}
            </div>`
          : nothing}
      </div>`;
    }

    if (this._config.layout === "figures") {
      const sub = c.secondary ? displayText(hass, c.secondary) : undefined;
      return html`<div
        class="fig"
        role="button"
        tabindex="0"
        data-i=${index}
        @pointerdown=${h.down}
        @pointermove=${h.move}
        @pointerup=${h.up}
        @pointercancel=${h.cancel}
        @keydown=${h.key}
        @contextmenu=${h.context}
      >
        ${c.name ? html`<span class="fname">${c.name}</span>` : nothing}
        <span class="fval">${t.text || "–"}</span>
        ${sub?.text ? html`<span class="fsub">${sub.text}</span>` : nothing}
      </div>`;
    }

    if (this._config.layout === "list")
      return html`<div
        class="row ${anim.cls} ${accent ? "lit" : ""}"
        role="button"
        tabindex="0"
        data-i=${index}
        @pointerdown=${h.down}
        @pointermove=${h.move}
        @pointerup=${h.up}
        @pointercancel=${h.cancel}
        @keydown=${h.key}
        @contextmenu=${h.context}
      >
        ${isDot
          ? html`<span class="dot" style="--dot:${accent ?? "var(--g-text-2)"}"></span>`
          : icon
            ? html`<ha-icon .icon=${icon} style=${accent ? `color:${accent}` : ""}></ha-icon>`
            : nothing}
        ${t.text ? html`<span class="text">${t.text}</span>` : nothing}
      </div>`;

    // a background colour means "on" (the selected period, a running mode): the look's lit control
    const on = cssColor(c.background);
    return html`<div
      class="chip control glass appear ${anim.cls} ${iconOnly ? "icon-only" : ""} ${on ? "active" : ""}"
      role="button"
      tabindex="0"
      data-i=${index}
      style="${on ? `--bg:${tint(c.background, 80)};--accent:${on};--fg:#fff;` : ""}${anim.glow ? `--glow:${cssColor(anim.glow)};` : ""}"
      @pointerdown=${h.down}
      @pointermove=${h.move}
      @pointerup=${h.up}
      @pointercancel=${h.cancel}
      @keydown=${h.key}
      @contextmenu=${h.context}
    >
      ${isDot
        ? html`<span class="dot" style="--dot:${accent ?? "var(--g-text)"}"></span>`
        : icon
          ? html`<ha-icon .icon=${icon} style=${accent ? `color:${accent}` : ""}></ha-icon>`
          : nothing}
      ${t.text ? html`<span class="text">${t.text}</span>` : nothing}
    </div>`;
  }

  /** The pill's detail on the right (`detail:` attribute), a timestamp as relative time. */
  private _detail(st: { attributes: Record<string, any> } | undefined) {
    const key = this._config.detail;
    if (!key || !st) return nothing;
    const v = st.attributes[key];
    if (v === undefined || v === null || v === "") return nothing;
    const lang = language(this._hass);
    const text = typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v) ? whenText(v, this._hass!, lang) : String(v);
    return text ? html`<span class="detail">${text}</span>` : nothing;
  }

  /** Relative times age: re-render once a minute while there are any. */
  private _tick?: number;
  override connectedCallback() {
    super.connectedCallback();
    this._tick = window.setInterval(() => (this._config?.detail || this._config?.items.some((i) => i.text?.includes("{changed}") || i.rules?.some((r) => String(r.text ?? "").includes("{changed}")))) && this.requestUpdate(), 60000);
    this._ensureHistory();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this._tick);
    this._openMenu(undefined);
    this._packRo?.disconnect();
    this._packRo = undefined;
    this._packWatched = new WeakSet();
  }

  protected override render() {
    if (!this._config || !this._hass) return nothing;
    const c = this._config;
    const size = c.size ?? 36;
    // pills: their height, for the pills inside
    const look = c.pill_height ? `;--glass-pill-height:${c.pill_height}px` : "";
    // its own glass: the items on a tile (GlassElement.tile)
    const tiled = (body: unknown) => (this.tile ? html`<div class=${this.tile}>${body}</div>` : body);
    if (c.layout === "list" || c.layout === "pills" || c.layout === "figures")
      return tiled(html`<div class="${c.layout}" style="--cols:${c.columns ?? (c.layout === "list" ? 1 : c.layout === "pills" ? 2 : c.items.length)}${c.gap !== undefined ? `;gap:${c.gap}px` : ""}${look}">
          ${repeat(
            c.items,
            (_it, i) => i,
            (it, i) => this._chip(it, i),
          )}
        </div>
        ${this._graph()}`);
    return tiled(html`<div
      class="bar ${c.wrap === false ? "scroll" : ""}"
      style="--chip:${size}px;gap:${c.gap ?? 8}px;flex-wrap:${c.wrap === false ? "nowrap" : "wrap"};justify-content:${c.align ?? "start"}"
    >
      ${repeat(
        c.items,
        (_it, i) => i,
        (it, i) => this._chip(it, i),
      )}
    </div>`);
  }

  static override styles = [
    GlassElement.styles,
    surface,
    control,
    materials,
    animations,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      .bar {
        display: flex;
        align-items: center;
        padding: 2px 0;
      }
      .bar.scroll {
        overflow-x: auto;
        scrollbar-width: none;
        /* room for the chip shadow inside the clipping box */
        padding: 6px 4px 12px;
        margin: -6px -4px -12px;
      }
      .chip {
        height: var(--chip);
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: var(--glass-chip-padding, 0 14px 0 10px);
        flex: none;
        font-size: 12.5px;
        font-weight: 600;
        letter-spacing: 0.01em;
        text-shadow: var(--g-text-shadow);
        box-shadow:
          0 4px 12px rgba(0, 0, 0, 0.07),
          inset 0 1px 1px rgba(255, 255, 255, 0.12);
      }
      /* macOS-style pill: a hairline highlight on the top edge, a fainter one at
         the bottom, a soft fill brighter at the top and a quiet two-layer shadow */
      :host([control-glass="liquid"]) .chip:not(.active) {
        background: var(--glass-liquid-pill, linear-gradient(180deg, rgba(255, 255, 255, 0.26), rgba(255, 255, 255, 0.1)));
        --g-base-shadow: inset 0 0.5px 0 rgba(255, 255, 255, calc(0.55 * var(--glass-edge-k, 1))), inset 0 -0.5px 0 rgba(255, 255, 255, calc(0.15 * var(--glass-edge-k, 1))), 0 1px 2px rgba(0, 0, 0, 0.08),
          0 4px 12px rgba(0, 0, 0, 0.06);
        box-shadow: var(--g-base-shadow);
      }
      @media (hover: hover) {
        :host([control-glass="liquid"]) .chip:not(.active):hover {
          background: var(--glass-liquid-pill-hover, linear-gradient(180deg, rgba(255, 255, 255, 0.34), rgba(255, 255, 255, 0.14)));
        }
      }
      .chip.icon-only {
        width: var(--chip);
        padding: 0;
        justify-content: center;
      }
      ha-icon {
        --mdc-icon-size: 17px;
        display: flex;
      }
      .dot {
        width: 13px;
        height: 13px;
        border-radius: 50%;
        background: var(--dot);
        box-shadow:
          0 0 8px color-mix(in srgb, var(--dot) 70%, transparent),
          inset 0 1px 1px rgba(255, 255, 255, 0.5);
        flex: none;
      }
      .text {
        white-space: nowrap;
      }
      /* list: quiet rows like the weather details; an icon takes its colour only when a rule gives it one */
      .list {
        display: grid;
        grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
        gap: 12px 16px;
      }
      .row {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        font-size: 14px;
        font-weight: 500;
        color: var(--g-text-2);
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }
      .row.lit {
        color: var(--g-text);
      }
      .row ha-icon {
        --mdc-icon-size: 20px;
        color: var(--g-text-2);
      }
      .row .text {
        overflow: hidden;
        text-overflow: ellipsis;
      }
      /* pills: equal tiles of the control glass – a room card button with the icon,
         the name over the state; coloured (and animated) by the rules */
      .pills {
        display: grid;
        grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
        gap: 10px;
      }
      .pill {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
        height: var(--glass-pill-height, 52px);
        padding: 0 14px 0 6px;
      }
      .pill:active {
        transform: translateZ(0) scale(0.97);
      }
      .ico {
        flex: none;
        width: calc(var(--glass-pill-height, 52px) - 12px);
        height: calc(var(--glass-pill-height, 52px) - 12px);
        display: grid;
        place-items: center;
        cursor: inherit;
      }
      /* own materials (pill_glass / icon_glass) instead of the control glass: the same shape */
      .pill.mat,
      .ico.mat {
        position: relative;
        box-sizing: border-box;
        border-radius: 999px;
        overflow: hidden;
        cursor: pointer;
        user-select: none;
        -webkit-user-select: none;
        touch-action: manipulation;
        transition:
          background 0.3s ease,
          transform 0.18s ease;
      }
      .pill.mat .secondary,
      .pill.mat .detail {
        color: color-mix(in srgb, currentColor 65%, transparent);
      }
      .pills .secondary,
      .pills .detail {
        color: var(--g-text-2);
      }
      .pills .pill.mat .secondary,
      .pills .pill.mat .detail {
        color: color-mix(in srgb, currentColor 65%, transparent);
      }
      .ico.mat.on {
        color: #fff;
      }
      /* icon_background on the control glass: its own backing beats every look's (Apple Home's grey too) */
      :host([control-glass]) .ico.control.own-bg {
        background: var(--sheen, linear-gradient(transparent, transparent)), linear-gradient(var(--bg), var(--bg)) !important;
        color: var(--fg) !important;
      }
      :host([control-glass]) .ico.control.own-fg {
        color: var(--fg) !important;
      }
      :host([control-glass]) .ico.control.own-bg::before {
        display: none;
      }
      .ico:not(.active) {
        --fg: var(--glass-icon-inactive, var(--g-text-2));
      }
      .ico ha-icon {
        --mdc-icon-size: 20px;
      }
      .words {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
        line-height: 1.2;
      }
      /* a pill with a drop-down: the options open under it, over what follows */
      .pill-wrap {
        position: relative;
        min-width: 0;
      }
      .pill-wrap:has(.menu) {
        z-index: 5;
      }
      /* the drop-down's chevron: a plain arrow; its tap area as large as the icon on the left */
      /* only the chevron opens the list: the pill itself does nothing */
      .pill.has-drop {
        padding-right: 6px;
        cursor: default;
      }
      .pill.has-drop:active {
        transform: none;
      }
      .chev {
        flex: none;
        width: calc(var(--glass-pill-height, 52px) - 12px);
        height: calc(var(--glass-pill-height, 52px) - 12px);
        border-radius: 50%;
        display: grid;
        place-items: center;
        --mdc-icon-size: 20px;
        padding: 0;
        border: 0;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        color: var(--glass-home-text-2, rgba(60, 60, 67, 0.68));
        background: none;
      }
      .chev ha-icon {
        display: flex;
      }
      /* only the arrow turns, not the button (its glass is lit from the top) */
      .chev ha-icon {
        transition: transform 0.25s ease;
      }
      .chev.open ha-icon {
        transform: rotate(180deg);
      }
      .menu {
        position: absolute;
        bottom: calc(100% + 8px);
        right: 0;
        min-width: 180px;
        padding: 6px;
        border-radius: 22px;
        display: flex;
        flex-direction: column;
        gap: 2px;
        color: var(--glass-home-text, #1c1c1e);
        background: var(--glass-home-fill, linear-gradient(var(--glass-home-surface, rgba(246, 246, 248, 0.86)), var(--glass-home-surface, rgba(246, 246, 248, 0.86))));
        border: 0.5px solid var(--glass-home-border, rgba(255, 255, 255, 0.35));
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
        -webkit-backdrop-filter: blur(calc(24px * var(--glass-blur-scale, 1))) saturate(160%);
        backdrop-filter: blur(calc(24px * var(--glass-blur-scale, 1))) saturate(160%);
      }
      .menu button {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        height: 40px;
        padding: 0 14px;
        border: 0;
        border-radius: 16px;
        background: none;
        color: inherit;
        font: inherit;
        font-size: 14px;
        font-weight: 500;
        text-align: left;
        cursor: pointer;
      }
      .menu button:hover {
        background: var(--glass-home-control, rgba(118, 118, 128, 0.12));
      }
      .menu button.cur {
        font-weight: 600;
        color: var(--glass-color-blue, #0a84ff);
      }
      .menu ha-icon {
        --mdc-icon-size: 18px;
      }
      .detail {
        flex: none;
        font-size: 11px;
        font-weight: 500;
        color: var(--g-text-2);
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      .primary {
        font-size: 13px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .secondary {
        font-size: 12px;
        font-weight: 500;
        color: var(--g-text-2);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      /* figures: quiet name over the value, a second value below – like the weather details */
      .figures {
        display: grid;
        grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
        gap: 12px;
      }
      .fig {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
        line-height: 1.2;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }
      .fname {
        font-size: 12px;
        font-weight: 500;
        color: var(--g-text-2);
      }
      .fval {
        font-size: 17px;
        font-weight: 600;
        color: var(--glass-figure-color, inherit);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .fsub {
        font-size: 12px;
        font-weight: 500;
        color: var(--g-text-2);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      /* the graph under them: edge to edge, fading out at the sides (as on the thermostat) */
      .graph {
        position: relative;
        height: var(--glass-graph-height, 56px);
        margin-top: 8px;
        color: var(--glass-graph-color, var(--glass-accent-icon, #ff9f0a));
        -webkit-mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
        mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
      }
      .graph svg {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        overflow: visible;
      }
      .graph svg.lines {
        filter: drop-shadow(0 0 3px color-mix(in srgb, currentColor 55%, transparent));
      }
      .line {
        fill: none;
        stroke: currentColor;
        stroke-width: 2.5px;
        stroke-linecap: round;
        stroke-linejoin: round;
        vector-effect: non-scaling-stroke;
      }
      .area {
        fill: url(#fill);
      }
      /* Apple Home pills: the tile's text colours (dark on a light tile, light in the side panel) */
      :host([control-glass="home"]) .pill:not(.mat) .primary {
        color: var(--glass-home-text, #1c1c1e);
      }
      :host([control-glass="home"]) .pill:not(.mat) .secondary {
        color: var(--glass-home-text-2, rgba(60, 60, 67, 0.68));
      }
      /* by day the appliance bars' pill in white glass */
      :host(:not([dark])[control-glass]) .pill.control:not(.mat) {
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.34), rgba(255, 255, 255, 0.12) 55%, rgba(255, 255, 255, 0.2)) !important;
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.55),
          0 1px 2px rgba(0, 0, 0, 0.04),
          0 4px 12px rgba(0, 0, 0, 0.06) !important;
        border: 0 !important;
      }
      /* by night the pills are the appliance bars' pill: a faint top-down sheen, a fine top edge */
      :host([dark][control-glass]) .pill.control:not(.mat) {
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.13), rgba(255, 255, 255, 0.04) 55%, rgba(255, 255, 255, 0.07)) !important;
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.16),
          0 1px 2px rgba(0, 0, 0, 0.1),
          0 4px 12px rgba(0, 0, 0, 0.12) !important;
        border: 0 !important;
      }
      /* Apple Home: same chip, only the colours change (see core/styles.ts) */
      :host([control-glass="home"]) .chip {
        text-shadow: none;
      }
    `,
  ];
}

registerCard("glass-status-bar", GlassStatusBar, {
  name: "Glass – status bar",
  description: "Chips with entity values, conditional icons, colors and animations.",
});
