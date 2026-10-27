import { css, html, nothing, svg, type PropertyValues } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { GlassElement } from "../core/glass-element";
import type { ActionConfig, BaseCardConfig, HomeAssistant } from "../core/types";
import { registerCard } from "../core/registry";
import { makeEditor } from "../editor/editor";
import { thermostatSpec } from "../editor/specs";
import { conditionEntities, evalCondition, type Condition } from "../core/conditions";
import { cssColor, tint } from "../core/colors";
import { control, liquidBar, surface } from "../core/styles";
import { pressHandlers, runAction, withDefaults, type ActionKind } from "../core/actions";
import { language } from "../core/settings";
import { LiquidController } from "../core/liquid";
import { SHEEN, materials, matTint, type Material } from "../core/materials";
import { curveAt, fetchHistory, onSpans, resample, smoothPath, stateValue, type Point } from "../core/history";
import { THERMOSTAT_PARTS } from "../core/card-parts";

/**
 * Room temperature tile: the last hours as a soft graph, fading out at the
 * sides, over a liquid glass bar with the room's icon (the thermostat's
 * switch), the temperature and the set point with − / + (or the bar on top). In a panel (no
 * tile) there is no bar: name, icon and value, the graph below.
 *
 *   type: custom:glass-thermostat
 *   entity: climate.living_room             # or a sensor: then no set point, only value + graph
 *   temperature_entity: sensor.living_temp  # optional: the value shown and drawn (default: the
 *                                           #   climate's current_temperature / the sensor)
 *   name: Obývák
 *   icon: mdi:sofa
 *   hours: 24
 *   graph_entities:                         # optional extras in the graph
 *     - sensor.water_target                 #   a number: a thin line on the same scale
 *     - binary_sensor.heating               #   on/off: shaded where it was on
 *   active: { entity: binary_sensor.heating, state: "on" }   # icon lit (default: climate heating)
 *   active_color: orange
 *   tap_action: { action: more-info }       # the tile does nothing by default; the icon
 *                                           #   switches the thermostat, − / + set it
 *   graph_color: orange                     # line and gradient (default: the look's accent)
 *   controls: bottom                        # the bar under the graph (default) or top
 *   show_name: true                         # the name above (default: on)
 *   min_max: 24                             # ↑ highest ↓ lowest in the bar: over 24 h (true = the graph's hours)
 *   smoothing: 1                            # 0 = every bump … 6 = a calm curve
 *
 *   pill_glass: frosted      # the bar with the icon and set point (core/materials), pill_color tints it
 *   icon_glass: liquid       # the icon's button while off; icon_on_glass while on (heating keeps its halo)
 *   icon_background: blue   # its backing in every state (none = material only)
 *   icons: { icon: { color: grey }, icon_on: { color: white } }   # the symbol off / on (core/card-parts)
 *   buttons_glass: dark      # the − value + field (default dark glass), buttons_color tints it
 */
interface ThermostatConfig extends BaseCardConfig {
  entity: string;
  temperature_entity?: string;
  name?: string;
  icon?: string;
  hours?: number;
  graph?: boolean;
  graph_entities?: (string | { entity: string })[];
  active?: Condition;
  active_color?: string;
  precision?: number;
  /** Smallest temperature span the graph shows, so a steady room isn't drawn as a mountain range. */
  min_range?: number;
  graph_color?: string;
  smoothing?: number;
  /** Where the bar with the icon and set point sits on a tile: bottom (default, like a room card with a photo) or top. */
  controls?: "bottom" | "top";
  /** A low tile for long lists (phones): the graph behind the name instead of above the bar. */
  compact?: boolean;
  /** A sensor (no set point): the value on the name's line, no icon – the graph right under them. */
  inline_value?: boolean;
  show_name?: boolean;
  /** Highest and lowest value in the bar (↑ 12,4° ↓ 3,1°): true = over the graph's hours, a number = over that many hours. */
  min_max?: boolean | number;
  tap_action?: ActionConfig;
  hold_action?: ActionConfig;
  double_tap_action?: ActionConfig;
  pill_glass?: Material;
  pill_color?: string;
  icon_glass?: Material;
  icon_on_glass?: Material;
  icon_background?: string;
  buttons_glass?: Material;
  buttons_color?: string;
}

/** Steps across the graph; plenty for a smooth line on a tile. */
const STEPS = 72;

