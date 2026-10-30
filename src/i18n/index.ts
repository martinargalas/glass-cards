import { cs } from "./cs";
import { de } from "./de";

/**
 * One dictionary for the cards and the editor. The source language is English: a text's
 * key is its English wording. Other languages are packs keyed by that text (./cs.ts, ./de.ts);
 * a text missing in a pack stays English. The language is the HA user's (Profile →
 * Language) – there is no other place to set it.
 *
 *   tr("Nothing on")                       → "Nic neběží"
 *   tr("{n} lights", { n: 4 })             → "4 světla" (plural forms, Intl.PluralRules)
 *
 * Plural texts are objects by plural category: { one: "{n} light", other: "{n} lights" }.
 */
export type Plural = Partial<Record<Intl.LDMLPluralRule, string>>;
export type Dict = Record<string, string | Plural>;

/** English wording where it differs by count, or where the key is not the wording itself. */
const en: Dict = {
  "{n} lights": { one: "{n} light", other: "{n} lights" },
  "{n} cards": { one: "{n} card", other: "{n} cards" },
  "{n} pop-ups": { one: "{n} pop-up", other: "{n} pop-ups" },
  // keys that are not their own English wording
  "Good late morning": "Good morning",
  "compass.N": "N",
  "compass.E": "E",
  "compass.S": "S",
  "compass.W": "W",
  "compass.NE": "NE",
  "compass.SE": "SE",
  "compass.SW": "SW",
  "compass.NW": "NW",
};

const PACKS: Record<string, Dict> = { cs, de };
/** The languages there is a pack for, by their own name (the editor's language picker). */
export const LANGS: [string, string][] = [
  ["en", "English"],
  ["cs", "Čeština"], // i18n-ok
  ["de", "Deutsch"],
];
const packOf = (l: string) => PACKS[l] ?? PACKS[l.split("-")[0]];

let lang = "en";
let pack: Dict | undefined;

/** The HA user's language as a locale – for numbers, dates and times. */
export const locale = () => lang;

/** The UI language: the HA user's, "en" without a pack for it. */
export const uiLang = () => (pack ? lang : "en");

/** Follows the HA user's language; cards and editors call it with every new `hass`. */
export function syncLang(hass?: { locale?: { language?: string }; language?: string }) {
  const l = hass?.locale?.language || hass?.language;
  if (!l || l === lang) return;
  lang = l;
  pack = packOf(l);
  window.dispatchEvent(new CustomEvent("glass-lang", { detail: l }));
}

/** An English text in the UI language, with {name} filled in. */
export function tr(key: string, vars?: Record<string, string | number>): string {
  return trIn(uiLang(), key, vars);
}

/** The same in a given language (the editor may speak another one than the cards). */
export function trIn(language: string, key: string, vars?: Record<string, string | number>): string {
  const p = language === "en" ? undefined : packOf(language);
  let v: string | Plural = p?.[key] ?? en[key] ?? key;
  if (typeof v === "object") {
    const n = Number(vars?.n ?? 0);
    v = v[new Intl.PluralRules(p ? language : "en").select(n)] ?? v.other ?? key;
  }
  return vars ? v.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m)) : v;
}
