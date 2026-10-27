/** Named-area grid layouts for glass-dashboard (shared with its editor). */
export type Preset = "classic" | "right" | "sidebar" | "stacked" | "three" | "single";
/** Built-in layouts: columns (uses `left_width` for side columns), rows, area template. */
export const PRESETS: Record<
  Preset,
  { label: string; columns: (side: string) => string; rows: string; areas: string[]; thumb: { cols: string; rows: string } }
> = {
  classic: { label: "Classic – column left", columns: (w) => `${w} minmax(0, 1fr)`, rows: "auto minmax(0, 1fr)", areas: ["header top", "left main"], thumb: { cols: "1fr 2.6fr", rows: "1fr 3.2fr" } },
  right: { label: "Column right", columns: (w) => `minmax(0, 1fr) ${w}`, rows: "auto minmax(0, 1fr)", areas: ["top header", "main left"], thumb: { cols: "2.6fr 1fr", rows: "1fr 3.2fr" } },
  sidebar: {
    label: "Side column, full height",
    columns: (w) => `${w} minmax(0, 1fr)`,
    rows: "minmax(0, 1fr)",
    areas: ["left main"],
    thumb: { cols: "1fr 2.6fr", rows: "1fr" },
  },
  three: {
    label: "Three columns",
    columns: (w) => `${w} minmax(0, 1fr) ${w}`,
    rows: "auto minmax(0, 1fr)",
    areas: ["header top top", "left main right"],
    thumb: { cols: "1fr 2.2fr 1fr", rows: "1fr 3.2fr" },
  },
  stacked: { label: "No side column", columns: () => "minmax(0, 1fr)", rows: "auto auto minmax(0, 1fr)", areas: ["header", "top", "main"], thumb: { cols: "1fr", rows: "1fr 1fr 3fr" } },
  single: { label: "Main area only", columns: () => "minmax(0, 1fr)", rows: "minmax(0, 1fr)", areas: ["main"], thumb: { cols: "1fr", rows: "1fr" } },
};

export const ident = (n: string) => n.trim().replace(/[^A-Za-z0-9_-]/g, "_");

