import { locale, tr } from "../i18n";
import { css, html, nothing, svg } from "lit";
import { GlassElement } from "../core/glass-element";
import type { BaseCardConfig, HomeAssistant } from "../core/types";
import { registerCard } from "../core/registry";
import { makeEditor } from "../editor/editor";
import { automationSpec, sunShadingSpec, valueGridSpec } from "../editor/specs";
import { haptic } from "../core/actions";
import { cssColor } from "../core/colors";
import { materials, matTint, type Material } from "../core/materials";
import { weather3dDefs, weather3dStyles, weatherIcon3d } from "./weather-icons-3d";
import { AUTOMATION_PARTS } from "../core/card-parts";

/*
 * Three cards for a side panel of an automation (the blinds' one, but not only):
 *
 *   glass-automation   – an automation on / off, and for how long a switch-off lasts
 *   glass-sun-shading  – the sun over a compass, the light outside, what the automation decided
 *   glass-value-grid   – numbers (input_number) in a table, − / + on each; a column per
 *                        season, the current one marked – by months or by an entity's state
 *
 * Stacked in a panel each gets a hairline above it (not the first one).
 */

interface PartConfig extends BaseCardConfig {
  title?: string;
  /** false: no title line */
  show_title?: boolean;
}


/**
 * − / + on an input_number: shown at once, sent once the taps pause (so a few taps are one
 * call); the new value stays shown until HA reports it.
 */
class Nudger {
  pending = new Map<string, number>();
  private timers = new Map<string, number>();
  constructor(private host: { requestUpdate(): void; hass(): HomeAssistant | undefined }) {}

  value(id: string): number | undefined {
    const v = this.pending.get(id) ?? Number(this.host.hass()?.states[id]?.state);
    return Number.isFinite(v) ? v : undefined;
  }

  nudge(id: string, step: number) {
    const hass = this.host.hass();
    const st = hass?.states[id];
    if (!st) return;
    haptic("selection");
    const a = st.attributes;
    const base = this.pending.get(id) ?? Number(st.state);
    const next = Math.min(Number(a.max ?? 100), Math.max(Number(a.min ?? 0), base + Number(a.step ?? 1) * step));
    this.pending.set(id, next);
    this.host.requestUpdate();
    clearTimeout(this.timers.get(id));
    this.timers.set(
      id,
      window.setTimeout(() => {
        const domain = id.split(".")[0] === "number" ? "number" : "input_number";
        this.host.hass()?.callService(domain, "set_value", { entity_id: id, value: next });
        window.setTimeout(() => (this.pending.delete(id), this.host.requestUpdate()), 4000);
      }, 900),
    );
  }

  stop() {
    for (const t of this.timers.values()) clearTimeout(t);
  }
}

const partStyles = css`
  :host {
    display: block;
  }
  .frame {
    display: flex;
    flex-direction: column;
    gap: 10px;
    color: var(--g-text);
    padding-top: 14px;
    border-top: 1px solid color-mix(in srgb, var(--g-text) 12%, transparent);
  }
  /* the first card of a stack opens it: no line above */
  :host(:first-child) .frame {
    border-top: 0;
    padding-top: 0;
  }
  .gtitle {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--g-text-2);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: 34px;
  }
  .lbl {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 600;
  }
  .lbl ha-icon,
  .head ha-icon {
    --mdc-icon-size: 18px;
    display: flex;
    color: var(--glass-accent-icon, currentColor);
  }
  /* − value + in the dark control glass */
  .set {
    display: flex;
    align-items: center;
    justify-content: space-between;
    box-sizing: border-box;
    height: 34px;
    padding: 0 3px;
    border-radius: 999px;
  }
  .set button {
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    color: inherit;
    display: grid;
    place-items: center;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .set button:active {
    background: color-mix(in srgb, var(--g-text) 14%, transparent);
  }
  .set ha-icon {
    --mdc-icon-size: 16px;
    display: flex;
  }
  .sp {
    font-size: 13px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .sp.pending {
    color: var(--accent-c, var(--glass-color-orange, #ff9f0a));
  }
  .hint {
    font-size: 12px;
    color: var(--g-text-2);
  }
`;

const frameClass = (_c: PartConfig) => "frame";

/* ── glass-automation ─────────────────────────────────────────────────────── */

/**
 * An automation (or any switch) on / off; optionally how long a switch-off lasts.
 *
 *   type: custom:glass-automation
 *   entity: automation.blinds_auto
 *   title: Automatika žaluzií
 *   show_state: true                         # "On" / "Off" beside the switch
 *   color: orange                            # the switch when on
 *   pause_for: input_select.blinds_auto_pause    # optional: "1 hodina" … "Natrvalo", "Do času"
 *   resume_at: input_datetime.blinds_auto_resume #   when it comes back (date + time)
 *   pause_until: input_datetime.blinds_auto_until #  the time for "until a time" (time only)
 *
 * The card only shows and sets these helpers – turning the automation back on at
 * `resume_at` is a small automation of your own (see docs/automation-cards.md).
 */
