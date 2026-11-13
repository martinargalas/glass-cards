import { tr } from "../i18n";
import type { HomeAssistant } from "./types";
import { hour12, language } from "./settings";
import blueprintYaml from "../../blueprints/automation/glass_alarm.yaml?raw";

/**
 * What the alarm cards share (glass-alarm, glass-alarms): an alarm's helpers, its days, when it
 * rings next – days off skipped (all-day events in calendars: public holidays, a holiday…) – the week as the user's country starts it, and the
 * alarms the cards create themselves (a set of helpers and an automation from the Glass alarm
 * blueprint, which ships in the bundle).
 */

export const WEEK = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Day = (typeof WEEK)[number];
export const WEEKDAYS: Day[] = ["mon", "tue", "wed", "thu", "fri"];
export const WEEKENDS: Day[] = ["sat", "sun"];

/** An alarm's helpers: the time is all it needs. */
export interface AlarmHelpers {
  /** the time: an input_datetime (time only) */
  entity: string;
  /** on / off: an input_boolean (or a switch) */
  switch?: string;
  /** the days it rings: an input_text ("mon,tue,wed,thu,fri", "once") */
  days?: string;
  /** days off skipped (the calendars' all-day events) – on / off: an input_boolean */
  skip_holidays?: string;
  /** its name: an input_text (alarms the cards created) or a text */
  name?: string;
  /** where it rings: an input_text with media players, comma separated */
  player?: string;
  /** what plays: an input_text with a sound's address */
  sound?: string;
}

/** The days a helper's text names – undefined = once. Short names, long ones, any case and separator. */
export function parseDays(s: string | undefined): Set<Day> | undefined {
  const t = (s ?? "").toLowerCase().trim();
  if (!t || t === "once" || t === "unknown" || t === "unavailable") return undefined;
  if (t === "daily" || t === "every day" || t === "all") return new Set(WEEK);
  if (t === "workdays" || t === "weekdays") return new Set(WEEKDAYS);
  if (t === "weekends") return new Set(WEEKENDS);
  const out = new Set<Day>();
  for (const w of t.split(/[\s,;|]+/)) {
    const d = WEEK.find((x) => w.startsWith(x));
    if (d) out.add(d);
  }
  return out.size ? out : undefined;
}

/** The text the helper gets: the days in the week's order, or "once". */
export const writeDays = (d: Set<Day> | undefined) => (d?.size ? WEEK.filter((x) => d.has(x)).join(",") : "once");
export const sameDays = (a: Set<Day> | undefined, b: readonly Day[]) => !!a && a.size === b.length && b.every((x) => a.has(x));
/** Date → its day of the week. */
export const dayOf = (d: Date): Day => WEEK[(d.getDay() + 6) % 7];
export const dateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Countries whose week starts on Monday regardless of the language (Europe): the HA's country. */
const MONDAY_COUNTRIES = new Set(
  "AD AL AM AT AZ BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GE GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SK SM TR UA VA XK".split(" "),
);

/**
 * The day the week starts: the HA profile's first weekday, else Monday in Europe (by the HA's
 * time zone or country – a fresh install's country is often left at US), else as the language
 * counts it (Sunday in American English).
 */
export function firstDay(hass?: HomeAssistant): Day {
  const fw = hass?.locale?.first_weekday;
  if (fw && fw !== "language") {
    const d = WEEK.find((x) => fw.startsWith(x));
    if (d) return d;
  }
  if (hass?.config?.time_zone?.startsWith("Europe/")) return "mon";
  const country = hass?.config?.country?.toUpperCase();
  if (country && MONDAY_COUNTRIES.has(country)) return "mon";
  const lang = language(hass);
  try {
    const loc = new Intl.Locale(lang) as Intl.Locale & { weekInfo?: { firstDay: number }; getWeekInfo?: () => { firstDay: number } };
    const n = loc.getWeekInfo?.().firstDay ?? loc.weekInfo?.firstDay;
    if (n) return WEEK[n - 1];
  } catch {
    /* an odd language tag: Monday */
  }
  return lang === "en" || lang === "en-US" ? "sun" : "mon";
}

/** The days of the week in the order the user's week runs. */
export function weekOrder(hass?: HomeAssistant): Day[] {
  const i = WEEK.indexOf(firstDay(hass));
  return [...WEEK.slice(i), ...WEEK.slice(0, i)];
}

