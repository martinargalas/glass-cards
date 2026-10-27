import type { BaseCardConfig, ChildLayout, HomeAssistant } from "./types";
import { createCard } from "./registry";
import { getSelected, onSelected, setSelected } from "./select";
import { evalCondition } from "./conditions";

export type ChildEl = HTMLElement & { hass?: HomeAssistant; setConfig?(c: BaseCardConfig): void; setMode?(m: Mode): void };

/** Layout modes, picked by the dashboard from its width. */
export type Mode = "mobile" | "tablet" | "desktop";
export const MODES: Mode[] = ["mobile", "tablet", "desktop"];

const isGlass = (el: HTMLElement) => el.localName.startsWith("glass-");
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);

/** Deep merge for config overrides: objects merge, arrays/scalars replace, null deletes. */
export function mergeConfig<T extends Record<string, any>>(base: T, over: Record<string, any>): T {
  const out: Record<string, any> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === null) delete out[k];
    else if (isObj(v) && isObj(out[k])) out[k] = mergeConfig(out[k], v);
    else out[k] = v;
  }
  return out as T;
}

/**
 * Responsive config: any card may carry
 *   visible_on: [mobile, tablet]          – render only in these modes
 *   responsive: { mobile: { … } }         – overrides merged in that mode
 * Both keys are consumed here, so third-party cards never see them.
 */
export function configForMode(cfg: BaseCardConfig, mode: Mode): BaseCardConfig | null {
  const { responsive, visible_on, ...rest } = cfg as BaseCardConfig & { responsive?: Record<string, any>; visible_on?: Mode[] };
  // a computer is set up as the tablet unless it has its own settings
  const desk = mode === "desktop";
  if (Array.isArray(visible_on) && !visible_on.includes(mode) && !(desk && visible_on.includes("tablet"))) return null;
  const over = responsive?.[mode] ?? (desk ? responsive?.tablet : undefined);
  return isObj(over) ? mergeConfig(rest, over) : rest;
}

/**
 * `view_layout.shadow_css`: CSS added inside a (third-party) card's shadow root, e.g.
 * to drop its own background inside a glass panel. Adopted style sheets survive the
 * card rebuilding its shadow DOM with innerHTML.
 */
function adoptShadowCss(holder: HTMLElement, css: string) {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  let tries = 0;
  const attach = () => {
    // our cards are the element itself; others sit in a display:contents holder
    const el = holder.shadowRoot ? holder : (holder.firstElementChild as HTMLElement | null);
    const root = el?.shadowRoot;
    if (root) {
      if (!root.adoptedStyleSheets.includes(sheet)) root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
      return;
    }
    if (tries++ < 120) requestAnimationFrame(attach);
  };
  attach();
}

/**
 * `view_layout.select: { group, id }` – any card, ours or third-party, becomes a picker:
 * a tap anywhere on it picks `id` in the group – panel cards show for it (visibility `condition: select`; the card's
 * own tap action still runs). The picked card carries [glass-selected] for its ring.
 */
const pickers = new Map<string, Set<HTMLElement>>();
const ringOf = (el: HTMLElement) =>
  // third-party cards sit in a display:contents holder: the ring goes on the card itself
  (getComputedStyle(el).display === "contents" ? (el.firstElementChild as HTMLElement | null) : el) ?? el;
function markPicked(group: string, id: string | undefined) {
  for (const el of pickers.get(group) ?? []) {
    const on = el.dataset.glassSelect === id;
    el.toggleAttribute("glass-selected", on);
    if (el.isConnected) ringOf(el).toggleAttribute("glass-selected", on);
  }
}
function makePicker(el: HTMLElement, sel: { group: string; id: string }) {
  const group = String(sel.group);
  el.dataset.glassSelect = String(sel.id);
  el.setAttribute("glass-selectable", "");
  el.addEventListener("click", () => setSelected(group, el.dataset.glassSelect!));
  let set = pickers.get(group);
  if (!set) {
    set = new Set();
    pickers.set(group, set);
    onSelected(group, (id) => markPicked(group, id));
  }
  set.add(el);
  // the holder of a third-party card fills only after it renders
  requestAnimationFrame(() => markPicked(group, getSelected(group)));
}

/**
 * `card_size: { width, height, fill }` – the card's own size from the editor's "Size" section.
 * A key of its own: Home Assistant's card editor keeps `view_layout` to itself and hands its
 * own copy back, so edits there would not stick. It wins over the same hints in view_layout.
 */
export interface CardSize {
  width?: string;
  height?: string;
  fill?: boolean;
}
function withCardSize(layout: ChildLayout | undefined, size: CardSize | undefined): ChildLayout | undefined {
  if (!size) return layout;
  return { ...(layout ?? {}), ...(size.width ? { width: size.width } : {}), ...(size.height ? { height: size.height } : {}), ...(size.fill ? { grow: 1 } : {}) };
}