interface AutomationConfig extends PartConfig {
  entity?: string;
  icon?: string;
  show_state?: boolean;
  color?: string;
  /** the switch's track: a material (on: tinted with color); unset = the plain track */
  switch_glass?: Material;
  pause_for?: string;
  resume_at?: string;
  pause_until?: string;
}

class GlassAutomation extends GlassElement<AutomationConfig> {
  static override wrapTile = true;
  static override parts = AUTOMATION_PARTS;
  static override properties = { ...GlassElement.properties, _menu: { state: true } };
  declare _menu: boolean;

  static getConfigElement() {
    return makeEditor(automationSpec);
  }

  static getStubConfig(hass?: HomeAssistant) {
    return { entity: Object.keys(hass?.states ?? {}).find((e) => e.startsWith("automation.")) ?? "" };
  }

  protected watchedEntities(c: AutomationConfig) {
    return [c.entity ?? "", c.pause_for ?? "", c.resume_at ?? "", c.pause_until ?? ""];
  }

  private _toggle(on: boolean) {
    const id = this._config.entity!;
    haptic("light");
    const domain = id.split(".")[0];
    this._hass!.callService(domain === "automation" ? "automation" : "homeassistant", on ? "turn_off" : "turn_on", { entity_id: id });
  }

  /** Under the switch: how long a switch-off lasts (a quiet drop-down); while off, when it comes back. */
  private _pauseRow(on: boolean) {
    const c = this._config;
    const sel = c.pause_for ? this._hass?.states[c.pause_for] : undefined;
    if (!sel) return nothing;
    const options: string[] = sel.attributes.options ?? [];
    // "until a time": the time beside the drop-down (HH:MM)
    const untilSt = c.pause_until ? this._hass?.states[c.pause_until]?.state : undefined;
    // the option's own words (the user's dropdown), Czech or English: "Do času" / "Until a time"
    const until = /čas|time/i.test(sel.state) && untilSt ? untilSt.slice(0, 5) : undefined; // i18n-ok
    let note = "";
    if (!on) {
      const at = c.resume_at ? this._hass?.states[c.resume_at]?.state : undefined;
      const t = at ? new Date(at.replace(" ", "T")) : undefined;
      if (t && t.getTime() > Date.now()) {
        const today = new Date().toDateString() === t.toDateString();
        const hm = t.toLocaleTimeString(locale(), { hour: "numeric", minute: "2-digit" });
        note = `${tr("Back on")} ${today ? (tr("at")) : tr("tomorrow at")} ${hm}`;
      } else note = tr("Off for good");
    }
    return html`<div class="row pauserow">
      <span class="pnote">${on ? (tr("When off")) : note}</span>
      <div class="pdrop">
        <button class="pbtn" aria-haspopup="listbox" aria-expanded=${this._menu ? "true" : "false"} @click=${() => (this._menu = !this._menu)}>
          <span>${until ? sel.state.replace(/\s*(času|a time)$/i, "") /* i18n-ok */ : sel.state}</span><ha-icon class="${this._menu ? "open" : ""}" icon="mdi:chevron-down"></ha-icon>
        </button>
        ${this._menu
          ? html`<div class="pmenu" role="listbox">
              ${options.map(
                (o) => html`<button role="option" class=${o === sel.state ? "cur" : ""} @click=${() => {
                  this._menu = false;
                  haptic("selection");
                  this._hass!.callService("input_select", "select_option", { entity_id: c.pause_for, option: o });
                }}>
                  <span>${o}</span>${o === sel.state ? html`<ha-icon icon="mdi:check"></ha-icon>` : nothing}
                </button>`,
              )}
            </div>`
          : nothing}
      </div>
      ${until
        ? html`<input
            class="ptime"
            type="time"
            .value=${until}
            @change=${(e: Event) => {
              const v = (e.target as HTMLInputElement).value;
              if (v) this._hass!.callService("input_datetime", "set_datetime", { entity_id: c.pause_until, time: `${v}:00` });
            }}
          />`
        : nothing}
    </div>`;
  }