/** Area template rows (`"a b" "c d"`, a multi-line string or a list) → rows of names. */
export function parseAreas(areas: string | string[] | undefined): string[][] {
  if (!areas) return [];
  const rows = Array.isArray(areas) ? areas : (areas.match(/"[^"]*"/g) ?? areas.split("\n"));
  // "." (or "...") is an empty cell, kept as such
  return rows.map((r) => r.replace(/"/g, "").trim().split(/\s+/).filter(Boolean).map((n) => (/^\.+$/.test(n) ? "." : ident(n)))).filter((r) => r.length);
}

/** Names in reading order (row by row), each once; "." is an empty cell. */
export function areaOrder(rows: string[][]): string[] {
  const out: string[] = [];
  for (const r of rows) for (const n of r) if (n !== "." && !out.includes(n)) out.push(n);
  return out;
}


/* ── Overlay from another dashboard ─────────────────────────────────────────
 * Bubble Card pop-ups only work when they live in the view that opens them, and
 * a panel view shows a single card – so the dashboard renders them itself. The
 * source stays where the user keeps it (YAML with !include, or a UI dashboard
 * editable with HA's editor); nothing is copied into this config. */

export interface OverlaySource {
  /** url_path of the dashboard, e.g. adaptive-dash or glass-popups */
  dashboard: string;
  /** view path / index / title; default: every view */
  view?: string | number;
  views?: (string | number)[];
  /** popups (default): bubble pop-ups and navigation stacks only; all: every card */
  filter?: "popups" | "all";
  /** false: leave out the navigation stacks (a glass-dock replaces them) */
  nav?: boolean;
}

function findCard(c: any, pred: (c: any) => boolean, depth = 0): any {
  if (!c || typeof c !== "object" || depth > 6) return undefined;
  if (pred(c)) return c;
  for (const child of [...(Array.isArray(c.cards) ? c.cards : []), c.card].filter(Boolean)) {
    const hit = findCard(child, pred, depth + 1);
    if (hit) return hit;
  }
  return undefined;
}

/** Pop-ups seen on this page (local overlays and loaded sources), by hash – for link pickers and the editor. */
export const knownPopups = new Map<string, { name?: string; icon?: string; source: string }>();

/** A card's Bubble pop-up: its hash, name and icon. */
export function popupOf(c: Record<string, any>): { hash: string; name?: string; icon?: string; card: Record<string, any> } | undefined {
  const p = findCard(c, (x) => x.type === "custom:bubble-card" && x.card_type === "pop-up");
  return p?.hash ? { hash: String(p.hash), name: p.name, icon: p.icon, card: p } : undefined;
}

export function rememberPopups(cards: Record<string, any>[] | undefined, source: string) {
  let added = false;
  for (const c of cards ?? []) {
    const p = popupOf(c);
    if (p && !knownPopups.has(p.hash)) {
      knownPopups.set(p.hash, { name: p.name, icon: p.icon, source });
      added = true;
    }
  }
  if (added) window.dispatchEvent(new Event("glass-popups"));
}

export function cardKind(c: Record<string, any>): "nav" | "popup" | "other" {
  if (findCard(c, (x) => x.type === "custom:bubble-card" && x.card_type === "pop-up")) return "popup";
  if (findCard(c, (x) => x.type === "custom:bubble-card" && x.card_type === "horizontal-buttons-stack")) return "nav";
  return "other";
}

const sources = new Map<string, Promise<Record<string, any> | undefined>>();

/** Loads (once per page) a dashboard's resolved config through HA's own API. */
function loadDashboard(hass: { callWS<T>(m: Record<string, unknown>): Promise<T> }, url: string) {
  let p = sources.get(url);
  if (!p) {
    p = hass.callWS<Record<string, any>>({ type: "lovelace/config", url_path: url }).catch((e) => {
      console.warn(`glass-cards: overlay_source ${url} could not be loaded`, e);
      sources.delete(url);
      return undefined;
    });
    sources.set(url, p);
  }
  return p;
}

/**
 * button-card resolves `template:` names from the config of the dashboard being
 * shown, so the source's templates are added to that config in memory. The key is
 * non-enumerable: HA's YAML editor and Save skip it, so it never ends up stored.
 * A dashboard's own templates win.
 */
function shareTemplates(templates: Record<string, any> | undefined) {
  if (!templates || !Object.keys(templates).length) return;
  const stack: (Document | ShadowRoot)[] = [document];
  while (stack.length) {
    const r = stack.pop()!;
    const root = r.querySelector("hui-root") as (Element & { lovelace?: { config?: Record<string, any> } }) | null;
    if (root?.lovelace?.config) {
      const cfg = root.lovelace.config;
      const own = Object.getOwnPropertyDescriptor(cfg, "button_card_templates");
      // stored templates of this dashboard: leave them, a merge would be saved with them
      if (own?.enumerable) return;
      const merged = { ...templates, ...(own?.value ?? {}) };
      try {
        Object.defineProperty(cfg, "button_card_templates", { value: merged, enumerable: false, configurable: true, writable: true });
      } catch {
        const copy = { ...cfg };
        Object.defineProperty(copy, "button_card_templates", { value: merged, enumerable: false, configurable: true, writable: true });
        root.lovelace.config = copy;
      }
      return;
    }
    r.querySelectorAll("*").forEach((e) => e.shadowRoot && stack.push(e.shadowRoot));
  }
}

/**
 * Sections view: a legacy Bubble Card pop-up owns the cards that follow it in its
 * section, so such a section stays together as one vertical stack. Standalone
 * pop-ups (Bubble Card ≥ 3.2, content in their own `cards:`) are taken as they are.
 * Other sections give their cards one by one (e.g. the navigation bar).
 */
function sectionCards(sec: any): any[] {
  const cards: any[] = sec?.cards ?? [];
  const i = cards.findIndex((c) => cardKind(c) === "popup");
  if (i < 0) return cards;
  // Bubble Card ≥ 3.2 "standalone" pop-up carries its content in `cards:` – keep as is
  if (Array.isArray(cards[i]?.cards) && cards[i].type === "custom:bubble-card") return cards;
  return [...cards.slice(0, i), { type: "vertical-stack", cards: cards.slice(i) }];
}

/** Cards for the overlay from another dashboard (see OverlaySource). */
export async function overlayCards(
  hass: { callWS<T>(m: Record<string, unknown>): Promise<T> },
  src: OverlaySource,
): Promise<Record<string, any>[] | undefined> {
  const cfg = await loadDashboard(hass, src.dashboard);
  // undefined: not loaded (yet) – the caller tries again
  if (!cfg) return undefined;
  shareTemplates(cfg.button_card_templates);
  const wanted = src.views ?? (src.view !== undefined ? [src.view] : undefined);
  const views = (cfg.views ?? []).filter(
    (v: any, i: number) => !wanted || wanted.some((w) => w === i || w === v.path || w === v.title || String(w) === String(i)),
  );
  const cards = views.flatMap((v: any) => [...(v.cards ?? []), ...(v.sections ?? []).flatMap(sectionCards)]);
  const kept = src.filter === "all" ? cards : cards.filter((c: any) => cardKind(c) !== "other");
  rememberPopups(kept, src.dashboard);
  return src.nav === false ? kept.filter((c: any) => cardKind(c) !== "nav") : kept;
}

/** A panel's track sizes as a list: "2 1", "60% 40%", ["300px", 1] → ["2", "1"] … */
/** vw / vh in a size → the screen the dashboard shows (the editor preview's device, else the window). */
export function screenUnits(v: string): string {
  return v.replace(/(\d*\.?\d+)([dsl]?)(vw|vh)\b/g, (_, n, p, u) => `calc(${n} * var(--glass-${u}, 1${p}${u}))`);
}

/** One track of the list syntax: "2" → a share of the free space, "300px", "60%", "auto" as they are. */
export function trackOne(x: string): string {
  return /^\d*\.?\d+$/.test(x) ? `minmax(0,${x}fr)` : x.endsWith("fr") ? `minmax(0,${x})` : screenUnits(x);
}

/** Track sizes: "2 1" → shares of the free space, "60% 40%", "300px 1" – as grid-template-columns / -rows. */
export function trackCss(v: string | (string | number)[] | undefined): string | undefined {
  const list = trackList(v);
  return list.length ? list.map(trackOne).join(" ") : undefined;
}

/** A CSS track list split into its tracks ("320px minmax(0, 1fr)" → two); repeat(n, …) is expanded. */
export function splitTracks(css: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of css.trim()) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (cur) out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out.flatMap((t) => {
    const m = /^repeat\(\s*(\d+)\s*,\s*(.+)\)$/.exec(t);
    return m ? splitTracks(Array(Number(m[1])).fill(m[2]).join(" ")) : [t];
  });
}

export function trackList(v: string | (string | number)[] | undefined): string[] {
  if (v === undefined || v === null || v === "") return [];
  const parts = Array.isArray(v) ? v.map(String) : String(v).split(/[\s,;]+/);
  return parts.map((x) => x.trim()).filter(Boolean);
}

/**
 * Drag on a line between two grid tracks (a `.grid-grip` inside the grid): both tracks
 * follow the pointer, at least 40 px each. `done` gets every track's size in layout px
 * (the preview's scale taken out). Grips sit in the grid as absolutely placed items.
 */
export function dragGridLine(e: PointerEvent, axis: "columns" | "rows", k: number, done: (px: number[]) => void) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const grip = e.currentTarget as HTMLElement;
  const box = grip.parentElement as HTMLElement;
  const cs = getComputedStyle(box);
  const sizes = (axis === "columns" ? cs.gridTemplateColumns : cs.gridTemplateRows).split(/\s+/).map(parseFloat);
  if (sizes.some(Number.isNaN) || k + 1 >= sizes.length) return;
  // screen px per layout px, whatever space getComputedStyle reports in
  const cols = cs.gridTemplateColumns.split(/\s+/).map(parseFloat);
  const inner = cols.reduce((a, b) => a + b, 0) + (parseFloat(cs.columnGap) || 0) * (cols.length - 1) + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  const scale = box.getBoundingClientRect().width / (inner || 1) || 1;
  grip.setPointerCapture(e.pointerId);
  grip.classList.add("on");
  const p0 = axis === "columns" ? e.clientX : e.clientY;
  const [a0, b0] = [sizes[k], sizes[k + 1]];
  const MIN = 40;
  let cur = sizes;
  const move = (ev: PointerEvent) => {
    const d = ((axis === "columns" ? ev.clientX : ev.clientY) - p0) / scale;
    const dd = Math.max(MIN - a0, Math.min(b0 - MIN, d));
    cur = sizes.map((v, i) => (i === k ? a0 + dd : i === k + 1 ? b0 - dd : v));
    box.style.setProperty(axis === "columns" ? "grid-template-columns" : "grid-template-rows", cur.map((v) => `${v.toFixed(1)}px`).join(" "));
  };
  const up = () => {
    grip.removeEventListener("pointermove", move);
    grip.removeEventListener("pointerup", up);
    grip.removeEventListener("pointercancel", up);
    grip.classList.remove("on");
    if (cur !== sizes) done(cur);
  };
  grip.addEventListener("pointermove", move);
  grip.addEventListener("pointerup", up);
  grip.addEventListener("pointercancel", up);
}

/** Dragged sizes as config: the largest track takes the rest ("1"), the others exact px. */
export function dragResult(px: number[]): string[] {
  const big = px.indexOf(Math.max(...px));
  return px.map((v, i) => (i === big ? "1" : `${Math.round(v)}px`));
}
