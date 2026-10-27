import { cssColor } from "./colors";
import type { FontSpec, IconSpec } from "./typography";

/**
 * The texts and icons of a card that its Appearance offers (colour, size, weight), each
 * with its active state (`<key>_on`) when it has one:
 *
 *   fonts: { name: { color: red, size: 15, weight: 700 }, name_on: { color: white } }
 *   icons: { icon: { color: amber, size: 24 }, icon_on: { … } }
 *
 * A card lists them in `static parts`; only what is set becomes a rule (`!important`, so it
 * beats the card's state rules), the active one after the plain one. The editor builds the
 * fields from the same list (editor PARTS_LOOK).
 */
export interface PartDef {
  key: string;
  kind: "text" | "icon";
  /** the element(s) in the card's shadow root */
  sel: string;
  /** the same in its active / picked / on state */
  on?: string;
  /** the editor's title of the field and the Appearance group it sits in */
  title: string;
  group: string;
  /** false: no size (e.g. a name drawn to the map's scale) */
  size?: boolean;
  /** offered even when the card doesn't show it right now (a menu that opens, a message that comes) */
  always?: boolean;
  /** an icon drawn as a plain <svg> (a glyph of our own): its size is its width / height */
  svg?: boolean;
}

export const text = (key: string, sel: string, title: string, group: string, on?: string, size = true): PartDef => ({ key, kind: "text", sel, on, title, group, size });
/** a part shown only now and then (an open menu…): always offered */
export const always = (p: PartDef): PartDef => ({ ...p, always: true });
/** an icon drawn as a plain <svg> */
export const glyph = (key: string, sel: string, title: string, group: string, on?: string): PartDef => ({ key, kind: "icon", sel, on, title, group, svg: true });
export const icon = (key: string, sel: string, title: string, group: string, on?: string): PartDef => ({ key, kind: "icon", sel, on, title, group });

const px = (v: number | string | undefined) => (v === undefined || v === "" || v === null ? undefined : typeof v === "number" || /^\d*\.?\d+$/.test(v) ? `${v}px` : v);

/** `fonts` / `icons` of a config → the rules for a card's parts (empty when nothing is set). */
export function partsCss(parts: PartDef[], fonts?: Record<string, FontSpec>, icons?: Record<string, IconSpec>): string {
  let out = "";
  for (const on of [false, true])
    for (const p of parts) {
      const sel = on ? p.on : p.sel;
      if (!sel) continue;
      const key = on ? `${p.key}_on` : p.key;
      const f = (p.kind === "icon" ? icons : fonts)?.[key] as (FontSpec & IconSpec) | undefined;
      if (!f || typeof f !== "object") continue;
      let d = "";
      const c = cssColor(f.color);
      if (c) d += `color:${c} !important;`;
      const s = p.size === false ? undefined : px(f.size);
      if (s) d += p.svg ? `width:${s} !important;height:${s} !important;` : p.kind === "icon" ? `--mdc-icon-size:${s} !important;` : `font-size:${s} !important;`;
      if (p.kind === "text" && f.weight !== undefined && f.weight !== "") d += `font-weight:${f.weight} !important;`;
      if (d) out += `${sel}{${d}}\n`;
    }
  return out;
}