  protected override render() {
    const c = this._config;
    const hass = this._hass;
    if (!c || !hass) return nothing;
    const st = c.entity ? hass.states[c.entity] : undefined;
    if (!st) return html`<div class=${frameClass(c)}><span class="hint">${c.entity || (tr("Choose an automation"))}</span></div>`;
    const on = st.state === "on";
    const title = c.title ?? st.attributes.friendly_name ?? (tr("Automation"));
    return html`<div class=${frameClass(c)} style=${c.color ? `--on:${cssColor(c.color)}` : ""}>
      ${c.show_title === false ? nothing : html`<span class="gtitle">${title}</span>`}
      <div class="row">
        <span class="lbl state">
          ${c.icon ? html`<ha-icon .icon=${c.icon}></ha-icon>` : nothing}
          ${c.show_state === false ? nothing : on ? (tr("On")) : tr("Off")}
        </span>
        <button
          class="toggle ${on ? "on" : ""} ${c.switch_glass ? `mat mat-${c.switch_glass}` : ""}"
          style=${c.switch_glass && on ? matTint(c.color ?? "orange", 70) : ""}
          role="switch" aria-checked=${on ? "true" : "false"} aria-label=${title} @click=${() => this._toggle(on)}>
          <i></i>
        </button>
      </div>
      ${this._pauseRow(on)}
    </div>`;
  }

  static override styles = [
    GlassElement.styles,
    partStyles,
    css`
      .lbl.state {
        font-size: 13px;
        font-weight: 500;
      }
      .toggle {
        position: relative;
        flex: none;
        width: 40px;
        height: 24px;
        padding: 0;
        border: 0;
        border-radius: 999px;
        cursor: pointer;
        background: color-mix(in srgb, var(--g-text) 16%, transparent);
        transition: background 0.25s ease;
        -webkit-tap-highlight-color: transparent;
      }
      /* on: a muted colour – a setting, not the headline (a material's track: tinted instead) */
      .toggle.on:not(.mat) {
        background: color-mix(in srgb, var(--on, var(--glass-color-orange, #ff9f0a)) 62%, transparent);
      }
      .toggle i {
        position: absolute;
        top: 3px;
        left: 3px;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.9);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
        transition: transform 0.25s ease;
      }
      .toggle.on i {
        transform: translateX(16px);
      }
      .pauserow {
        min-height: 28px;
      }
      .pnote {
        font-size: 12px;
        color: var(--g-text-2);
      }
      .pdrop {
        position: relative;
        margin-left: auto;
      }
      .pdrop:has(.pmenu) {
        z-index: 5;
      }
      .pbtn {
        display: flex;
        align-items: center;
        gap: 2px;
        padding: 2px 0 2px 8px;
        border: 0;
        background: none;
        font: inherit;
        font-size: 12px;
        font-weight: 600;
        color: var(--g-text);
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }
      .pbtn ha-icon {
        --mdc-icon-size: 18px;
        display: flex;
        color: var(--g-text-2);
        transition: transform 0.25s ease;
      }
      .pbtn ha-icon.open {
        transform: rotate(180deg);
      }
      .ptime {
        width: 44px;
        padding: 0;
        border: 0;
        font: inherit;
        font-size: 12px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        color: var(--g-text);
        background: none;
        color-scheme: light dark;
        cursor: pointer;
      }
      .ptime::-webkit-calendar-picker-indicator {
        display: none;
      }
      .pmenu {
        position: absolute;
        right: 0;
        top: calc(100% + 4px);
        min-width: 150px;
        padding: 6px;
        border-radius: 16px;
        display: flex;
        flex-direction: column;
        /* its own colours: the sidebar's white text must not land on the light menu */
        color: #1c1c1e;
        background: rgba(246, 246, 248, 0.97);
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
        -webkit-backdrop-filter: blur(calc(20px * var(--glass-blur-scale, 1)));
        backdrop-filter: blur(calc(20px * var(--glass-blur-scale, 1)));
      }
      .pmenu button {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 9px 10px;
        border: 0;
        border-radius: 10px;
        background: none;
        font: inherit;
        font-size: 13px;
        color: inherit;
        text-align: left;
        cursor: pointer;
      }
      .pmenu button.cur {
        font-weight: 600;
      }
      .pmenu button:hover {
        background: rgba(0, 0, 0, 0.06);
      }
      :host([dark]) .pmenu {
        color: #fff;
        background: rgba(44, 48, 57, 0.97);
      }
      :host([dark]) .pmenu button:hover {
        background: rgba(255, 255, 255, 0.08);
      }
      .pmenu ha-icon {
        --mdc-icon-size: 16px;
        display: flex;
      }
    `,
    materials,
  ];
}

registerCard("glass-automation", GlassAutomation, {
  name: "Glass – automation switch",
  description: "An automation on / off, and for how long a switch-off lasts.",
});

/* ── glass-sun-shading ────────────────────────────────────────────────────── */

