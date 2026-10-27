import { tr } from "../i18n";
import { css, html, nothing } from "lit";
import { GlassElement } from "../core/glass-element";
import type { ActionConfig, BaseCardConfig, HomeAssistant } from "../core/types";
import { registerCard } from "../core/registry";
import { makeEditor } from "../editor/editor";
import { calendarSpec } from "../editor/specs";
import { cssColor } from "../core/colors";
import { hour12, language } from "../core/settings";
import { pressHandlers, runAction, type ActionKind } from "../core/actions";
import { CALENDAR_PARTS } from "../core/card-parts";
import { surface } from "../core/styles";

/**
 * Upcoming events from one or more calendars, grouped by day.
 *
 *   type: custom:glass-calendar
 *   days: 5
 *   max_events: 6
 *   show_location: false
 *   hide_empty: false
 *   fit: true            # in a column: takes the space left, scrolls inside and fades out at the bottom
 *   calendars:
 *     - entity: calendar.family
 *       color: blue
 *     - entity: calendar.work
 *       color: orange
 *
 * Events come from HA's calendar API, fetched when the card appears, when a
 * calendar entity changes state (an event starts or ends), every 15 minutes and
 * just after midnight – never on unrelated state changes.
 */
interface CalendarSource {
  entity: string;
  name?: string;
  color?: string;
}

interface CalendarConfig extends BaseCardConfig {
  calendars?: (CalendarSource | string)[];
  entities?: string[];
  days?: number;
  max_events?: number;
  show_location?: boolean;
  show_title?: boolean;
  title?: string;
  hide_empty?: boolean;
  fit?: boolean;
  tap_action?: ActionConfig;
}

interface ApiEvent {
  summary: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  location?: string;
}

interface Ev {
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location?: string;
  color: string;
}

const PALETTE = ["blue", "orange", "green", "purple", "pink", "teal", "yellow", "red"];
const REFRESH_MS = 15 * 60 * 1000;

/** "2026-10-08" → local midnight (Date parses date-only strings as UTC). */
const localDate = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day);
};
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

class GlassCalendar extends GlassElement<CalendarConfig> {
  static override parts = CALENDAR_PARTS;
  static override properties = { ...GlassElement.properties, _events: { state: true }, _error: { state: true } };
  declare _events?: Ev[];
  declare _error?: string;

  private _sources: Required<Pick<CalendarSource, "entity" | "color">>[] = [];
  private _timer?: number;
  private _midnight?: number;
  private _loading = false;

  static getConfigElement() {
    return makeEditor(calendarSpec);
  }

  static getStubConfig(hass: HomeAssistant) {
    const cal = Object.keys(hass.states).find((e) => e.startsWith("calendar."));
    return { calendars: cal ? [{ entity: cal }] : [] };
  }

  protected override validateConfig(c: CalendarConfig) {
    const list = [...(c.calendars ?? []), ...(c.entities ?? [])];
    if (!list.length) throw new Error("`calendars` must list at least one calendar entity");
    this._sources = list.map((s, i) => {
      const src = typeof s === "string" ? { entity: s } : s;
      return { entity: src.entity, color: cssColor(src.color ?? PALETTE[i % PALETTE.length]) ?? "#fff" };
    });
    this._events = undefined;
    if (this.isConnected) this._fetch();
    return c;
  }

  protected watchedEntities() {
    return this._sources.map((s) => s.entity);
  }

  /** A calendar entity changed (event started / ended, calendar edited) → refetch. */
  protected override hassChanged() {
    this._fetch();
  }