/** A day's name in the user's language: Po / Pondělí, Mon / Monday. */
export function dayName(hass: HomeAssistant | undefined, d: Day, style: "short" | "long" | "narrow" = "short") {
  // 2024-01-01 was a Monday
  const s = new Intl.DateTimeFormat(language(hass), { weekday: style }).format(new Date(2024, 0, 1 + WEEK.indexOf(d)));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** How it repeats, in words: Once, Weekdays, Every day, Weekends – or the days. */
export function repeatText(hass: HomeAssistant | undefined, d: Set<Day> | undefined) {
  if (!d) return tr("Once");
  if (sameDays(d, WEEK)) return tr("Every day");
  if (sameDays(d, WEEKDAYS)) return tr("Weekdays");
  if (sameDays(d, WEEKENDS)) return tr("Weekends");
  return weekOrder(hass)
    .filter((x) => d.has(x))
    .map((x) => dayName(hass, x))
    .join(", ");
}

/** 12 hours (AM / PM): as the HA profile says, else as the language writes the time. */
export function uses12h(hass?: HomeAssistant): boolean {
  return hour12(hass) ?? new Intl.DateTimeFormat(language(hass), { hour: "numeric" }).resolvedOptions().hour12 ?? false;
}

/** A time for the big clock: 06:30, or 6:30 with AM / PM apart. */
export function clockParts(hass: HomeAssistant | undefined, h: number, m: number): { time: string; ap?: string } {
  const mm = String(m).padStart(2, "0");
  if (!uses12h(hass)) return { time: `${String(h).padStart(2, "0")}:${mm}` };
  return { time: `${h % 12 === 0 ? 12 : h % 12}:${mm}`, ap: tr(h < 12 ? "AM" : "PM") };
}

/** An input_datetime's time: [hours, minutes]. */
export function timeOf(hass: HomeAssistant | undefined, id: string): [number, number] | undefined {
  const st = hass?.states[id];
  const m = /^(\d{1,2}):(\d{2})/.exec(st?.state ?? "");
  if (m) return [Number(m[1]), Number(m[2])];
  const a = st?.attributes;
  return typeof a?.hour === "number" ? [a.hour, a.minute ?? 0] : undefined;
}

export interface NextRing {
  at: Date;
  /** a day off skipped on the way (its event's name) */
  skipped?: { date: Date; name: string };
}

/** When it rings next – within two weeks – the holidays (by date) skipped. */
export function nextRing(time: [number, number] | undefined, on: boolean, days: Set<Day> | undefined, holidays?: Map<string, string>): NextRing | undefined {
  if (!time || !on) return undefined;
  const now = new Date();
  let skipped: NextRing["skipped"];
  for (let i = 0; i < 15; i++) {
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, time[0], time[1]);
    if (at <= now) continue;
    // once: the next time the clock gets there, whatever the day
    if (!days) return { at };
    if (!days.has(dayOf(at))) continue;
    const h = holidays?.get(dateKey(at));
    if (h) {
      skipped ??= { date: at, name: h };
      continue;
    }
    return { at, skipped };
  }
  return undefined;
}

/** When it rings next, in words: Today 6:30, Tomorrow 6:30, Monday 6:30, Tue 24. 11. 6:30 – and the holiday skipped. */
export function nextText(hass: HomeAssistant | undefined, n: NextRing | undefined, on: boolean, skipping: boolean): { when: string; skipped?: string } {
  if (!on) return { when: tr("Off") };
  if (!n) return { when: skipping ? tr("Not in the next two weeks") : "–" };
  const lang = language(hass);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(n.at);
  day.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - today.getTime()) / 86400000);
  const time = new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit", hour12: uses12h(hass) }).format(n.at);
  const when =
    diff === 0
      ? tr("Today {time}", { time })
      : diff === 1
        ? tr("Tomorrow {time}", { time })
        : diff < 7
          ? `${dayName(hass, dayOf(n.at), "long")} ${time}`
          : `${new Intl.DateTimeFormat(lang, { weekday: "short", day: "numeric", month: "numeric" }).format(n.at)} ${time}`;
  return { when, skipped: n.skipped ? tr("{name} skipped", { name: n.skipped.name }) : undefined };
}

/**
 * Days off in a calendar for the next two weeks, by date: its all-day events only – a public
 * holiday, a holiday, "no alarm" – not a meeting at 6:00. Fetched at most once an hour.
 */