/**
 * The sun from above over a compass (north up): its direction, nearer the middle the higher
 * it stands; the shading azimuth (where it shines into the room) as a sector; the light outside as a
 * ring; beside it what the shading automation decided and the tilt it aims for.
 *
 *   type: custom:glass-sun-shading
 *   sun: sun.sun
 *   light: sensor.sun_sensor_luminance       # optional: the ring
 *   shading: sensor.blinds_shading_level     # optional: open / min / mid / max
 *   target_tilt: sensor.blinds_target_tilt   # optional
 *   azimuth_from: 195                        # shading azimuth: the sun shines into the room (° – 90 E, 180 S, 270 W);
 *   azimuth_to: 305                          #   inside it the automation shades fully, even with a low sun
 *   azimuth_high_from: 215                   # optional: a narrower range once the sun stands above azimuth_high_above °
 *   azimuth_high_above: 20
 *   horizon: 4                               # the real horizon (°): below it the sun counts as set
 *   show_compass: true
 *   show_details: true
 *   size: 124                                # the compass (px)
 *   layout: side                             # side: the text beside the compass; below: under it
 *   labels: { open: Bez stínění, max: Silné stínění }   # the shading states in words
 *
 * The light ring marks the levels' thresholds when the shading sensor has them as an
 * attribute (`thresholds_attribute`, lux per level).
 */
interface SunShadingConfig extends PartConfig {
  sun?: string;
  light?: string;
  shading?: string;
  target_tilt?: string;
  azimuth_from?: number;
  azimuth_to?: number;
  azimuth_high_from?: number;
  azimuth_high_to?: number;
  azimuth_high_above?: number;
  horizon?: number;
  show_compass?: boolean;
  show_details?: boolean;
  size?: number;
  layout?: "side" | "below";
  labels?: Record<string, string>;
  thresholds_attribute?: string;
  /** the shading azimuth on the compass (and "on the windows"); default orange */
  band_color?: string;
  /** the light ring; default amber */
  light_color?: string;
  /** the compass's face: watch (glass face, glare – default) or a material (none: only its rim) */
  compass_glass?: "watch" | Material;
  /** icon: the realistic sun of the weather icons · dot: a plain dot (sun_color) */
  sun_style?: "icon" | "dot";
  sun_color?: string;
  show_letters?: boolean;
  show_ticks?: boolean;
  /** the light ring's width (of 100 – the compass's own scale) */
  ring_width?: number;
}

const SHADE: Record<string, string> = {
  open: "No shading",
  min: "Light shading",
  mid: "Medium shading",
  medium: "Medium shading",
  max: "Strong shading",
};

class GlassSunShading extends GlassElement<SunShadingConfig> {
  static override wrapTile = true;
  static override parts = AUTOMATION_PARTS;
  static getConfigElement() {
    return makeEditor(sunShadingSpec);
  }

  static getStubConfig() {
    return { sun: "sun.sun", azimuth_from: 135, azimuth_to: 225 };
  }

  protected watchedEntities(c: SunShadingConfig) {
    return [c.sun ?? "sun.sun", c.light ?? "", c.shading ?? "", c.target_tilt ?? ""];
  }

  /** The shading azimuth for this height of the sun: [from, to] in degrees. */
  private _band(el: number): [number, number] | undefined {
    const c = this._config;
    const lo: [number, number] | undefined = c.azimuth_from !== undefined && c.azimuth_to !== undefined ? [c.azimuth_from, c.azimuth_to] : undefined;
    const hf = c.azimuth_high_from;
    const ht = c.azimuth_high_to;
    const hi: [number, number] | undefined = hf !== undefined || ht !== undefined ? [hf ?? lo?.[0] ?? 0, ht ?? lo?.[1] ?? 0] : undefined;
    return hi && el >= (c.azimuth_high_above ?? 20) ? hi : lo;
  }

