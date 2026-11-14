import { tr } from "../i18n";
import { css, html, nothing, svg } from "lit";
import { GlassElement } from "../core/glass-element";
import { LiquidController } from "../core/liquid";
import type { BaseCardConfig, HomeAssistant } from "../core/types";
import { registerCard } from "../core/registry";
import { makeEditor } from "../editor/editor";
import { blindSpec, defaultTilts } from "../editor/specs";
import { haptic } from "../core/actions";
import { control, liquidBar, surface } from "../core/styles";
import { cssColor, tint } from "../core/colors";
import { SHEEN, materials, matTint, type Material } from "../core/materials";
import { BLIND_PARTS } from "../core/card-parts";
import { blindPath, slatsPath, tiltDeg } from "../core/glass-icons";

/**
 * A room's blind – or anything else that opens and closes: position and tilt as bars – tap
 * anywhere on a bar or drag it – with quick choices under each (your own scripts or plain
 * values), a stop button while it moves and the pause of the room's automation with the time
 * left as a ring.
 *
 *   type: custom:glass-blind
 *   entity: cover.office
 *   kind: blind                               # blind (tilting slats) | roller | gate; default: by the entity
 *   name: Pracovna
 *   pause: switch.office_blinds_user_switch   # the automation's pause for this room
 *   pause_duration: 3600                      # s – how long a pause lasts (for the ring)
 *   positions:                                # quick positions (default: up / down)
 *     - { name: Nahoru, icon: mdi:arrow-up, script: script.open_blinds_office }
 *     - { name: Dolů, icon: mdi:arrow-down, script: script.close_blinds_office }
 *   tilts:                                    # quick tilts (default: closed / half / open)
 *     - { name: Min, script: script.tilt_blinds_office_min }
 *     - { name: Střed, script: script.tilt_blinds_office_mid }
 *     - { name: Max, script: script.tilt_blinds_office_max }
 *   slats: full                               # full (bar + quick tilts) | bar | none
 *   hide_pause: true                          # no pause button (the automation still pauses)
 *   show_title: false                         # no icon, name and state above the bars (no pause button
 *                                             #   either: no row at all, the card is just its bars)
 *   show_icon: false                          # no button on the position bar, the bar keeps its height
 *   show_bar_text: false                      # no state / % on the position bar – under the name instead
 *   show_positions: false                     # no quick positions on the bar (its button still goes up / down)
 *   percent_only: true                        # the bars say "45 %", no words (Closed, Partially open…)
 *   bar_glass: frosted                        # own materials (core/materials), *_color tints them:
 *   slats_glass: flat                         #   the position bar, the slats bar, the drawer,
 *   tray_glass: flat                          #   the icon's button up / down (icon_glass / icon_on_glass)
 *   fill_style: solid                         # the bar's fill: fade | solid | glow | none, fill_strength %
 *
 * A choice is { name, icon?, script? | value? } – a script is run, a value (0–100) set.
 *
 * The kind: a blind's bar fills as far as it is down and has the slats' drawer; a roller the
 * same without the drawer; a gate (garage door, door, window…) fills as far as it is open, with
 * the entity's own icon and Open / Close. A cover that can't be set to a position (only open and
 * close) gets a bar that shows its state and the buttons, not a slider.
 */
interface Choice {
  name?: string;
  icon?: string;
  script?: string;
  value?: number;
}

type Kind = "blind" | "roller" | "gate";

interface BlindConfig extends BaseCardConfig {
  entity: string;
  /** what it is: a blind with tilting slats, a roller (no tilt), a gate / garage door / window; auto = by the entity */
  kind?: "auto" | "blind" | "roller" | "gate";
  name?: string;
  icon?: string;
  pause?: string;
  pause_duration?: number;
  positions?: Choice[];
  tilts?: Choice[];
  /** the slats in the drawer (a blind): their bar and quick tilts, the bar only, or no drawer */
  slats?: "full" | "bar" | "none";
  /** the blind down / the gate open (bar fill, icon); the pause ring – default orange */
  active_color?: string;
  pause_color?: string;
  /** the pause button: its material (default Apple Home's dark glass) and a tint over it */
  pause_glass?: Material;
  pause_button_color?: string;
  /** the quick choices: the positions on the bar (default none) and the tilts in the drawer (default dark) */
  positions_glass?: Material;
  tilts_glass?: Material;
  choices_color?: string;
  hide_pause?: boolean;
  /** the quick positions on the bar (default shown); the button on the bar still goes all the way up / down */
  show_positions?: boolean;
  /** the bars' states as numbers only – "45 %", not "Closed" / "Partially open · 45 %" / "Closing" */
  percent_only?: boolean;
  /** the title above the bars: the icon, name and state (default shown) – off, and with no pause button either, the card is just its bars */
  show_title?: boolean;
  /** the blind's button on the position bar (default shown) */
  show_icon?: boolean;
  /** the state and percentage on the position bar (default shown) – off, they go under the name; a very narrow tile drops them from the bar itself */
  show_bar_text?: boolean;
  bar_glass?: Material;
  bar_color?: string;
  slats_glass?: Material;
  slats_color?: string;
  tray_glass?: Material;
  tray_color?: string;
  icon_glass?: Material;
  icon_on_glass?: Material;
  icon_background?: string;
  fill_color?: string;
  fill_style?: "fade" | "solid" | "glow" | "none";
  fill_strength?: number;
}