const holidayCache = new Map<string, { at: number; days: Map<string, string>; pending?: Promise<Map<string, string>> }>();
export function holidays(hass: HomeAssistant | undefined, cal: string | undefined, onLoad: () => void): Map<string, string> | undefined {
  if (!cal || !hass?.callApi) return undefined;
  const c = holidayCache.get(cal);
  if (c && (c.pending || Date.now() - c.at < 3600000)) {
    c.pending?.then(onLoad);
    return c.days;
  }
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 15);
  const q = `start=${encodeURIComponent(from.toISOString())}&end=${encodeURIComponent(to.toISOString())}`;
  const entry = { at: Date.now(), days: c?.days ?? new Map<string, string>(), pending: undefined as Promise<Map<string, string>> | undefined };
  entry.pending = hass
    .callApi<{ summary: string; start: { date?: string; dateTime?: string }; end: { date?: string; dateTime?: string } }[]>("GET", `calendars/${cal}?${q}`)
    .then((evs) => {
      const map = new Map<string, string>();
      for (const e of evs) {
        // all-day events only
        const s = e.start.date;
        const end = e.end.date;
        if (!s) continue;
        // every day of it (an all-day event's end is the day after)
        const d = new Date(`${s}T00:00:00`);
        const stop = end && end > s ? new Date(`${end}T00:00:00`) : new Date(d.getTime() + 86400000);
        for (; d < stop; d.setDate(d.getDate() + 1)) map.set(dateKey(d), e.summary);
      }
      entry.days = map;
      entry.pending = undefined;
      return map;
    })
    .catch(() => {
      entry.at = 0;
      entry.pending = undefined;
      return entry.days;
    });
  holidayCache.set(cal, entry);
  entry.pending.then(onLoad);
  return entry.days;
}

/** Days off in any of the calendars, by date (the first calendar's name for a day in several). */
export function daysOff(hass: HomeAssistant | undefined, cals: string[] | string | undefined, onLoad: () => void): Map<string, string> | undefined {
  const list = calendarsOf(cals);
  if (!list.length) return undefined;
  const out = new Map<string, string>();
  for (const cal of list) for (const [k, v] of holidays(hass, cal, onLoad) ?? []) if (!out.has(k)) out.set(k, v);
  return out;
}

/** The calendars set: one, several, or none. */
export const calendarsOf = (c: string[] | string | undefined): string[] => (Array.isArray(c) ? c : c ? [c] : []).filter((x) => typeof x === "string" && x.startsWith("calendar."));

/** The melody that ships with the cards (dist/sound-birds.mp3), as a path on this Home Assistant. */
export function defaultSound(): string {
  // the bundle's own address in a variable: Vite would resolve `new URL(…, import.meta.url)` at build time
  const bundle = import.meta.url;
  return new URL("./sound-birds.mp3", bundle).pathname;
}