class GlassThermostat extends GlassElement<ThermostatConfig> {
  static override parts = THERMOSTAT_PARTS;
  static getConfigElement() {
    return makeEditor(thermostatSpec);
  }

  static getStubConfig(hass: HomeAssistant) {
    const climate = Object.keys(hass.states).find((e) => e.startsWith("climate."));
    return { entity: climate ?? "" };
  }

  constructor() {
    super();
    new LiquidController(this, ".frame");
  }

  private _series: Record<string, Point[]> = {};
  private _fetchedAt = 0;
  private _loading = false;
  /** Set point being dialled in; sent once the − / + presses stop. */
  private _pending?: number;
  private _sendTimer?: number;
  private _pendingTimer?: number;
  /** Pointer over the graph: 0–1 along it; the marker and the header follow it. */
  private _hover?: number;
  private _hoverInfo?: { v: number; t: number };

  /** The marker stays until a press anywhere outside this card. */
  private _outside = (e: Event) => {
    if (!e.composedPath().includes(this)) this._untrack();
  };

  private _track(e: PointerEvent) {
    document.addEventListener("pointerdown", this._outside, true);
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (!r.width) return;
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    if (f === this._hover) return;
    this._hover = f;
    this.requestUpdate();
  }

  private _untrack() {
    document.removeEventListener("pointerdown", this._outside, true);
    if (this._hover === undefined) return;
    this._hover = undefined;
    this.requestUpdate();
  }

  protected override validateConfig(c: ThermostatConfig) {
    if (!c.entity) throw new Error("`entity` (a climate or temperature sensor) is required");
    const extras = (c.graph_entities ?? []).map((e) => (typeof e === "string" ? e : e?.entity)).filter(Boolean);
    this._series = {};
    this._fetchedAt = 0;
    return { ...c, graph_entities: extras };
  }

  protected watchedEntities(c: ThermostatConfig) {
    const out = new Set<string>([c.entity]);
    if (c.temperature_entity) out.add(c.temperature_entity);
    for (const e of c.graph_entities as string[]) out.add(e);
    conditionEntities(c.active, c.entity, out);
    return out;
  }

  private get _isClimate() {
    return this._config.entity.startsWith("climate.");
  }

  /** The entity whose history is the main line: the room sensor, else the entity itself (sensor). */
  private get _lineEntity(): string | undefined {
    const c = this._config;
    if (c.temperature_entity) return c.temperature_entity;
    return this._isClimate ? undefined : c.entity;
  }

  private _ids(): string[] {
    const c = this._config;
    const line = this._lineEntity;
    return [...(line ? [line] : []), ...(c.graph_entities as string[])];
  }

  /** History once, then again every few minutes; live states are added in between. */
  private _ensureHistory() {
    const hass = this._hass;
    if (!hass || !this._config || this._config.graph === false || this._loading) return;
    if (Date.now() - this._fetchedAt < 10 * 60 * 1000) return;
    const ids = this._ids();
    if (!ids.length) return;
    this._loading = true;
    fetchHistory(hass, ids, this._config.hours ?? 24)
      .then((res) => {
        this._series = res;
        this._fetchedAt = Date.now();
        this.requestUpdate();
      })
      .finally(() => (this._loading = false));
  }

  protected override hassChanged(hass: HomeAssistant) {
    // live: the newest state of each drawn entity joins its series
    for (const id of this._ids()) {
      const st = hass.states[id];
      const s = this._series[id];
      if (!st || !s) continue;
      const v = stateValue(st.state);
      const t = Date.parse(st.last_updated);
      if (!Number.isNaN(v) && (!s.length || s[s.length - 1].t < t)) s.push({ t, v });
    }
    // the set point arrived: stop showing the dialled value
    if (this._pending !== undefined && this._sendTimer === undefined) {
      const target = hass.states[this._config.entity]?.attributes.temperature;
      if (target === this._pending) this._pending = undefined;
    }
    this._ensureHistory();
  }

  override connectedCallback() {
    super.connectedCallback();
    this._ensureHistory();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    clearTimeout(this._sendTimer);
    clearTimeout(this._pendingTimer);
    clearTimeout(this._hitTimer);
    this._untrack();
  }

  /** The room icon switches the thermostat: off ↔ heat (or its first mode that isn't off). */
  private _toggle() {
    const hass = this._hass!;
    const st = hass.states[this._config.entity];
    if (!st) return;
    const modes: string[] = st.attributes.hvac_modes ?? [];
    const on = modes.includes("heat") ? "heat" : (modes.find((m) => m !== "off") ?? "heat");
    hass.callService("climate", "set_hvac_mode", { entity_id: this._config.entity, hvac_mode: st.state === "off" ? on : "off" });
  }

