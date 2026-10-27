import { tr } from "../i18n";
import type { HomeAssistant } from "./types";
import { getSelected, setSelected } from "./select";

/**
 * The period a period bar picked and charts show: its kind (day / week / month / year)
 * and how many of them back (0 = the current one, −1 = the one before …).
 *
 * Kept either in Home Assistant helpers (`offset_entity` an input_number, `select_entity`
 * an input_select – for automations and templates that follow it) or, without them, per
 * browser tab in a `group` (core/select; default "period"). The bar and the charts that
 * follow it name the same helpers or the same group.
 */
export type PeriodKind = "day" | "week" | "month" | "year";
export const PERIOD_KINDS: PeriodKind[] = ["day", "week", "month", "year"];

export interface PeriodSource {
  group?: string;
  offset_entity?: string;
  select_entity?: string;
  /** the input_select's options → kinds, where the names aren't recognised ({ Dny: day }) */
  kinds?: Record<string, PeriodKind>;
}

export interface Period {
  kind: PeriodKind;
  offset: number;
}

const DEFAULT_GROUP = "period";
export const periodGroup = (s: PeriodSource) => s.group || DEFAULT_GROUP;
export const usesHelpers = (s: PeriodSource) => !!s.offset_entity;

/** Words an option starts with, per kind (en, cs, de, fr, es, pl, sk). */
const WORDS: [PeriodKind, string[]][] = [
  ["day", ["day", "den", "dny", "dni", "tag", "jour", "día", "dia", "dzie"]], // i18n-ok
  ["week", ["week", "týd", "tyd", "woche", "sem", "tydz", "týž"]], // i18n-ok
  ["month", ["month", "měs", "mes", "monat", "mois", "miesi"]], // i18n-ok
  ["year", ["year", "rok", "jahr", "an", "año", "ano"]], // i18n-ok
];

/** An input_select's option → its kind (the `kinds` map first, then the option's name). */
export function kindOf(option: string | undefined, kinds?: Record<string, PeriodKind>): PeriodKind | undefined {
  if (!option) return undefined;
  if (kinds?.[option]) return kinds[option];
  const o = option.trim().toLowerCase();
  return WORDS.find(([, w]) => w.some((x) => o.startsWith(x)))?.[0];
}

export function readPeriod(hass: HomeAssistant | undefined, s: PeriodSource, kinds: PeriodKind[] = ["day", "month", "year"]): Period {
  if (usesHelpers(s)) {
    const offset = Number(hass?.states[s.offset_entity!]?.state);
    const option = s.select_entity ? hass?.states[s.select_entity]?.state : undefined;
    return { kind: kindOf(option, s.kinds) ?? "day", offset: Number.isFinite(offset) ? Math.min(0, offset) : 0 };
  }
  const [k, n] = (getSelected(periodGroup(s)) ?? "").split(":");
  const kind = (PERIOD_KINDS as string[]).includes(k) ? (k as PeriodKind) : kinds[0] ?? "day";
  const offset = Number(n);
  return { kind, offset: Number.isFinite(offset) ? Math.min(0, Math.round(offset)) : 0 };
}

/** Without helpers: stores the period in the group (the bar's ‹ › / now / kind). */
export function writePeriod(s: PeriodSource, p: Period) {
  setSelected(periodGroup(s), `${p.kind}:${Math.min(0, p.offset)}`);
}

/** Start of the period `offset` back from now (weeks start on Monday). */
export function periodStart(p: Period, now = new Date()): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (p.kind === "day") d.setDate(d.getDate() + p.offset);
  else if (p.kind === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 7 * p.offset);
  else if (p.kind === "month") {
    d.setDate(1);
    d.setMonth(d.getMonth() + p.offset);
  } else d.setFullYear(d.getFullYear() + p.offset, 0, 1);
  return d;
}

/** Start of the period after it. */
export function periodEnd(p: Period, now = new Date()): Date {
  const d = periodStart(p, now);
  if (p.kind === "day") d.setDate(d.getDate() + 1);
  else if (p.kind === "week") d.setDate(d.getDate() + 7);
  else if (p.kind === "month") d.setMonth(d.getMonth() + 1);
  else d.setFullYear(d.getFullYear() + 1);
  return d;
}

function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
}

const cap = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1);

/** The period's name: "Pondělí 27.10." / short "Po 27.10.", "43. týden", "Říjen" (another
 *  year: "Říjen 2025" / short "Říj 2025"), "2026". Short for narrow bars (phones). */
export function periodLabel(p: Period, lang: string, short = false, now = new Date()): string {
  const d = periodStart(p, now);
  if (p.kind === "day") {
    const date = d.toLocaleDateString(lang, { day: "numeric", month: "numeric" });
    return `${cap(d.toLocaleDateString(lang, { weekday: short ? "short" : "long" }))} ${date}`;
  }
  if (p.kind === "week") return tr(short ? "W{n}" : "Week {n}", { n: isoWeek(d) });
  if (p.kind === "month") {
    const name = cap(d.toLocaleDateString(lang, { month: short && d.getFullYear() !== now.getFullYear() ? "short" : "long" })).replace(/\.$/, "");
    return d.getFullYear() === now.getFullYear() ? name : `${name} ${d.getFullYear()}`;
  }
  return String(d.getFullYear());
}

/** The kind's name in the drop-down (without helpers; with them the input_select's options). */
export function kindName(k: PeriodKind, lang: string): string {
  const en: Record<PeriodKind, string> = { day: "Day", week: "Week", month: "Month", year: "Year" };
  return tr(en[k]);
}