/** A sound's name for the list: the shipped melody by its name, else the file's. */
export function soundName(url: string | undefined): string {
  if (!url || url === defaultSound() || /sound-birds\.mp3$/.test(url)) return tr("Birds");
  const file = decodeURIComponent(url.split(/[/?#]/).filter(Boolean).pop() ?? url);
  return file.replace(/\.(mp3|ogg|wav|m4a|flac|aac)$/i, "");
}

/* ── alarms the cards create: glass_alarm_<n> ──────────────────────────────── */

const PREFIX = "glass_alarm_";
/** The blueprint's path in HA (blueprints/automation/<path>): the same as a manual import's. */
export const BLUEPRINT_PATH = "glass-cards/glass_alarm.yaml";

/** The helpers of alarm n the cards created. */
export function managedHelpers(n: number): Required<AlarmHelpers> {
  const id = `${PREFIX}${n}`;
  return {
    entity: `input_datetime.${id}_time`,
    switch: `input_boolean.${id}`,
    days: `input_text.${id}_days`,
    skip_holidays: `input_boolean.${id}_holidays`,
    name: `input_text.${id}_name`,
    player: `input_text.${id}_player`,
    sound: `input_text.${id}_sound`,
  };
}

/** The alarms the cards created, found by their helpers: their numbers, in order. */
export function managedAlarms(hass: HomeAssistant | undefined): number[] {
  if (!hass) return [];
  const re = /^input_datetime\.glass_alarm_(\d+)_time$/;
  return Object.keys(hass.states)
    .map((id) => re.exec(id)?.[1])
    .filter((n): n is string => !!n)
    .map(Number)
    .sort((a, b) => a - b);
}

/** Is alarm n one the cards created (its helpers named so)? */
export const managedNumber = (h: AlarmHelpers): number | undefined => {
  const m = /^input_datetime\.glass_alarm_(\d+)_time$/.exec(h.entity);
  return m ? Number(m[1]) : undefined;
};

/**
 * A new alarm: its helpers and its automation from the Glass alarm blueprint (saved into HA
 * first, from the bundle). Needs an administrator. Returns its number.
 */
export async function createAlarm(hass: HomeAssistant, opts: { name: string; time: string; days: string; player: string; sound: string; skip?: boolean; calendars?: string[] }): Promise<number> {
  const taken = new Set(managedAlarms(hass));
  let n = 1;
  while (taken.has(n)) n++;
  const base = `Glass alarm ${n}`;
  const ws = <T>(msg: Record<string, unknown>) => hass.callWS<T>(msg);
  // the names make the entity ids (glass_alarm_<n>_…)
  await ws({ type: "input_boolean/create", name: base, icon: "mdi:alarm" });
  await ws({ type: "input_datetime/create", name: `${base} time`, has_date: false, has_time: true, icon: "mdi:clock-outline" });
  await ws({ type: "input_text/create", name: `${base} days`, max: 100, icon: "mdi:calendar-week" });
  await ws({ type: "input_text/create", name: `${base} name`, max: 100, icon: "mdi:label-outline" });
  await ws({ type: "input_text/create", name: `${base} player`, max: 255, icon: "mdi:speaker" });
  await ws({ type: "input_text/create", name: `${base} sound`, max: 255, icon: "mdi:music-note" });
  await ws({ type: "input_boolean/create", name: `${base} holidays`, icon: "mdi:calendar-star" });
  const h = managedHelpers(n);
  // the helpers' first values (a new entity takes a moment to exist)
  await waitFor(hass, [h.entity, h.days, h.name, h.player, h.sound]);
  await hass.callService("input_datetime", "set_datetime", { entity_id: h.entity, time: opts.time });
  await hass.callService("input_text", "set_value", { entity_id: h.days, value: opts.days });
  if (opts.name) await hass.callService("input_text", "set_value", { entity_id: h.name, value: opts.name });
  if (opts.player) await hass.callService("input_text", "set_value", { entity_id: h.player, value: opts.player });
  await hass.callService("input_text", "set_value", { entity_id: h.sound, value: opts.sound || defaultSound() });
  await hass.callService("input_boolean", "turn_on", { entity_id: opts.skip === false ? h.switch : [h.switch, h.skip_holidays] });
  await installBlueprint(hass);
  await hass.callApi!("POST", `config/automation/config/${PREFIX}${n}`, {
    alias: base,
    description: "Rings the alarm set in the Glass alarm cards. Created by the cards: change it there.",
    use_blueprint: {
      path: BLUEPRINT_PATH,
      input: {
        time_entity: h.entity,
        switch_entity: h.switch,
        days_entity: h.days,
        skip_calendars: opts.calendars ?? [],
        skip_holidays_entity: h.skip_holidays,
        players_entity: h.player,
        sound_entity: h.sound,
      },
    },
  });
  return n;
}

/** Saves the blueprint that ships with the cards into HA (over an older copy). */
async function installBlueprint(hass: HomeAssistant) {
  await hass.callWS({
    type: "blueprint/save",
    domain: "automation",
    path: BLUEPRINT_PATH.replace(/\.yaml$/, ""),
    yaml: blueprintYaml,
    source_url: "https://github.com/martinargalas/glass-cards/blob/main/blueprints/automation/glass_alarm.yaml",
    allow_override: true,
  });
}

/** An alarm the cards created gone: its automation and helpers. */
export async function deleteAlarm(hass: HomeAssistant, n: number) {
  await hass.callApi!("DELETE", `config/automation/config/${PREFIX}${n}`).catch(() => undefined);
  const h = managedHelpers(n);
  for (const id of Object.values(h)) {
    const [domain, obj] = id.split(".");
    await hass.callWS({ type: `${domain}/delete`, [`${domain}_id`]: obj }).catch(() => undefined);
  }
}

/** Waits (up to 5 s) until the entities exist. */
function waitFor(hass: HomeAssistant, ids: string[]) {
  return new Promise<void>((resolve) => {
    const start = Date.now();
    const check = () => {
      // the card's hass is replaced on every change: read the newest from the page
      const states = (document.querySelector("home-assistant") as unknown as { hass?: HomeAssistant } | null)?.hass?.states ?? hass.states;
      if (ids.every((id) => states[id]) || Date.now() - start > 5000) resolve();
      else setTimeout(check, 150);
    };
    check();
  });
}