  protected override render() {
    const c = this._config;
    const hass = this._hass;
    if (!c || !hass) return nothing;
    const st = (id?: string) => (id ? hass.states[id] : undefined);
    const sun = st(c.sun ?? "sun.sun");
    const light = st(c.light);
    const shade = st(c.shading)?.state;
    const word = (s: string) => c.labels?.[s] ?? (SHADE[s] ? tr(SHADE[s]) : s);
    const tt = st(c.target_tilt)?.state;
    const tilt = shade !== "open" && tt && !Number.isNaN(parseFloat(tt)) ? Math.round(parseFloat(tt)) : undefined;
    const el = Number(sun?.attributes.elevation);
    const az = Number(sun?.attributes.azimuth);
    const known = Number.isFinite(el) && Number.isFinite(az);
    const up = known && el > (c.horizon ?? 0);
    const band = known ? this._band(el) : undefined;
    const inBand = !!band && up && (az - band[0] + 360) % 360 <= (band[1] - band[0] + 360) % 360;
    const lx = light ? parseFloat(light.state) : NaN;
    const thresholds = st(c.shading)?.attributes[c.thresholds_attribute ?? "prahy_lux"] as Record<string, number> | undefined;
    const fmt = (v: number) => Math.round(v).toLocaleString(locale());
    const compass = c.show_compass !== false && known;
    const details = c.show_details !== false;
    return html`<div class=${frameClass(c)}>
      ${c.show_title === false ? nothing : html`<span class="gtitle">${c.title ?? (tr("Current state"))}</span>`}
      <div class="sky ${c.layout === "below" ? "below" : ""}" style="--size:${c.size ?? 124}px;--band:${cssColor(c.band_color ?? "orange") ?? "transparent"};--lux:${cssColor(c.light_color ?? "amber") ?? "transparent"}">
        ${compass ? this._dial(el, az, up, band, inBand, Number.isFinite(lx) ? lx : undefined, thresholds) : nothing}
        ${details
          ? html`<div class="skytext">
              ${shade ? html`<span class="dec">${word(shade)}</span>` : nothing}
              ${tilt !== undefined ? html`<span class="v2">${tr("target tilt")} ${tilt} %</span>` : nothing}
              ${known
                ? html`<span class="v2 gap">${tr("Sun")} ${up ? `${Math.round(el)}°` : tr("below horizon")} · ${Math.round(az)}°</span>`
                : nothing}
              ${inBand
                ? shade && shade !== "open"
                  ? html`<span class="v2 hot">${tr("on the windows")}</span>`
                  : html`<span class="v2">${tr("in the shading azimuth · weak light")}</span>`
                : nothing}
              ${Number.isFinite(lx) ? html`<span class="v2">${tr("Illuminance")} ${fmt(lx)} ${light!.attributes.unit_of_measurement ?? "lx"}</span>` : nothing}
            </div>`
          : nothing}
      </div>
    </div>`;
  }

  private _dial(el: number, az: number, up: boolean, band: [number, number] | undefined, inBand: boolean, lx: number | undefined, levels: Record<string, number> | undefined) {
    const C = 50;
    const R = 40;
    const pt = (deg: number, r: number) => {
      const a = ((deg - 90) * Math.PI) / 180;
      return [C + Math.cos(a) * r, C + Math.sin(a) * r];
    };
    const sr = R * (1 - Math.min(90, Math.max(0, el)) / 90);
    const [sx, sy] = pt(az, sr);
    let wedge = "";
    if (band) {
      const [a0, a1] = band;
      const [x0, y0] = pt(a0, R);
      const [x1, y1] = pt(a1, R);
      const large = (((a1 - a0) % 360) + 360) % 360 > 180 ? 1 : 0;
      wedge = `M${C},${C} L${x0},${y0} A${R},${R} 0 ${large} 1 ${x1},${y1} Z`;
    }
    // square-root scale to 100 klx: dusk barely shows, an overcast day ~ a third, full sun the whole ring
    const scale = (v: number) => Math.min(100, Math.sqrt(Math.max(0, v) / 100000) * 100);
    const lxPct = lx !== undefined ? scale(lx) : undefined;
    const c = this._config;
    const style = c.compass_glass ?? "watch";
    const rw = Math.min(14, Math.max(2, c.ring_width ?? 9));
    const dot = c.sun_style === "dot";
    const ticks =
      lxPct !== undefined && levels && typeof levels === "object"
        ? Object.entries(levels)
            .filter(([, v]) => Number.isFinite(Number(v)))
            .map(([k, v]) => ({ k, pct: scale(Number(v)), hit: lx! >= Number(v) }))
        : [];
    // a material's face: a round element behind the drawing (the backdrop blur needs one)
    const faceR = lxPct !== undefined ? R - rw / 2 : R;
    return html`<div class="dialwrap ${style === "watch" ? "watch" : "mat"} ${style === "none" ? "outline" : ""}" style="--rw:${rw};--fd:${faceR * 2};--sun:${cssColor(c.sun_color ?? "yellow") ?? "transparent"}">
      ${style !== "watch" && style !== "none" ? html`<div class="face mat-${style}"></div>` : nothing}
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          <radialGradient id="bk-face" cx="50%" cy="30%" r="75%">
            <stop offset="0" stop-color="#fff" stop-opacity="0.1"></stop>
            <stop offset="1" stop-color="#fff" stop-opacity="0.015"></stop>
          </radialGradient>
          <linearGradient id="bk-glass" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#fff" stop-opacity="0.2"></stop>
            <stop offset="1" stop-color="#fff" stop-opacity="0"></stop>
          </linearGradient>
          <clipPath id="bk-in"><circle cx=${C} cy=${C} r=${R - rw / 2}></circle></clipPath>
        </defs>
        <circle class="dial ${lxPct !== undefined ? "ringed" : ""}" cx=${C} cy=${C} r=${lxPct !== undefined ? R - rw / 2 : R}></circle>
        ${wedge ? svg`<path class="band ${inBand ? "lit" : ""}" d=${wedge} clip-path="url(#bk-in)"></path>` : nothing}
        ${(c.show_ticks === false ? [] : Array.from({ length: 12 }, (_, i) => i * 30))
          .filter((d) => d % 90)
          .map((d) => {
            const [x0, y0] = pt(d, R - 11);
            const [x1, y1] = pt(d, R - 8);
            return svg`<line class="tick" x1=${x0} y1=${y0} x2=${x1} y2=${y1}></line>`;
          })}
        ${(c.show_letters === false ? [] : ["N", "E", "S", "W"]).map((n, i) => {
          const [x, y] = pt(i * 90, R - 14);
          return svg`<text x=${x} y=${y} dominant-baseline="central">${tr(`compass.${n}`)}</text>`;
        })}
        ${lxPct !== undefined
          ? svg`<circle class="lux-track" cx=${C} cy=${C} r=${R}></circle>
              <circle class="lux" cx=${C} cy=${C} r=${R} pathLength="100" stroke-dasharray="${lxPct} 100" transform="rotate(-90 ${C} ${C})"></circle>
              ${ticks.map(({ k, pct, hit }) => {
                const [x0, y0] = pt(pct * 3.6, R - 3);
                const [x1, y1] = pt(pct * 3.6, R + rw / 2);
                return svg`<line class="lvl ${hit ? "hit" : ""}" x1=${x0} y1=${y0} x2=${x1} y2=${y1}><title>${k}</title></line>`;
              })}`
          : nothing}
        ${style === "watch" ? svg`<ellipse class="glare" cx=${C - 6} cy=${C - R * 0.5} rx=${R * 0.78} ry=${R * 0.48} clip-path="url(#bk-in)"></ellipse>` : nothing}
        ${up && dot ? svg`<circle class="sundot" cx=${sx} cy=${sy} r="5"></circle>` : nothing}
      </svg>
      ${up && !dot ? html`${weather3dDefs}<span class="sun3d" style="left:${sx}%;top:${sy}%">${weatherIcon3d("sunny")}</span>` : nothing}
    </div>`;
  }

