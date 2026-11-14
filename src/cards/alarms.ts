import { tr } from "../i18n";
import { css, html, nothing } from "lit";
import { GlassElement } from "../core/glass-element";
import { LiquidController } from "../core/liquid";
import type { BaseCardConfig, GlassMode, HomeAssistant } from "../core/types";
import { registerCard } from "../core/registry";
import { makeEditor } from "../editor/editor";
import { alarmsSpec } from "../editor/specs";
import { haptic } from "../core/actions";
import { surface } from "../core/styles";
import { cssColor } from "../core/colors";
import { materials, matTint, type Material } from "../core/materials";
import { ALARMS_PARTS } from "../core/card-parts";
import { isDark, language } from "../core/settings";
import { openAlarmEditor, readDraft, type Draft } from "../core/alarm-editor";
import type { SheetHandle } from "../core/sheet";
import {
  clockParts,
  dayName,
  createAlarm,
  defaultSound,
  deleteAlarm,
  calendarsOf,
  daysOff,
  managedAlarms,
  managedHelpers,
  managedNumber,
  nextRing,
  updateBlueprint,
  parseDays,
  repeatText,
  soundName,
  timeOf,
  uses12h,
  weekOrder,
  writeDays,
  WEEK,
  type AlarmHelpers,
  type Day,
  type NextRing,
} from "../core/alarm-model";

/**
 * Alarms in one list – several, each with its own time, days, speakers and sound: a switch on
 * each, a tap opens its settings (the name, time wheels, days, days off, where it rings,
 * what plays), + adds one.
 *
 *   type: custom:glass-alarms
 *   title: Budíky
 *   skip_calendars:                        # days off: these calendars' all-day events are skipped
 *     - calendar.czech_republic            #   (the Holiday integration's public holidays)
 *     - calendar.holidays                  #   (your own: a holiday, "no alarm"…)
 *   players: [media_player.kids, media_player.bedroom]   # offered speakers (default: all)
 *   sounds:                                # sounds offered beside the cards' own melody
 *     - { name: Radio, url: https://ice.radio.example/stream.mp3 }
 *   list_glass: frosted                    # own materials (core/materials), *_color tints them:
 *   add_glass: dark                        #   the alarms' group, +, the switches, the modal
 *   sheet_glass: liquid                    #   (sheet_*) and its controls (controls_*)
 *
 * + (administrators) creates an alarm itself: its helpers (glass_alarm_<n>_…) and its
 * automation from the Glass alarm blueprint, which it saves into Home Assistant from the
 * bundle. Delete in its settings removes them again. The list shows every such alarm.
 */
interface AlarmsConfig extends BaseCardConfig {
  title?: string;
  /** days off: calendars whose all-day events the alarms skip – public holidays (the Holiday integration), your holidays… */
  skip_calendars?: string[];
  /** the speakers offered (default: every media player) */
  players?: string[];
  /** sounds offered beside the cards' own melody: { name, url } */
  sounds?: { name: string; url: string }[];
  /** the wheels' minutes: every 1 (default), 5, 10, 15 or 30 */
  minute_step?: number;
  /** an alarm on: its switch, the picked days, the buttons – default blue */
  active_color?: string;
  /** list: every alarm under each other (default); carousel: one at a time, the others a swipe away */
  layout?: "list" | "carousel";
  /** when the soonest alarm rings, above the list – "Alarm in 3 days" (default shown) */
  show_next?: boolean;
  /** the + button: its material (default a faint tint) and a tint over it */
  add_glass?: Material;
  add_color?: string;
  /** the alarms' group (the carousel too): its material and a tint over it */
  list_glass?: Material;
  list_color?: string;
  /** the switches: the track's material when off, and their colour when on (default active_color) */
  switch_glass?: Material;
  switch_color?: string;
  /** the days an alarm rings on, lit (default active_color) */
  days_color?: string;
  /** the settings' window: its glass, as a card's background (liquid – the real liquid glass, dark-liquid, frosted, light, flat, solid, home, none; default its own dark or light glass) and a tint over it */
  sheet_glass?: GlassMode;
  sheet_color?: string;
  /** the modal's controls – quick choices, days, fields, lists: their material and a tint */
  controls_glass?: Material;
  controls_color?: string;
}

