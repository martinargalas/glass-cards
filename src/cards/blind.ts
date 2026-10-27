import { tr } from "../i18n";
import { css, html, nothing, svg } from "lit";
import { GlassElement } from "../core/glass-element";
import type { BaseCardConfig, HomeAssistant } from "../core/types";
import { registerCard } from "../core/registry";
import { makeEditor } from "../editor/editor";
import { blindSpec } from "../editor/specs";
import { haptic } from "../core/actions";
import { control, liquidBar, surface } from "../core/styles";
import { cssColor, tint } from "../core/colors";
import { SHEEN, materials, matTint, type Material } from "../core/materials";
import { BLIND_PARTS } from "../core/card-parts";

/**
 * A room's blind: position and tilt as bars – tap anywhere on a bar or drag it – with
 * quick choices under each (your own scripts or plain values), a stop button while it
 * moves and the pause of the room's automation with the time left as a ring.
 *
 *   type: custom:glass-blind
 *   entity: cover.office
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
 *   show_icon: false                          # no button on the position bar, the bar keeps its height
 *   bar_glass: frosted                        # own materials (core/materials), *_color tints them:
 *   slats_glass: flat                         #   the position bar, the slats bar, the drawer,
 *   tray_glass: flat                          #   the icon's button up / down (icon_glass / icon_on_glass)
 *   fill_style: solid                         # the bar's fill: fade | solid | glow | none, fill_strength %
 *
 * A choice is { name, icon?, script? | value? } – a script is run, a value (0–100) set.
 */
interface Choice {
  name?: string;
  icon?: string;
  script?: string;
  value?: number;
}

interface BlindConfig extends BaseCardConfig {
  entity: string;
  name?: string;
  icon?: string;
  pause?: string;
  pause_duration?: number;
  positions?: Choice[];
  tilts?: Choice[];
  /** the slats in the drawer: their bar and quick tilts, the bar only, or no drawer */
  slats?: "full" | "bar" | "none";
  /** the blind down (bar fill, icon); the pause ring – default orange */
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
  /** the blind's button on the position bar (default shown) */
  show_icon?: boolean;
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

const has = (v?: string) => !!v && v !== "none";
/** An element's own material (a colour alone tints the default one). */
function part(m: Material | undefined, color: string | undefined, def: Material) {
  const use = m ?? (has(color) ? def : undefined);
  return use ? { cls: `mat mat-${use}`, style: matTint(has(color) ? color : undefined) } : undefined;
}

/**
 * The blind as it hangs: a head rail, slats down to the position at their tilt; pulled up
 * it is only the packed stack under the rail.
 */
const blindGlyph = (pos: number) => {
  // seen from the front: the head rail, the slats as lines down to the position
  const bottom = 6 + ((100 - Math.min(100, Math.max(0, pos))) / 100) * 14;
  const ys: number[] = [];
  if (pos >= 99) ys.push(7, 9.5);
  else for (let y = 7.5; y <= bottom + 0.01; y += 3) ys.push(y);
  return svg`<svg class="glyph" viewBox="0 0 24 24" aria-hidden="true">
    <line x1="3.5" y1="4" x2="20.5" y2="4"></line>
    ${ys.map((y) => svg`<line class="thin" x1="5" y1=${y} x2="19" y2=${y}></line>`)}
  </svg>`;
};

/** Slats seen from the side at an angle (90° = shut, 0° = flat open): the tilt buttons' icon. */
const slats = (deg: number) => {
  const r = (deg * Math.PI) / 180;
  const dx = Math.cos(r) * 4.2;
  const dy = Math.sin(r) * 4.2;
  return svg`<svg class="glyph" viewBox="0 0 24 24" aria-hidden="true">
    ${[5, 10, 15, 20].map((y) => svg`<line x1=${12 - dx} y1=${y - dy} x2=${12 + dx} y2=${y + dy}></line>`)}
  </svg>`;
};

class GlassBlind extends GlassElement<BlindConfig> {
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

  private _value(bar: Bar): number | undefined {
    const st = this._hass?.states[this._config.entity];
    const v = Number(bar === "pos" ? st?.attributes.current_position : st?.attributes.current_tilt_position);
    return Number.isFinite(v) ? v : undefined;
  }

