import { tr } from "../i18n";
import { css, html, nothing } from "lit";
import { GlassElement } from "../core/glass-element";
import { LiquidController } from "../core/liquid";
import type { BaseCardConfig, GlassMode, HomeAssistant } from "../core/types";
import { registerCard } from "../core/registry";
import { makeEditor } from "../editor/editor";
import { alarmSpec } from "../editor/specs";
import { haptic } from "../core/actions";
import { control, surface } from "../core/styles";
import { cssColor, tint } from "../core/colors";
import { SHEEN, materials, matTint, type Material } from "../core/materials";
import { ALARM_PARTS } from "../core/card-parts";
import { isDark } from "../core/settings";
import { openTimePicker } from "../core/time-picker";
import { openAlarmEditor } from "../core/alarm-editor";
import type { SheetHandle } from "../core/sheet";
import { calendarsOf, clockParts, daysOff, nextRing, nextText, parseDays, repeatText, timeOf, uses12h, WEEK, type Day } from "../core/alarm-model";

/**
 * An alarm clock: its time, on / off and the days it rings, kept in Home Assistant helpers –
 * the card shows and sets them, an automation rings it (the Glass alarm blueprint). Several
 * alarms in one list, created right there: glass-alarms.
 *
 *   type: custom:glass-alarm
 *   entity: input_datetime.kids_alarm            # the time (a time-only input_datetime)
 *   switch: input_boolean.kids_alarm             # on / off – the button with the bell
 *   days: input_text.kids_alarm_days             # the days it rings: mon,tue,wed,thu,fri | once
 *   skip_calendars: [calendar.czech_republic]    # days off: these calendars' all-day events
 *   skip_holidays: input_boolean.kids_alarm_holidays   # not on days off – on / off
 *   player: input_text.kids_alarm_player         # where it rings: media players, comma separated
 *   sound: input_text.kids_alarm_sound           # what plays: a sound's address
 *   name: Dětský pokoj
 *   minute_step: 5                               # the picker's minutes: 0, 5, 10…
 *
 * A tap on the time opens the picker (wheels; AM / PM where the language writes 12 hours –
 * English – or the HA profile says so), the bell turns it on / off, the bar below says when it
 * repeats; its button opens the alarm's settings in a modal – a sheet from the bottom on a
 * phone, a dialog on a tablet: Once, Weekdays, Every day, Weekends, the seven days (Monday
 * first in Europe), Not on days off, and where it rings and what plays when the alarm
 * has helpers for them. Under the time: when it rings next – days off skipped – or Off.
 *
 * The days helper (input_text) holds the days' short English names, comma separated
 * ("mon,tue,wed,thu,fri"), or "once": it rings the next time the clock gets there, then the
 * automation turns it off.
 */
interface AlarmConfig extends BaseCardConfig {
  entity: string;
  /** on / off: an input_boolean (or a switch) – the bell button turns it */
  switch?: string;
  /** the days it rings: an input_text the card writes ("mon,tue,wed,thu,fri", "once") */
  days?: string;
  /** days off: calendars whose all-day events it skips – public holidays (the Holiday integration), your holidays… */
  skip_calendars?: string[];
  /** skipping days off on / off: an input_boolean (none: always skipped when `skip_calendars` is set) */
  skip_holidays?: string;
  /** where it rings: an input_text with the media players (comma separated) – picked in the settings */
  player?: string;
  /** what plays: an input_text with the sound's address – picked in the settings */
  sound?: string;
  name?: string;
  icon?: string;
  /** when it rings next under the time (default shown) */
  show_next?: boolean;
  /** the bar with the days (default shown when `days` is set) */
  show_days?: boolean;
  /** the picker's minutes: every 1 (default), 5, 10, 15 or 30 */
  minute_step?: number;
  /** the alarm on: the bell, the picked days, the picker's button – default blue */
  active_color?: string;
  icon_glass?: Material;
  icon_on_glass?: Material;
  icon_background?: string;
  /** the bar with the days: its material and a tint over it */
  days_glass?: Material;
  days_color?: string;
  /** the round button on the bar that opens the settings: its material and a tint */
  button_glass?: Material;
  button_color?: string;
  /** the settings' and the time picker's window: its glass, as a card's background (liquid, dark-liquid, frosted, light, flat, solid, home, none; default its own dark or light glass) and a tint */
  sheet_glass?: GlassMode;
  sheet_color?: string;
  /** the window's controls – quick choices, days, fields, lists: their material and a tint */
  controls_glass?: Material;
  controls_color?: string;
}