const has = (v?: string) => !!v && v !== "none";
/** An element's own material (a colour alone tints the default one). */
export function matPart(m: Material | undefined, color: string | undefined, def: Material) {
  const use = m ?? (has(color) ? def : undefined);
  return use ? { cls: `mat mat-${use}`, style: matTint(has(color) ? color : undefined) } : undefined;
}

interface Row {
  a: AlarmHelpers & { created?: number };
  on: boolean;
  t: [number, number] | undefined;
  days: Set<Day> | undefined;
  next: NextRing | undefined;
  /** its next date, on or off – a once alarm shows it */
  date: Date | undefined;
  skipped?: string;
  /** it rings next on a day off, as on a weekend (its name) */
  dayOff?: string;
}

class GlassAlarms extends GlassElement<AlarmsConfig> {
  static override parts = ALARMS_PARTS;
  static getConfigElement() {
    return makeEditor(alarmsSpec);
  }

  static getStubConfig() {
    return { title: tr("Alarms") };
  }

  constructor() {
    super();
    // glass: liquid – the real liquid glass over the card (WebGL / SVG lens), as the other cards
    new LiquidController(this, ".frame");
  }

  private _sheet?: SheetHandle;
  private _tick?: number;
  private _busy = false;
  /** the switches flipped, until HA reports them */
  private _sent = new Map<string, boolean>();

  protected watchedEntities(c: AlarmsConfig) {
    return calendarsOf(c.skip_calendars);
  }

  /** The created alarms come and go: any glass_alarm_ helper changing redraws the list (every hass, before the base's check). */
  protected override forwardHass(hass: HomeAssistant) {
    const key = Object.keys(hass.states)
      .filter((id) => id.includes(".glass_alarm_"))
      .map((id) => `${id}=${hass.states[id].state}`)
      .join("|");
    if (key !== this._key) {
      this._key = key;
      this.requestUpdate();
    }
    this._sheet?.update();
    void updateBlueprint(hass);
  }
  private _key = "";

