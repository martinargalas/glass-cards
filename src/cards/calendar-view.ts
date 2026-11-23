import { tr } from "../i18n";
import { css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { GlassElement } from "../core/glass-element";
import type { BaseCardConfig, HomeAssistant } from "../core/types";
import { registerCard } from "../core/registry";
import { makeEditor } from "../editor/editor";
import { calendarViewSpec } from "../editor/specs";
import { CALENDAR_VIEW_PARTS } from "../core/card-parts";
import { cssColor } from "../core/colors";
import { hour12, isDark, language } from "../core/settings";
import { haptic } from "../core/actions";
import { materials, type Material } from "../core/materials";
import { wallpaperUrl } from "../core/liquid-gl";
import { WEEK, WEEKENDS, weekOrder } from "../core/alarm-model";
import { matPart } from "./alarms";
import { layerFor } from "../core/overlay";
import "../core/time-picker";

/**
 * The calendars in full: a month, a week, a day or the agenda, on a photo of the month under
 * liquid glass. Opens from the Calendar card (a tap on it), or sits in a pop-up / a view of its own.
 *
 *   type: custom:glass-calendar-view
 *   calendars:                # default: every calendar of Home Assistant
 *     - { entity: calendar.family, color: blue }
 *     - calendar.work
 *   days_off: [calendar.czech_holidays]  # their all-day events tint the day instead (holidays)
 *   view: month               # what it starts with (default: month; a phone: agenda)
 *   views: [month, week, day, agenda]    # what can be picked on a wide screen
 *   phone_views: [day, agenda]           # … on a phone
 *   image: months             # months (default): a photo for each month; or one picture for all:
 *                             #   glass:hills-day (a wallpaper of the cards), /local/x.jpg, https://…
 *   images: { 12: /local/xmas.jpg }      # a picture of your own for a month (1–12)
 *   hemisphere: auto          # auto (Home Assistant's location) | north | south – which photos
 *                             #   fit the season: July is summer in Prague, winter in Sydney
 *   agenda_days: 30
 *   panel_glass: …            # the calendar's own glass (default frosted CSS glass; liquid-gl if you want it)
 *   controls_glass: liquid-gl # the buttons not picked (views, calendars, ‹ ›); the picked one is dark
 */

type View = "month" | "week" | "day" | "agenda";
interface Src {
  entity: string;
  name?: string;
  color?: string;
}
interface ViewConfig extends BaseCardConfig {
  /** the calendars: an entity or { entity, name, color } (default: every calendar of Home Assistant) */
  calendars?: (Src | string)[];
  /** calendars whose all-day events tint their day instead of showing as events – public holidays, your vacation */
  days_off?: string[];
  /** what it starts with: month, week, day or agenda (default month; a phone: day) */
  view?: View;
  /** the views offered on a wide screen (default month, week, day, agenda) */
  views?: View[];
  /** the views offered on a phone (default day, agenda) */
  phone_views?: View[];
  /** months (default): a photo for each month; one picture for all – glass:hills-day (a wallpaper of the cards); custom: image_url */
  image?: string;
  /** image: custom – a picture of your own for every month: /local/x.jpg, https://… */
  image_url?: string;
  /** a picture of your own for a month: { 12: /local/xmas.jpg } */
  images?: Record<string, string>;
  /** which photos fit the season: auto (Home Assistant's location, default), north or south */
  hemisphere?: "auto" | "north" | "south";
  /** weekends: tint (default) – a shade on Saturday and Sunday; plain; hide – the week and the month without them */
  weekends?: "tint" | "plain" | "hide";
  /** the agenda: how many days ahead (default 30) */
  agenda_days?: number;
  /** the card's height on a dashboard (default 640px) */
  height?: string;
  /** the calendar's own glass over the photo (default light frosted glass, dark in dark mode – no WebGL) */
  panel_glass?: Material;
  panel_color?: string;
  /** the switches' track – views, calendars, ‹ Today › (default liquid-gl; dark-liquid-gl in dark mode); the picked item is a solid pill in it */
  controls_glass?: Material;
  controls_color?: string;
  /** the picked item in the switches (default dark grey by day, sunk in at night) */
  picked_color?: string;
  /** an event's detail and the event form (default as the panel) */
  sheet_glass?: Material;
  sheet_color?: string;
  /** today and the time now: the date's circle, the line (default red) */
  today_color?: string;
  /** in a Bubble Card pop-up: a close button (✕) that closes the pop-up (default true) */
  close?: boolean;
  /** internal: the copy over the page (opened from the Calendar card) */
  overlay?: boolean;
}

interface ApiEvent {
  summary: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  location?: string;
  description?: string;
  uid?: string;
  recurrence_id?: string;
  rrule?: string;
}
interface Ev {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location?: string;
  description?: string;
  repeats: boolean;
  cal: number;
  /** what a change or a delete names it by (none: the calendar can't) */
  uid?: string;
  recurrenceId?: string;
  rrule?: string;
}
/** the event form: a new event, or one being changed */
interface Form {
  ev?: Ev;
  cal: string;
  title: string;
  allDay: boolean;
  /** start and end: a date (YYYY-MM-DD) and a time (HH:MM); an all-day event's end is its last day */
  sd: string;
  st: string;
  ed: string;
  et: string;
  location: string;
  description: string;
  rrule: string;
  /** a repeating event changed: this one only, or this one and the ones after it */
  scope: "one" | "future";
  busy?: boolean;
  error?: string;
  /** the picker open under its row: a date's month or a time's wheels */
  open?: "sd" | "st" | "ed" | "et";
  /** the month the date picker shows (YYYY-MM-01), when moved off the picked date's */
  mon?: string;
}
interface Cal {
  entity: string;
  name: string;
  color: string;
  off: boolean;
}

const PALETTE = ["blue", "orange", "green", "purple", "pink", "teal", "yellow", "red"];
const VIEW_ICON: Record<View, string> = { month: "mdi:calendar-month-outline", week: "mdi:calendar-week-outline", day: "mdi:calendar-today-outline", agenda: "mdi:format-list-bulleted" };
const VIEW_NAME: Record<View, string> = { month: "Month", week: "Week", day: "Day", agenda: "Agenda" };
const HOUR = 44;
/** a calendar entity's supported_features: what Home Assistant lets a card do with its events */
const CREATE = 1;
const DELETE = 2;
const UPDATE = 4;
const REPEATS: [string, string][] = [
  ["", "Doesn't repeat"],
  ["FREQ=DAILY", "Every day"],
  ["FREQ=WEEKLY", "Every week"],
  ["FREQ=MONTHLY", "Every month"],
  ["FREQ=YEARLY", "Every year"],
];
const REFRESH_MS = 15 * 60 * 1000;

const localDate = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day);
};
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const isWeekend = (d: Date) => WEEKENDS.includes(WEEK[(d.getDay() + 6) % 7]);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
/** a local time with its offset, as Home Assistant's own calendar dialog sends it */
const isoLocal = (d: Date) => {
  const o = -d.getTimezoneOffset();
  return `${ymd(d)}T${hm(d)}:00${o < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(o) / 60))}:${pad(Math.abs(o) % 60)}`;
};
/** one of the cards' month photos (dist/calendar-01.webp …) */
const monthPhoto = (m: number) => `glass:calendar/${String(m + 1).padStart(2, "0")}.webp`;

export class GlassCalendarView extends GlassElement<ViewConfig> {
  static override properties = {
    ...GlassElement.properties,
    _view: { state: true },
    _cursor: { state: true },
    _hidden: { state: true },
    _evs: { state: true },
    _detail: { state: true },
    _form: { state: true },
    _drag: { state: true },
    _settled: { state: true },
    _confirm: { state: true },
    _w: { state: true },
  };
  declare _view: View;
  declare _cursor: Date;
  declare _hidden: Set<string>;
  declare _evs?: Ev[];
  declare _detail?: Ev;
  declare _form?: Form;
  /** an event being dragged: where it would go now */
  declare _drag?: { id: string; start: Date; end: Date };
  /** an event just dropped: it settles into place */
  declare _settled?: string;
  /** the detail's delete asked again ("Delete this event?"), or its error */
  declare _confirm?: { busy?: boolean; error?: string };
  /** the card's width: a phone (< 720) and a small one (< 420) have a layout of their own */
  declare _w: number;

  /** over the page: the card it opened from – its dashboard says when it's night */
  opener?: Element;
  protected override nightNow(): boolean {
    return this.opener?.isConnected ? isDark(this._hass, this.opener) : super.nightNow();
  }