  private _choose(bar: Bar, c: Choice) {
    haptic("light");
    const id = this._config.entity;
    if (c.script) {
      this._hass?.callService("script", "turn_on", { entity_id: c.script });
      return;
    }
    if (c.value === undefined) return;
    this._sent.set(bar, { v: c.value, until: Date.now() + 90000 });
    if (bar === "pos") this._hass?.callService("cover", "set_cover_position", { entity_id: id, position: c.value });
    else this._hass?.callService("cover", "set_cover_tilt_position", { entity_id: id, tilt_position: c.value });
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
    // the position bar fills as far as the blind is down: its value is 100 − filled
    const pct = Math.round((bar === "pos" ? 1 - v : v) * 100);
    this._sent.set(bar, { v: pct, until: Date.now() + 90000 });
    haptic("light");
    const id = this._config.entity;
    if (bar === "pos") this._hass?.callService("cover", "set_cover_position", { entity_id: id, position: pct });
    else this._hass?.callService("cover", "set_cover_tilt_position", { entity_id: id, tilt_position: pct });
  }

  /** What a value shows now: dragged, sent (until the blind reports it) or reported. */
  private _shown(bar: Bar): number | undefined {
    const real = this._value(bar);
    const sent = this._sent.get(bar);
    if (sent && (Date.now() > sent.until || (real !== undefined && Math.abs(real - sent.v) <= 2))) this._sent.delete(bar);
    if (this._drag?.bar === bar) return Math.round((bar === "pos" ? 1 - this._drag.v : this._drag.v) * 100);
    return this._sent.get(bar)?.v ?? real;
  }