  override connectedCallback() {
    super.connectedCallback();
    this._timer = window.setInterval(() => this._fetch(), REFRESH_MS);
    this._scheduleMidnight();
    if (this._hass && this._config) this._fetch();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this._timer);
    clearTimeout(this._midnight);
  }

  private _scheduleMidnight() {
    clearTimeout(this._midnight);
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 10);
    this._midnight = window.setTimeout(() => {
      this._fetch();
      this._scheduleMidnight();
    }, next.getTime() - now.getTime());
  }

  private async _fetch() {
    const hass = this._hass;
    if (!hass?.callApi || !this._config || this._loading) return;
    this._loading = true;
    const from = startOfDay(new Date());
    const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + Math.max(1, this._config.days ?? 5));
    const q = `start=${encodeURIComponent(from.toISOString())}&end=${encodeURIComponent(to.toISOString())}`;
    try {
      const lists = await Promise.all(
        this._sources.map(async (s) => {
          const evs = await hass.callApi!<ApiEvent[]>("GET", `calendars/${s.entity}?${q}`).catch(() => [] as ApiEvent[]);
          return evs.map<Ev>((e) => {
            const allDay = !e.start.dateTime;
            return {
              title: e.summary || "—",
              start: allDay ? localDate(e.start.date!) : new Date(e.start.dateTime!),
              end: allDay ? localDate(e.end.date!) : new Date(e.end.dateTime!),
              allDay,
              location: e.location || undefined,
              color: s.color,
            };
          });
        }),
      );
      const now = Date.now();
      this._events = lists
        .flat()
        .filter((e) => e.end.getTime() > now)
        .sort((a, b) => a.start.getTime() - b.start.getTime() || Number(b.allDay) - Number(a.allDay));
      this._error = undefined;
    } catch (err) {
      this._error = String(err);
    } finally {
      this._loading = false;
    }
  }

  private _dayLabel(d: Date, lang: string): string {
    const today = startOfDay(new Date());
    const diff = Math.round((startOfDay(d).getTime() - today.getTime()) / 86400000);
    if (diff <= 0 || diff === 1) {
      const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
      const s = rtf.format(Math.max(0, diff), "day");
      return s.charAt(0).toUpperCase() + s.slice(1);
    }
    const s = new Intl.DateTimeFormat(lang, { weekday: "short", day: "numeric", month: "numeric" }).format(d);
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  private _time(e: Ev, lang: string, h12: boolean | undefined): string {
    if (e.allDay) return tr("all day");
    const now = Date.now();
    if (e.start.getTime() <= now) {
      const mins = Math.max(1, Math.round((e.end.getTime() - now) / 60000));
      const rest = mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60 ? `${mins % 60} min` : ""}`.trim() : `${mins} min`;
      return tr("{rest} left", { rest });
    }
    return new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit", hour12: h12 }).format(e.start);
  }

  protected override render() {
    if (!this._config || !this._hass) return nothing;
    const c = this._config;
    const hass = this._hass;
    const lang = language(hass);
    const h12 = hour12(hass);
    const events = (this._events ?? []).slice(0, c.max_events ?? 6);
    if (this._events && !events.length && c.hide_empty) return nothing;
    // the rest of the days asked for: "+2 more" instead of running over the panel
    const more = (this._events?.length ?? 0) - events.length;

    // group by day; an all-day / multi-day event already running counts as today
    const today = startOfDay(new Date());
    const groups = new Map<string, { label: string; events: Ev[] }>();
    for (const e of events) {
      const d = e.start < today ? today : e.start;
      const k = dayKey(d);
      if (!groups.has(k)) groups.set(k, { label: this._dayLabel(d, lang), events: [] });
      groups.get(k)!.events.push(e);
    }

    const target = { entity: this._sources[0]?.entity, tap_action: c.tap_action ?? { action: "navigate", navigation_path: "/calendar" } };
    const h = pressHandlers(
      () => target,
      (kind: ActionKind) => runAction(this, hass, target, kind),
    );

    this.toggleAttribute("fit", !!c.fit);
    return html`<div class="cal ${this.tile}" role="button" tabindex="0" @pointerdown=${h.down} @pointermove=${h.move} @pointerup=${h.up} @pointercancel=${h.cancel} @keydown=${h.key}>
      ${c.show_title ? html`<div class="title">${c.title ?? tr("Calendar")}</div>` : nothing}
      ${!this._events
        ? html`<div class="empty">…</div>`
        : !events.length
          ? html`<div class="empty">${tr("No events in the next few days")}</div>`
          : [...groups.values()].map(
              (g) => html`<div class="day">
                <div class="label">${g.label}</div>
                ${g.events.map(
                  (e) => html`<div class="ev">
                    <i class="dot" style="background:${e.color}"></i>
                    <span class="time">${this._time(e, lang, h12)}</span>
                    <span class="what"
                      ><span class="name">${e.title}</span>${c.show_location && e.location ? html`<span class="loc">${e.location}</span>` : nothing}</span
                    >
                  </div>`,
                )}
              </div>`,
            )}
      ${more > 0 ? html`<div class="more">+${more} ${tr("more")}</div>` : nothing}
    </div>`;
  }

  static override styles = [
    GlassElement.styles,
    surface,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      /* fit: the rest of the column; scrolls inside, the last lines fade out */
      :host([fit]) {
        flex: 1 1 0 !important;
        min-height: 0;
      }
      :host([fit]) .cal {
        height: 100%;
        overflow-y: auto;
        overscroll-behavior: contain;
        scrollbar-width: none;
        -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 36px), transparent);
        mask-image: linear-gradient(to bottom, #000 calc(100% - 36px), transparent);
        padding-bottom: 28px;
        box-sizing: border-box;
      }
      :host([fit]) .cal::-webkit-scrollbar {
        display: none;
      }
      .more {
        font-size: 12px;
        opacity: 0.6;
      }
      .cal {
        display: flex;
        flex-direction: column;
        gap: 12px;
        text-shadow: var(--g-text-shadow);
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        outline: none;
      }
      /* home tiles on a panel without glass: the calendar is its own tile */
      :host([on-bare][glass="home"]) .cal {
        --g-text: var(--glass-home-text, #1c1c1e);
        --g-text-2: var(--glass-home-text-2, rgba(60, 60, 67, 0.68));
        --g-text-shadow: none;
        color: var(--g-text);
        padding: 16px 20px;
        border-radius: var(--g-radius);
        background: var(--glass-home-surface, rgba(246, 246, 248, 0.8));
        border: 0.5px solid var(--glass-home-border, rgba(255, 255, 255, 0.35));
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
        -webkit-backdrop-filter: blur(calc(var(--glass-home-blur, 24px) * var(--glass-blur-scale, 1))) saturate(var(--glass-home-saturate, 100%));
        backdrop-filter: blur(calc(var(--glass-home-blur, 24px) * var(--glass-blur-scale, 1))) saturate(var(--glass-home-saturate, 100%));
      }
      .title {
        font-size: 15px;
        font-weight: 600;
      }
      .day {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .label {
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--g-text-2);
      }
      .ev {
        display: grid;
        grid-template-columns: 10px minmax(64px, auto) 1fr;
        align-items: baseline;
        column-gap: 8px;
        font-size: 15px;
        font-weight: 400;
      }
      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        align-self: center;
      }
      .time {
        color: var(--g-text-2);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .what {
        min-width: 0;
        display: flex;
        flex-direction: column;
      }
      .name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .loc {
        font-size: 12.5px;
        color: var(--g-text-2);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .empty {
        font-size: 15px;
        font-weight: 300;
        color: var(--g-text-2);
      }
    `,
  ];
}

registerCard("glass-calendar", GlassCalendar, {
  name: "Glass – calendar",
  description: "Upcoming events from HA calendars, grouped by day.",
});