  /** The − / + just pressed, lit for a moment (touch screens show no :active). */
  private _hit?: 1 | -1;
  private _hitTimer?: number;

  private _step(dir: 1 | -1) {
    this._hit = dir;
    clearTimeout(this._hitTimer);
    this._hitTimer = window.setTimeout(() => ((this._hit = undefined), this.requestUpdate()), 220);
    const hass = this._hass!;
    const st = hass.states[this._config.entity];
    if (!st) return;
    const a = st.attributes;
    const step = a.target_temp_step ?? (hass.config?.unit_system?.temperature === "°F" ? 1 : 0.5);
    const cur = this._pending ?? a.temperature ?? a.current_temperature ?? 20;
    const next = Math.min(a.max_temp ?? 35, Math.max(a.min_temp ?? 5, Math.round((cur + dir * step) / step) * step));
    this._pending = next;
    this.requestUpdate();
    clearTimeout(this._sendTimer);
    clearTimeout(this._pendingTimer);
    this._sendTimer = window.setTimeout(() => {
      this._sendTimer = undefined;
      hass.callService("climate", "set_temperature", { entity_id: this._config.entity, temperature: next });
      // give up on showing the dialled value if the thermostat never confirms it
      this._pendingTimer = window.setTimeout(() => ((this._pending = undefined), this.requestUpdate()), 8000);
    }, 900);
  }

  protected override updated(changed: PropertyValues) {
    super.updated(changed);
    this._ensureHistory();
  }