  protected override render() {
    const c = this._config;
    const hass = this._hass;
    if (!c || !hass) return nothing;
    const st = hass.states[c.entity];
    if (!st) return html`<div class="frame surface"><span class="name">${c.entity}?</span></div>`;
    const moving = st.state === "opening" || st.state === "closing";
    const onColor = c.active_color ?? "orange";
    const left = this._pauseLeft();
    const pos = this._shown("pos");
    const tilt = this._shown("tilt");
    const positions = c.positions ?? [
      { name: tr("Up"), icon: "mdi:chevron-up", value: 100 },
      { name: tr("Down"), icon: "mdi:chevron-down", value: 0 },
    ];
    const TILT_DEG = [78, 40, 0];
    const tilts = (
      c.tilts ?? [
        { name: tr("Close"), value: 0 },
        { name: tr("Half"), value: 50 },
        { name: tr("Open"), value: 100 },
      ]
    ).map((t, i, all) => ({ ...t, deg: TILT_DEG[Math.round((i / Math.max(1, all.length - 1)) * 2)] }));
    const posText = pos === undefined ? "–" : pos >= 99 ? tr("At the top") : pos <= 1 ? tr("At the bottom") : `${pos} %`;
    const R = 15;
    const C = 2 * Math.PI * R;
    const down = (pos ?? 100) < 99;
    // the tilt in words (Home Assistant: 100 = slats open, flat; 0 = shut); pulled up they're packed
    const tiltText =
      tilt === undefined
        ? "–"
        : !down && this._drag?.bar !== "tilt"
          ? "–"
          : tilt >= 90
            ? tr("Open")
            : tilt <= 10
              ? tr("Shut")
              : `${tr("Half open")} · ${tilt} %`;
    // up / down on the bar: the lights' quiet round mode buttons
    const modeBtn = (bar: Bar, ch: Choice) => html`<button class="mode mat-${c.positions_glass ?? "none"}" style=${matTint(c.choices_color)} title=${ch.name ?? ""} aria-label=${ch.name ?? ""} @click=${() => this._choose(bar, ch)}>
      <ha-icon .icon=${ch.icon ?? "mdi:circle-small"}></ha-icon>
    </button>`;
    const btn = (bar: Bar, ch: Choice & { deg?: number }) => {
      const real = this._value(bar);
      const cur = ch.value !== undefined && real !== undefined && Math.abs(real - ch.value) <= 2;
      return html`<button class="round side mat-${c.tilts_glass ?? "dark"} ${cur ? "cur" : ""}" style=${matTint(c.choices_color)} title=${ch.name ?? ""} aria-label=${ch.name ?? ""} @click=${() => this._choose(bar, ch)}>
        ${ch.deg !== undefined && !ch.icon ? slats(ch.deg) : html`<ha-icon .icon=${ch.icon ?? "mdi:circle-small"}></ha-icon>`}
      </button>`;
    };
    const bar = part(c.bar_glass, c.bar_color, "frosted");
    const slatsMat = part(c.slats_glass, c.slats_color, "flat");
    const tray = part(c.tray_glass, c.tray_color, "flat");
    const icon = this._icon(down, onColor);
    return html`<div class="frame surface" style="--c-on:${cssColor(onColor) ?? "transparent"};--fill:${has(c.fill_color) ? cssColor(c.fill_color) : "var(--c-on)"};--c-pause:${cssColor(c.pause_color ?? onColor) ?? "transparent"}">
      <div class="title">
        ${c.icon ? html`<ha-icon class="ricon" .icon=${c.icon}></ha-icon>` : nothing}
        <span class="tt">
          <span class="name">${c.name ?? st.attributes.friendly_name ?? c.entity}</span>
          <span class="sub narrow-only">${moving ? (st.state === "closing" ? (tr("Closing")) : tr("Opening")) : posText}</span>
        </span>
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
      </div>
      <div class="ctl">
        <div
          class="bar lbar ${bar ? bar.cls : "control"} ${c.show_icon === false ? "no-icon" : ""} ${this._drag?.bar === "pos" ? "drag" : ""} ${down ? "on" : ""} fill-${c.fill_style ?? "fade"}"
          style="${bar ? `${bar.style};` : ""}--pct:${100 - (pos ?? 100)};--fill-a:${c.fill_strength ?? 34}"
          role="slider"
          aria-label=${tr("Position")}
          aria-valuenow=${pos ?? 0}
          @pointerdown=${(e: PointerEvent) => this._slide("pos", e)}
          @pointermove=${(e: PointerEvent) => this._slide("pos", e)}
          @pointerup=${(e: PointerEvent) => this._slide("pos", e)}
          @pointercancel=${(e: PointerEvent) => this._slide("pos", e)}
        >
          <i class="fill"></i>
          ${c.show_icon === false
            ? nothing
            : html`<div class="btn ${icon.cls}" style=${icon.style}>
                ${moving
                  ? html`<span class="run ${st.state === "closing" ? "down" : "up"}">${blindGlyph(0)}</span>`
                  : blindGlyph(pos ?? 100)}
              </div>`}
          <span class="blabel"><span class="wide-only">${posText}</span><span class="narrow-only">${pos === undefined ? "–" : `${pos} %`}</span></span>
          <span class="btns" @pointerdown=${(e: Event) => e.stopPropagation()}>${positions.map((p) => modeBtn("pos", p))}</span>
        </div>
        ${c.slats === "none"
          ? nothing
          : html`<div class="tray ${tray ? tray.cls : ""}" style=${tray ? tray.style : ""}>
          <div
            class="bar thin ${slatsMat ? slatsMat.cls : ""} ${this._drag?.bar === "tilt" ? "drag" : ""} ${!down && this._drag?.bar !== "tilt" ? "idle" : ""} fill-${c.fill_style ?? "fade"}"
            style="${slatsMat ? `${slatsMat.style};` : ""}--pct:${tilt ?? 0};--fill-a:${c.fill_strength ?? 34}"
            role="slider"
            aria-label=${tr("Slats")}
            aria-valuenow=${tilt ?? 0}
            @pointerdown=${(e: PointerEvent) => this._slide("tilt", e)}
            @pointermove=${(e: PointerEvent) => this._slide("tilt", e)}
            @pointerup=${(e: PointerEvent) => this._slide("tilt", e)}
            @pointercancel=${(e: PointerEvent) => this._slide("tilt", e)}
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

  /** The button on the bar: own material / backing / symbol colours (icon_*), else the control glass lit while down. */
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
      /* up: nothing to fill (as a light that's off) */
      .bar.lbar:not(.on) .fill {
        opacity: 0;
      }
      .bar.drag .fill {
        transition: none;
      }
      /* no button: the bar keeps its height, the fill runs from the very edge */
      .bar.no-icon {
        min-height: var(--btn);
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
        color: var(--g-text-2);
        background: color-mix(in srgb, var(--g-text) 8%, transparent);
      }
      .glyph {
        width: 20px;
        height: 20px;
      }
      .glyph line {
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
      }
      .glyph line.thin {
        stroke-width: 1.6;
      }
      /* on its way: the slats unroll (down) or pack up (up) again and again */
      .run {
        display: grid;
        place-items: center;
      }
      .run .glyph {
        animation: blind-down 1.6s ease-in-out infinite;
      }
      .run.up .glyph {
        animation-direction: reverse;
      }
      @keyframes blind-down {
        0% {
          clip-path: inset(0 0 72% 0);
        }
        80%,
        100% {
          clip-path: inset(0 0 0 0);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .run .glyph {
          animation: none;
        }
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
  description: "A room's blind: position and tilt bars (tap or drag), quick choices, the automation's pause.",
});
