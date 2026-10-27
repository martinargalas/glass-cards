/**
 * Editor texts: the shared dictionary (src/i18n). The cards speak the HA user's language;
 * the studio and the editors may speak another one – a tool preference, kept per browser
 * ("auto" = as HA).
 */
import { trIn, uiLang } from "../i18n";

const KEY = "glass-cards-editor-lang";
let pref: string = (() => {
  try {
    return localStorage.getItem(KEY) || "auto";
  } catch {
    return "auto";
  }
})();

/** The editor's language setting: "auto" (as HA) or a language code. */
export const editorLangPref = () => pref;
/** The language the editor speaks now. */
export const editorLang = () => (pref === "auto" ? uiLang() : pref);

export function setEditorLang(l: string) {
  pref = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new CustomEvent("glass-lang", { detail: l }));
}

/** Translate an English UI text (falls back to the English text). */
export function t(s: string | undefined, vars?: Record<string, string | number>): string {
  if (!s) return "";
  return trIn(editorLang(), s, vars);
}

/** Translates labels / titles inside an ha-form schema. */
export function tSchema<T>(schema: T): T {
  if (editorLang() === "en") return schema;
  const walk = (n: any): any => {
    if (Array.isArray(n)) return n.map(walk);
    if (!n || typeof n !== "object") return n;
    const out: any = {};
    for (const [k, v] of Object.entries(n)) out[k] = (k === "label" || k === "title" || k === "helper") && typeof v === "string" ? t(v) : walk(v);
    return out;
  };
  return walk(schema);
}