type Bar = "pos" | "tilt";

/** Home Assistant's cover features (supported_features bits). */
const SET_POSITION = 4;
const STOP = 8;
const TILT = 16 | 32 | 128;
/** Device classes that open and close like a gate: their bar is how far open. */
const GATES = ["gate", "garage", "door", "window", "damper"];
/** A gate's icon by its device class: closed, open. */
const GATE_ICONS: Record<string, [string, string]> = {
  gate: ["mdi:gate", "mdi:gate-open"],
  garage: ["mdi:garage", "mdi:garage-open"],
  door: ["mdi:door-closed", "mdi:door-open"],
  window: ["mdi:window-closed", "mdi:window-open"],
};

const has = (v?: string) => !!v && v !== "none";
/** An element's own material (a colour alone tints the default one). */
function part(m: Material | undefined, color: string | undefined, def: Material) {
  const use = m ?? (has(color) ? def : undefined);
  return use ? { cls: `mat mat-${use}`, style: matTint(has(color) ? color : undefined) } : undefined;
}

/** The blind as it hangs at a position (the glass:blind icons' shapes, at any position). */
const blindGlyph = (pos: number) => svg`<svg class="glyph" viewBox="0 0 24 24" aria-hidden="true"><path d=${blindPath(pos)}></path></svg>`;

/** Three slats from the side at an angle (the glass:slats icons' shapes): the tilt buttons' icon. */
const slats = (deg: number) => svg`<svg class="glyph" viewBox="0 0 24 24" aria-hidden="true"><path d=${slatsPath(deg)}></path></svg>`;

class GlassBlind extends GlassElement<BlindConfig> {
  constructor() {
    super();
    // the card's own glass (glass: liquid / light): the WebGL glass over it, as every card's
    new LiquidController(this, ".frame");
  }

  static override parts = BLIND_PARTS;
  static getConfigElement() {
    return makeEditor(blindSpec);
  }

  static getStubConfig(hass: HomeAssistant) {
    return { entity: Object.keys(hass.states).find((id) => id.startsWith("cover.")) ?? "" };
  }

  static override properties = { ...GlassElement.properties, _drag: { state: true } };
  /** The bar being dragged and where (0–1). */
  declare _drag?: { bar: Bar; v: number };
  /** Values sent, shown until the blind reports them (it takes a while to get there). */
  private _sent = new Map<Bar, { v: number; until: number }>();
  private _tick?: number;

  protected override validateConfig(c: BlindConfig) {
    if (!c.entity) throw new Error("Set `entity` (a cover)");
    return c;
  }

  protected watchedEntities(c: BlindConfig) {
    return [c.entity, c.pause ?? ""];
  }