  /** in a Bubble Card pop-up (its container somewhere up the tree): a ✕ that closes it */
  private _popup = false;
  private _findPopup() {
    for (let n: Node | null = this.parentNode; n; n = n instanceof ShadowRoot ? n.host : n.parentNode) {
      const cls = (n as Element).classList;
      if (cls && [...cls].some((c) => c.startsWith("bubble-pop-up"))) return true;
    }
    return false;
  }
  /** ✕: over the page it goes; in a pop-up, the pop-up closes (its #hash dropped, as Bubble Card does) */
  private _close() {
    haptic("selection");
    if (this._config.overlay) return this.remove();
    if (!location.hash) return;
    history.replaceState(history.state, "", location.href.split("#")[0]);
    window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: true } }));
  }

  private _cals: Cal[] = [];
  private _range = "";
  private _loading?: string;
  private _timer?: number;
  private _scrolled = "";

  constructor() {
    super();
    this._cursor = startOfDay(new Date());
    this._hidden = new Set();
    this._w = 1000;
  }

  static override parts = CALENDAR_VIEW_PARTS;

  static getConfigElement() {
    return makeEditor(calendarViewSpec);
  }
  static getStubConfig() {
    return {};
  }

  protected override validateConfig(c: ViewConfig) {
    this._evs = undefined;
    this._range = "";
    return c;
  }

  protected watchedEntities() {
    return this._cals.map((s) => s.entity);
  }

  /** an event started / ended, a calendar changed: fetched again */
  protected override hassChanged() {
    this._range = "";
    void this._fetch();
  }

  private _ro = new ResizeObserver(([e]) => {
    const w = Math.round(e.contentRect.width);
    if (Math.abs(w - this._w) > 1) this._w = w;
  });

  override connectedCallback() {
    super.connectedCallback();
    this._ro.observe(this);
    // the pop-up's content is built after the card: looked for once it's in place
    requestAnimationFrame(() => {
      const p = this._findPopup();
      if (p !== this._popup) ((this._popup = p), this.requestUpdate());
    });
    this._timer = window.setInterval(() => ((this._range = ""), void this._fetch()), REFRESH_MS);
    if (this._config?.overlay) window.addEventListener("keydown", this._onKey);
  }
  override disconnectedCallback() {
    super.disconnectedCallback();
    this._ro.disconnect();
    clearInterval(this._timer);
    window.removeEventListener("keydown", this._onKey);
    this._dragCancel();
  }
  private _onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    if (this._form) this._form = undefined;
    else if (this._confirm) this._confirm = undefined;
    else if (this._detail) this._detail = undefined;
    else this.remove();
  };

  /* ---------- the calendars and their events ---------- */

  /** the calendars it shows: the config's, else every calendar entity */
  private _sources(hass: HomeAssistant): Cal[] {
    const c = this._config;
    const off = new Set(c.days_off ?? []);
    const list = c.calendars?.length ? c.calendars : Object.keys(hass.states).filter((e) => e.startsWith("calendar.")).sort();
    const srcs = list.map((s) => (typeof s === "string" ? { entity: s } : s));
    for (const e of off) if (!srcs.some((s) => s.entity === e)) srcs.push({ entity: e });
    return srcs.map((s, i) => ({
      entity: s.entity,
      name: s.name ?? (hass.states[s.entity]?.attributes.friendly_name as string | undefined) ?? s.entity,
      color: cssColor(s.color ?? PALETTE[i % PALETTE.length]) ?? "#888",
      off: off.has(s.entity),
    }));
  }

  /** the days the view shows */
  private _span(view: View, cur: Date, hass?: HomeAssistant): [Date, Date] {
    const first = WEEK.indexOf(weekOrder(hass)[0]);
    const weekStart = (d: Date) => addDays(d, -((d.getDay() + 6 - first) % 7));
    if (view === "month") {
      const s = weekStart(new Date(cur.getFullYear(), cur.getMonth(), 1));
      return [s, addDays(s, 42)];
    }
    if (view === "week") {
      const s = weekStart(cur);
      return [s, addDays(s, 7)];
    }
    if (view === "day") return [cur, addDays(cur, 1)];
    return [cur, addDays(cur, Math.max(1, this._config.agenda_days ?? 30))];
  }

  private async _fetch() {
    const hass = this._hass;
    if (!hass?.callApi || !this._config) return;
    const [from, to] = this._span(this._view, this._cursor, hass);
    const key = `${from.getTime()}|${to.getTime()}|${this._cals.map((c) => c.entity).join(",")}`;
    if (key === this._range || key === this._loading) return;
    this._loading = key;
    const q = `start=${encodeURIComponent(from.toISOString())}&end=${encodeURIComponent(to.toISOString())}`;
    const lists = await Promise.all(
      this._cals.map(async (s, cal) => {
        const evs = await hass.callApi!<ApiEvent[]>("GET", `calendars/${s.entity}?${q}`).catch(() => [] as ApiEvent[]);
        return evs.map<Ev>((e, i) => {
          const allDay = !e.start.dateTime;
          return {
            // the same id after a move (a repeating event's day keeps its recurrence_id)
            id: e.uid ? `${s.entity}|${e.uid}|${e.recurrence_id ?? ""}` : `${s.entity}|${i}|${e.start.dateTime ?? e.start.date}`,
            title: e.summary || "—",
            start: allDay ? localDate(e.start.date!) : new Date(e.start.dateTime!),
            end: allDay ? localDate(e.end.date!) : new Date(e.end.dateTime!),
            allDay,
            location: e.location || undefined,
            description: e.description || undefined,
            repeats: !!(e.rrule || e.recurrence_id),
            cal,
            uid: e.uid,
            recurrenceId: e.recurrence_id,
            rrule: e.rrule,
          };
        });
      }),
    );
    // a newer request meanwhile: its answer wins
    if (this._loading !== key) return;
    this._loading = undefined;
    this._range = key;
    this._evs = lists.flat().sort((a, b) => a.start.getTime() - b.start.getTime() || Number(b.allDay) - Number(a.allDay));
    // the picked event as the calendar has it now (gone: nothing picked)
    if (this._detail) this._detail = this._evs.find((e) => e.id === this._detail!.id);
  }

  /** events shown (calendars switched on, not days off) on a day */
  private _on(day: Date): Ev[] {
    const a = day.getTime();
    const b = addDays(day, 1).getTime();
    const d = this._drag;
    const list = d ? (this._evs ?? []).map((e) => (e.id === d.id ? { ...e, start: d.start, end: d.end } : e)) : (this._evs ?? []);
    return list.filter((e) => !this._cals[e.cal]?.off && !this._hidden.has(this._cals[e.cal]?.entity) && e.start.getTime() < b && e.end.getTime() > a);
  }
  /** a day off (a holiday calendar's all-day event): its name */
  private _dayOff(day: Date): string | undefined {
    const a = day.getTime();
    const b = addDays(day, 1).getTime();
    return (this._evs ?? []).find((e) => this._cals[e.cal]?.off && !this._hidden.has(this._cals[e.cal].entity) && e.start.getTime() < b && e.end.getTime() > a)?.title;
  }

  /* ---------- adding, changing, deleting ---------- */

  /** what Home Assistant lets a card do with a calendar's events */
  private _can(entity: string, what: number) {
    return !!(Number(this._hass?.states[entity]?.attributes.supported_features ?? 0) & what);
  }
  private _canAdd() {
    return this._cals.some((c) => this._can(c.entity, CREATE));
  }
  private _refresh() {
    this._range = "";
    void this._fetch();
  }
  private _set(patch: Partial<Form>) {
    if (this._form) this._form = { ...this._form, ...patch, error: undefined };
  }

  /** a day's first free start for a new event: today the next half hour, another day 9:00 */
  private _startOn(d: Date) {
    const now = new Date();
    if (!sameDay(d, now)) return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9);
    const half = Math.floor(now.getMinutes() / 30) * 30 + 30;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), half);
  }

  /** a new event, half an hour long: at a time (a tap on the time line), on a day (a tap on the
   *  month's day, the all-day row) or the day shown */
  private _newEvent(at?: Date, allDay = false) {
    const cals = this._cals.filter((c) => this._can(c.entity, CREATE));
    if (!cals.length) return;
    haptic("selection");
    const cal = cals.find((c) => !c.off && !this._hidden.has(c.entity)) ?? cals[0];
    const s = at ?? this._startOn(this._cursor);
    const e = new Date(s.getTime() + 30 * 60000);
    this._detail = undefined;
    this._confirm = undefined;
    this._form = { cal: cal.entity, title: "", allDay, sd: ymd(s), st: hm(s), ed: ymd(allDay ? s : e), et: hm(e), location: "", description: "", rrule: "", scope: "one" };
  }

  private _edit(ev: Ev) {
    haptic("selection");
    const last = ev.allDay ? addDays(ev.end, -1) : ev.end;
    this._form = {
      ev,
      cal: this._cals[ev.cal].entity,
      title: ev.title === "—" ? "" : ev.title,
      allDay: ev.allDay,
      sd: ymd(ev.start),
      st: hm(ev.start),
      ed: ymd(last < ev.start ? ev.start : last),
      et: hm(ev.end),
      location: ev.location ?? "",
      description: ev.description ?? "",
      rrule: ev.rrule ?? "",
      scope: "one",
    };
    this._detail = undefined;
    this._confirm = undefined;
  }

  /** the start moved: the end with it, the event as long as before */
  private _moveStart(sd: string, st: string) {
    const f = this._form!;
    const at = (d: string, t: string) => (f.allDay ? localDate(d) : new Date(`${d}T${t}`)).getTime();
    const len = Math.max(0, at(f.ed, f.et) - at(f.sd, f.st));
    const end = new Date(at(sd, st) + len);
    if (isNaN(end.getTime())) return this._set({ sd, st });
    this._set({ sd, st, ed: ymd(end), et: f.allDay ? f.et : hm(end) });
  }

  private async _save() {
    const f = this._form;
    const hass = this._hass;
    if (!f || !hass || f.busy) return;
    if (!f.title.trim()) return void (this._form = { ...f, error: tr("Give it a name") });
    const start = f.allDay ? localDate(f.sd) : new Date(`${f.sd}T${f.st}`);
    // an all-day event ends the day after its last (as Home Assistant keeps it)
    const end = f.allDay ? addDays(localDate(f.ed), 1) : new Date(`${f.ed}T${f.et}`);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return void (this._form = { ...f, error: tr("Pick when it is") });
    if (end <= start) return void (this._form = { ...f, error: tr("It ends before it starts") });
    const event: Record<string, string> = {
      summary: f.title.trim(),
      dtstart: f.allDay ? ymd(start) : isoLocal(start),
      dtend: f.allDay ? ymd(end) : isoLocal(end),
    };
    if (f.location.trim()) event.location = f.location.trim();
    if (f.description.trim()) event.description = f.description.trim();
    const one = !!f.ev?.recurrenceId && f.scope === "one";
    // one of a repeating event's days: it alone, so no repeat of its own
    if (f.rrule && !one) event.rrule = f.rrule;
    this._form = { ...f, busy: true, error: undefined };
    try {
      if (f.ev)
        await hass.callWS({
          type: "calendar/event/update",
          entity_id: f.cal,
          uid: f.ev.uid,
          ...(f.ev.recurrenceId ? { recurrence_id: f.ev.recurrenceId } : {}),
          ...(f.ev.recurrenceId && f.scope === "future" ? { recurrence_range: "THISANDFUTURE" } : {}),
          event,
        });
      else await hass.callWS({ type: "calendar/event/create", entity_id: f.cal, event });
      haptic("medium");
      this._form = undefined;
      this._refresh();
    } catch (err) {
      haptic("light");
      if (this._form) this._form = { ...this._form, busy: false, error: (err as { message?: string })?.message ?? String(err) };
    }
  }

  private async _delete(ev: Ev, future: boolean) {
    const hass = this._hass;
    if (!hass || this._confirm?.busy) return;
    this._confirm = { busy: true };
    try {
      await hass.callWS({
        type: "calendar/event/delete",
        entity_id: this._cals[ev.cal].entity,
        uid: ev.uid,
        ...(ev.recurrenceId ? { recurrence_id: ev.recurrenceId } : {}),
        ...(ev.recurrenceId && future ? { recurrence_range: "THISANDFUTURE" } : {}),
      });
      haptic("medium");
      this._confirm = undefined;
      this._detail = undefined;
      this._refresh();
    } catch (err) {
      haptic("light");
      this._confirm = { error: (err as { message?: string })?.message ?? String(err) };
    }
  }

  /** a tap on the time line's free space: a new event at that half hour */
  private _slot(day: Date, e: MouseEvent) {
    if (this._swiped || !this._canAdd()) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const h = Math.max(0, Math.min(23.5, Math.floor(((e.clientY - r.top) / HOUR) * 2) / 2));
    this._newEvent(new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(h), (h % 1) * 60));
  }

  /* ---------- picking an event: its detail beside it (a phone: at the bottom) ---------- */

  private _select(e: Ev) {
    haptic("selection");
    this._confirm = undefined;
    this._shownSel = undefined;
    this._detail = this._detail?.id === e.id ? undefined : e;
  }
  /** a tap elsewhere: the picked event let go first (nothing new made by that tap) */
  private _dismiss() {
    if (!this._detail) return false;
    this._detail = undefined;
    this._confirm = undefined;
    return true;
  }

  /** the detail next to its event, as Outlook's: right of it, else left, else under it */
  /** the picked event the phone's detail would cover: the time line scrolled to show it (once) */
  private _shownSel?: string;
  private _placePop() {
    const dock = this.renderRoot.querySelector<HTMLElement>(".detail.dock .sheet");
    if (dock && this._detail && this._shownSel !== this._detail.id) {
      this._shownSel = this._detail.id;
      const sel = this.renderRoot.querySelector<HTMLElement>(".sel");
      const tl = this.renderRoot.querySelector<HTMLElement>(".timeline");
      if (sel && tl) {
        const over = sel.getBoundingClientRect().bottom - dock.getBoundingClientRect().top + 16;
        if (over > 0) tl.scrollBy({ top: over, behavior: "smooth" });
      }
    }
    if (!this._detail) this._shownSel = undefined;
    const pop = this.renderRoot.querySelector<HTMLElement>(".pop");
    const frame = this.renderRoot.querySelector<HTMLElement>(".frame");
    const sel = this.renderRoot.querySelector<HTMLElement>(".sel");
    if (!pop || !frame) return;
    if (!sel) return void (pop.style.visibility = "hidden");
    const f = frame.getBoundingClientRect();
    const r = sel.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const gap = 10;
    let x: number;
    let y = r.top - f.top;
    if (f.right - r.right > w + gap + 8) x = r.right - f.left + gap;
    else if (r.left - f.left > w + gap + 8) x = r.left - f.left - w - gap;
    else {
      x = r.left - f.left + r.width / 2 - w / 2;
      y = r.bottom - f.top + gap;
      if (y + h > f.height - 8) y = r.top - f.top - h - gap;
    }
    x = Math.max(8, Math.min(f.width - w - 8, x));
    y = Math.max(8, Math.min(f.height - h - 8, y));
    pop.style.left = `${x}px`;
    pop.style.top = `${y}px`;
    pop.style.visibility = "";
  }

  /* ---------- dragging: move an event, or stretch it from its corner ---------- */

  private _canEdit(e: Ev) {
    return !!e.uid && this._can(this._cals[e.cal]?.entity, UPDATE);
  }
  /** the pointer on an event: a drag waiting to start (a mouse: once it moves; a finger: once held) */
  private _dg?: { ev: Ev; mode: "move" | "resize" | "start"; x: number; y: number; id: number; on: boolean; touch: boolean; el: HTMLElement; timer?: number };
  /** a drag just ended: the click after it opens nothing */
  private _dragged = false;

  private _dragDown(ev: Ev, mode: "move" | "resize" | "start", x: PointerEvent) {
    if ((x.pointerType === "mouse" && x.button !== 0) || !this._canEdit(ev)) return;
    const touch = x.pointerType !== "mouse";
    // a finger moves only the picked event (a tap picks it); on any other it scrolls
    if (touch && this._detail?.id !== ev.id) return;
    x.stopPropagation();
    const el = (x.currentTarget as HTMLElement).closest<HTMLElement>(".block, .ev")!;
    clearTimeout(this._dg?.timer);
    const g: NonNullable<typeof this._dg> = { ev, mode, x: x.clientX, y: x.clientY, id: x.pointerId, on: false, touch, el };
    this._dg = g;
    // the window follows the pointer from the press on: a quick drag leaves the event at once
    window.addEventListener("pointermove", this._dragMove, { passive: false });
    window.addEventListener("pointerup", this._dragUp);
    window.addEventListener("pointercancel", this._dragCancel);
    if (mode !== "move") this._dragStart();
  }

  private _dragStart() {
    const g = this._dg;
    if (!g) return;
    g.on = true;
    haptic("medium");
    try {
      g.el.setPointerCapture(g.id);
    } catch {
      /* the pointer is gone already */
    }
    this._drag = { id: g.ev.id, start: g.ev.start, end: g.ev.end };
  }

  /** a new half hour reached: a light tick (a phone that can) */
  private _tick(next: { id: string; start: Date; end: Date }) {
    const d = this._drag;
    if (d && (d.start.getTime() !== next.start.getTime() || d.end.getTime() !== next.end.getTime())) haptic("selection");
    this._drag = next;
  }

  private _dragMove = (x: PointerEvent) => {
    const g = this._dg;
    if (!g || x.pointerId !== g.id) return;
    const dx = x.clientX - g.x;
    const dy = x.clientY - g.y;
    if (!g.on) {
      if (Math.hypot(dx, dy) > 4) this._dragStart();
      if (!this._dg?.on) return;
    }
    x.preventDefault();
    const e = g.ev;
    const len = e.end.getTime() - e.start.getTime();
    const HALF = 30 * 60000;
    const ms = (dy / HOUR) * 3600000;
    // on the half hours of the grid (11:45 dragged lands on 12:00, 12:30…)
    const snap = (t: number) => {
      const d = new Date(t);
      const m = Math.round((d.getHours() * 60 + d.getMinutes()) / 30) * 30;
      return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, m).getTime();
    };
    if (g.mode === "resize") {
      const end = new Date(Math.max(e.start.getTime() + HALF, snap(e.end.getTime() + ms)));
      this._tick({ id: e.id, start: e.start, end });
      return;
    }
    if (g.mode === "start") {
      const start = new Date(Math.min(e.end.getTime() - HALF, snap(e.start.getTime() + ms)));
      this._tick({ id: e.id, start, end: e.end });
      return;
    }
    // the day under the pointer (a day of the month, an all-day cell, a column of the time line)
    const under = (this.renderRoot as ShadowRoot).elementFromPoint?.(x.clientX, x.clientY)?.closest<HTMLElement>("[data-day]");
    const day = under ? localDate(under.dataset.day!) : startOfDay(this._drag?.start ?? e.start);
    let start: Date;
    if (e.allDay || g.el.classList.contains("ev")) {
      // a day's events: to another day, the same time
      start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), e.start.getHours(), e.start.getMinutes());
    } else {
      start = new Date(snap(new Date(day.getFullYear(), day.getMonth(), day.getDate(), e.start.getHours(), e.start.getMinutes()).getTime() + ms));
    }
    this._tick({ id: e.id, start, end: new Date(start.getTime() + len) });
  };

  private _unlisten() {
    window.removeEventListener("pointermove", this._dragMove);
    window.removeEventListener("pointerup", this._dragUp);
    window.removeEventListener("pointercancel", this._dragCancel);
  }

  private _dragUp = (x: PointerEvent) => {
    const g = this._dg;
    if (!g || x.pointerId !== g.id) return;
    clearTimeout(g.timer);
    this._dg = undefined;
    this._unlisten();
    if (!g.on) return;
    const d = this._drag;
    this._drag = undefined;
    this._dragged = true;
    this._settled = g.ev.id;
    setTimeout(() => this._settled === g.ev.id && (this._settled = undefined), 400);
    setTimeout(() => (this._dragged = false), 60);
    if (d && (d.start.getTime() !== g.ev.start.getTime() || d.end.getTime() !== g.ev.end.getTime())) void this._moveTo(g.ev, d.start, d.end);
  };

  private _dragCancel = () => {
    this._unlisten();
    clearTimeout(this._dg?.timer);
    this._dg = undefined;
    this._drag = undefined;
  };

  /* a finger on an event: never Bubble Card's (its pop-up would slide); held, the page doesn't scroll */
  private _touchStart = (x: TouchEvent) => x.stopPropagation();
  private _touchMove = {
    handleEvent: (x: TouchEvent) => {
      x.stopPropagation();
      if (this._dg?.on && x.cancelable) x.preventDefault();
    },
    passive: false,
  };

  /** an event moved or stretched: saved in its calendar (one day of a repeating one: that day) */
  private async _moveTo(ev: Ev, start: Date, end: Date) {
    const hass = this._hass;
    if (!hass) return;
    const event: Record<string, string> = {
      summary: ev.title,
      dtstart: ev.allDay ? ymd(start) : isoLocal(start),
      dtend: ev.allDay ? ymd(end) : isoLocal(end),
    };
    if (ev.location) event.location = ev.location;
    if (ev.description) event.description = ev.description;
    if (ev.rrule && !ev.recurrenceId) event.rrule = ev.rrule;
    // where it was put, until the calendar answers
    this._evs = (this._evs ?? []).map((e) => (e.id === ev.id ? { ...e, start, end } : e));
    if (this._detail?.id === ev.id) this._detail = this._evs.find((e) => e.id === ev.id);
    haptic("selection");
    try {
      await hass.callWS({
        type: "calendar/event/update",
        entity_id: this._cals[ev.cal].entity,
        uid: ev.uid,
        ...(ev.recurrenceId ? { recurrence_id: ev.recurrenceId } : {}),
        event,
      });
    } catch {
      haptic("light");
    }
    this._refresh();
  }

  /* ---------- the photo ---------- */

  private _photo(): string {
    const c = this._config;
    const m = this._cursor.getMonth();
    const own = c.images?.[String(m + 1)];
    if (own) return wallpaperUrl(own)!;
    if (c.image === "custom") {
      if (c.image_url) return wallpaperUrl(c.image_url)!;
    } else if (c.image && c.image !== "months") return wallpaperUrl(c.image)!;
    const south = c.hemisphere === "south" || (c.hemisphere !== "north" && (this._hass?.config?.latitude ?? 0) < 0);
    // the south: the season half a year on (its July is the north's January)
    return wallpaperUrl(monthPhoto(south ? (m + 6) % 12 : m))!;
  }

  protected override glassUnder(el: HTMLElement): Element | undefined {
    return el.closest(".frame")?.querySelector(".photo") ?? undefined;
  }

  /* ---------- moving around ---------- */

  private _views(): View[] {
    const c = this._config;
    const phone = this._w < 720;
    const list = (phone ? c.phone_views ?? ["day", "agenda"] : c.views ?? ["month", "week", "day", "agenda"]).filter((v) => v in VIEW_ICON);
    return list.length ? list : ["agenda"];
  }

  private _go(step: -1 | 0 | 1) {
    haptic("selection");
    if (!step) {
      this._cursor = startOfDay(new Date());
      return;
    }
    const d = this._cursor;
    const v = this._view;
    this._cursor =
      v === "month" ? new Date(d.getFullYear(), d.getMonth() + step, 1) : addDays(d, step * (v === "week" ? 7 : v === "day" ? 1 : Math.max(1, this._config.agenda_days ?? 30)));
  }

  private _pick(v: View) {
    haptic("selection");
    this._view = v;
  }

  private _openDay(d: Date) {
    haptic("selection");
    this._cursor = d;
    this._view = this._views().includes("day") ? "day" : this._views().includes("agenda") ? "agenda" : this._view;
  }

  private _toggle(entity: string) {
    haptic("selection");
    const next = new Set(this._hidden);
    if (next.has(entity)) next.delete(entity);
    else next.add(entity);
    this._hidden = next;
  }

  /** a swipe across the view: the one before / after */
  private _sw?: { x: number; y: number };
  /** a swipe just moved the view: the click after it adds nothing */
  private _swiped = false;
  private _swDown = (e: PointerEvent) => {
    this._swiped = false;
    if (e.pointerType !== "touch" || (e.target as HTMLElement).closest(".seg, button, .sheet")) return;
    this._sw = { x: e.clientX, y: e.clientY };
  };
  private _swUp = (e: PointerEvent) => {
    const s = this._sw;
    this._sw = undefined;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(e.clientY - s.y) * 1.5) {
      this._swiped = true;
      this._go(dx < 0 ? 1 : -1);
    }
  };

  /* ---------- render ---------- */

  protected override willUpdate(changed: PropertyValues) {
    super.willUpdate(changed);
    this.toggleAttribute("overlay", !!this._config?.overlay);
    this.toggleAttribute("phone", this._w < 720);
    this.toggleAttribute("small", this._w < 420);
    if (this._hass && this._config) {
      const next = this._sources(this._hass);
      if (next.map((c) => c.entity + c.color).join() !== this._cals.map((c) => c.entity + c.color).join()) {
        this._cals = next;
        this._range = "";
      }
    }
    const views = this._views();
    if (!this._view || !views.includes(this._view)) this._view = this._config?.view && views.includes(this._config.view) ? this._config.view : views[0];
  }

  protected override updated(changed: PropertyValues) {
    super.updated(changed);
    if (this._detail) requestAnimationFrame(() => this._placePop());
    void this._fetch();
    // the time line: scrolled to the morning (or now) once per day shown
    const tl = this.renderRoot.querySelector<HTMLElement>(".timeline");
    const k = `${this._view}|${this._cursor.getTime()}`;
    if (tl && this._scrolled !== k) {
      this._scrolled = k;
      const now = new Date();
      const h = sameDay(now, this._cursor) || this._view === "week" ? Math.max(0, now.getHours() - 1) : 7;
      tl.scrollTop = h * HOUR;
    }
  }

  override render() {
    const c = this._config;
    const hass = this._hass;
    if (!c || !hass) return nothing;
    const lang = language(hass);
    const dark = this.nightNow();
    // the calendar itself on light (frosted) glass – cheap on any screen; the real WebGL glass is
    // the switches' (controls_glass), or this one's when panel_glass names it
    const panel = matPart(c.panel_glass, c.panel_color, "frosted");
    const view = this._view;
    // own colours: the picked item, today
    const own = [c.height && !c.overlay ? `height:${c.height}` : "", c.picked_color ? `--cv-picked:${cssColor(c.picked_color)}` : "", c.today_color ? `--cv-today:${cssColor(c.today_color)}` : ""]
      .filter(Boolean)
      .join(";");
    return html`<div
      class="frame ${dark ? "dark" : ""} ${c.picked_color ? "own-picked" : ""}"
      style=${own}
      @pointerdown=${this._swDown}
      @pointerup=${this._swUp}
      @pointercancel=${() => (this._sw = undefined)}
    >
      <div class="photo" style="background-image:url('${this._photo()}')"></div>
      ${this._head(lang)}
      <div class="panel ${panel?.cls ?? ""} v-${view}" style=${panel?.style ?? ""}>
        ${!this._evs
          ? html`<div class="loading">${tr("Loading…")}</div>`
          : view === "month"
            ? this._month(lang)
            : view === "agenda"
              ? this._agenda(lang)
              : this._timeline(lang, view === "week" ? 7 : 1)}
      </div>
      ${this._detail && !this._dg?.on ? this._sheet(this._detail, lang) : nothing} ${this._form ? this._formSheet(this._form, lang) : nothing}
    </div>`;
  }

  /** the title over the photo, ‹ Today ›, the views and the calendars */
  private _head(lang: string) {
    // the switches' track: clear liquid glass by day, dark liquid glass at night (both WebGL)
    const night = this.nightNow();
    const ctlMat = this._config.controls_glass ?? (night ? "dark-liquid-gl" : "liquid-gl");
    const ctl = matPart(ctlMat, this._config.controls_color, ctlMat);
    const d = this._cursor;
    const v = this._view;
    const small = this._w < 420;
    let title: string;
    if (v === "month") title = new Intl.DateTimeFormat(lang, { month: "long", year: "numeric" }).format(d);
    else if (v === "week") {
      const [a, b] = this._span("week", d, this._hass);
      // "16.–22. listopadu 2026", "November 16 – 22, 2026": the language's own way
      title = new Intl.DateTimeFormat(lang, { day: "numeric", month: small ? "short" : "long", year: "numeric" }).formatRange(a, addDays(b, -1));
    } else if (v === "day") title = new Intl.DateTimeFormat(lang, this._w < 720 ? { day: "numeric", month: small ? "short" : "long" } : { weekday: "long", day: "numeric", month: "long" }).format(d);
    else title = new Intl.DateTimeFormat(lang, { month: small ? "short" : "long", year: "numeric" }).format(d);
    // a segmented switch, as a toolbar's: one glass track (liquid glass over the photo), the
    // picked item a solid pill in it, the others just their icon and name on the glass
    const track = (cls: string, items: unknown) => html`<div class="seg ${cls} ${ctl?.cls ?? ""}" style=${ctl?.style ?? ""}>${items}</div>`;
    const views = this._views();
    const cals = html`<div class="scroll">
      ${track(
        "cals",
        this._cals.map((s) => {
          const on = !this._hidden.has(s.entity);
          return html`<button class="item ${on ? "on" : ""}" style="--c:${s.color}" title=${s.name} @click=${() => this._toggle(s.entity)}>
            <i class="dot ${on ? "" : "hollow"}"></i>${small && !on ? nothing : html`<span>${s.name}</span>`}
          </button>`;
        }),
      )}
    </div>`;
    return html`<div class="head">
      <div class="row top">
        <h2 class="title">${cap(title)}</h2>
        ${this._canAdd()
          ? track("add", html`<button class="item round" title=${tr("New event")} @click=${() => this._newEvent()}><ha-icon .icon=${"mdi:plus"}></ha-icon></button>`)
          : nothing}
        ${track(
          "nav",
          html`<button class="item round" title=${tr("Previous")} @click=${() => this._go(-1)}><ha-icon .icon=${"mdi:chevron-left"}></ha-icon></button
            ><button class="item" @click=${() => this._go(0)}>${tr("Today")}</button
            ><button class="item round" title=${tr("Next")} @click=${() => this._go(1)}><ha-icon .icon=${"mdi:chevron-right"}></ha-icon></button>`,
        )}
        ${this._config.overlay || (this._popup && this._config.close !== false)
          ? track("close", html`<button class="item round" title=${tr("Close")} @click=${() => this._close()}><ha-icon .icon=${"mdi:close"}></ha-icon></button>`)
          : nothing}
      </div>
      <div class="row">
        ${views.length > 1
          ? track(
              "views",
              views.map(
                (x) => html`<button class="item ${x === v ? "on" : ""}" title=${tr(VIEW_NAME[x])} @click=${() => this._pick(x)}>
                  <ha-icon .icon=${VIEW_ICON[x]}></ha-icon>${!small || x === v ? html`<span>${tr(VIEW_NAME[x])}</span>` : nothing}
                </button>`,
              ),
            )
          : nothing}
        ${cals}
      </div>
    </div>`;
  }

  private _evPill(e: Ev, lang: string, h12: boolean | undefined) {
    const s = this._cals[e.cal];
    const t = e.allDay ? "" : new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit", hour12: h12 }).format(e.start);
    const d = this._drag?.id === e.id && this._dg?.on;
    const sel = this._detail?.id === e.id;
    return html`<button
      class="ev ${e.allDay ? "all" : ""} ${d ? "dragging" : ""} ${this._settled === e.id ? "settle" : ""} ${sel ? "sel" : ""} ${this._canEdit(e) ? "can-drag" : ""}"
      style="--c:${s.color}"
      @click=${(x: Event) => (x.stopPropagation(), !this._dragged && this._select(e))}
      @pointerdown=${(x: PointerEvent) => this._dragDown(e, "move", x)}
      @pointermove=${this._dragMove}
      @pointerup=${this._dragUp}
      @pointercancel=${this._dragCancel}
      @touchstart=${this._touchStart}
      @touchmove=${this._touchMove}
    >
      ${t ? html`<b>${t}</b>` : nothing}<span>${e.title}</span>
    </button>`;
  }

  private _month(lang: string) {
    const hass = this._hass!;
    const h12 = hour12(hass);
    const [from] = this._span("month", this._cursor, hass);
    const today = startOfDay(new Date());
    const we = this._config.weekends ?? "tint";
    const order = weekOrder(hass).filter((d) => we !== "hide" || !WEEKENDS.includes(d));
    const names = order.map((d) => new Intl.DateTimeFormat(lang, { weekday: this._w < 900 ? "narrow" : "short" }).format(new Date(2024, 0, 1 + WEEK.indexOf(d))));
    const max = this._w < 900 ? 2 : 3;
    const days = Array.from({ length: 42 }, (_, i) => addDays(from, i)).filter((d) => we !== "hide" || !isWeekend(d));
    return html`<div class="month" style="grid-template-columns:repeat(${order.length}, minmax(0, 1fr))">
      ${names.map((n) => html`<div class="wd">${n}</div>`)}
      ${days.map((d, i) => {
        const evs = this._on(d);
        const off = this._dayOff(d);
        const other = d.getMonth() !== this._cursor.getMonth();
        // a tap on the day: a new event on it; on its number (or +N): the day itself
        const open = (x: Event) => (x.stopPropagation(), this._openDay(d));
        const target = this._drag && sameDay(this._drag.start, d) && this._dg?.on;
        return html`<div
          class="cell ${other ? "other" : ""} ${off ? "off" : ""} ${we === "tint" && isWeekend(d) ? "we" : ""} ${i % order.length === 0 ? "first" : ""} ${target ? "target" : ""}"
          data-day=${ymd(d)}
          @click=${() => (this._dragged || this._dismiss() ? undefined : this._canAdd() && !this._swiped ? this._newEvent(this._startOn(d)) : this._openDay(d))}
        >
          <div class="num"><span class="open ${sameDay(d, today) ? "today" : ""}" @click=${open}>${d.getDate()}</span>${off ? html`<small title=${off}>${off}</small>` : nothing}</div>
          ${evs.slice(0, max).map((e) => this._evPill(e, lang, h12))}
          ${evs.length > max ? html`<div class="more" @click=${open}>+${evs.length - max}</div>` : nothing}
        </div>`;
      })}
    </div>`;
  }

  private _agenda(lang: string) {
    const hass = this._hass!;
    const h12 = hour12(hass);
    const [from, to] = this._span("agenda", this._cursor, hass);
    const today = startOfDay(new Date());
    const days: TemplateResult[] = [];
    for (let d = from; d < to; d = addDays(d, 1)) {
      const evs = this._on(d);
      const off = this._dayOff(d);
      if (!evs.length && !off) continue;
      const label = sameDay(d, today)
        ? cap(new Intl.RelativeTimeFormat(lang, { numeric: "auto" }).format(0, "day"))
        : cap(new Intl.DateTimeFormat(lang, { weekday: "long", day: "numeric", month: "long" }).format(d));
      days.push(html`<section class=${off ? "off" : ""}>
        <h3 @click=${() => this._openDay(d)}>${label}${off ? html`<small>${off}</small>` : nothing}</h3>
        ${evs.map((e) => {
          const s = this._cals[e.cal];
          const f = (x: Date) => new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit", hour12: h12 }).format(x);
          const time = e.allDay ? tr("all day") : `${f(e.start)} – ${f(e.end)}`;
          return html`<button class="row-ev ${this._detail?.id === e.id ? "sel" : ""}" style="--c:${s.color}" @click=${() => this._select(e)}>
            <span class="when">${time}</span><i class="bar"></i>
            <span class="what"><b>${e.title}</b>${e.location ? html`<small>${e.location}</small>` : nothing}</span>
          </button>`;
        })}
      </section>`);
    }
    return html`<div class="agenda">${days.length ? days : html`<div class="empty">${tr("Nothing planned")}</div>`}</div>`;
  }

  /** a week (or one day): the all-day events above, the others on a time line */
  private _timeline(lang: string, n: number) {
    const hass = this._hass!;
    const h12 = hour12(hass);
    const [from] = this._span(n === 7 ? "week" : "day", this._cursor, hass);
    const we = this._config.weekends ?? "tint";
    const days = Array.from({ length: n }, (_, i) => addDays(from, i)).filter((d) => n === 1 || we !== "hide" || !isWeekend(d));
    n = days.length;
    const weCls = (d: Date) => (we === "tint" && isWeekend(d) ? "we" : "");
    const today = startOfDay(new Date());
    const now = new Date();
    const hours = Array.from({ length: 24 }, (_, h) => new Intl.DateTimeFormat(lang, { hour: "numeric", hour12: h12 }).format(new Date(2024, 0, 1, h)));
    const cols = `grid-template-columns: 52px repeat(${n}, minmax(0, 1fr))`;
    // a phone's day: the week above it, a tap picks the day
    const strip =
      n === 1 && this._w < 720
        ? (() => {
            const [ws] = this._span("week", this._cursor, hass);
            return html`<div class="days strip">
              ${Array.from({ length: 7 }, (_, i) => addDays(ws, i)).map((d) => {
                const off = this._dayOff(d);
                const has = this._on(d).length > 0;
                return html`<button class="dh ${sameDay(d, today) ? "is-today" : ""} ${sameDay(d, this._cursor) ? "picked" : ""} ${off ? "off" : ""} ${weCls(d)}" @click=${() => (haptic("selection"), (this._cursor = d))}>
                  <small>${new Intl.DateTimeFormat(lang, { weekday: "narrow" }).format(d)}</small><b>${d.getDate()}</b><i class=${has ? "has" : ""}></i>
                </button>`;
              })}
            </div>`;
          })()
        : nothing;
    return html`${strip}${n > 1
        ? html`<div class="days" style=${cols}>
            <span></span>
            ${days.map((d) => {
              const off = this._dayOff(d);
              return html`<button class="dh ${sameDay(d, today) ? "is-today" : ""} ${off ? "off" : ""} ${weCls(d)}" title=${off ?? ""} @click=${() => this._openDay(d)}>
                <small>${new Intl.DateTimeFormat(lang, { weekday: "short" }).format(d)}</small><b>${d.getDate()}</b>
              </button>`;
            })}
          </div>`
        : nothing}
      <div class="alldays" style=${cols}>
        <span class="lbl">${tr("all day")}</span>
        ${days.map((d) => {
          // a day off (a holiday): its name in the row too – a day shows it, as the month does
          const off = this._dayOff(d);
          return html`<div class="ad ${weCls(d)} ${off ? "off" : ""}" data-day=${ymd(d)} @click=${() => !this._dragged && !this._dismiss() && this._canAdd() && this._newEvent(d, true)}>
            ${off ? html`<span class="offname" title=${off}>${off}</span>` : nothing}
            ${this._on(d).filter((e) => e.allDay || e.end.getTime() - e.start.getTime() >= 86400000).map((e) => this._evPill(e, lang, h12))}
          </div>`;
        })}
      </div>
      <div class="timeline" @scroll=${() => this._detail && this._placePop()}>
        <div class="tgrid" style="${cols};height:${24 * HOUR}px">
          <div class="hours">${hours.map((h, i) => html`<span style="top:${i * HOUR}px">${i ? h : ""}</span>`)}</div>
          ${days.map((d) => {
            const evs = this._on(d).filter((e) => !e.allDay && e.end.getTime() - e.start.getTime() < 86400000);
            // side by side where they overlap: each in the first lane free at its start
            const lanes: number[] = [];
            const placed = evs.map((e) => {
              let l = lanes.findIndex((end) => end <= e.start.getTime());
              if (l < 0) l = lanes.push(0) - 1;
              lanes[l] = e.end.getTime();
              return { e, l };
            });
            const day0 = d.getTime();
            // where a dragged event was: a dashed outline left behind
            const was = this._drag && this._dg?.on ? this._evs?.find((e) => e.id === this._drag!.id) : undefined;
            const ghost =
              was && !was.allDay && sameDay(was.start, d)
                ? html`<i class="ghost" style="top:${((was.start.getTime() - day0) / 3600000) * HOUR}px;height:${Math.max(18, ((was.end.getTime() - was.start.getTime()) / 3600000) * HOUR - 2)}px"></i>`
                : nothing;
            return html`<div class="col ${sameDay(d, today) ? "is-today" : ""} ${weCls(d)}" data-day=${ymd(d)} @click=${(x: MouseEvent) => !this._dragged && !this._dismiss() && this._slot(d, x)}>
              ${ghost}
              ${placed.map(({ e, l }) => {
                const a = Math.max(0, (e.start.getTime() - day0) / 3600000);
                const b = Math.min(24, (e.end.getTime() - day0) / 3600000);
                const s = this._cals[e.cal];
                const w = 100 / lanes.length;
                const dragging = this._drag?.id === e.id && this._dg?.on;
                const edit = this._canEdit(e);
                const sel = this._detail?.id === e.id;
                const f = (x: Date) => new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit", hour12: h12 }).format(x);
                return html`<button
                  class="block ${dragging ? "dragging" : ""} ${this._settled === e.id ? "settle" : ""} ${sel ? "sel" : ""} ${edit ? "can-drag" : ""}"
                  style="--c:${s.color};top:${a * HOUR}px;height:${Math.max(18, (b - a) * HOUR - 2)}px;left:calc(${dragging ? 0 : l * w}% + 2px);width:calc(${dragging ? 100 : w}% - 4px)"
                  @click=${(x: Event) => (x.stopPropagation(), !this._dragged && this._select(e))}
                  @pointerdown=${(x: PointerEvent) => this._dragDown(e, "move", x)}
                  @pointermove=${this._dragMove}
                  @pointerup=${this._dragUp}
                  @pointercancel=${this._dragCancel}
                  @touchstart=${this._touchStart}
                  @touchmove=${this._touchMove}
                >
                  <b>${e.title}</b><small>${dragging ? `${f(e.start)} – ${f(e.end)}` : f(e.start)}</small>
                  ${edit && (sel || dragging)
                    ? html`<span class="edge top" title=${tr("Drag to make it longer or shorter")} @pointerdown=${(x: PointerEvent) => this._dragDown(e, "start", x)} @click=${(x: Event) => x.stopPropagation()}
                        ><i></i></span
                      ><span class="edge bottom" title=${tr("Drag to make it longer or shorter")} @pointerdown=${(x: PointerEvent) => this._dragDown(e, "resize", x)} @click=${(x: Event) => x.stopPropagation()}
                        ><i></i
                      ></span>`
                    : nothing}
                </button>`;
              })}
              ${sameDay(d, now) ? html`<i class="now" style="top:${((now.getTime() - day0) / 3600000) * HOUR}px"></i>` : nothing}
            </div>`;
          })}
        </div>
      </div>`;
  }

  /** an event: when, which calendar, where, what */
  private _sheet(e: Ev, lang: string) {
    const h12 = hour12(this._hass);
    const s = this._cals[e.cal];
    const day = (x: Date) => cap(new Intl.DateTimeFormat(lang, { weekday: "long", day: "numeric", month: "long", year: x.getFullYear() === new Date().getFullYear() ? undefined : "numeric" }).format(x));
    const time = (x: Date) => new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit", hour12: h12 }).format(x);
    const lastDay = addDays(e.end, -1);
    const when = e.allDay
      ? sameDay(e.start, lastDay) || e.end <= e.start
        ? `${day(e.start)} · ${tr("all day")}`
        : `${day(e.start)} – ${day(lastDay)}`
      : sameDay(e.start, e.end)
        ? `${day(e.start)} · ${time(e.start)} – ${time(e.end)}`
        : `${day(e.start)} ${time(e.start)} – ${day(e.end)} ${time(e.end)}`;
    const panel = matPart(this._config.sheet_glass ?? this._config.panel_glass, this._config.sheet_color ?? this._config.panel_color, "frosted");
    // beside its event on a wide screen (placed once drawn, _placePop); at the bottom on a phone –
    // no veil: the calendar stays live, the picked event can be dragged meanwhile
    const phone = this._w < 720;
    return html`<div class="detail ${phone ? "dock" : "popwrap"}">
      <div class="sheet ${phone ? "" : "pop"} ${panel?.cls ?? ""}" style="--c:${s.color};${panel?.style ?? ""}${phone ? "" : ";visibility:hidden"}" @click=${(x: Event) => x.stopPropagation()}>
        <button class="x" title=${tr("Close")} @click=${() => this._dismiss()}><ha-icon .icon=${"mdi:close"}></ha-icon></button>
        <h3><i class="dot"></i>${e.title}</h3>
        <div class="line"><ha-icon .icon=${"mdi:clock-outline"}></ha-icon><span>${when}${e.repeats ? html` · <ha-icon class="rep" .icon=${"mdi:repeat"}></ha-icon>` : nothing}</span></div>
        <div class="line"><ha-icon .icon=${"mdi:calendar-outline"}></ha-icon><span>${s.name}</span></div>
        ${e.location ? html`<div class="line"><ha-icon .icon=${"mdi:map-marker-outline"}></ha-icon><span>${e.location}</span></div>` : nothing}
        ${e.description ? html`<p class="desc">${e.description}</p>` : nothing} ${this._actions(e)}
      </div>
    </div>`;
  }

  /** the detail's Edit and Delete – where the calendar allows them; a delete asked again */
  private _actions(e: Ev) {
    const entity = this._cals[e.cal].entity;
    const edit = !!e.uid && this._can(entity, UPDATE);
    const del = !!e.uid && this._can(entity, DELETE);
    if (!edit && !del) return nothing;
    const q = this._confirm;
    if (q && del)
      return html`<div class="ask">
        <p>${e.repeats ? tr("Delete this event, or this and the ones after it?") : tr("Delete this event?")}</p>
        ${q.error ? html`<p class="err">${q.error}</p>` : nothing}
        <div class="actions">
          <button class="btn" @click=${() => (this._confirm = undefined)}>${tr("Cancel")}</button>
          ${e.repeats && e.recurrenceId
            ? html`<button class="btn danger" ?disabled=${q.busy} @click=${() => this._delete(e, true)}>${tr("This and following")}</button>`
            : nothing}
          <button class="btn danger solid" ?disabled=${q.busy} @click=${() => this._delete(e, false)}>${e.repeats && e.recurrenceId ? tr("This event") : tr("Delete")}</button>
        </div>
      </div>`;
    return html`<div class="actions">
      ${del ? html`<button class="btn danger" @click=${() => (haptic("selection"), (this._confirm = {}))}><ha-icon .icon=${"mdi:trash-can-outline"}></ha-icon>${tr("Delete")}</button>` : nothing}
      ${edit ? html`<button class="btn solid" @click=${() => this._edit(e)}><ha-icon .icon=${"mdi:pencil-outline"}></ha-icon>${tr("Edit")}</button>` : nothing}
    </div>`;
  }

  /** the form's date picker: a small month, the picked day a solid pill, today red */
  private _miniMonth(f: Form, k: "sd" | "ed", lang: string) {
    const hass = this._hass!;
    const picked = localDate(f[k]);
    const m = f.mon ? localDate(f.mon) : new Date(picked.getFullYear(), picked.getMonth(), 1);
    const [from] = this._span("month", m, hass);
    const last = new Date(m.getFullYear(), m.getMonth() + 1, 0);
    // as many weeks as the month needs
    const n = Math.ceil((Math.round((last.getTime() - from.getTime()) / 86400000) + 1) / 7) * 7;
    const today = startOfDay(new Date());
    const names = weekOrder(hass).map((d) => new Intl.DateTimeFormat(lang, { weekday: "narrow" }).format(new Date(2024, 0, 1 + WEEK.indexOf(d))));
    const move = (step: number) => (haptic("selection"), this._set({ mon: ymd(new Date(m.getFullYear(), m.getMonth() + step, 1)) }));
    const pick = (d: Date) => {
      haptic("selection");
      if (k === "sd") this._moveStart(ymd(d), f.st);
      else this._set({ ed: ymd(d) });
      this._set({ open: undefined, mon: undefined });
    };
    return html`<div class="mini">
      <div class="mhead">
        <b>${cap(new Intl.DateTimeFormat(lang, { month: "long", year: "numeric" }).format(m))}</b>
        <button class="mnav" title=${tr("Previous")} @click=${() => move(-1)}><ha-icon .icon=${"mdi:chevron-left"}></ha-icon></button>
        <button class="mnav" title=${tr("Next")} @click=${() => move(1)}><ha-icon .icon=${"mdi:chevron-right"}></ha-icon></button>
      </div>
      <div class="mgrid">
        ${names.map((x) => html`<span class="mwd">${x}</span>`)}
        ${Array.from({ length: n }, (_, i) => addDays(from, i)).map(
          (d) =>
            html`<button class="mday ${d.getMonth() !== m.getMonth() ? "other" : ""} ${sameDay(d, picked) ? "on" : ""} ${sameDay(d, today) ? "today" : ""}" @click=${() => pick(d)}>
              ${d.getDate()}
            </button>`,
        )}
      </div>
    </div>`;
  }

  /** a new event, or one changed – as Apple's: Cancel, the title and Add on top; the name and the
   *  place; when; repeat and calendar; notes. Every field a pill. */
  private _formSheet(f: Form, lang: string) {
    const cals = this._cals.filter((c) => this._can(c.entity, CREATE) || c.entity === f.cal);
    const color = this._cals.find((c) => c.entity === f.cal)?.color ?? "#888";
    const panel = matPart(this._config.sheet_glass ?? this._config.panel_glass, this._config.sheet_color ?? this._config.panel_color, "frosted");
    const repeats = REPEATS.some(([v]) => v === f.rrule) ? REPEATS : [...REPEATS, [f.rrule, tr("As set in the calendar")] as [string, string]];
    const instance = !!f.ev?.recurrenceId;
    const v = (e: Event) => (e.target as HTMLInputElement).value;
    const h12 = hour12(this._hass);
    const dfmt = new Intl.DateTimeFormat(lang, { weekday: "short", day: "numeric", month: "short" });
    const tfmt = new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit", hour12: h12 });
    // a pill shows the value; a tap opens the card's own picker under the row (another tap closes it)
    const toggle = (k: NonNullable<Form["open"]>) => (haptic("selection"), this._set({ open: f.open === k ? undefined : k, mon: undefined }));
    const date = (k: "sd" | "ed") =>
      html`<button class="pill date ${f.open === k ? "open" : ""}" @click=${() => toggle(k)}>${cap(dfmt.format(localDate(f[k])))}</button>`;
    const time = (k: "st" | "et") =>
      html`<button class="pill time ${f.open === k ? "open" : ""}" @click=${() => toggle(k)}>${tfmt.format(new Date(`2000-01-01T${f[k]}`))}</button>`;
    const picker = (k: "s" | "e") =>
      f.open === `${k}d`
        ? this._miniMonth(f, `${k}d` as "sd" | "ed", lang)
        : f.open === `${k}t`
          ? html`<div class="wheels-row">
              <glass-time-wheels
                .hours=${Number(f[`${k}t`].slice(0, 2))}
                .minutes=${Number(f[`${k}t`].slice(3, 5))}
                .hour12=${!!h12}
                .step=${5}
                @change=${(e: CustomEvent) => {
                  const t = `${pad(e.detail.hours)}:${pad(e.detail.minutes)}`;
                  if (k === "s") this._moveStart(this._form!.sd, t);
                  else this._set({ et: t });
                }}
              ></glass-time-wheels>
            </div>`
          : nothing;
    return html`<div class="scrim" @click=${() => (this._form = undefined)}>
      <div class="sheet form ${panel?.cls ?? ""}" style="--c:${color};${panel?.style ?? ""}" @click=${(x: Event) => x.stopPropagation()}>
        <div class="bar">
          <button class="link" @click=${() => (this._form = undefined)}>${tr("Cancel")}</button>
          <h3>${f.ev ? tr("Edit event") : tr("New event")}</h3>
          <button class="link strong" ?disabled=${f.busy} @click=${() => this._save()}>${f.ev ? tr("Save") : tr("Add")}</button>
        </div>
        <div class="stack">
          <input class="pill name" .value=${f.title} placeholder=${tr("Name")} @input=${(e: Event) => this._set({ title: v(e) })} @keydown=${(e: KeyboardEvent) => e.key === "Enter" && this._save()} />
          <input class="pill" .value=${f.location} placeholder=${tr("Location")} @input=${(e: Event) => this._set({ location: v(e) })} />
        </div>
        <div class="group">
          <label class="row">
            <span>${tr("All day")}</span>
            <input class="switch" type="checkbox" .checked=${f.allDay} @change=${(e: Event) => this._set({ allDay: (e.target as HTMLInputElement).checked })} />
          </label>
          <div class="row">
            <span>${tr("Starts")}</span>
            ${date("sd")} ${f.allDay ? nothing : time("st")}
          </div>
          ${picker("s")}
          <div class="row">
            <span>${tr("Ends")}</span>
            ${date("ed")} ${f.allDay ? nothing : time("et")}
          </div>
          ${picker("e")}
        </div>
        <div class="group">
          ${instance && f.scope === "one"
            ? nothing
            : html`<label class="row">
                <span>${tr("Repeat")}</span>
                <span class="pill select">
                  <select @change=${(e: Event) => this._set({ rrule: v(e) })}>
                    ${repeats.map(([val, name]) => html`<option value=${val} ?selected=${val === f.rrule}>${tr(name)}</option>`)}
                  </select>
                  <ha-icon .icon=${"mdi:unfold-more-horizontal"}></ha-icon>
                </span>
              </label>`}
          <label class="row">
            <span>${tr("Calendar")}</span>
            <span class="pill select ${f.ev ? "fixed" : ""}">
              <i class="dot"></i>
              <select ?disabled=${!!f.ev} @change=${(e: Event) => this._set({ cal: v(e) })}>
                ${cals.map((c) => html`<option value=${c.entity} ?selected=${c.entity === f.cal}>${c.name}</option>`)}
              </select>
              ${f.ev ? nothing : html`<ha-icon .icon=${"mdi:unfold-more-horizontal"}></ha-icon>`}
            </span>
          </label>
        </div>
        ${instance
          ? html`<div class="choice">
              <button class="${f.scope === "one" ? "on" : ""}" @click=${() => this._set({ scope: "one" })}>${tr("This event")}</button>
              <button class="${f.scope === "future" ? "on" : ""}" @click=${() => this._set({ scope: "future" })}>${tr("This and following")}</button>
            </div>`
          : nothing}
        <textarea class="notes" .value=${f.description} placeholder=${tr("Notes")} @input=${(e: Event) => this._set({ description: v(e) })}></textarea>
        ${f.error ? html`<p class="err">${f.error}</p>` : nothing}
      </div>
    </div>`;
  }


  override getCardSize() {
    return 10;
  }

  static override styles = [
    GlassElement.styles,
    css`
      :host {
        display: block;
        --cv-text: #1d1d1f;
        --cv-soft: rgba(29, 29, 31, 0.6);
        --cv-line: rgba(29, 29, 31, 0.1);
      }
      /* over the page: the page dimmed and blurred behind it */
      :host([overlay]) {
        position: fixed;
        inset: 0;
        z-index: 10;
        display: grid;
        padding: 16px;
        box-sizing: border-box;
        background: rgba(0, 0, 0, 0.35);
        -webkit-backdrop-filter: blur(24px);
        backdrop-filter: blur(24px);
        animation: fade 0.2s ease;
      }
      :host([overlay][phone]) {
        padding: 0;
      }
      @keyframes fade {
        from {
          opacity: 0;
        }
      }
      .frame {
        position: relative;
        overflow: hidden;
        height: 640px;
        border-radius: var(--glass-radius, 28px);
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 18px;
        box-sizing: border-box;
        color: var(--cv-text);
        user-select: none;
        -webkit-user-select: none;
      }
      :host([overlay]) .frame {
        height: 100%;
        max-width: 1400px;
        width: 100%;
        margin: 0 auto;
      }
      :host([overlay][phone]) .frame {
        border-radius: 0;
      }
      :host([phone]) .frame {
        padding: 12px;
        gap: 10px;
      }
      .frame.dark {
        --cv-text: #fff;
        --cv-soft: rgba(255, 255, 255, 0.65);
        --cv-line: rgba(255, 255, 255, 0.12);
      }
      .photo {
        position: absolute;
        inset: 0;
        background-size: cover;
        background-position: center;
      }
      .frame.dark .photo {
        filter: brightness(0.6);
      }
      .head,
      .panel {
        position: relative;
      }
      .head {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .row {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }
      .row.top {
        gap: 12px;
      }
      .title {
        flex: 1;
        min-width: 0;
        margin: 0;
        font-size: 34px;
        font-weight: 700;
        letter-spacing: -0.02em;
        color: #fff;
        /* crisp, close to the letters: a wide soft one turns into a grey haze on a bright sky */
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35), 0 0 1px rgba(0, 0, 0, 0.25);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      :host([phone]) .title {
        font-size: 24px;
      }
      :host([small]) .title {
        font-size: 20px;
      }
      /* the switches: one glass track each, the picked item a solid pill in it */
      .seg {
        flex: none;
        display: inline-flex;
        align-items: center;
        gap: 2px;
        padding: 4px;
        border-radius: 999px;
      }
      /* by day the clear liquid glass, the photo bent through it, dark text on it (the shader's
         darkening is for white text, its milk would make it a grey pill) – as the alarm's */
      .seg {
        --glass-liquid-contrast: 0;
        --glass-liquid-tint: 0.06;
        --glass-liquid-blur: 3;
      }
      /* on the clear glass a busy photo (branches, leaves) shows through: a soft halo keeps the
         text and icons apart from it – light round dark text, dark round white text at night */
      .seg .item:not(.on) {
        text-shadow: 0 0 3px rgba(255, 255, 255, 0.95), 0 0 8px rgba(255, 255, 255, 0.7);
      }
      .seg .item:not(.on) ha-icon {
        filter: drop-shadow(0 0 2px rgba(255, 255, 255, 0.95)) drop-shadow(0 0 5px rgba(255, 255, 255, 0.6));
      }
      .frame.dark .seg .item:not(.on) {
        text-shadow: 0 0 3px rgba(0, 0, 0, 0.8), 0 0 8px rgba(0, 0, 0, 0.5);
      }
      .frame.dark .seg .item:not(.on) ha-icon {
        filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.8)) drop-shadow(0 0 5px rgba(0, 0, 0, 0.5));
      }
      .frame.dark .seg {
        --glass-liquid-contrast: initial;
        --glass-liquid-tint: initial;
        --glass-liquid-blur: initial;
      }
      .seg:not(.mat) {
        background: rgba(255, 255, 255, 0.55);
        -webkit-backdrop-filter: blur(12px);
        backdrop-filter: blur(12px);
      }
      .frame.dark .seg:not(.mat) {
        background: rgba(30, 30, 34, 0.5);
      }
      .scroll {
        flex: 1;
        min-width: 0;
        display: flex;
        justify-content: flex-end;
        overflow-x: auto;
        scrollbar-width: none;
      }
      .scroll::-webkit-scrollbar {
        display: none;
      }
      :host([phone]) .head .row:not(.top) {
        flex-direction: column;
        align-items: flex-start;
      }
      :host([phone]) .scroll {
        width: 100%;
        justify-content: flex-start;
      }
      .item {
        flex: none;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 32px;
        padding: 0 14px;
        border: 0;
        border-radius: 999px;
        background: none;
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        color: var(--cv-text);
        --mdc-icon-size: 18px;
      }
      /* the picked one a solid pill: grey, lighter at the top, a fine light edge above */
      .item.on,
      .item:not(.on):active {
        background: linear-gradient(180deg, #77777d, #4b4b51);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28), 0 1px 3px rgba(0, 0, 0, 0.22);
        color: #fff;
        text-shadow: none;
      }
      /* a tap shows: hovered faintly, pressed solid and a little smaller (‹ Today › change the view
         and nothing in the switch itself stays picked) */
      .item {
        transition: background 0.15s ease, color 0.15s ease, transform 0.12s ease;
      }
      @media (hover: hover) {
        .item:not(.on):not(:active):hover {
          background: color-mix(in srgb, currentColor 10%, transparent);
        }
      }
      .item:active {
        transform: scale(0.93);
      }
      .item:not(.on):active {
        transition-duration: 0s;
      }
      /* at night the picked one light: dark on dark wouldn't stand out */
      .frame.dark .item.on,
      .frame.dark .item:not(.on):active {
        background: linear-gradient(180deg, #ffffff, #dcdce1);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 1px 3px rgba(0, 0, 0, 0.35);
        color: #1d1d1f;
        text-shadow: none;
      }
      .item.round {
        width: 32px;
        padding: 0;
        justify-content: center;
      }
      :host([small]) .item {
        padding: 0 10px;
      }
      :host([small]) .item.round {
        padding: 0;
      }
      .cals .item:not(.on) span {
        opacity: 0.7;
      }
      .dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--c);
        flex: none;
      }
      .dot.hollow {
        background: none;
        box-shadow: inset 0 0 0 2px var(--c);
      }
      /* the glass over the photo, the view in it */
      .panel {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        border-radius: calc(var(--glass-radius, 28px) - 8px);
        overflow: hidden;
        /* the real liquid glass, clear: the photo bent through it (a milky one hides the lens);
           just enough white in it for dark text */
        --glass-liquid-contrast: 0;
        --glass-liquid-tint: 0.2;
        --glass-liquid-blur: 6;
        text-shadow: 0 1px 2px rgba(255, 255, 255, 0.55);
      }
      .frame.dark .panel {
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
      }
      .frame.dark .panel {
        --glass-liquid-contrast: initial;
        --glass-liquid-tint: initial;
        --glass-liquid-blur: initial;
      }
      .panel:not(.mat) {
        background: rgba(255, 255, 255, 0.6);
        -webkit-backdrop-filter: blur(24px) saturate(1.4);
        backdrop-filter: blur(24px) saturate(1.4);
      }
      /* at night: denser, a wider blur and less colour – the dimmed photo's sunset and blues
         would show through as blotches */
      .frame.dark .panel:not(.mat) {
        background: rgba(22, 22, 26, 0.74);
        -webkit-backdrop-filter: blur(44px) saturate(0.85);
        backdrop-filter: blur(44px) saturate(0.85);
      }
      .loading,
      .empty {
        margin: auto;
        color: var(--cv-soft);
        font-size: 15px;
      }
      /* an event: its calendar's colour */
      .ev {
        display: flex;
        align-items: center;
        gap: 4px;
        min-width: 0;
        width: 100%;
        margin-top: 2px;
        padding: 2px 6px;
        border: 0;
        border-radius: 6px;
        font: inherit;
        font-size: 12px;
        text-align: left;
        cursor: pointer;
        color: var(--cv-text);
        background: color-mix(in srgb, var(--c) 22%, transparent);
        box-shadow: inset 3px 0 0 var(--c);
      }
      .ev.all {
        background: color-mix(in srgb, var(--c) 70%, transparent);
        color: #fff;
        box-shadow: none;
      }
      .ev b {
        font-weight: 600;
        opacity: 0.75;
        flex: none;
      }
      .ev span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      /* month */
      .month {
        flex: 1;
        display: grid;
        grid-template-columns: repeat(7, minmax(0, 1fr));
        grid-template-rows: auto repeat(6, minmax(0, 1fr));
      }
      .wd {
        padding: 10px 0 6px;
        text-align: center;
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--cv-soft);
      }
      .cell {
        min-width: 0;
        overflow: hidden;
        padding: 4px 6px;
        border-top: 1px solid var(--cv-line);
        border-left: 1px solid var(--cv-line);
        cursor: pointer;
      }
      .cell.first {
        border-left: 0;
      }
      /* weekends: a light shade; a day a dragged event would land on: ringed */
      .cell.we,
      .col.we,
      .ad.we,
      .dh.we {
        background: color-mix(in srgb, var(--cv-text) 4%, transparent);
      }
      .cell.target {
        box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--cv-text) 35%, transparent);
      }
      .ad.off {
        background: color-mix(in srgb, #ff3b30 7%, transparent);
      }
      .offname {
        display: block;
        padding: 2px 4px;
        font-size: 11px;
        font-weight: 600;
        color: #d70015;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .frame.dark .offname {
        color: #ff6961;
      }
      .cell.other {
        opacity: 0.45;
      }
      .cell.off {
        background: color-mix(in srgb, #ff3b30 7%, transparent);
      }
      .num {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        font-weight: 600;
        min-width: 0;
      }
      .num span.open {
        cursor: pointer;
      }
      @media (hover: hover) {
        .num span.open:not(.today):hover {
          background: var(--cv-line);
        }
      }
      .num span {
        flex: none;
        display: inline-grid;
        place-items: center;
        min-width: 24px;
        height: 24px;
        border-radius: 12px;
      }
      .num span.today {
        background: var(--cv-today, #ff3b30);
        color: #fff;
      }
      .num small,
      .agenda h3 small {
        font-size: 11px;
        font-weight: 500;
        color: #d70015;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .frame.dark .num small,
      .frame.dark .agenda h3 small {
        color: #ff6961;
      }
      .more {
        font-size: 11px;
        font-weight: 600;
        color: var(--cv-soft);
        padding: 2px 6px;
      }
      /* agenda */
      .agenda {
        flex: 1;
        overflow-y: auto;
        padding: 6px 18px 18px;
        overscroll-behavior: contain;
      }
      .agenda section + section {
        margin-top: 6px;
      }
      .agenda h3 {
        position: sticky;
        top: 0;
        z-index: 1;
        display: flex;
        align-items: baseline;
        gap: 10px;
        margin: 0;
        padding: 12px 0 6px;
        font-size: 15px;
        font-weight: 700;
        cursor: pointer;
      }
      .row-ev {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        padding: 8px 0;
        border: 0;
        border-bottom: 1px solid var(--cv-line);
        background: none;
        font: inherit;
        color: inherit;
        text-align: left;
        cursor: pointer;
      }
      .row-ev .when {
        flex: none;
        width: 110px;
        font-size: 13px;
        color: var(--cv-soft);
        font-variant-numeric: tabular-nums;
      }
      :host([small]) .row-ev .when {
        width: 82px;
        font-size: 12px;
      }
      .row-ev .bar {
        flex: none;
        width: 4px;
        align-self: stretch;
        border-radius: 2px;
        background: var(--c);
      }
      .row-ev .what {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .row-ev b {
        font-weight: 600;
        font-size: 15px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .row-ev small {
        font-size: 12.5px;
        color: var(--cv-soft);
      }
      /* week / day */
      .days,
      .alldays {
        display: grid;
        border-bottom: 1px solid var(--cv-line);
      }
      .dh {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        padding: 8px 0 6px;
        border: 0;
        background: none;
        font: inherit;
        color: inherit;
        cursor: pointer;
      }
      .dh small {
        font-size: 11px;
        text-transform: uppercase;
        color: var(--cv-soft);
        font-weight: 700;
      }
      .dh b {
        display: grid;
        place-items: center;
        min-width: 30px;
        height: 30px;
        border-radius: 15px;
        font-size: 17px;
      }
      .dh.is-today b {
        color: var(--cv-today, #ff3b30);
      }
      .dh.picked b,
      .days:not(.strip) .dh.is-today b {
        background: var(--cv-today, #ff3b30);
        color: #fff;
      }
      .dh.picked:not(.is-today) b {
        background: rgba(60, 60, 67, 0.82);
      }
      /* at night the dark grey would vanish in the dark panel */
      .frame.dark .dh.picked:not(.is-today) b {
        background: rgba(255, 255, 255, 0.24);
      }
      .days.strip {
        grid-template-columns: repeat(7, minmax(0, 1fr));
      }
      .dh i {
        width: 4px;
        height: 4px;
        border-radius: 50%;
      }
      .dh i.has {
        background: var(--cv-soft);
      }
      .dh.off small {
        color: #d70015;
      }
      .alldays {
        min-height: 30px;
        align-items: start;
      }
      .alldays .lbl {
        font-size: 10.5px;
        color: var(--cv-soft);
        padding: 8px 6px;
        text-align: right;
      }
      .ad {
        padding: 2px 3px 4px;
        min-width: 0;
        border-left: 1px solid var(--cv-line);
      }
      .timeline {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
      }
      .tgrid {
        display: grid;
        position: relative;
        background-image: repeating-linear-gradient(to bottom, var(--cv-line) 0 1px, transparent 1px ${HOUR}px);
      }
      .hours {
        position: relative;
      }
      .hours span {
        position: absolute;
        right: 8px;
        transform: translateY(-50%);
        font-size: 11px;
        color: var(--cv-soft);
        font-variant-numeric: tabular-nums;
      }
      .col {
        position: relative;
        border-left: 1px solid var(--cv-line);
      }
      .col.is-today {
        background: color-mix(in srgb, var(--cv-today, #ff3b30) 5%, transparent);
      }
      .block {
        position: absolute;
        display: flex;
        flex-direction: column;
        gap: 1px;
        overflow: hidden;
        padding: 3px 6px;
        border: 0;
        border-radius: 8px;
        box-sizing: border-box;
        font: inherit;
        text-align: left;
        cursor: pointer;
        color: var(--cv-text);
        background: color-mix(in srgb, var(--c) 28%, transparent);
        box-shadow: inset 3px 0 0 var(--c);
      }
      /* an event that can move: grabbed, it lifts; its corner stretches it */
      .block.can-drag,
      .ev.can-drag {
        touch-action: pan-y;
      }
      .block.dragging,
      .ev.dragging {
        z-index: 5;
        cursor: grabbing;
        background: color-mix(in srgb, var(--c) 55%, var(--cv-bg-lift, rgba(255, 255, 255, 0.6)));
        box-shadow: inset 3px 0 0 var(--c), 0 10px 24px rgba(0, 0, 0, 0.28), 0 0 0 1.5px var(--c);
        transform: scale(1.04);
        /* picked up: it lifts; then it follows the grid's half hours smoothly */
        animation: lift 0.16s cubic-bezier(0.2, 0.9, 0.3, 1.2);
        transition: top 0.09s ease-out, left 0.09s ease-out, height 0.09s ease-out;
      }
      @keyframes lift {
        from {
          transform: none;
          box-shadow: inset 3px 0 0 var(--c);
        }
      }
      /* dropped: it settles, a little bounce, a ring that fades */
      .block.settle,
      .ev.settle {
        animation: settle 0.34s cubic-bezier(0.3, 1.4, 0.5, 1);
      }
      @keyframes settle {
        0% {
          transform: scale(1.04);
          box-shadow: inset 3px 0 0 var(--c), 0 10px 24px rgba(0, 0, 0, 0.28), 0 0 0 1.5px var(--c);
        }
        60% {
          transform: scale(0.985);
        }
        100% {
          transform: none;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .block.dragging,
        .ev.dragging {
          transform: none;
          animation: none;
          transition: none;
        }
        .block.settle,
        .ev.settle {
          animation: none;
        }
      }
      .frame.dark .block.dragging,
      .frame.dark .ev.dragging {
        --cv-bg-lift: rgba(40, 40, 46, 0.85);
      }
      .ghost {
        position: absolute;
        left: 2px;
        right: 2px;
        border-radius: 8px;
        border: 1.5px dashed color-mix(in srgb, var(--cv-text) 35%, transparent);
        box-sizing: border-box;
        pointer-events: none;
      }
      /* the picked event: ringed in its colour, above the others; a finger drags it (no scroll) */
      .block.sel,
      .ev.sel {
        z-index: 4;
        touch-action: none;
        background: color-mix(in srgb, var(--c) 42%, transparent);
        box-shadow: inset 3px 0 0 var(--c), 0 0 0 2px var(--c), 0 6px 16px rgba(0, 0, 0, 0.18);
      }
      .block.sel,
      .block.dragging {
        overflow: visible;
      }
      .row-ev.sel {
        background: color-mix(in srgb, var(--c) 16%, transparent);
        border-radius: 12px;
      }
      /* its top and bottom edges: a handle each, drag to make it start or end earlier / later */
      .edge {
        position: absolute;
        left: 0;
        right: 0;
        height: 18px;
        display: grid;
        place-items: center;
        cursor: ns-resize;
        touch-action: none;
        z-index: 2;
      }
      .edge.top {
        top: -9px;
      }
      .edge.bottom {
        bottom: -9px;
      }
      .edge i {
        width: 30px;
        height: 6px;
        border-radius: 3px;
        background: #fff;
        box-shadow: 0 0 0 1.5px var(--c), 0 1px 3px rgba(0, 0, 0, 0.25);
      }
      /* the detail: beside its event (no veil), or at the bottom on a phone */
      .detail {
        position: absolute;
        z-index: 6;
        pointer-events: none;
      }
      .detail.popwrap {
        inset: 0;
      }
      .detail.dock {
        left: 0;
        right: 0;
        bottom: 0;
      }
      .detail .sheet {
        pointer-events: auto;
        box-shadow: 0 14px 40px rgba(0, 0, 0, 0.28), 0 0 0 0.5px rgba(0, 0, 0, 0.08);
        animation: fade 0.15s ease;
      }
      .sheet.pop {
        position: absolute;
        width: 320px;
      }
      .detail.dock .sheet {
        width: 100%;
        border-radius: 24px 24px 0 0;
      }
      .block b {
        font-size: 12.5px;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .block small {
        font-size: 11px;
        opacity: 0.75;
      }
      .now {
        position: absolute;
        left: 0;
        right: 0;
        height: 2px;
        background: var(--cv-today, #ff3b30);
        pointer-events: none;
      }
      .now::before {
        content: "";
        position: absolute;
        left: -4px;
        top: -3px;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--cv-today, #ff3b30);
      }
      /* an event's detail: in the middle (a phone: from the bottom) */
      .scrim {
        position: absolute;
        inset: 0;
        z-index: 3;
        display: grid;
        place-items: center;
        padding: 16px;
        background: rgba(0, 0, 0, 0.18);
        animation: fade 0.15s ease;
      }
      :host([phone]) .scrim {
        place-items: end stretch;
        padding: 0;
      }
      .sheet {
        position: relative;
        width: min(440px, 100%);
        box-sizing: border-box;
        padding: 22px 22px 20px;
        border-radius: 24px;
        color: var(--cv-text);
        --glass-liquid-contrast: 0;
        --glass-liquid-tint: 0.35;
        --glass-liquid-blur: 10;
      }
      .frame.dark .sheet {
        --glass-liquid-contrast: initial;
        --glass-liquid-tint: initial;
        --glass-liquid-blur: initial;
      }
      .sheet:not(.mat) {
        background: rgba(255, 255, 255, 0.85);
        -webkit-backdrop-filter: blur(30px);
        backdrop-filter: blur(30px);
      }
      .frame.dark .sheet:not(.mat) {
        background: rgba(30, 30, 34, 0.85);
      }
      :host([phone]) .sheet {
        width: 100%;
        border-radius: 24px 24px 0 0;
        padding-bottom: calc(20px + env(safe-area-inset-bottom, 0px));
      }
      .sheet h3 {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 0 36px 14px 0;
        font-size: 20px;
        font-weight: 700;
      }
      .sheet .dot {
        width: 12px;
        height: 12px;
      }
      .sheet .line {
        display: flex;
        gap: 10px;
        align-items: flex-start;
        padding: 5px 0;
        font-size: 14.5px;
        --mdc-icon-size: 18px;
      }
      .sheet .line ha-icon {
        color: var(--cv-soft);
        flex: none;
      }
      .sheet .rep {
        --mdc-icon-size: 15px;
        vertical-align: -2px;
      }
      .sheet .desc {
        margin: 10px 0 0;
        padding-top: 10px;
        border-top: 1px solid var(--cv-line);
        font-size: 14px;
        line-height: 1.45;
        white-space: pre-wrap;
        max-height: 40vh;
        overflow: auto;
      }
      /* the detail's Edit / Delete, the form's buttons */
      .actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 16px;
      }
      .btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 38px;
        padding: 0 16px;
        border: 0;
        border-radius: 999px;
        font: inherit;
        font-size: 14.5px;
        font-weight: 600;
        cursor: pointer;
        color: var(--cv-text);
        background: var(--cv-line);
        --mdc-icon-size: 18px;
        transition: transform 0.12s ease, filter 0.15s ease;
      }
      .btn:active {
        transform: scale(0.95);
      }
      .btn:disabled {
        opacity: 0.5;
        cursor: default;
      }
      /* the one that does it: the switches' picked pill */
      .btn.solid {
        background: linear-gradient(180deg, #77777d, #4b4b51);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28), 0 1px 3px rgba(0, 0, 0, 0.22);
        color: #fff;
      }
      /* at night a button stands out of the sheet: light graphite, lit on top (not sunk in as a
         picked switch) */
      .frame.dark .btn.solid {
        background: linear-gradient(180deg, #6e6e76, #48484f);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28), 0 2px 6px rgba(0, 0, 0, 0.4);
        color: #fff;
      }
      .btn.danger {
        color: #ff3b30;
      }
      .btn.danger.solid {
        background: linear-gradient(180deg, #ff5a50, #e0281e);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.3), 0 1px 3px rgba(0, 0, 0, 0.22);
        color: #fff;
      }
      .ask {
        margin-top: 14px;
        padding-top: 12px;
        border-top: 1px solid var(--cv-line);
      }
      .ask p {
        margin: 0;
        font-size: 14.5px;
        font-weight: 600;
      }
      .ask .actions {
        margin-top: 12px;
      }
      .err {
        margin: 8px 0 0;
        color: #ff3b30;
        font-size: 13px;
      }
      /* the form, as Apple's: grouped rows on the sheet, every field a pill */
      .form {
        display: flex;
        flex-direction: column;
        gap: 14px;
        width: min(460px, 100%);
        max-height: 100%;
        overflow: auto;
        padding: 14px 18px 20px;
        --cv-fill: rgba(118, 118, 128, 0.12);
        --cv-group: rgba(255, 255, 255, 0.55);
      }
      .frame.dark .form {
        color-scheme: dark;
        --cv-fill: rgba(118, 118, 128, 0.26);
        --cv-group: rgba(255, 255, 255, 0.06);
      }
      .form .bar {
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        align-items: center;
        min-height: 40px;
      }
      .form .bar h3 {
        margin: 0;
        font-size: 17px;
        font-weight: 600;
        white-space: nowrap;
      }
      .form .link {
        justify-self: start;
        border: 0;
        padding: 8px 4px;
        background: none;
        font: inherit;
        font-size: 16px;
        color: var(--cv-text);
        opacity: 0.75;
        cursor: pointer;
      }
      .form .link.strong {
        justify-self: end;
        font-weight: 600;
        opacity: 1;
      }
      .form .link:disabled {
        opacity: 0.35;
      }
      .form .stack {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      /* a field: a pill */
      .form .pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        box-sizing: border-box;
        height: 40px;
        padding: 0 16px;
        border: 0;
        border-radius: 999px;
        font: inherit;
        font-size: 15px;
        color: inherit;
        background: var(--cv-fill);
        outline: none;
      }
      .form .stack .pill {
        height: 46px;
        padding: 0 20px;
        background: var(--cv-group);
      }
      .form .pill.name {
        font-size: 17px;
        font-weight: 600;
      }
      .form input::placeholder,
      .form textarea::placeholder {
        color: var(--cv-soft);
        opacity: 1;
      }
      .form .pill:focus-visible,
      .form .pill:focus-within,
      .form .notes:focus-visible {
        box-shadow: 0 0 0 2px var(--c);
      }
      /* the rows: a label on the left, the fields on the right, a hairline between */
      .form .group {
        display: flex;
        flex-direction: column;
        padding: 0 8px 0 18px;
        border-radius: 24px;
        background: var(--cv-group);
      }
      .form .row {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
        min-height: 54px;
        font-size: 16px;
      }
      .form .row + .row {
        border-top: 0.5px solid var(--cv-line);
      }
      .form .row > span:first-child {
        flex: 1;
        min-width: 0;
      }
      /* a date or a time: a pill; open, it's ringed, its picker under the row */
      .form .date,
      .form .time {
        cursor: pointer;
        font-variant-numeric: tabular-nums;
        transition: box-shadow 0.15s ease;
      }
      .form .time {
        min-width: 78px;
        justify-content: center;
      }
      .form .pill.open {
        box-shadow: 0 0 0 2px var(--c);
      }
      .form {
        --text: var(--cv-text);
        --text-2: var(--cv-soft);
        --band: var(--cv-fill);
        --accent: var(--c);
      }
      .wheels-row {
        padding: 4px 10px 10px 0;
      }
      .mini {
        padding: 2px 10px 12px 0;
      }
      .mhead {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px 0 6px;
      }
      .mhead b {
        flex: 1;
        font-size: 15px;
        font-weight: 600;
      }
      .mnav {
        display: grid;
        place-items: center;
        width: 32px;
        height: 32px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: var(--cv-fill);
        color: inherit;
        cursor: pointer;
        --mdc-icon-size: 20px;
      }
      .mgrid {
        display: grid;
        grid-template-columns: repeat(7, minmax(0, 1fr));
        gap: 2px;
        text-align: center;
      }
      .mwd {
        padding: 4px 0;
        font-size: 11px;
        font-weight: 600;
        color: var(--cv-soft);
      }
      .mday {
        justify-self: center;
        width: 36px;
        height: 36px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: none;
        font: inherit;
        font-size: 15px;
        font-variant-numeric: tabular-nums;
        color: inherit;
        cursor: pointer;
      }
      .mday.other {
        color: var(--cv-soft);
        opacity: 0.6;
      }
      .mday.today {
        color: var(--cv-today, #ff3b30);
        font-weight: 700;
      }
      .mday.on {
        background: linear-gradient(180deg, #77777d, #4b4b51);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28), 0 1px 3px rgba(0, 0, 0, 0.22);
        color: #fff;
        font-weight: 600;
      }
      .frame.dark .mday.on {
        background: linear-gradient(180deg, #ffffff, #dcdce1);
        color: #1d1d1f;
      }
      @media (hover: hover) {
        .mday:not(.on):hover {
          background: var(--cv-fill);
        }
      }
      /* a pick: its value and a small chevron, the select itself invisible over it */
      .form .select {
        position: relative;
        max-width: 60%;
        padding: 0 12px 0 16px;
        --mdc-icon-size: 16px;
      }
      .form .select select {
        appearance: none;
        -webkit-appearance: none;
        min-width: 0;
        border: 0;
        padding: 0;
        background: none;
        font: inherit;
        color: inherit;
        outline: none;
        cursor: pointer;
        text-overflow: ellipsis;
      }
      .form .select.fixed {
        padding-right: 16px;
      }
      .form .select.fixed select {
        cursor: default;
        opacity: 1;
      }
      .form .select ha-icon {
        flex: none;
        color: var(--cv-soft);
        pointer-events: none;
      }
      .form .select .dot {
        width: 10px;
        height: 10px;
        flex: none;
      }
      /* All day: a switch */
      .form .switch {
        appearance: none;
        -webkit-appearance: none;
        position: relative;
        flex: none;
        width: 51px;
        height: 31px;
        margin: 0;
        border-radius: 999px;
        background: var(--cv-fill);
        cursor: pointer;
        transition: background 0.2s ease;
      }
      .form .switch::after {
        content: "";
        position: absolute;
        top: 2px;
        left: 2px;
        width: 27px;
        height: 27px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.18), 0 0 0 0.5px rgba(0, 0, 0, 0.04);
        transition: transform 0.2s ease;
      }
      .form .switch:checked {
        background: #34c759;
      }
      .form .switch:checked::after {
        transform: translateX(20px);
      }
      /* a repeating event changed: this one or this and the following – a segmented pill */
      .form .choice {
        display: flex;
        padding: 3px;
        border-radius: 999px;
        background: var(--cv-fill);
      }
      .form .choice button {
        flex: 1;
        height: 34px;
        border: 0;
        border-radius: 999px;
        background: none;
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        color: inherit;
        cursor: pointer;
      }
      .form .choice button.on {
        background: linear-gradient(180deg, #77777d, #4b4b51);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28), 0 1px 3px rgba(0, 0, 0, 0.22);
        color: #fff;
      }
      .frame.dark .form .choice button.on {
        background: linear-gradient(180deg, #ffffff, #dcdce1);
        color: #1d1d1f;
      }
      .form .notes {
        min-height: 96px;
        box-sizing: border-box;
        padding: 14px 20px;
        border: 0;
        border-radius: 24px;
        font: inherit;
        font-size: 15px;
        color: inherit;
        background: var(--cv-group);
        resize: vertical;
        outline: none;
      }
      .form .err {
        margin: 0;
        text-align: center;
      }
      /* a small phone: the date shorter, the rows tighter */
      :host([small]) .form {
        padding: 12px 14px 18px;
      }
      :host([small]) .form .group {
        padding: 0 6px 0 14px;
      }
      :host([small]) .form .pill {
        padding: 0 12px;
        font-size: 14.5px;
      }
      :host([small]) .form .time {
        min-width: 64px;
        padding: 0 10px;
      }
      .sheet .x {
        position: absolute;
        top: 14px;
        right: 14px;
        display: grid;
        place-items: center;
        width: 32px;
        height: 32px;
        border: 0;
        border-radius: 50%;
        cursor: pointer;
        color: var(--cv-text);
        background: var(--cv-line);
        --mdc-icon-size: 18px;
      }
      /* at night the picked one sunk into the dark glass: darker than it, pressed in – a solid
         white pill would glare */
      .frame.dark .item.on,
      .frame.dark .item:not(.on):active,
      .frame.dark .mday.on,
      .frame.dark .form .choice button.on {
        background: rgba(0, 0, 0, 0.45);
        box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.6), 0 1px 0 rgba(255, 255, 255, 0.12);
        color: #fff;
        text-shadow: none;
      }
      /* a picked colour of your own (picked_color): by day and at night */
      .frame.own-picked .item.on,
      .frame.own-picked .mday.on,
      .frame.own-picked .form .choice button.on {
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.2), rgba(255, 255, 255, 0) 60%), var(--cv-picked);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.3), 0 1px 3px rgba(0, 0, 0, 0.25);
        color: #fff;
        text-shadow: 0 1px 1px rgba(0, 0, 0, 0.25);
      }
      /* a material picked against the time of day: the text follows the glass, not the day –
         white on a dark glass by day, dark on a light glass at night */
      .seg:is(.mat-dark, .mat-dark-liquid, .mat-dark-liquid-gl),
      .panel:is(.mat-dark, .mat-dark-liquid, .mat-dark-liquid-gl),
      .sheet:is(.mat-dark, .mat-dark-liquid, .mat-dark-liquid-gl) {
        --cv-text: #fff;
        --cv-soft: rgba(255, 255, 255, 0.65);
        --cv-line: rgba(255, 255, 255, 0.14);
        color: #fff;
      }
      .seg:is(.mat-dark, .mat-dark-liquid, .mat-dark-liquid-gl) .item:not(.on) {
        text-shadow: 0 0 3px rgba(0, 0, 0, 0.8), 0 0 8px rgba(0, 0, 0, 0.5);
      }
      .seg:is(.mat-dark, .mat-dark-liquid, .mat-dark-liquid-gl) .item:not(.on) ha-icon {
        filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.8)) drop-shadow(0 0 5px rgba(0, 0, 0, 0.5));
      }
      .panel:is(.mat-dark, .mat-dark-liquid, .mat-dark-liquid-gl) {
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
      }
      .frame.dark .seg:is(.mat-liquid, .mat-liquid-gl, .mat-frosted),
      .frame.dark .panel:is(.mat-liquid, .mat-liquid-gl, .mat-frosted),
      .frame.dark .sheet:is(.mat-liquid, .mat-liquid-gl, .mat-frosted) {
        --cv-text: #1d1d1f;
        --cv-soft: rgba(29, 29, 31, 0.6);
        --cv-line: rgba(29, 29, 31, 0.1);
        color: #1d1d1f;
      }
      .frame.dark .seg:is(.mat-liquid, .mat-liquid-gl, .mat-frosted) .item:not(.on) {
        text-shadow: 0 0 3px rgba(255, 255, 255, 0.95), 0 0 8px rgba(255, 255, 255, 0.7);
      }
      .frame.dark .seg:is(.mat-liquid, .mat-liquid-gl, .mat-frosted) .item:not(.on) ha-icon {
        filter: drop-shadow(0 0 2px rgba(255, 255, 255, 0.95)) drop-shadow(0 0 5px rgba(255, 255, 255, 0.6));
      }
      .frame.dark .panel:is(.mat-liquid, .mat-liquid-gl, .mat-frosted) {
        text-shadow: 0 1px 2px rgba(255, 255, 255, 0.55);
      }
    `,
    // after the card's own rules: a material picked for a part replaces its default glass
    materials,
  ];
}

/** The large view over the page, for a card that opens it (the Calendar card): its calendars. */
export function openCalendarView(from: Element, hass: HomeAssistant | undefined, config: Partial<ViewConfig>) {
  document.querySelectorAll("glass-calendar-view[overlay]").forEach((e) => e.remove());
  const el = document.createElement("glass-calendar-view") as GlassCalendarView;
  el.opener = from;
  el.setConfig({ type: "custom:glass-calendar-view", ...config, overlay: true });
  if (hass) el.hass = hass;
  layerFor(from).append(el);
  return el;
}

registerCard("glass-calendar-view", GlassCalendarView, {
  name: "Glass – full calendar",
  description: "A full-size calendar – month, week, day or agenda: add, edit and drag events. Opens from the Calendar card.",
});