  private _graph() {
    const c = this._config;
    if (c.graph === false) return nothing;
    const end = Date.now();
    const start = end - (c.hours ?? 24) * 3600 * 1000;
    const line = this._lineEntity;
    const sm = Math.max(0, Math.min(12, Math.round(c.smoothing ?? 1)));
    const main = line ? resample(this._series[line] ?? [], start, end, STEPS, sm) : [];
    const extras = (c.graph_entities as string[]).map((id) => {
      const pts = this._series[id] ?? [];
      const st = this._hass!.states[id];
      // on/off entities (binary sensors, on/off sensors) are shaded spans, numbers are lines
      const binary = id.startsWith("binary_sensor.") || (st ? Number.isNaN(parseFloat(st.state)) && !Number.isNaN(stateValue(st.state)) : false);
      return binary ? { spans: onSpans(pts, start, end) } : { values: resample(pts, start, end, STEPS, sm) };
    });
    const nums = [...main, ...extras.flatMap((e) => e.values ?? [])].filter((v): v is number => v !== undefined);
    if (!nums.length) return html`<div class="graph"></div>`;
    let min = Math.min(...nums);
    let max = Math.max(...nums);
    const span = Math.max(c.min_range ?? 2, max - min);
    const mid = (min + max) / 2;
    min = mid - span / 2;
    max = mid + span / 2;
    // headroom: the line never touches the tile's top content or its bottom edge
    const lo = min - span * 0.18;
    const hi = max + span * 0.12;
    const d = smoothPath(main, lo, hi);
    const color = cssColor(c.graph_color);
    // the marker steps from hour to hour
    const HOUR = 3600 * 1000;
    const at = this._hover !== undefined ? Math.min(Math.floor(end / HOUR) * HOUR, Math.max(Math.ceil(start / HOUR) * HOUR, Math.round((start + this._hover * (end - start)) / HOUR) * HOUR)) : undefined;
    const f = at !== undefined ? (at - start) / (end - start) : undefined;
    const hv = f !== undefined && d ? curveAt(main, f) : undefined;
    this._hoverInfo = hv !== undefined ? { v: hv, t: at! } : undefined;
    return html`<div
      class="graph ${color ? "colored" : ""}"
      style=${color ? `--glass-graph-color:${color}` : ""}
      @pointermove=${(e: PointerEvent) => this._track(e)}
      @pointerdown=${(e: PointerEvent) => this._track(e)}
    >
      <div class="plot">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="currentColor" style="stop-opacity:var(--glass-graph-fill, 0.3)"></stop>
            <stop offset="0.7" stop-color="currentColor" style="stop-opacity:calc(var(--glass-graph-fill, 0.3) * 0.25)"></stop>
            <stop offset="1" stop-color="currentColor" stop-opacity="0"></stop>
          </linearGradient>
        </defs>
        ${extras.map((e) =>
          e.spans
            ? e.spans.map(([a, b]) => svg`<rect class="span" x=${a} y="0" width=${b - a} height="100"></rect>`)
            : svg`<path class="extra" d=${smoothPath(e.values!, lo, hi)}></path>`,
        )}
        ${d ? svg`<path class="area" d=${`${d}L100,100L0,100Z`}></path>` : nothing}
      </svg>
      ${d ? html`<svg class="lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path class="line" d=${d}></path></svg>` : nothing}
      </div>
      ${hv !== undefined ? html`<i class="marker" style="left:${f! * 100}%;top:${100 - ((hv - lo) / (hi - lo)) * 100}%"></i>` : nothing}
    </div>`;
  }

  protected override render() {
    const c = this._config;
    const hass = this._hass;
    if (!c || !hass) return nothing;
    const st = hass.states[c.entity];
    const lang = language(hass);
    const fmt = new Intl.NumberFormat(lang, { minimumFractionDigits: c.precision ?? 1, maximumFractionDigits: c.precision ?? 1 });
    const climate = this._isClimate;
    const tempSt = c.temperature_entity ? hass.states[c.temperature_entity] : undefined;
    // a configured room sensor is the only source: missing / unavailable → no value at all
    const value = c.temperature_entity ? parseFloat(tempSt?.state ?? "") : climate ? Number(st?.attributes.current_temperature) : parseFloat(st?.state ?? "");
    const unit = (tempSt ?? (!climate ? st : undefined))?.attributes.unit_of_measurement ?? hass.config?.unit_system?.temperature ?? "°C";
    // climate: lit while on, glowing while it heats; others: lit and glowing by `active`
    const heating = c.active !== undefined ? evalCondition(c.active, hass, c.entity) : climate && st?.attributes.hvac_action === "heating";
    const active = climate && c.active === undefined ? !!st && !["off", "unavailable", "unknown"].includes(st.state) : heating;
    const color = c.active_color ?? "orange";
    const fill = active ? tint(color) : undefined;
    const accent = active ? cssColor(color) : undefined;
    // the tile itself does nothing unless actions are configured; the icon and − / + are the controls
    const target = withDefaults(
      { entity: c.entity, tap_action: c.tap_action, hold_action: c.hold_action, double_tap_action: c.double_tap_action },
      { tap_action: { action: "none" }, hold_action: { action: "none" } },
    );
    const clickable = [target.tap_action, target.hold_action, target.double_tap_action].some((a) => a && a.action !== "none");
    const h = pressHandlers(
      () => target,
      (kind: ActionKind) => runAction(this, hass, target, kind),
    );
    // the controls' presses are their own
    const own = (fn: (ev: any) => void) => (ev: Event) => {
      if (!ev.composedPath().some((n) => ["set", "toggle"].some((k) => (n as Element).classList?.contains(k)))) fn(ev);
    };
    const target_t = st?.attributes.temperature;
    const setPoint = this._pending ?? target_t;
    const graph = this._graph();
    // highest / lowest over the graph's hours, from the recorded values (not the smoothed line)
    let hilo: { hi: number; lo: number } | undefined;
    const line = this._lineEntity;
    if (c.min_max && line && this._series[line]?.length) {
      const span = typeof c.min_max === "number" ? Math.min(c.min_max, c.hours ?? 24) : (c.hours ?? 24);
      const from = Date.now() - span * 3600 * 1000;
      const pts = this._series[line];
      const vals = pts.filter((p, i) => p.t >= from || pts[i + 1]?.t > from).map((p) => p.v);
      if (vals.length) hilo = { hi: Math.max(...vals), lo: Math.min(...vals) };
    }
    const hover = this._hoverInfo;
    const time = hover ? new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit" }).format(new Date(hover.t)) : "";
    const off = st?.state === "off";
    const stop = (e: Event) => e.stopPropagation();
    // own materials: the bar (pill), the icon's button, the − / + field (a colour alone keeps the default glass)
    const has = (v?: string) => !!v && v !== "none";
    const pillMat = c.pill_glass ?? (has(c.pill_color) ? "frosted" : undefined);
    const btnMat = c.buttons_glass ?? (has(c.buttons_color) ? "dark" : undefined);
    const ownBg = !!c.icon_background;
    const lit = !!fill && !ownBg;
    // the symbol's colours: icons.icon / icon_on (core/card-parts)
    const onColor = c.icons?.icon_on?.color;
    const offColor = c.icons?.icon?.color;
    const sym = fill ? (has(onColor) ? cssColor(onColor) : ownBg ? accent : undefined) : has(offColor) ? cssColor(offColor) : undefined;
    const bg = c.icon_background === "none" ? "transparent" : ownBg ? tint(c.icon_background) : undefined;
    // off and on each with its own material (icon_glass / icon_on_glass); unset → the control glass
    const iconMat = active ? c.icon_on_glass : c.icon_glass;
    const iconCls = iconMat ? `mat mat-${iconMat} ${lit ? "on" : ""}` : `control ${lit ? "active" : ""} ${ownBg ? "own-bg" : ""} ${sym ? "own-fg" : ""}`;
    const iconStyle = iconMat
      ? `${ownBg ? (bg === "transparent" ? "" : `${matTint(c.icon_background)};`) : lit ? `${matTint(color, 70)};` : ""}${sym ? `color:${sym};` : ""}`
      : `${ownBg ? `--bg:${bg};${bg === "transparent" ? "" : `--sheen:${SHEEN};`}` : lit ? `--bg:${fill};--accent:${accent};` : ""}${sym ? `--fg:${sym};` : ""}`;
    const name = c.show_name === false ? undefined : (c.name ?? (st ? undefined : `${c.entity}?`));
    return html`<div
      class="frame surface ${active ? "on" : ""} ${clickable ? "clickable" : ""} ${c.controls === "top" ? "top" : "bottom"} ${c.compact ? "compact" : ""}"
      @pointerdown=${own(h.down)}
      @pointermove=${own(h.move)}
      @pointerup=${own(h.up)}
      @pointercancel=${h.cancel}
      @contextmenu=${h.context}
    >
      ${name || (c.inline_value && !climate)
        ? html`<div class="title">
            <span class="name">${name ?? ""}</span>
            ${c.inline_value && !climate
              ? hover
                ? html`<span class="ival">${fmt.format(hover.v)}<small>${unit} · ${time}</small></span>`
                : Number.isFinite(value)
                  ? html`<span class="ival">${fmt.format(value)}<small>${unit}</small></span>`
                  : nothing
              : nothing}
          </div>`
        : nothing}
      ${c.inline_value && !climate
        ? nothing
        : html`<div class=${pillMat ? `head mat mat-${pillMat}` : "head lbar control"} style=${pillMat ? matTint(c.pill_color) : ""}>
        <div
          class="btn ${iconCls} ${heating && (lit || iconMat) ? "glow" : ""} ${climate && st ? "toggle" : ""}"
          role=${climate && st ? "button" : nothing}
          aria-pressed=${climate && st ? (active ? "true" : "false") : nothing}
          style="${iconStyle}--glow:${cssColor(color)}"
          @pointerdown=${climate ? stop : nothing}
          @pointerup=${climate ? stop : nothing}
          @click=${climate ? (e: Event) => (e.stopPropagation(), this._toggle()) : nothing}
        >
          ${c.icon ? html`<ha-icon .icon=${c.icon}></ha-icon>` : st ? html`<ha-state-icon .hass=${hass} .stateObj=${st}></ha-state-icon>` : nothing}
        </div>
        <div class="txt">
          ${hover
            ? html`<span class="val">${fmt.format(hover.v)}<small>${unit} · ${time}</small></span>`
            : Number.isFinite(value)
              ? html`<span class="val">${fmt.format(value)}<small>${unit}</small></span>`
              : nothing}
        </div>
        ${hilo ? html`<span class="hilo">↑ ${fmt.format(hilo.hi)}° ↓ ${fmt.format(hilo.lo)}°</span>` : nothing}
        ${climate && st
          ? html`<div class="set ${off ? "off" : ""} ${btnMat ? `mat mat-${btnMat}` : ""}" style=${btnMat ? matTint(c.buttons_color) : ""} @pointerdown=${stop} @pointerup=${stop} @click=${stop}>
              <button class=${this._hit === -1 ? "hit" : ""} aria-label="−" @click=${() => this._step(-1)}><ha-icon icon="mdi:minus"></ha-icon></button>
              ${keyed(
                this._pending,
                html`<span class="sp ${this._pending !== undefined ? "pending" : ""}">${typeof setPoint === "number" ? fmt.format(setPoint) : "–"}</span>`,
              )}
              <button class=${this._hit === 1 ? "hit" : ""} aria-label="+" @click=${() => this._step(1)}><ha-icon icon="mdi:plus"></ha-icon></button>
            </div>`
          : nothing}
      </div>`}
      ${graph}
    </div>`;
  }

  override getCardSize() {
    return 3;
  }

  getGridOptions() {
    return { columns: 6, rows: 3, min_rows: 2 };
  }

  static override styles = [
    GlassElement.styles,
    surface,
    control,
    liquidBar,
    css`
      :host {
        display: block;
        height: 100%;
        /* the tile adapts to its own width (two columns on a wide phone) */
        container: tstat / inline-size;
      }
      /* inside a panel (no tile of its own) the panel's layout decides the height */
      :host([nested]:not([on-bare])) {
        height: auto;
        min-height: 0;
      }
      .frame {
        /* a little smaller than the room cards' buttons: three tiles side by side on a tablet */
        --btn: var(--glass-thermostat-button-size, 42px);
        position: relative;
        box-sizing: border-box;
        height: 100%;
        min-height: var(--glass-thermostat-min-height, 150px);
        display: flex;
        flex-direction: column;
        padding: 12px 10px 14px;
        border-radius: var(--g-radius);
        overflow: hidden;
        isolation: isolate;
        transition: transform 0.25s ease;
      }
      .frame.clickable {
        cursor: pointer;
      }
      /* only a tile with an action of its own gives way – not when a control in it is pressed */
      .frame.clickable:active:not(:has(.set:active, .toggle:active)) {
        transform: scale(0.985);
      }
      /* inside a panel the panel is the glass; the card is only its content */
      /* (a card with its own glass on a panel without any – own-tile – is its own tile) */
      :host([nested][glass]:not([own-tile])) .frame.surface {
        background: none !important;
        border: none !important;
        box-shadow: none !important;
        -webkit-backdrop-filter: none !important;
        backdrop-filter: none !important;
      }
      :host([nested]:not([own-tile])) .frame::before,
      :host([nested]:not([own-tile])) .frame::after {
        display: none;
      }
      /* home tiles on a panel without glass: the card is its own tile, like a room card */
      :host([nested][on-bare][glass="home"]) .frame.surface {
        background: var(--glass-home-fill, linear-gradient(var(--glass-home-surface, rgba(246, 246, 248, 0.8)), var(--glass-home-surface, rgba(246, 246, 248, 0.8)))) !important;
        border: 0.5px solid var(--glass-home-border, rgba(255, 255, 255, 0.35)) !important;
        box-shadow: var(--glass-home-shadow, 0 4px 16px rgba(0, 0, 0, 0.1)) !important;
        -webkit-backdrop-filter: blur(calc(var(--glass-home-blur, 24px) * var(--glass-blur-scale, 1))) saturate(var(--glass-home-saturate, 100%)) !important;
        backdrop-filter: blur(calc(var(--glass-home-blur, 24px) * var(--glass-blur-scale, 1))) saturate(var(--glass-home-saturate, 100%)) !important;
      }
      /* no tile of its own → the text keeps the panel's colours */
      :host([nested]:not([on-bare]):not([own-tile])) .frame.surface {
        --g-text: inherit;
        --g-text-2: inherit;
        --g-text-shadow: inherit;
        --g-icon-shadow: inherit;
        color: inherit;
      }

      /* ── tile: the name top left (room card title), what the thermostat does in the
            corner, a liquid glass bar with icon, temperature and set point, the graph below ── */
      .title {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 10px;
        padding: 0 4px 8px;
      }
      /* the name as on the room cards */
      .name {
        font-size: var(--glass-room-title-size, 15px);
        font-weight: 600;
        letter-spacing: -0.01em;
        color: var(--glass-room-title-color, var(--g-text));
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .head {
        position: relative;
        z-index: 1;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 4px;
        cursor: inherit;
        overflow: visible;
      }
      .head.control:active {
        transform: translateZ(0);
      }
      .txt {
        flex: 1;
        min-width: 0;
      }
      .val {
        font-size: 22px;
        font-weight: 400;
        line-height: 1.15;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      /* as the weather card's high / low */
      .hilo {
        flex: none;
        padding-right: 10px;
        font-size: 13px;
        color: var(--g-text-2);
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      .val small {
        margin-left: 2px;
        font-size: 13px;
        color: var(--g-text-2);
      }

      /* the room's icon: a room card button, the thermostat's switch */
      .btn {
        flex: none;
        width: var(--btn);
        height: var(--btn);
        display: grid;
        place-items: center;
        pointer-events: none;
      }
      .btn ha-icon,
      .btn ha-state-icon {
        --mdc-icon-size: calc(var(--btn) * 0.52);
        display: flex;
        filter: var(--g-icon-shadow);
      }
      /* own materials (pill_glass, icon_glass): the shape the control glass would give */
      .head.mat,
      .btn.mat {
        border-radius: 999px;
      }
      /* a lit icon in its own material keeps the bulb's halo */
      .btn.mat.glow {
        overflow: visible;
        box-shadow:
          0 0 10px 1px color-mix(in srgb, var(--glow) 55%, transparent),
          0 0 22px 5px color-mix(in srgb, var(--glow) 25%, transparent),
          inset 0 1px 0 rgba(255, 255, 255, 0.5);
      }
      .btn.mat.on {
        color: #fff;
      }
      /* icon_background / icon colours on the control glass: they beat every look's (Apple Home's grey too) */
      :host([control-glass]) .btn.control.own-bg {
        background: var(--sheen, linear-gradient(transparent, transparent)), linear-gradient(var(--bg), var(--bg)) !important;
      }
      :host([control-glass]) .btn.control.own-bg::before {
        display: none;
      }
      :host([control-glass]) .btn.control.own-fg {
        color: var(--fg) !important;
      }
      .btn:not(.active) {
        --fg: var(--glass-icon-inactive, var(--g-text));
      }
      .btn.toggle {
        pointer-events: auto;
        cursor: pointer;
      }
      /* heating: a close halo, a lit bulb (specific enough to beat the look's button shadow) */
      :host([control-glass]) .btn.control.active.glow,
      .btn.control.active.glow {
        overflow: visible;
        box-shadow:
          0 0 10px 1px color-mix(in srgb, var(--glow) 55%, transparent),
          0 0 22px 5px color-mix(in srgb, var(--glow) 25%, transparent),
          inset 0 1px 0 rgba(255, 255, 255, 0.5) !important;
      }

      /* set point: − value + in dark liquid glass, as tall as the icon */
      .set {
        flex: none;
        display: flex;
        align-items: center;
        height: var(--btn);
        padding: 0 4px;
        border-radius: 999px;
        cursor: default;
      }
      .set:not(.mat) {
        color: var(--glass-home-side-text, #fff);
        background: var(--glass-control-bg);
        box-shadow: var(--glass-control-shadow);
        -webkit-backdrop-filter: blur(calc(14px * var(--glass-blur-scale, 1))) saturate(150%);
        backdrop-filter: blur(calc(14px * var(--glass-blur-scale, 1))) saturate(150%);
      }
      .set button {
        width: 34px;
        height: 34px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: none;
        color: inherit;
        display: grid;
        place-items: center;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        transition:
          transform 0.15s ease,
          background 0.2s ease;
      }
      .set button:active,
      .set button.hit {
        transform: scale(0.88);
        background: rgba(255, 255, 255, 0.24);
      }
      .set ha-icon {
        --mdc-icon-size: 18px;
        display: flex;
      }
      .sp {
        min-width: 36px;
        text-align: center;
        font-size: 14px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      .set.off .sp {
        opacity: 0.45;
      }
      /* a new set point: orange until the thermostat takes it, with a little bump on each press */
      .sp.pending {
        color: var(--glass-thermostat-accent, var(--glass-home-side-icon, #ff9f0a));
        animation: bump 0.25s ease;
      }
      @keyframes bump {
        from {
          transform: scale(1.22);
        }
        to {
          transform: scale(1);
        }
      }

      /* the graph: edge to edge, fading out at the sides; above the bar (default,
         like a room card's photo over its buttons) or below it */
      .graph {
        position: relative;
        flex: 1;
        min-height: var(--glass-graph-min-height, 56px);
        margin: 6px -10px -14px;
        color: var(--glass-graph-color, var(--glass-home-side-icon, #ff9f0a));
        --glass-graph-fill: 0.32;
        touch-action: pan-y;
      }
      .frame.bottom .graph {
        order: -1;
        margin: -12px -10px 6px;
      }
      .frame.bottom .title {
        order: -2;
      }
      .plot {
        position: absolute;
        inset: 0;
        -webkit-mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
        mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
      }

      /* inline value: on the name's line, right aligned */
      .ival {
        font-size: 17px;
        font-weight: 500;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .ival small {
        margin-left: 2px;
        font-size: 12px;
        color: var(--g-text-2);
      }
      /* compact: no room of its own for the graph – it runs behind the name, the bar
         right under it; about two thirds of the usual height */
      .frame.compact {
        min-height: 0;
      }
      .frame.compact .graph {
        position: absolute;
        inset: 0 0 auto;
        /* the band behind the name only, never behind the bar */
        height: var(--glass-thermostat-compact-graph, 46px);
        min-height: 0;
        margin: 0;
        opacity: 0.7;
        z-index: 0;
        pointer-events: none;
      }
      .frame.compact .title {
        position: relative;
        z-index: 1;
        padding-bottom: 14px;
      }
      /* narrow tile (two columns on a phone): the set point gets its own row under the
         temperature, as wide as the tile */
      @container tstat (max-width: 250px) {
        /* no bar around two rows: icon and temperature straight on the tile,
           the dark set point under them */
        /* specific enough to beat the bar material (liquidBar, !important) */
        .head,
        :host([control-glass]) .frame .head.lbar.control,
        :host([control-glass][on-bare]) .frame .head.lbar.control {
          flex-wrap: wrap;
          row-gap: 8px;
          padding: 0;
          background: none !important;
          border: 0 !important;
          box-shadow: none !important;
          -webkit-backdrop-filter: none !important;
          backdrop-filter: none !important;
        }
        .head::before,
        .head::after,
        :host([control-glass]) .frame .head.lbar.control::before,
        :host([control-glass]) .frame .head.lbar.control::after {
          display: none;
        }
        .hilo {
          display: none;
        }
        .set {
          flex: 1 1 100%;
          justify-content: space-between;
        }
      }

      /* ── in a panel (heat pump): no tile, no bar – name, icon and value, the graph below ── */
      :host([nested]:not([on-bare]):not([own-tile])) .frame {
        min-height: 0;
        padding: 0;
        overflow: visible;
      }
      :host([nested]:not([on-bare]):not([own-tile])) .head {
        padding: 0;
        gap: 12px;
        background: none !important;
        border: 0 !important;
        box-shadow: none !important;
      }
      :host([nested]:not([on-bare]):not([own-tile])) .head::before {
        display: none;
      }
      :host([nested]:not([on-bare]):not([own-tile])) .graph,
      :host([nested]:not([on-bare]):not([own-tile])) .title {
        order: 0;
      }
      :host([nested]:not([on-bare]):not([own-tile])) .graph {
        margin: 10px 0 0;
      }

      svg {
        position: absolute;
        inset: 0;
        display: block;
        width: 100%;
        height: 100%;
        overflow: visible;
      }
      /* the line glows a little (filter on the svg: blur in screen pixels) */
      svg.lines {
        filter: drop-shadow(0 0 3px color-mix(in srgb, currentColor 55%, transparent));
      }
      .line {
        fill: none;
        stroke: currentColor;
        stroke-opacity: var(--glass-graph-opacity, 0.95);
        stroke-width: var(--glass-graph-width, 2.5px);
        stroke-linecap: round;
        stroke-linejoin: round;
        vector-effect: non-scaling-stroke;
      }
      .area {
        fill: url(#fill);
        stroke: none;
      }
      .graph.colored {
        --glass-graph-fill: 0.4;
      }
      .extra {
        fill: none;
        stroke: var(--glass-graph-accent, var(--glass-accent-icon, #ff9f0a));
        stroke-opacity: 0.8;
        stroke-width: 1.5px;
        stroke-dasharray: 4 4;
        vector-effect: non-scaling-stroke;
      }
      .span {
        fill: var(--glass-graph-accent, var(--glass-accent-icon, #ff9f0a));
        fill-opacity: var(--glass-graph-span, 0.14);
      }
      /* the point under the pointer, on the line */
      .marker {
        position: absolute;
        width: 10px;
        height: 10px;
        margin: -7px 0 0 -7px;
        border-radius: 50%;
        background: currentColor;
        border: 2px solid var(--glass-graph-marker-ring, #fff);
        box-shadow:
          0 0 8px color-mix(in srgb, currentColor 70%, transparent),
          0 1px 3px rgba(0, 0, 0, 0.2);
        pointer-events: none;
      }
    `,
    // after the card's own rules: a picked material replaces the default glass
    materials,
  ];
}

registerCard("glass-thermostat", GlassThermostat, {
  name: "Glass – thermostat",
  description: "Room temperature with set point controls and a soft history graph, styled like the room cards.",
});