  override connectedCallback() {
    super.connectedCallback();
    // the pause ring counts down by the minute
    this._tick = window.setInterval(() => this._config?.pause && this.requestUpdate(), 30000);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this._tick);
  }

  /** What it is: as set, else by the entity – gates by their class, blinds by their tilt. */
  private _kind(): Kind {
    const c = this._config;
    if (c.kind && c.kind !== "auto") return c.kind;
    const a = this._hass?.states[c.entity]?.attributes ?? {};
    if (GATES.includes(a.device_class)) return "gate";
    const f = a.supported_features;
    // tilts of its own or slats asked for: a blind, even if the entity doesn't tilt (scripts do)
    const tilt = !!c.tilts?.length || c.slats === "full" || c.slats === "bar" || a.current_tilt_position !== undefined || (typeof f === "number" && (f & TILT) !== 0);
    return tilt ? "blind" : "roller";
  }

  /** A cover feature; an entity without supported_features is taken to have it. */
  private _can(feature: number, attr?: string): boolean {
    const a = this._hass?.states[this._config.entity]?.attributes ?? {};
    if (typeof a.supported_features === "number") return (a.supported_features & feature) !== 0;
    return attr ? a[attr] !== undefined : true;
  }

  private _value(bar: Bar): number | undefined {
    const st = this._hass?.states[this._config.entity];
    const raw = bar === "pos" ? st?.attributes.current_position : st?.attributes.current_tilt_position;
    // only open / closed: up or down all the way
    if (bar === "pos" && raw === undefined) return st?.state === "open" ? 100 : st?.state === "closed" ? 0 : undefined;
    const v = Number(raw);
    return Number.isFinite(v) ? v : undefined;
  }

  /** On its way: as the cover says, or towards a position sent and not reached yet. */
  private _motion(): "opening" | "closing" | undefined {
    const st = this._hass?.states[this._config.entity];
    if (st?.state === "opening" || st?.state === "closing") return st.state;
    const sent = this._sent.get("pos");
    const real = this._value("pos");
    if (!sent || real === undefined || Date.now() > sent.until || Math.abs(real - sent.v) <= 2) return undefined;
    return sent.v > real ? "opening" : "closing";
  }

  /** A position: set, or – a cover that only opens and closes – opened or closed. */
  private _move(position: number) {
    const id = this._config.entity;
    this._sent.set("pos", { v: position, until: Date.now() + 90000 });
    if (this._can(SET_POSITION, "current_position")) this._hass?.callService("cover", "set_cover_position", { entity_id: id, position });
    else this._hass?.callService("cover", position >= 50 ? "open_cover" : "close_cover", { entity_id: id });
    this.requestUpdate();
  }

  /** Up or down (a gate: open or closed), the end the cover is not at; is it at the open end now? */
  private _atOpenEnd() {
    const pos = this._value("pos") ?? 0;
    return this._kind() === "gate" ? pos > 1 : pos >= 99;
  }

  /** The button on the bar: stop while it moves, else all the way to the other end. */
  private _iconTap() {
    if (this._motion() && this._can(STOP)) return this._stop();
    haptic("light");
    this._move(this._atOpenEnd() ? 0 : 100);
  }

  private _stop() {
    haptic("light");
    this._sent.delete("pos");
    this._hass?.callService("cover", "stop_cover", { entity_id: this._config.entity });
    this.requestUpdate();
  }

  private _choose(bar: Bar, c: Choice) {
    haptic("light");
    const id = this._config.entity;
    if (c.script) {
      this._hass?.callService("script", "turn_on", { entity_id: c.script });
      return;
    }
    if (c.value === undefined) return;
    if (bar === "pos") return this._move(c.value);
    this._sent.set(bar, { v: c.value, until: Date.now() + 90000 });
    this._hass?.callService("cover", "set_cover_tilt_position", { entity_id: id, tilt_position: c.value });
    this.requestUpdate();
  }

  /** The time left of the automation's pause (0–1), or undefined when it isn't paused. */
  private _pauseLeft(): number | undefined {
    const st = this._config.pause ? this._hass?.states[this._config.pause] : undefined;
    if (st?.state !== "on") return undefined;
    const dur = (this._config.pause_duration ?? 3600) * 1000;
    const since = Date.parse(st.last_changed);
    return Math.max(0, Math.min(1, 1 - (Date.now() - since) / dur));
  }

  /** A bar: the value follows the finger; a tap or the release sends it. */
  private _slide(bar: Bar, e: PointerEvent) {
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    const v = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    if (e.type === "pointerdown") {
      el.setPointerCapture(e.pointerId);
      this._drag = { bar, v };
      return;
    }
    if (this._drag?.bar !== bar) return;
    if (e.type === "pointermove") {
      this._drag = { bar, v };
      return;
    }
    this._drag = undefined;
    if (e.type === "pointercancel") return;
    const pct = Math.round(this._fromBar(bar, v) * 100);
    haptic("light");
    if (bar === "pos") return this._move(pct);
    this._sent.set(bar, { v: pct, until: Date.now() + 90000 });
    this._hass?.callService("cover", "set_cover_tilt_position", { entity_id: this._config.entity, tilt_position: pct });
  }

  /** The value at a point of a bar (0–1): a blind's position bar fills as far as it is down (100 − position), a gate's as far as it is open. */
  private _fromBar(bar: Bar, v: number) {
    return bar === "pos" && this._kind() !== "gate" ? 1 - v : v;
  }

  /** What a value shows now: dragged, sent (until the blind reports it) or reported. */
  private _shown(bar: Bar): number | undefined {
    const real = this._value(bar);
    const sent = this._sent.get(bar);
    if (sent && (Date.now() > sent.until || (real !== undefined && Math.abs(real - sent.v) <= 2))) this._sent.delete(bar);
    if (this._drag?.bar === bar) return Math.round(this._fromBar(bar, this._drag.v) * 100);
    // the position: always where the blind is – where it is going shows as the target (_target)
    if (bar === "pos" && real !== undefined) return real;
    return this._sent.get(bar)?.v ?? real;
  }

  /** Where a position sent is taking the blind, while it is not there yet (the bar's target). */
  private _target(): number | undefined {
    if (this._drag?.bar === "pos" || !this._motion()) return undefined;
    return this._sent.get("pos")?.v;
  }

  protected override render() {
    const c = this._config;
    const hass = this._hass;
    if (!c || !hass) return nothing;
    const st = hass.states[c.entity];
    if (!st) return html`<div class="frame surface"><span class="name">${c.entity}?</span></div>`;
    const kind = this._kind();
    const gate = kind === "gate";
    const motion = this._motion();
    const onColor = c.active_color ?? "orange";
    const left = this._pauseLeft();
    const pos = this._shown("pos");
    const tilt = this._shown("tilt");
    // a garage door goes up and down, the others open sideways
    const garage = st.attributes.device_class === "garage";
    const positions =
      c.positions ??
      (gate
        ? [
            { name: tr("Close"), icon: garage ? "mdi:chevron-down" : "mdi:arrow-collapse-horizontal", value: 0 },
            { name: tr("cover.open"), icon: garage ? "mdi:chevron-up" : "mdi:arrow-expand-horizontal", value: 100 },
          ]
        : [
            { name: tr("Up"), icon: "mdi:chevron-up", value: 100 },
            { name: tr("Down"), icon: "mdi:chevron-down", value: 0 },
          ]);
    // only open / close: the bar shows the state, the buttons move it
    const slider = this._can(SET_POSITION, "current_position");
    const canStop = this._can(STOP);
    // the slats drawn as the tilt sets them; a script's (no value) by its place: first shut, last open
    const tilts = (c.tilts ?? defaultTilts()).map((t, i, all) => ({
      ...t,
      deg: tiltDeg(typeof t.value === "number" ? t.value : (i / Math.max(1, all.length - 1)) * 100),
    }));
    // percent_only: numbers, not words (a cover that only opens and closes keeps its words: it has no number)
    const pctOnly = c.percent_only === true;
    const posText =
      pos === undefined
        ? "–"
        : pctOnly && slider
          ? `${pos} %`
          : pos >= 99
            ? tr("cover.is_open")
            : pos <= 1
              ? tr("cover.is_closed")
              : `${tr("Partially open")} · ${pos} %`;
    const motionText = motion && !(pctOnly && slider) ? (gate ? tr(motion === "closing" ? "cover.closing" : "cover.opening") : tr(motion === "closing" ? "Closing" : "Opening")) : "";
    const R = 15;
    const C = 2 * Math.PI * R;
    const down = (pos ?? 100) < 99;
    // how much of the bar is filled: a blind as far as it is down, a gate as far as it is open
    const amount = gate ? (pos ?? 0) : 100 - (pos ?? 100);
    const lit = amount > 1;
    // on its way to a position set on the bar: that position, from the bar's start, uncoloured
    const target = this._target();
    const targetAmount = target === undefined ? undefined : gate ? target : 100 - target;
    const drawer = kind === "blind" && c.slats !== "none";
    // the tilt in words (Home Assistant: 100 = slats open, flat; 0 = shut); pulled up they're packed
    const tiltText =
      tilt === undefined
        ? "–"
        : !down && this._drag?.bar !== "tilt"
          ? "–"
          : pctOnly
            ? `${tilt} %`
            : tilt >= 90
            ? tr("cover.is_open")
            : tilt <= 10
              ? tr("cover.is_closed")
              : `${tr("Partially open")} · ${tilt} %`;
    // up / down on the bar: the lights' quiet round mode buttons
    const modeBtn = (bar: Bar, ch: Choice) => html`<button class="mode mat-${c.positions_glass ?? "none"}" style=${matTint(c.choices_color)} title=${ch.name ?? ""} aria-label=${ch.name ?? ""} @click=${() => this._choose(bar, ch)}>
      <ha-icon .icon=${ch.icon ?? "mdi:circle-small"}></ha-icon>
    </button>`;
    const btn = (bar: Bar, ch: Choice & { deg?: number }) => {
      const real = this._value(bar);
      const cur = ch.value !== undefined && real !== undefined && Math.abs(real - ch.value) <= 2;
      return html`<button class="round side mat-${c.tilts_glass ?? "dark"} ${c.tilts_glass ? "" : "auto"} ${cur ? "cur" : ""}" style=${matTint(c.choices_color)} title=${ch.name ?? ""} aria-label=${ch.name ?? ""} @click=${() => this._choose(bar, ch)}>
        ${ch.deg !== undefined && !ch.icon ? slats(ch.deg) : html`<ha-icon .icon=${ch.icon ?? "mdi:circle-small"}></ha-icon>`}
      </button>`;
    };
    const bar = part(c.bar_glass, c.bar_color, "frosted");
    const slatsMat = part(c.slats_glass, c.slats_color, "flat");
    const tray = part(c.tray_glass, c.tray_color, "flat");
    const icon = this._icon(lit, onColor);
    const gateIcon = GATE_ICONS[st.attributes.device_class] ?? ["glass:blind", "glass:blind-open"];
    const slide = (bar: Bar) => (e: PointerEvent) => this._slide(bar, e);
    return html`<div class="frame surface" style="--c-on:${cssColor(onColor) ?? "transparent"};--fill:${has(c.fill_color) ? cssColor(c.fill_color) : "var(--c-on)"};--c-pause:${cssColor(c.pause_color ?? onColor) ?? "transparent"}">
      ${c.show_title === false && !(c.pause && !c.hide_pause)
        ? nothing
        : html`<div class="title ${c.show_title === false ? "bare" : ""}">
        ${c.show_title === false
          ? nothing
          : html`${c.icon ? html`<ha-icon class="ricon" .icon=${c.icon}></ha-icon>` : nothing}
              <span class="tt">
                <span class="name">${c.name ?? st.attributes.friendly_name ?? c.entity}</span>
                <span class="sub ${c.show_bar_text === false ? "always" : "narrow-only"}"
                  >${motion && motionText
                    ? html`<span class="word">${motionText}${slider && pos !== undefined ? " · " : ""}</span>${slider && pos !== undefined ? `${pos} %` : ""}`
                    : slider && !pctOnly && pos !== undefined && pos > 1 && pos < 99
                      ? html`<span class="word">${tr("Partially open")} · </span>${pos} %`
                      : posText}</span
                >
              </span>`}
        ${c.pause && !c.hide_pause
          ? html`<button
              class="round pause mat-${c.pause_glass ?? "dark"} ${left !== undefined ? "on" : ""}"
              style=${matTint(c.pause_button_color)}
              title=${left !== undefined
                ? tr("Automation paused for {n} more min – tap to resume", { n: Math.ceil((left * (c.pause_duration ?? 3600)) / 60) })
                : tr("Pause the automation")}
              @click=${() => (haptic("light"), hass.callService("switch", "toggle", { entity_id: c.pause }))}
            >
              ${left !== undefined
                ? svg`<svg class="ring" viewBox="0 0 36 36" aria-hidden="true">
                    <circle cx="18" cy="18" r=${R} class="track"></circle>
                    <circle cx="18" cy="18" r=${R} class="left" stroke-dasharray="${C * left} ${C}"></circle>
                  </svg>`
                : nothing}
              <ha-icon icon=${left !== undefined ? "mdi:play" : "mdi:pause"}></ha-icon>
            </button>`
          : nothing}
      </div>`}
      <div class="ctl">
        <div
          class="bar lbar ${bar ? bar.cls : "control"} ${c.show_icon === false ? "no-icon" : ""} ${c.show_bar_text === false ? "no-text" : ""} ${slider ? "" : "fixed"} ${motion ? "moving" : ""} ${this._drag?.bar === "pos" ? "drag" : ""} ${lit ? "on" : ""} fill-${c.fill_style ?? "fade"}"
          style="${bar ? `${bar.style};` : ""}--pct:${amount};--tgt:${targetAmount ?? 0};--fill-a:${c.fill_strength ?? 34}"
          role=${slider ? "slider" : "group"}
          aria-label=${tr("Position")}
          aria-valuenow=${slider ? (pos ?? 0) : nothing}
          @pointerdown=${slider ? slide("pos") : nothing}
          @pointermove=${slider ? slide("pos") : nothing}
          @pointerup=${slider ? slide("pos") : nothing}
          @pointercancel=${slider ? slide("pos") : nothing}
        >
          ${slider && targetAmount !== undefined ? html`<i class="target"></i>` : nothing}
          <i class="fill"></i>
          ${c.show_icon === false
            ? nothing
            : html`<div
                class="btn tap ${icon.cls} ${motion ? "moving" : ""}"
                style=${icon.style}
                role="button"
                tabindex="0"
                title=${motion && canStop ? tr("Stop") : this._atOpenEnd() ? (gate ? tr("Close") : tr("Down")) : gate ? tr("cover.open") : tr("Up")}
                @pointerdown=${(e: Event) => e.stopPropagation()}
                @click=${() => this._iconTap()}
                @keydown=${(e: KeyboardEvent) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), this._iconTap())}
              >
                ${gate ? html`<ha-icon class="gicon" .icon=${gateIcon[(pos ?? 0) > 1 || motion ? 1 : 0]}></ha-icon>` : blindGlyph(pos ?? 100)}
              </div>`}
          <span class="blabel"
            ><span class="wide-only">${motion && motionText ? `${motionText}${slider && pos !== undefined ? ` · ${pos} %` : ""}` : posText}</span
            ><span class="narrow-only">${pos === undefined ? "–" : slider ? `${pos} %` : posText}</span></span
          >
          <span class="btns" @pointerdown=${(e: Event) => e.stopPropagation()}
            >${motion && canStop
              ? html`<button class="mode stop mat-${c.positions_glass ?? "none"}" style=${matTint(c.choices_color)} title=${tr("Stop")} aria-label=${tr("Stop")} @click=${() => this._stop()}>
                  <ha-icon .icon=${"mdi:stop"}></ha-icon>
                </button>`
              : c.show_positions === false
                ? nothing
                : positions.map((p) => modeBtn("pos", p))}</span
          >
        </div>
        ${!drawer
          ? nothing
          : html`<div class="tray ${tray ? tray.cls : ""}" style=${tray ? tray.style : ""}>
          <div
            class="bar thin ${slatsMat ? slatsMat.cls : ""} ${this._drag?.bar === "tilt" ? "drag" : ""} ${!down && this._drag?.bar !== "tilt" ? "idle" : ""} fill-${c.fill_style ?? "fade"}"
            style="${slatsMat ? `${slatsMat.style};` : ""}--pct:${tilt ?? 0};--fill-a:${c.fill_strength ?? 34}"
            role="slider"
            aria-label=${tr("Slats")}
            aria-valuenow=${tilt ?? 0}
            @pointerdown=${slide("tilt")}
            @pointermove=${slide("tilt")}
            @pointerup=${slide("tilt")}
            @pointercancel=${slide("tilt")}
          >
            <i class="fill"></i>
            <span class="blabel">${tr("Slats")}</span>
            <span class="bval">${tiltText}</span>
          </div>
          ${c.slats === "bar" ? nothing : html`<div class="tilts">${tilts.map((t) => btn("tilt", t))}</div>`}
        </div>`}
      </div>
    </div>`;
  }

  /** The button on the bar: own material / backing / symbol colours (icon_*), else the control glass lit while down (a gate: open). */
  private _icon(down: boolean, color: string) {
    const c = this._config;
    const fill = down ? tint(color) : undefined;
    const accent = cssColor(color);
    const ownBg = !!c.icon_background;
    const lit = !!fill && !ownBg;
    // the symbol's colours: icons.icon / icon_on (core/card-parts)
    const onColor = c.icons?.icon_on?.color;
    const offColor = c.icons?.icon?.color;
    const sym = down ? (has(onColor) ? cssColor(onColor) : ownBg ? accent : undefined) : has(offColor) ? cssColor(offColor) : undefined;
    const bg = c.icon_background === "none" ? "transparent" : ownBg ? tint(c.icon_background) : undefined;
    const m = down ? c.icon_on_glass : c.icon_glass;
    if (m)
      return {
        cls: `mat mat-${m} ${lit ? "on" : ""} ${down ? "glow" : ""}`,
        style: `${ownBg ? (bg === "transparent" ? "" : `${matTint(c.icon_background)};`) : lit ? `${matTint(color, 70)};` : ""}${sym ? `color:${sym};` : ""}--glow:${accent}`,
      };
    return {
      cls: `control ${lit ? "active glow" : ""} ${ownBg ? "own-bg" : ""} ${sym ? "own-fg" : ""}`,
      style: `${ownBg ? `--bg:${bg};${bg === "transparent" ? "" : `--sheen:${SHEEN};`}` : lit ? `--bg:${fill};--accent:${accent};` : ""}${sym ? `--fg:${sym};` : ""}--glow:${accent}`,
    };
  }

  static override styles = [
    GlassElement.styles,
    surface,
    control,
    liquidBar,
    css`
      /* as tall as its content; a grid with equal rows still stretches it (align: stretch) */
      :host {
        display: block;
        min-width: 0;
        container: blind / inline-size;
      }
      /* a narrow tile (two side by side on a phone): a tighter bar */
      .narrow-only {
        display: none;
      }
      /* the bar's text off (show_bar_text: false): the state under the name, the arrows to the right */
      .tt .sub.always {
        display: block;
      }
      .bar.lbar.no-text .blabel {
        display: none;
      }
      .bar.lbar .btns {
        margin-left: auto;
      }
      /* no button and no text: the arrows at the bar's two ends, their round matching its */
      .bar.lbar.no-icon.no-text {
        padding: 4px;
      }
      .bar.lbar.no-icon.no-text .btns {
        flex: 1;
        justify-content: space-between;
        padding: 0;
      }
      /* a very narrow tile (three in a row on a phone): no text on the bar – the state is under
         the name; with the button only the button (a tap goes up / down, the bar drags), without
         it the arrows at the two ends */
      @container blind (max-width: 170px) {
        :host .frame .bar.lbar .blabel {
          display: none;
        }
        :host .frame .bar.lbar:not(.no-icon) .btns {
          display: none;
        }
        :host .frame .bar.lbar.no-icon {
          padding: 4px;
          /* as tall as a bar with the button: a row of tiles stays even */
          min-height: calc(var(--btn) + 8px);
          box-sizing: border-box;
        }
        :host .frame .bar.lbar.no-icon .btns {
          flex: 1;
          min-width: 0;
          justify-content: space-between;
          padding: 0;
        }
        /* the two arrows at full size, each in its half of the bar against its end – where the
           bar is too short they overlap a little in the middle, never the bar's ends */
        :host .frame .bar.lbar.no-icon .btns {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        }
        :host .frame .bar.lbar.no-icon .btns .mode {
          flex: none;
        }
        :host .frame .bar.lbar.no-icon .btns .mode:last-child:not(:first-child) {
          justify-self: end;
        }
        /* under the name: "29 %", not "Partially open · 29 %" – it wouldn't fit */
        :host .tt .sub .word {
          display: none;
        }
        /* the drawer: the slats' state alone on its bar, the tilts smaller */
        :host .frame .bar.thin .blabel {
          display: none;
        }
        :host .frame .bar.thin {
          justify-content: center;
          padding: 0 6px;
        }
        :host .frame .tray {
          padding-left: 4px;
          padding-right: 4px;
        }
        :host .frame .tilts {
          justify-content: space-between;
        }
        :host .frame .tilts .round.side {
          width: 26px;
          height: 26px;
        }
        :host .frame .tilts .round.side .glyph {
          width: 18px;
          height: 18px;
        }
      }
      /* a narrow tile (phones, two columns): the state under the name, the bar just the glyph and the arrows */
      @container blind (max-width: 230px) {
        .narrow-only {
          display: inline;
        }
        .tt .sub.narrow-only {
          display: block;
        }
        .wide-only {
          display: none;
        }
        .frame {
          --btn: 36px;
          padding: 10px 10px 12px;
        }
        .frame .bar.lbar {
          gap: 6px;
        }
        /* smaller controls; the bar keeps its 4 px all round, so the glyph and the arrows
           are as big as the glyph and concentric with the pill */
        :host .frame {
          --btn: 36px;
        }
        .frame .bar.lbar {
          gap: 4px;
        }
        .frame .mode {
          width: var(--btn);
          height: var(--btn);
        }
        .frame .mode ha-icon {
          --mdc-icon-size: 20px;
        }
        .frame .btns {
          padding-right: 0;
          gap: 0;
        }
        /* the percentage after the glyph: small, never cut */
        .frame .blabel {
          font-size: 11px;
          overflow: visible;
          text-overflow: clip;
        }
        /* the room's name: always whole – a touch smaller, never cut */
        .frame .name {
          flex: none;
          overflow: visible;
          text-overflow: clip;
          font-size: 14px;
        }
        .frame .title {
          gap: 6px;
        }
        /* the state under the name: one line, never cut */
        .frame .tt .sub {
          white-space: nowrap;
          overflow: visible;
        }
        .frame .bar.thin .blabel {
          display: inline;
          font-size: 13px;
        }
        .frame .bar.thin {
          padding: 0 10px;
        }
        .frame .tilts .round.side {
          width: 30px;
          height: 30px;
        }
        .frame .tilts .round.side .glyph {
          width: 21px;
          height: 21px;
        }
      }
      .frame {
        --btn: var(--glass-light-button-size, 42px);
        box-sizing: border-box;
        height: 100%;
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 12px 12px 14px;
        border-radius: var(--g-radius);
      }
      .title {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 34px;
        padding: 0 2px 0 4px;
      }
      /* no title (show_title: false), only the pause button: on the right */
      .title.bare {
        justify-content: flex-end;
      }
      .name {
        flex: 1;
        min-width: 0;
        font-size: var(--glass-room-title-size, 15px);
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .ricon {
        --mdc-icon-size: 18px;
        display: flex;
        color: var(--glass-accent-icon, var(--c-on));
      }
      /* round buttons in the title: stop while moving, the automation's pause */
      .round {
        position: relative;
        flex: none;
        width: 34px;
        height: 34px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        display: grid;
        place-items: center;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        transition: transform 0.15s ease;
      }
      .round:active {
        transform: scale(0.9);
      }
      /* the pause button's ring track: visible on any material */
      .round.pause .ring .track {
        stroke: color-mix(in srgb, currentColor 22%, transparent);
      }
      .round ha-icon {
        --mdc-icon-size: 18px;
        display: flex;
      }
      .ring {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        transform: rotate(-90deg);
      }
      .ring circle {
        fill: none;
        stroke-width: 3;
      }
      .ring .track {
        stroke: rgba(255, 255, 255, 0.18);
      }
      .ring .left {
        stroke: var(--c-pause);
        stroke-linecap: round;
        transition: stroke-dasharray 0.6s ease;
      }
      .tt {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        line-height: 1.25;
      }
      .sub {
        font-size: 12px;
        font-weight: 500;
        color: var(--g-text-2);
        font-variant-numeric: tabular-nums;
      }
      .sub.pending {
        color: var(--c-on);
      }
      /* the position: a liquid glass bar as the lights', filled as far as the blind is down;
         up / down on it. The slats: a thinner bar and three tilts in the drawer under it */
      .ctl {
        display: flex;
        flex-direction: column;
      }
      .bar {
        position: relative;
        z-index: 1;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 4px;
        border-radius: 999px;
        isolation: isolate;
        touch-action: none;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        user-select: none;
        -webkit-user-select: none;
      }
      .fill {
        position: absolute;
        inset: 0;
        z-index: -1;
        border-radius: inherit;
        background: linear-gradient(
          90deg,
          color-mix(in srgb, var(--fill, #ff9500) calc(var(--fill-a, 34) * 1%), transparent),
          color-mix(in srgb, var(--fill, #ff9500) calc(var(--fill-a, 34) * 0.65%), transparent)
        );
        clip-path: inset(0 calc(100% - (var(--btn) + 8px) - (100% - var(--btn) - 8px) * var(--pct) / 100) 0 0 round 999px);
        transition: clip-path 0.35s ease;
      }
      /* where it is going (a position set on the bar, not reached yet): from the bar's start to
         there, in the text's colour, faint – under the fill, which follows the blind */
      .target {
        position: absolute;
        inset: 0;
        z-index: -1;
        border-radius: inherit;
        background: color-mix(in srgb, var(--g-text, currentColor) 12%, transparent);
        clip-path: inset(0 calc(100% - (var(--btn) + 8px) - (100% - var(--btn) - 8px) * var(--tgt) / 100) 0 0 round 999px);
        animation: target-in 0.25s ease;
      }
      .bar.no-icon .target {
        clip-path: inset(0 calc(100% - var(--tgt) * 1%) 0 0 round 999px);
      }
      @keyframes target-in {
        from {
          opacity: 0;
        }
      }
      /* up: nothing to fill (as a light that's off) */
      .bar.lbar:not(.on) .fill {
        opacity: 0;
      }
      .bar.drag .fill {
        transition: none;
      }
      /* no button: the bar keeps its height, the fill runs from the very edge */
      .bar.no-icon {
        /* as tall as a bar with the button (the button + 4 px around it) */
        box-sizing: border-box;
        min-height: calc(var(--btn) + 8px);
        padding-left: 16px;
      }
      .bar.no-icon .fill {
        clip-path: inset(0 calc(100% - var(--pct) * 1%) 0 0 round 999px);
      }
      /* fill_style: one even colour, a glow towards the value, or none */
      .bar.fill-solid .fill {
        background: color-mix(in srgb, var(--fill, #ff9500) calc(var(--fill-a, 34) * 1%), transparent);
      }
      .bar.fill-glow .fill {
        background: linear-gradient(
          90deg,
          color-mix(in srgb, var(--fill, #ff9500) calc(var(--fill-a, 34) * 0.4%), transparent),
          color-mix(in srgb, var(--fill, #ff9500) calc(var(--fill-a, 34) * 1.6%), transparent)
        );
      }
      .bar.fill-none .fill {
        display: none;
      }
      /* own materials: the shape the control glass would give */
      .bar.mat,
      .btn.mat {
        border-radius: 999px;
      }
      .tray.mat {
        border-radius: 0 0 22px 22px;
      }
      .btn.mat.glow {
        overflow: visible;
        box-shadow:
          0 0 10px 1px color-mix(in srgb, var(--glow) 55%, transparent),
          0 0 22px 5px color-mix(in srgb, var(--glow) 25%, transparent);
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
      .bicon {
        --mdc-icon-size: 20px;
        display: flex;
        color: var(--g-text-2);
      }
      .blabel {
        flex: 1;
        min-width: 0;
        font-size: 14px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .btns {
        display: flex;
        gap: 2px;
        padding-right: 4px;
      }
      /* as the lights' mode buttons */
      .mode {
        width: 32px;
        height: 32px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: none;
        color: var(--g-text-2);
        display: grid;
        place-items: center;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        transition: background 0.2s ease;
      }
      .mode:active {
        background: color-mix(in srgb, var(--g-text) 12%, transparent);
      }
      .mode ha-icon {
        --mdc-icon-size: 20px;
        display: flex;
      }
      /* the lit bulb of the lights: here the slats as they stand, orange while the blind is down */
      .btn {
        flex: none;
        width: var(--btn);
        height: var(--btn);
        display: grid;
        place-items: center;
      }
      /* the button on the bar: a tap goes all the way to the other end, or stops it */
      .btn.tap {
        cursor: pointer;
        border-radius: 50%;
        -webkit-tap-highlight-color: transparent;
        transition: transform 0.15s ease;
      }
      .btn.tap:active {
        transform: scale(0.9);
      }
      .btn .glyph {
        width: calc(var(--btn) * 0.52);
        height: calc(var(--btn) * 0.52);
      }
      .tray {
        display: flex;
        flex-direction: column;
        gap: 10px;
        position: relative;
        z-index: 0;
        /* tucked under the bar from its middle; the slats bar then sits as far below the
           bar (10px) as the tilt buttons below the slats bar */
        margin-top: calc(-1 * var(--btn) / 2 - 4px);
        padding: calc(var(--btn) / 2 + 4px + 10px) 8px 10px;
        border-radius: 0 0 22px 22px;
      }
      .tray:not(.mat) {
        background: var(--glass-seg-bg, color-mix(in srgb, var(--g-text) 7%, transparent));
        box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.07);
        /* as the lights' drawer: the bar is see-through glass – cut its lower half out of the
           drawer, leaving only the corners beside its round ends */
        --r: calc(var(--btn) / 2 + 4px);
        -webkit-mask:
          linear-gradient(transparent var(--r), #000 var(--r)),
          radial-gradient(circle var(--r) at 100% 0, transparent 98%, #000) 0 0 / var(--r) var(--r) no-repeat,
          radial-gradient(circle var(--r) at 0 0, transparent 98%, #000) 100% 0 / var(--r) var(--r) no-repeat;
        mask:
          linear-gradient(transparent var(--r), #000 var(--r)),
          radial-gradient(circle var(--r) at 100% 0, transparent 98%, #000) 0 0 / var(--r) var(--r) no-repeat,
          radial-gradient(circle var(--r) at 0 0, transparent 98%, #000) 100% 0 / var(--r) var(--r) no-repeat;
      }
      .bar.thin {
        height: 34px;
        padding: 0 12px;
      }
      .bar.thin:not(.mat) {
        background: color-mix(in srgb, var(--g-text) 8%, transparent);
      }
      /* pulled up: the slats don't matter now – a quiet bar, no fill */
      .bar.thin.idle {
        opacity: 0.45;
      }
      .bar.thin.idle .fill {
        opacity: 0;
      }
      .bar.thin .fill {
        clip-path: inset(0 calc(100% - var(--pct) * 1%) 0 0 round 999px);
      }
      .bar.thin .blabel {
        font-size: 13px;
      }
      .bval {
        font-size: 13px;
        font-weight: 600;
        color: var(--g-text-2);
        font-variant-numeric: tabular-nums;
      }
      .tilts {
        display: flex;
        justify-content: space-around;
      }
      .round.side {
        width: 36px;
        height: 36px;
      }
      .tilts .round.side {
        width: 34px;
        height: 34px;
      }
      /* no material picked: a faint round; a picked one (tilts_glass) draws its own */
      .tilts .round.side.auto {
        color: var(--g-text-2);
        background: color-mix(in srgb, var(--g-text) 8%, transparent);
      }
      /* the slats fill the button more; a pixel lower looks centred in the round button */
      .tilts .round.side .glyph {
        width: 24px;
        height: 24px;
        transform: translateY(1px);
      }
      .glyph {
        width: 20px;
        height: 20px;
      }
      .glyph path {
        fill: currentColor;
      }
      /* on its way: the symbol on the bar blinks, the stop button takes the quick choices' place */
      .btn.moving > * {
        animation: cover-blink 1.1s ease-in-out infinite;
      }
      @keyframes cover-blink {
        50% {
          opacity: 0.25;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .btn.moving > * {
          animation: none;
        }
      }
      .btn .gicon {
        --mdc-icon-size: calc(var(--btn) * 0.52);
        display: flex;
      }
      /* only open / close: the bar shows the state, the buttons move it */
      .bar.fixed {
        cursor: default;
      }
      .mode.stop {
        color: var(--c-on);
      }
      .round.side.cur {
        color: #1c1c1e;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0.7));
      }
    `,
    // last: an element's material wins over its rules above
    materials,
  ];
}

registerCard("glass-blind", GlassBlind, {
  name: "Glass – blind",
  description: "A room's blind, roller or gate: position and tilt bars (tap or drag), stop while it moves, quick choices, the automation's pause.",
});