const has = (v?: string) => !!v && v !== "none";
/** An element's own material (a colour alone tints the default one). */
function part(m: Material | undefined, color: string | undefined, def: Material) {
  const use = m ?? (has(color) ? def : undefined);
  return use ? { cls: `mat mat-${use}`, style: matTint(has(color) ? color : undefined) } : undefined;
}

class GlassAlarm extends GlassElement<AlarmConfig> {
  static override parts = ALARM_PARTS;
  static getConfigElement() {
    return makeEditor(alarmSpec);
  }

  static getStubConfig(hass: HomeAssistant) {
    const ids = Object.keys(hass.states);
    const time = ids.find((id) => id.startsWith("input_datetime.") && hass.states[id].attributes.has_time && !hass.states[id].attributes.has_date);
    return { entity: time ?? "" };
  }

  constructor() {
    super();
    // glass: liquid – the real liquid glass over the card (WebGL / SVG lens), as the other cards
    new LiquidController(this, ".frame");
  }

  /** Values sent, shown until HA reports them. */
  private _sent: { time?: string; on?: boolean } = {};
  private _tick?: number;
  private _sheet?: SheetHandle;

  protected override validateConfig(c: AlarmConfig) {
    if (!c.entity) throw new Error("Set `entity` (an input_datetime with the time)");
    return c;
  }

  protected watchedEntities(c: AlarmConfig) {
    return [c.entity, c.switch ?? "", c.days ?? "", c.skip_holidays ?? "", ...calendarsOf(c.skip_calendars), c.player ?? "", c.sound ?? ""];
  }