  override connectedCallback() {
    super.connectedCallback();
    this._tick = window.setInterval(() => this.requestUpdate(), 60000);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this._tick);
    this._sheet?.close();
  }

  /** Every alarm created in the cards (glass_alarm_<n>), in order. */
  private _alarms(): (AlarmHelpers & { created?: number })[] {
    return managedAlarms(this._hass).map((n) => ({ ...managedHelpers(n), created: n }));
  }

  private _on(a: AlarmHelpers) {
    if (!a.switch) return true;
    const real = this._hass?.states[a.switch]?.state === "on";
    const sent = this._sent.get(a.switch);
    if (sent === real) this._sent.delete(a.switch);
    return this._sent.get(a.switch) ?? real;
  }

  private _toggle(a: AlarmHelpers, e: Event) {
    e.stopPropagation();
    if (!a.switch) return;
    haptic("light");
    const on = !this._on(a);
    this._sent.set(a.switch, on);
    this._hass?.callService(a.switch.split(".")[0] === "switch" ? "switch" : "input_boolean", on ? "turn_on" : "turn_off", { entity_id: a.switch });
    this.requestUpdate();
  }

  private _name(a: AlarmHelpers): string {
    const n = a.name?.startsWith("input_text.") ? this._hass?.states[a.name]?.state : a.name;
    return n && n !== "unknown" ? n : "";
  }

  private _opts() {
    const c = this._config;
    return {
      dark: isDark(this._hass, this),
      accent: cssColor(c.active_color ?? "blue"),
      calendars: calendarsOf(c.skip_calendars),
      players: c.players,
      sounds: c.sounds,
      minuteStep: Number(c.minute_step) || 1,
      host: this as HTMLElement,
      sheetGlass: c.sheet_glass,
      sheetTint: c.sheet_color,
      controlsMat: matPart(c.controls_glass, c.controls_color, "flat"),
    };
  }

  private _edit(a: AlarmHelpers & { created?: number }) {
    const hass = this._hass;
    if (!hass) return;
    haptic("light");
    const n = a.created ?? managedNumber(a);
    this._sheet = openAlarmEditor({
      ...this._opts(),
      hass,
      helpers: a,
      title: this._name(a) || tr("Alarm"),
      full: true,
      onDelete: n !== undefined && hass.user?.is_admin ? () => deleteAlarm(hass, n) : undefined,
    });
  }

  /** + : a new alarm in the editor; Done creates its helpers and automation. */
  private _add() {
    const hass = this._hass;
    if (!hass || this._busy) return;
    haptic("light");
    const n = managedAlarms(hass).length + 1;
    this._sheet = openAlarmEditor({
      ...this._opts(),
      hass,
      helpers: { ...managedHelpers(0) },
      title: tr("New alarm"),
      full: true,
      draft: { name: tr("Alarm {n}", { n }), sound: defaultSound() },
      onSave: async (d: Draft) => {
        this._busy = true;
        try {
          await createAlarm(hass, {
            name: d.name,
            time: `${String(d.hours).padStart(2, "0")}:${String(d.minutes).padStart(2, "0")}:00`,
            days: writeDays(d.days),
            player: d.players.join(","),
            sound: d.sound || defaultSound(),
            skip: d.skip,
            calendars: calendarsOf(this._config.skip_calendars),
          });
        } finally {
          this._busy = false;
        }
      },
    });
  }

  /** The alarm ringing soonest of all that are on: when, in words – "Alarm in 3 days" – and its date and time. */
  private _soonest(rows: Row[]): { head: string; sub: string } {
    const hass = this._hass;
    const next = rows
      .map((r) => r.next)
      .filter((n): n is NonNullable<typeof n> => !!n)
      .sort((a, b) => a.at.getTime() - b.at.getTime())[0];
    if (!next) return { head: rows.length ? tr("All alarms off") : tr("No alarms yet"), sub: "" };
    const lang = language(hass);
    const ms = next.at.getTime() - Date.now();
    const min = Math.max(1, Math.round(ms / 60000));
    let when: string;
    if (min >= 24 * 60) when = new Intl.RelativeTimeFormat(lang, { numeric: "always" }).format(Math.round(ms / 86400000), "day");
    else if (min >= 60) when = tr("in {h} h {m} min", { h: Math.floor(min / 60), m: min % 60 });
    else when = new Intl.RelativeTimeFormat(lang, { numeric: "always" }).format(min, "minute");
    const sub = new Intl.DateTimeFormat(lang, { weekday: "short", day: "numeric", month: "numeric", hour: "numeric", minute: "2-digit", hour12: uses12h(hass) }).format(next.at);
    return { head: tr("Alarm {when}", { when }), sub };
  }

  protected override render() {
    const c = this._config;
    const hass = this._hass;
    if (!c || !hass) return nothing;
    const admin = !!hass.user?.is_admin;
    const hol = daysOff(hass, c.skip_calendars, () => this.requestUpdate());
    const rows: Row[] = this._alarms().map((a) => {
      const on = this._on(a);
      const t = timeOf(hass, a.entity);
      const days = a.days ? parseDays(hass.states[a.days]?.state) : new Set(WEEK);
      const skipping = !!hol && (!a.skip_holidays || hass.states[a.skip_holidays]?.state === "on");
      // the next ring as if it were on: a switched-off once alarm still shows its date
      const next = nextRing(t, true, days, skipping ? hol : undefined);
      return { a, on, t, days, next: on ? next : undefined, date: next?.at, skipped: on ? next?.skipped?.name : undefined, dayOff: on ? next?.dayOff : undefined };
    });
    const top = this._soonest(rows);
    const carousel = c.layout === "carousel" && rows.length > 1;
    const addMat = matPart(c.add_glass, c.add_color, "flat");
    const listMat = matPart(c.list_glass, c.list_color, "flat");
    const add = admin
      ? html`<button class="add ${addMat?.cls ?? ""}" style=${addMat?.style ?? ""} title=${tr("New alarm")} aria-label=${tr("New alarm")} @click=${() => this._add()}><ha-icon .icon=${"mdi:plus"}></ha-icon></button>`
      : nothing;
    const on = cssColor(c.active_color ?? "blue") ?? "transparent";
    const vars = `--c-on:${on};--c-sw:${(has(c.switch_color) && cssColor(c.switch_color)) || on};--c-days:${(has(c.days_color) && cssColor(c.days_color)) || on}`;
    return html`<div class="frame surface ${carousel ? "carousel" : ""}" style=${vars}>
      <div class="head">
        ${c.title ? html`<span class="title">${c.title}</span>` : html`<span class="title"></span>`}
        ${add}
      </div>
      ${c.show_next === false
        ? nothing
        : html`<div class="soon">
            <div class="soon-head">${top.head}</div>
            <!-- always there, empty or not: switching alarms off never changes the card's height -->
            <div class="soon-sub">${top.sub || "\u00a0"}</div>
          </div>`}
      ${rows.length
        ? carousel
          ? html`<div class="slides ${listMat?.cls ?? ""}" style=${listMat?.style ?? ""} @scroll=${(e: Event) => this._onSlide(e)}>${rows.map((r) => html`<div class="slide">${this._row(r)}</div>`)}</div>
              <div class="dots">${rows.map((_, i) => html`<i class=${i === this._slide ? "cur" : ""} @click=${() => this._goSlide(i)}></i>`)}</div>`
          : html`<div class="list ${listMat?.cls ?? ""}" style=${listMat?.style ?? ""}>${rows.map((r) => this._row(r))}</div>`
        : html`<div class="empty">
            <ha-icon .icon=${"mdi:alarm-plus"}></ha-icon>
            <span>${admin ? tr("Add an alarm with +") : tr("No alarms yet")}</span>
          </div>`}
    </div>`;
  }

  /** An alarm: its time big, under it the days (the picked ones lit) or its date, where it rings; the switch on the right. */
  private _row(r: Row) {
    const hass = this._hass!;
    const { a, on, t, days } = r;
    const clock = t ? clockParts(hass, t[0], t[1]) : { time: "--:--" };
    const name = this._name(a);
    const d = a.player || a.sound ? readDraft(hass, a) : undefined;
    const where = a.player ? (d!.players.length ? d!.players.map((id) => hass.states[id]?.attributes.friendly_name ?? id).join(", ") : tr("No speaker")) : "";
    const lang = language(hass);
    return html`<div class="alarm ${on ? "on" : ""} ${name ? "" : "noname"}" role="button" tabindex="0" @click=${() => this._edit(a)} @keydown=${(e: KeyboardEvent) => e.key === "Enter" && this._edit(a)}>
      <div class="txt">
        ${name ? html`<div class="aname">${name}</div>` : nothing}
        <div class="clock"><span class="time">${clock.time}</span>${clock.ap ? html`<span class="ap">${clock.ap}</span>` : nothing}</div>
        <div class="when">
          ${days
            ? html`<span class="week" aria-label=${repeatText(hass, days)}
                >${weekOrder(hass).map((x) => html`<b class=${days.has(x) ? "lit" : ""} title=${dayName(hass, x, "long")}>${dayName(hass, x, "narrow")}</b>`)}</span
              >`
            : html`<span class="date">${r.date ? new Intl.DateTimeFormat(lang, { weekday: "short", day: "numeric", month: "numeric" }).format(r.date) : tr("Once")}</span>`}
          ${r.skipped || r.dayOff
            ? html`<span class="skip" title=${r.skipped ? tr("{name} skipped", { name: r.skipped }) : tr("{name}: rings as on a weekend", { name: r.dayOff! })}><ha-icon .icon=${"mdi:calendar-star"}></ha-icon></span>`
            : nothing}
        </div>
        ${where
          ? html`<div class="where"><ha-icon .icon=${"mdi:speaker"}></ha-icon><span>${where}${a.sound ? ` · ${soundName(d!.sound)}` : ""}</span></div>`
          : nothing}
      </div>
      ${a.switch
        ? html`<button class="sw ${on ? "on" : ""} ${this._swMat?.cls ?? ""}" style=${this._swMat?.style ?? ""} role="switch" aria-checked=${on} aria-label=${on ? tr("Turn off") : tr("Turn on")} @click=${(e: Event) => this._toggle(a, e)}></button>`
        : nothing}
    </div>`;
  }

  private get _swMat() {
    return matPart(this._config.switch_glass, undefined, "flat");
  }

  /** The carousel: the alarm in view, by the scroll. */
  private _slide = 0;
  private _onSlide(e: Event) {
    const el = e.currentTarget as HTMLElement;
    const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
    if (i !== this._slide) {
      this._slide = i;
      this.requestUpdate();
    }
  }
  private _goSlide(i: number) {
    const el = this.renderRoot.querySelector<HTMLElement>(".slides");
    el?.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  }

  static override styles = [
    GlassElement.styles,
    surface,
    css`
      :host {
        display: block;
        min-width: 0;
        container: alarms / inline-size;
      }
      .frame {
        box-sizing: border-box;
        height: 100%;
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 14px;
        border-radius: var(--g-radius);
      }
      .head {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 36px;
        padding: 0 2px 0 6px;
        margin-bottom: -10px;
      }
      .title {
        flex: 1;
        min-width: 0;
        font-size: var(--glass-room-title-size, 15px);
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .add {
        flex: none;
        width: 36px;
        height: 36px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        display: grid;
        place-items: center;
        color: inherit;
        background: color-mix(in srgb, var(--g-text) 10%, transparent);
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        transition: transform 0.15s ease;
      }
      .add:active {
        transform: scale(0.9);
      }
      .add ha-icon {
        --mdc-icon-size: 22px;
        display: flex;
      }
      /* the soonest alarm: as a phone's clock app says it */
      .soon {
        text-align: center;
        padding: 0 8px 6px;
      }
      /* one line each, whatever they say: the card keeps its height when alarms go off */
      .soon-head,
      .soon-sub {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .soon-head {
        font-size: clamp(18px, 7cqi, 30px);
        font-weight: 600;
        line-height: 1.2;
      }
      .soon-sub {
        margin-top: 4px;
        font-size: 14px;
        line-height: 18px;
        height: 18px;
        font-weight: 500;
        color: var(--g-text-2);
      }
      /* the alarms: one group, hairlines between */
      .list {
        display: flex;
        flex-direction: column;
        border-radius: 22px;
        background: color-mix(in srgb, var(--g-text) 7%, transparent);
        overflow: hidden;
      }
      .list .alarm + .alarm::before {
        content: "";
        position: absolute;
        top: 0;
        left: 18px;
        right: 18px;
        height: 1px;
        background: color-mix(in srgb, var(--g-text) 10%, transparent);
      }
      .alarm {
        position: relative;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 16px 12px 18px;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        outline: none;
      }
      .alarm:active {
        background: color-mix(in srgb, var(--g-text) 5%, transparent);
      }
      .alarm:focus-visible {
        box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--c-on) 70%, transparent);
      }
      .txt {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .aname {
        font-size: 13px;
        font-weight: 600;
        color: var(--g-text-2);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .clock {
        display: flex;
        align-items: baseline;
        gap: 5px;
      }
      .time {
        font-size: var(--glass-alarm-time-size, clamp(24px, 13cqi, 46px));
        font-weight: 600;
        line-height: 1.05;
        letter-spacing: -0.5px;
        font-variant-numeric: tabular-nums;
      }
      .ap {
        font-size: 15px;
        font-weight: 600;
        color: var(--g-text-2);
      }
      .alarm:not(.on) .time,
      .alarm:not(.on) .ap {
        color: var(--g-text-2);
        opacity: 0.75;
      }
      .when {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        font-weight: 600;
        color: var(--g-text-2);
      }
      /* the days of the week: the ones it rings on in the alarm's colour */
      .week {
        display: flex;
        gap: 9px;
        letter-spacing: 0.5px;
      }
      .week b {
        font-weight: 600;
        opacity: 0.6;
      }
      .week b.lit {
        opacity: 1;
        font-weight: 800;
      }
      .alarm.on .week b.lit {
        color: var(--c-days);
      }
      .skip ha-icon {
        --mdc-icon-size: 15px;
        display: flex;
      }
      .where {
        display: flex;
        align-items: center;
        gap: 4px;
        min-width: 0;
        font-size: 12px;
        font-weight: 500;
        color: var(--g-text-2);
      }
      .where span {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .where ha-icon {
        --mdc-icon-size: 14px;
        display: flex;
        flex: none;
        /* the speaker glyph sits inset in its box: back to the line the name, time and days start on */
        margin-left: -3px;
      }
      .sw {
        position: relative;
        flex: none;
        width: 50px;
        height: 30px;
        padding: 0;
        border: 0;
        border-radius: 999px;
        background: color-mix(in srgb, var(--g-text) 18%, transparent);
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        transition: background 0.2s ease;
      }
      .sw::after {
        content: "";
        position: absolute;
        top: 3px;
        left: 3px;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
        transition: transform 0.2s ease;
      }
      .sw.on {
        background: var(--c-sw);
      }
      /* own materials: the shape stays */
      .add.mat,
      .sw.mat {
        border-radius: 999px;
      }
      .list.mat,
      .slides.mat {
        border-radius: 22px;
      }
      .sw.on::after {
        transform: translateX(20px);
      }
      /* layout: carousel – one alarm at a time, the others a swipe away */
      .slides {
        display: flex;
        overflow-x: auto;
        scroll-snap-type: x mandatory;
        scrollbar-width: none;
        overscroll-behavior-x: contain;
        border-radius: 22px;
        background: color-mix(in srgb, var(--g-text) 7%, transparent);
      }
      .slides::-webkit-scrollbar {
        display: none;
      }
      .slide {
        flex: 0 0 100%;
        min-width: 0;
        scroll-snap-align: start;
      }
      .dots {
        display: flex;
        justify-content: center;
        gap: 6px;
        margin-top: -2px;
      }
      .dots i {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: color-mix(in srgb, var(--g-text) 25%, transparent);
        cursor: pointer;
        transition: background 0.2s ease;
      }
      .dots i.cur {
        background: var(--g-text);
      }
      .empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        padding: 14px 8px 18px;
        font-size: 13px;
        font-weight: 500;
        color: var(--g-text-2);
        text-align: center;
      }
      .empty ha-icon {
        --mdc-icon-size: 32px;
      }
      /* a narrow tile: tighter days */
      /* a very narrow tile: the switch up in the corner beside the name, the time below gets the width */
      @container alarms (max-width: 230px) {
        .alarm .sw {
          position: absolute;
          top: 8px;
          right: 8px;
        }
        .alarm .aname {
          padding-right: 46px;
          line-height: 26px;
        }
        .alarm.noname .txt {
          padding-top: 28px;
        }
      }
      @container alarms (max-width: 260px) {
        .frame {
          padding: 10px;
        }
        .alarm {
          gap: 8px;
          padding: 10px 10px 10px 12px;
        }
        .week {
          gap: 4px;
          font-size: 11px;
        }
        .sw {
          width: 42px;
          height: 26px;
        }
        .sw::after {
          width: 20px;
          height: 20px;
        }
        .sw.on::after {
          transform: translateX(16px);
        }
        .soon-head {
          font-size: 18px;
        }
        .soon-sub {
          font-size: 12px;
        }
      }
    `,
    // last: an element's material wins over its rules above
    materials,
  ];
}

registerCard("glass-alarms", GlassAlarms, {
  name: "Glass – alarms",
  description: "Several alarms in one list: a switch on each, their time, days, speakers and sound in a modal; + creates an alarm (its helpers and automation).",
});