  static override styles = [
    weather3dStyles,
    GlassElement.styles,
    partStyles,
    css`
      .sky {
        display: flex;
        align-items: center;
        gap: 14px;
      }
      .sky.below {
        flex-direction: column;
        align-items: stretch;
      }
      .sky.below .dialwrap {
        align-self: center;
      }
      .dialwrap {
        position: relative;
        flex: none;
        width: var(--size, 124px);
        height: var(--size, 124px);
        margin: 4px;
      }
      .sun3d {
        position: absolute;
        z-index: 1;
        width: calc(var(--size, 124px) * 0.26);
        height: calc(var(--size, 124px) * 0.26);
        transform: translate(-50%, -50%);
        pointer-events: none;
      }
      .sky svg:not(.wi3d) {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: visible;
      }
      .sky .dial {
        fill: url(#bk-face);
        stroke: color-mix(in srgb, var(--g-text) 16%, transparent);
        stroke-width: 1;
      }
      .sky .dial.ringed {
        stroke: none;
      }
      /* a material's face: the element behind the drawing; the drawn face stays clear */
      .face {
        position: absolute;
        left: 50%;
        top: 50%;
        width: calc(var(--fd) * 1%);
        height: calc(var(--fd) * 1%);
        transform: translate(-50%, -50%);
        border-radius: 50%;
      }
      .mat .dial {
        fill: none;
        stroke: none;
      }
      .outline .dial {
        fill: none;
        stroke: color-mix(in srgb, var(--g-text) 22%, transparent);
      }
      .outline .dial.ringed {
        stroke: none;
      }
      .sky .sundot {
        fill: var(--sun);
        filter: drop-shadow(0 0 3px color-mix(in srgb, var(--sun) 70%, transparent));
      }
      /* the shading azimuth: faint in its colour, stronger while the sun is in it */
      .sky .band {
        fill: color-mix(in srgb, var(--band) 14%, transparent);
      }
      .sky .band.lit {
        fill: color-mix(in srgb, var(--band) 34%, transparent);
      }
      .sky text {
        fill: var(--g-text-2);
        font-size: 8px;
        font-weight: 600;
        text-anchor: middle;
      }
      .sky .tick {
        stroke: color-mix(in srgb, var(--g-text) 28%, transparent);
        stroke-width: 1;
        stroke-linecap: round;
      }
      .sky .glare {
        fill: url(#bk-glass);
        pointer-events: none;
      }
      .sky .lux-track,
      .sky .lux {
        fill: none;
        stroke-width: var(--rw, 9);
        stroke-linecap: round;
      }
      .sky .lvl {
        stroke: color-mix(in srgb, var(--g-text) 30%, transparent);
        stroke-width: 1;
      }
      .sky .lvl.hit {
        stroke: rgba(0, 0, 0, 0.25);
      }
      .sky .lux-track {
        stroke: color-mix(in srgb, var(--g-text) 7%, transparent);
      }
      .sky .lux {
        stroke: var(--lux);
        filter: drop-shadow(0 0 3px color-mix(in srgb, var(--lux) 55%, transparent)) drop-shadow(0 0 8px color-mix(in srgb, var(--lux) 25%, transparent));
        transition: stroke-dasharray 0.6s ease;
      }
      .skytext {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
        font-size: 13px;
      }
      .dec {
        font-size: 15px;
        font-weight: 600;
      }
      .skytext .v2 {
        color: var(--g-text-2);
        font-size: 12px;
        font-variant-numeric: tabular-nums;
      }
      .skytext .gap {
        margin-top: 6px;
      }
      .skytext .hot {
        color: var(--band);
      }
    `,
    materials,
  ];
}