  override connectedCallback() {
    super.connectedCallback();
    // "today" becomes "tomorrow" as the clock passes the alarm
    this._tick = window.setInterval(() => this.requestUpdate(), 60000);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this._tick);
    this._sheet?.close();
  }

  /** The time set: [hours, minutes], the one sent until HA reports it. */
  private _time(): [number, number] | undefined {
    const real = this._hass?.states[this._config.entity]?.state;
    if (this._sent.time && real === this._sent.time) this._sent.time = undefined;
    const m = this._sent.time ? /^(\d{1,2}):(\d{2})/.exec(this._sent.time) : null;
    return m ? [Number(m[1]), Number(m[2])] : timeOf(this._hass, this._config.entity);
  }

  private _on(): boolean {
    const id = this._config.switch;
    if (!id) return true;
    const real = this._hass?.states[id]?.state === "on";
    if (this._sent.on === real) this._sent.on = undefined;
    return this._sent.on ?? real;
  }

  private _days(): Set<Day> | undefined {
    const id = this._config.days;
    return id ? parseDays(this._hass?.states[id]?.state) : new Set(WEEK);
  }

  /** Days off are skipped: calendars are set and the switch (if any) is on. */
  private _skipping(): boolean {
    const c = this._config;
    if (!calendarsOf(c.skip_calendars).length) return false;
    return !c.skip_holidays || this._hass?.states[c.skip_holidays]?.state === "on";
  }

  private _toggle() {
    const id = this._config.switch;
    if (!id) return;
    haptic("light");
    this._sent.on = !this._on();
    this._hass?.callService(id.split(".")[0] === "switch" ? "switch" : "input_boolean", this._sent.on ? "turn_on" : "turn_off", { entity_id: id });
    this.requestUpdate();
  }

  private _accent() {
    return cssColor(this._config.active_color ?? "blue");
  }

  private _pick() {
    const hass = this._hass;
    const t = this._time() ?? [7, 0];
    if (!hass) return;
    haptic("light");
    openTimePicker({
      hours: t[0],
      minutes: t[1],
      hour12: uses12h(hass),
      step: Number(this._config.minute_step) || 1,
      title: this._config.name ?? tr("Alarm"),
      dark: isDark(hass, this),
      accent: this._accent(),
      host: this,
      glass: this._config.sheet_glass,
      tint: this._config.sheet_color,
      onSet: (h, m) => {
        const time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
        this._sent.time = time;
        hass.callService("input_datetime", "set_datetime", { entity_id: this._config.entity, time });
        // a new time: the alarm is meant to ring – on, as a phone's alarm
        if (this._config.switch && !this._on()) this._toggle();
        this.requestUpdate();
      },
    });
  }

  /** The alarm's settings: its days, holidays, player and sound in a modal. */
  private _settings() {
    const hass = this._hass;
    const c = this._config;
    if (!hass) return;
    haptic("light");
    this._sheet = openAlarmEditor({
      hass,
      helpers: { entity: c.entity, switch: c.switch, days: c.days, skip_holidays: c.skip_holidays, player: c.player, sound: c.sound },
      title: c.name ?? tr("Alarm"),
      dark: isDark(hass, this),
      accent: this._accent(),
      calendars: calendarsOf(c.skip_calendars),
      minuteStep: Number(c.minute_step) || 1,
      host: this,
      sheetGlass: c.sheet_glass,
      sheetTint: c.sheet_color,
      controlsMat: part(c.controls_glass, c.controls_color, "flat"),
    });
  }

  protected override render() {
    const c = this._config;
    const hass = this._hass;
    if (!c || !hass) return nothing;
    const st = hass.states[c.entity];
    if (!st) return html`<div class="frame surface"><span class="name">${c.entity}?</span></div>`;
    const on = this._on();
    const t = this._time();
    const clock = t ? clockParts(hass, t[0], t[1]) : { time: "--:--" };
    const days = this._days();
    const color = c.active_color ?? "blue";
    const icon = this._icon(on, color);
    const skipping = this._skipping();
    const showDays = !!c.days && c.show_days !== false;
    const hol = skipping ? daysOff(hass, c.skip_calendars, () => this.requestUpdate()) : undefined;
    const next = c.show_next === false ? undefined : nextText(hass, nextRing(t, on, days, hol), on, skipping);
    const bar = part(c.days_glass, c.days_color, "frosted");
    const btn = part(c.button_glass, c.button_color, "flat");
    return html`<div class="frame surface ${on ? "on" : ""}" style="--c-on:${cssColor(color) ?? "transparent"}">
      ${c.name ? html`<div class="name">${c.name}</div>` : nothing}
      <div class="main">
        <div
          class="btn ${icon.cls} ${c.switch ? "tap" : ""}"
          style=${icon.style}
          role=${c.switch ? "switch" : nothing}
          aria-checked=${c.switch ? String(on) : nothing}
          tabindex=${c.switch ? "0" : nothing}
          title=${c.switch ? (on ? tr("Turn off") : tr("Turn on")) : nothing}
          @click=${() => this._toggle()}
          @keydown=${(e: KeyboardEvent) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), this._toggle())}
        >
          <ha-icon .icon=${c.icon ?? (on ? "mdi:alarm" : "mdi:alarm-off")}></ha-icon>
        </div>
        <button class="clock" title=${tr("Set the time")} @click=${() => this._pick()}>
          <span class="time">${clock.time}</span>${clock.ap ? html`<span class="ap">${clock.ap}</span>` : nothing}
        </button>
      </div>
      ${next !== undefined
        ? html`<div class="next">${next.when}</div>
            ${calendarsOf(c.skip_calendars).length
              ? // with calendars set, the line for a day off is always there (hidden when there's none): turning the alarm off or a day off passing never changes the card's height
                html`<div class="next skip ${next.skipped ? "" : "empty"}" title=${next.skipped ?? ""}>
                  <ha-icon .icon=${"mdi:calendar-star"}></ha-icon><span>${next.skipped ?? "\u00a0"}</span>
                </div>`
              : nothing}`
        : nothing}
      ${showDays
        ? html`<button class="dbar ${bar ? bar.cls : "control"}" style=${bar ? bar.style : ""} aria-haspopup="dialog" title=${tr("Alarm settings")} @click=${() => this._settings()}>
            <span class="dlabel">${repeatText(hass, days)}${skipping && c.skip_holidays ? html`<span class="hol"> · ${tr("not on days off")}</span>` : nothing}</span>
            <span class="chev ${btn?.cls ?? ""}" style=${btn?.style ?? ""}><ha-icon .icon=${"mdi:dots-horizontal"}></ha-icon></span>
          </button>`
        : nothing}
    </div>`;
  }

  /** The bell: own material / backing / symbol colours (icon_*), else the control glass lit while on. */
  private _icon(on: boolean, color: string) {
    const c = this._config;
    const fill = on ? tint(color) : undefined;
    const accent = cssColor(color);
    const ownBg = !!c.icon_background;
    const lit = !!fill && !ownBg;
    const onColor = c.icons?.icon_on?.color;
    const offColor = c.icons?.icon?.color;
    const sym = on ? (has(onColor) ? cssColor(onColor) : ownBg ? accent : undefined) : has(offColor) ? cssColor(offColor) : undefined;
    const bg = c.icon_background === "none" ? "transparent" : ownBg ? tint(c.icon_background) : undefined;
    const m = on ? c.icon_on_glass : c.icon_glass;
    if (m)
      return {
        cls: `mat mat-${m} ${lit ? "lit" : ""} ${on ? "glow" : ""}`,
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
    css`
      :host {
        display: block;
        min-width: 0;
        container: alarm / inline-size;
      }
      .frame {
        /* the bell and the clock grow with the card */
        --btn: clamp(40px, 15cqi, 56px);
        box-sizing: border-box;
        height: 100%;
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 16px 14px 14px;
        border-radius: var(--g-radius);
      }
      .name {
        font-size: var(--glass-room-title-size, 15px);
        font-weight: 600;
        padding: 0 4px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .main {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 0 4px;
      }
      .btn {
        flex: none;
        width: var(--btn);
        height: var(--btn);
        border-radius: 50%;
        display: grid;
        place-items: center;
      }
      .btn ha-icon {
        --mdc-icon-size: calc(var(--btn) * 0.54);
        display: flex;
      }
      .btn.tap {
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        transition: transform 0.15s ease;
      }
      .btn.tap:active {
        transform: scale(0.9);
      }
      .btn.mat {
        border-radius: 50%;
      }
      .btn.mat.glow {
        overflow: visible;
        box-shadow:
          0 0 10px 1px color-mix(in srgb, var(--glow) 55%, transparent),
          0 0 22px 5px color-mix(in srgb, var(--glow) 25%, transparent);
      }
      .btn.mat.lit {
        color: #fff;
      }
      :host([control-glass]) .btn.control.own-bg {
        background: var(--sheen, linear-gradient(transparent, transparent)), linear-gradient(var(--bg), var(--bg)) !important;
      }
      :host([control-glass]) .btn.control.own-bg::before {
        display: none;
      }
      :host([control-glass]) .btn.control.own-fg {
        color: var(--fg) !important;
      }
      /* the time: big, a tap opens the picker */
      .clock {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: baseline;
        justify-content: center;
        gap: 6px;
        padding: 0;
        border: 0;
        background: none;
        color: inherit;
        font: inherit;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        transition: transform 0.15s ease;
      }
      .clock:active {
        transform: scale(0.97);
      }
      .time {
        font-size: var(--glass-alarm-time-size, clamp(30px, 17cqi, 56px));
        font-weight: 500;
        line-height: 1;
        letter-spacing: -0.5px;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .ap {
        font-size: 18px;
        font-weight: 600;
        color: var(--g-text-2);
      }
      .frame:not(.on) .time {
        color: var(--g-text-2);
      }
      .next {
        text-align: center;
        line-height: 18px;
        height: 18px;
        font-size: 13px;
        font-weight: 500;
        color: var(--g-text-2);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-top: -4px;
      }
      .next.skip {
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 4px;
        margin-top: -8px;
        font-size: 12px;
      }
      .next.skip span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .next.skip ha-icon {
        --mdc-icon-size: 14px;
        display: flex;
        flex: none;
      }
      .next.skip.empty {
        visibility: hidden;
      }
      .ctl {
        display: flex;
        flex-direction: column;
      }
      /* the days: a pill that says how it repeats, the chevron opens the drawer under it */
      .dbar {
        position: relative;
        z-index: 1;
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 52px;
        padding: 4px 4px 4px 18px;
        border: 0;
        border-radius: 999px;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }
      .dbar.mat,
      .chev.mat {
        border-radius: 999px;
      }
      .dlabel {
        flex: 1;
        min-width: 0;
        font-size: 14px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .hol {
        font-weight: 500;
        color: var(--g-text-2);
      }
      .chev {
        flex: none;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        background: color-mix(in srgb, var(--g-text) 10%, transparent);
      }
      .chev ha-icon {
        --mdc-icon-size: 22px;
        display: flex;
      }
      .dbar:active .chev {
        transform: scale(0.92);
      }
      .chev {
        transition: transform 0.15s ease;
      }
      /* a narrow tile: the bell over the clock, both centred */
      @container alarm (max-width: 220px) {
        .frame {
          --btn: 40px;
          padding: 12px 10px;
          gap: 8px;
        }
        .main {
          flex-direction: column;
          gap: 6px;
        }
        .name {
          text-align: center;
        }
        .time {
          font-size: var(--glass-alarm-time-size, clamp(24px, 20cqi, 40px));
        }
        .ap {
          font-size: 13px;
        }
        .next {
          margin-top: 0;
          font-size: 12px;
        }
        .dbar {
          min-height: 40px;
          padding-left: 12px;
        }
        .chev {
          width: 32px;
          height: 32px;
        }
        .dlabel {
          font-size: 13px;
        }
        .hol {
          display: none;
        }
      }
    `,
    // last: an element's material wins over its rules above
    materials,
  ];
}

registerCard("glass-alarm", GlassAlarm, {
  name: "Glass – alarm clock",
  description: "An alarm clock: the time with its own picker (12 / 24 h), on / off, the days it rings, days off skipped. Rung by the Glass alarm blueprint.",
});