/** Applies `view_layout` placement hints from a child config to the created element. */
export function placeChild(el: HTMLElement, layout: ChildLayout | undefined) {
  const s = el.style;
  s.minWidth = "0";
  if (!layout) return;
  if (layout.grow !== undefined) {
    s.flexGrow = String(layout.grow);
    // it takes the rest of a column – and gives way when there's less (a flex item won't shrink below its content)
    s.minHeight = "0";
  }
  if (layout.shrink !== undefined) s.flexShrink = String(layout.shrink);
  if (layout.basis) s.flexBasis = layout.basis;
  if (layout.align) s.alignSelf = layout.align;
  if (layout.span) s.gridColumn = `span ${layout.span}`;
  if (layout.row_span) s.gridRow = `span ${layout.row_span}`;
  if (layout.order !== undefined) s.order = String(layout.order);
  // a bare number is px
  const len = (v: string | number) => (/^\d*\.?\d+$/.test(String(v).trim()) ? `${String(v).trim()}px` : String(v));
  if (layout.height) s.height = len(layout.height);
  if (layout.width) s.width = len(layout.width);
  // e.g. "0 11px": inset from the panel's edges, to line up with a card's own inner edge
  if (layout.margin) s.margin = typeof layout.margin === "number" ? `${layout.margin}px` : layout.margin;
  if (layout.select?.group && layout.select.id !== undefined) makePicker(el, layout.select);
  // above the following siblings, e.g. so a drop-down can open over the next card
  if (layout.z_index !== undefined) {
    s.position = "relative";
    s.zIndex = String(layout.z_index);
  }
}

/** The config each built card came from (same object): lets the editor find a clicked card. */
export const cardSource = new WeakMap<Element, BaseCardConfig>();

/**
 * Builds child cards for a container. Glass children are told they are nested
 * (no own blur), which glass tier the dashboard resolved, and the current mode.
 */
/** What each built card was built from: its config and the container's options (for reuse). */
const builtFrom = new WeakMap<Element, { json: string; opts: string; layout: string; type: string }>();

export function buildChildren(
  configs: BaseCardConfig[] | BaseCardConfig | undefined,
  hass: HomeAssistant | undefined,
  opts: { nested: boolean; glass?: string; controlGlass?: string; mode?: Mode; bare?: boolean; reuse?: ChildEl[] },
): ChildEl[] {
  const list = configs ? (Array.isArray(configs) ? configs : [configs]) : [];
  const mode = opts.mode ?? "tablet";
  const out: ChildEl[] = [];
  // the previous children: an unchanged card is kept as it is, a changed glass card of
  // the same type at the same place gets the new config (editing one card in a big
  // panel then re-renders that card only, not all of them)
  const optsKey = JSON.stringify([mode, opts.nested, opts.glass, opts.controlGlass, opts.bare]);
  const prev = (opts.reuse ?? []).filter((el) => builtFrom.get(el)?.opts === optsKey);
  const used = new Set<Element>();
  const take = (json: string, type: string, layout: string, at: number): ChildEl | undefined => {
    const exact = prev.find((el) => !used.has(el) && builtFrom.get(el)!.json === json);
    if (exact) return exact;
    const near = prev[at];
    const b = near && builtFrom.get(near);
    if (near && !used.has(near) && b!.type === type && b!.layout === layout && isGlass(near) && near.setConfig) return near;
    return undefined;
  };
  for (const raw of list) {
    const cfg = configForMode(raw, mode);
    if (!cfg) continue;
    const json = JSON.stringify(cfg);
    const layout = JSON.stringify([cfg.view_layout ?? null, cfg.card_size ?? null]);
    const type = String(cfg.type);
    const again = take(json, type, layout, out.length);
    if (again) {
      used.add(again);
      if (builtFrom.get(again)!.json !== json) {
        try {
          again.setConfig!(cfg);
        } catch (e) {
          console.warn("glass-cards: card config", e);
        }
        builtFrom.set(again, { json, opts: optsKey, layout, type });
        if (isGlass(again)) inheritGlass(again, cfg, opts);
      }
      cardSource.set(again, raw);
      out.push(again);
      continue;
    }
    const el = createCard(cfg, hass) as ChildEl;
    cardSource.set(el, raw);
    builtFrom.set(el, { json, opts: optsKey, layout, type });
    if (isGlass(el)) {
      if (opts.nested) el.setAttribute("nested", "");
      // the container draws no glass: content cards may draw their own tile
      if (opts.bare) el.setAttribute("on-bare", "");
      inheritGlass(el, cfg, opts);
      el.setMode?.(mode);
    }
    placeChild(el, withCardSize(cfg.view_layout as ChildLayout | undefined, cfg.card_size as CardSize | undefined));
    const css = (cfg.view_layout as ChildLayout | undefined)?.shadow_css;
    if (css) adoptShadowCss(el, css);
    out.push(el);
  }
  return out;
}

/** A card's own `glass:` / `control_glass:` wins over what the container passes down.
 *  Re-run on reuse, so setting (or clearing) the card's own value takes effect at once. */
function inheritGlass(el: ChildEl, cfg: BaseCardConfig, opts: { glass?: string; controlGlass?: string }) {
  const g = opts.glass && !cfg.glass;
  el.toggleAttribute("glass-inherited", !!g);
  if (g) el.setAttribute("glass", opts.glass!);
  const cg = opts.controlGlass && !cfg.control_glass;
  el.toggleAttribute("control-glass-inherited", !!cg);
  if (cg) el.setAttribute("control-glass", opts.controlGlass!);
}

/**
 * The children whose `visibility` (HA's card visibility conditions) holds now – the others
 * are left out of the page, as HA's conditional card does (a camera stops streaming).
 * The editor's preview shows the same: a hidden card is edited in the card list.
 */
export function visibleChildren(children: ChildEl[], hass: HomeAssistant | undefined): ChildEl[] {
  if (!hass) return children;
  return children.filter((el) => {
    const cond = (cardSource.get(el) as { visibility?: unknown } | undefined)?.visibility;
    return !cond || evalCondition(cond as any, hass);
  });
}

export function forward(children: ChildEl[], hass: HomeAssistant) {
  for (const c of children) c.hass = hass;
}