registerCard("glass-sun-shading", GlassSunShading, {
  name: "Glass – sun and shading",
  description: "The sun over a compass with the windows' band, the light outside and the shading decision.",
});

/* ── glass-value-grid ─────────────────────────────────────────────────────── */

/**
 * Numbers in a table, − / + on each – e.g. the slats' tilt per season and level. Each
 * column is a "mode"; the current one is marked: by months (its own range, the rest of
 * the year the column without months) or by an entity's state (`active` + each column's
 * `state`). Month ranges held in input_numbers can be changed right on the card.
 *
 *   type: custom:glass-value-grid
 *   title: Náklon lamel
 *   columns:
 *     - name: Silné slunce
 *       icon: mdi:white-balance-sunny
 *       months_from: input_number.blinds_summer_from   # or from_month: 6 (fixed)
 *       months_to: input_number.blinds_summer_to       #    to_month: 11
 *     - name: Slabé slunce                             # no months: the rest of the year
 *       icon: mdi:weather-sunny-off
 *   rows:
 *     - name: Min
 *       entities: [input_number.blinds_summer_min, input_number.blinds_winter_min]
 *     - name: Střed
 *       entities: [input_number.blinds_summer_medium, input_number.blinds_winter_medium]
 *
 * Or by state:  active: sensor.blinds_season  and a column  state: summer
 */
interface GridColumn {
  name?: string;
  icon?: string;
  months_from?: string;
  months_to?: string;
  from_month?: number;
  to_month?: number;
  state?: string;
}
interface GridRow {
  name?: string;
  entities?: string[];
}
interface ValueGridConfig extends PartConfig {
  columns?: GridColumn[];
  rows?: GridRow[];
  active?: string;
  /** false: the months' − / + are not shown (the column is still chosen by them) */
  show_months?: boolean;
  unit?: string;
  /** the current column's cells and a value not sent yet; default the control glass / orange */
  active_color?: string;
  /** the fields' materials: the current column's (default Apple Home's dark glass) and the others' (default no blur) */
  current_glass?: Material;
  field_glass?: Material;
  /** a tint over the other fields */
  cell_color?: string;
}


class GlassValueGrid extends GlassElement<ValueGridConfig> {
  static override wrapTile = true;
  static override parts = AUTOMATION_PARTS;
  private _n = new Nudger({ requestUpdate: () => this.requestUpdate(), hass: () => this._hass });

  static getConfigElement() {
    return makeEditor(valueGridSpec);
  }

  static getStubConfig() {
    return { title: "", columns: [{ name: "A" }], rows: [{ name: "1", entities: [] }] };
  }

  protected watchedEntities(c: ValueGridConfig) {
    return [
      c.active ?? "",
      ...(c.columns ?? []).flatMap((x) => [x.months_from ?? "", x.months_to ?? ""]),
      ...(c.rows ?? []).flatMap((r) => r.entities ?? []),
    ];
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._n.stop();
  }

  /** A column's month range (1–12), from its input_numbers or fixed months. */
  private _range(col: GridColumn): [number, number] | undefined {
    const from = col.months_from ? this._n.value(col.months_from) : col.from_month;
    const to = col.months_to ? this._n.value(col.months_to) : col.to_month;
    return from !== undefined && to !== undefined ? [Math.round(from), Math.round(to)] : undefined;
  }

  /** The current column: by the `active` entity's state, else by months (a range over New Year works). */
  private _current(cols: GridColumn[]): number {
    const c = this._config;
    if (c.active) {
      const s = this._hass?.states[c.active]?.state;
      return cols.findIndex((x) => x.state !== undefined && String(x.state) === s);
    }
    const m = new Date().getMonth() + 1;
    const hit = cols.findIndex((x) => {
      const r = this._range(x);
      return r && (r[0] <= r[1] ? m >= r[0] && m <= r[1] : m >= r[0] || m <= r[1]);
    });
    return hit >= 0 ? hit : cols.findIndex((x) => !this._range(x));
  }

  protected override render() {
    const c = this._config;
    const hass = this._hass;
    if (!c || !hass) return nothing;
    const cols = c.columns ?? [];
    const rows = c.rows ?? [];
    const cur = this._current(cols);
    const monthName = (v: number | undefined) =>
      v !== undefined && v >= 1 && v <= 12 ? new Date(2000, v - 1, 1).toLocaleString(locale(), { month: "short" }) : "–";
    const stepper = (id: string, text: (v: number | undefined) => string, cls = "") => html`<div
      class="set ${cls} mat-${cls.includes("cur") ? (c.current_glass ?? "dark") : (c.field_glass ?? "flat")}"
      style=${cls.includes("cur") ? matTint(c.active_color) : matTint(c.cell_color, 40)}
    >
      <button aria-label="−" @click=${() => this._n.nudge(id, -1)}><ha-icon icon="mdi:minus"></ha-icon></button>
      <span class="sp ${this._n.pending.has(id) ? "pending" : ""}">${text(this._n.value(id))}</span>
      <button aria-label="+" @click=${() => this._n.nudge(id, 1)}><ha-icon icon="mdi:plus"></ha-icon></button>
    </div>`;
    // the month ranges one can change here: columns with both months in input_numbers
    const ranged = c.show_months === false ? [] : cols.filter((x) => x.months_from && x.months_to && hass.states[x.months_from] && hass.states[x.months_to]);
    const unit = c.unit ? ` ${c.unit}` : "";
    const ac = cssColor(c.active_color);
    return html`<div class=${frameClass(c)} style=${ac ? `--accent-c:${ac}` : ""}>
      ${ranged.map(
        (x) => html`<span class="gtitle">${x.name ?? ""}</span>
          <div class="months">
            ${stepper(x.months_from!, monthName, "wide")}<span class="dash">–</span>${stepper(x.months_to!, monthName, "wide")}
          </div>`,
      )}
      ${c.show_title === false || !c.title ? nothing : html`<span class="gtitle ${ranged.length ? "sep" : ""}">${c.title}</span>`}
      ${cols.length && rows.length
        ? html`<div class="grid" style="--cols:${cols.length}">
            <span></span>
            ${cols.map(
              (x, i) => html`<span class="head ${i === cur ? "cur" : ""}">${x.icon ? html`<ha-icon .icon=${x.icon}></ha-icon>` : nothing}${x.name ?? ""}</span>`,
            )}
            ${rows.map(
              (r) => html`<span class="lvl">${r.name ?? ""}</span>
                ${cols.map((_, i) => {
                  const id = r.entities?.[i];
                  return id && hass.states[id] ? stepper(id, (v) => (v === undefined ? "–" : `${Math.round(v)}${unit}`), i === cur ? "cur" : "") : html`<span></span>`;
                })}`,
            )}
          </div>`
        : html`<span class="hint">${tr("Add columns and rows in the card's settings.")}</span>`}
    </div>`;
  }

  static override styles = [
    GlassElement.styles,
    partStyles,
    css`
      .months {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .months .set {
        flex: 1;
      }
      .dash {
        color: var(--g-text-2);
      }
      .gtitle.sep {
        margin-top: 6px;
      }
      .grid {
        display: grid;
        grid-template-columns: auto repeat(var(--cols), minmax(0, 1fr));
        align-items: center;
        gap: 8px 10px;
      }
      .head {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        font-size: 13px;
        font-weight: 600;
        color: var(--g-text-2);
        text-align: center;
      }
      .head.cur {
        color: var(--g-text);
      }
      .lvl {
        font-size: 13px;
        font-weight: 500;
        color: var(--g-text-2);
      }
    `,
    materials,
  ];
}

registerCard("glass-value-grid", GlassValueGrid, {
  name: "Glass – value grid",
  description: "Numbers in a table with − / +, a column per mode (season); the current one marked by months or a state.",
});

