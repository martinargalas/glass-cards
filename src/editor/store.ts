/*
 * The large editor outside HA's card dialog: lists dashboards, finds their
 * glass-dashboard cards and saves straight to HA (lovelace/config/save) – after
 * checking nobody changed the dashboard meanwhile and keeping the previous
 * version in the browser (IndexedDB), to put back with "Undo the last save".
 */

import { DEMO_DASHBOARD, DEMO_POPUPS, DEMO_POPUPS_URL } from "../demo/dashboard";
import { DEMO_NEWS } from "../demo/news";

type WS = { callWS<T>(m: Record<string, unknown>): Promise<T> };
type Cfg = Record<string, any>;
type Path = (string | number)[];

export interface DashInfo {
  /** url_path; null = the default dashboard (Overview) */
  url: string | null;
  title: string;
  mode: "storage" | "yaml";
}

export async function listDashboards(hass: WS): Promise<DashInfo[]> {
  const [list, info] = await Promise.all([
    hass.callWS<any[]>({ type: "lovelace/dashboards/list" }).catch(() => []),
    hass.callWS<{ mode?: string }>({ type: "lovelace/info" }).catch(() => ({ mode: "storage" })),
  ]);
  return [
    { url: null, title: "Overview", mode: info?.mode === "yaml" ? "yaml" : "storage" },
    ...list.map((d) => ({ url: String(d.url_path), title: String(d.title ?? d.url_path), mode: d.mode === "yaml" ? ("yaml" as const) : ("storage" as const) })),
  ];
}

/** A dashboard's stored config, fresh from HA; an empty one for a storage dashboard nobody saved yet. */
export async function loadConfig(hass: WS, url: string | null): Promise<Cfg> {
  try {
    return await hass.callWS<Cfg>({ type: "lovelace/config", url_path: url, force: true });
  } catch (e: any) {
    if (e?.code === "config_not_found") return { views: [] };
    throw e;
  }
}

export function saveConfig(hass: WS, url: string | null, config: Cfg) {
  return hass.callWS({ type: "lovelace/config/save", url_path: url, config });
}

/* ── the demo dashboard ─────────────────────────────────────────────────────
 * Two of them at most:
 *   glass-demo         the user's: added once; once they change it, never touched again
 *   glass-demo-latest  the cards': the newest demo, written over by every newer one
 * each with its pop-ups beside it (<url>-popups, a hidden dashboard). A demo written here carries
 * a stamp (`glass_demo` at its root): which demo it is and a sum of what was written, so a later
 * version sees whether it is older and whether the user changed it. */

/** Where the demo dashboard lives once added. */
export const DEMO_URL = "glass-demo";
/** The newest demo, beside a user's changed one. */
export const DEMO_LATEST_URL = "glass-demo-latest";
/** A demo dashboard's pop-ups: a hidden dashboard beside it. */
export const popupsOf = (url: string) => `${url}-popups`;
/** Any demo's pop-ups dashboard (the demo hass serves its pictures from the bundle). */
export const isDemoPopups = (url: unknown) => typeof url === "string" && /^glass-demo(-[\w-]+)?-popups$/.test(url);

interface Stamp {
  /** which demo (DEMO_VERSION) */
  v: string;
  /** what was written: its sum, without the stamp */
  sum: string;
  /** how many lines DEMO_NEWS had then */
  news: number;
}

/** The same JSON whatever order its keys come back in. */
function stable(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
}
function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
const sumOf = (cfg: Cfg) => {
  const { glass_demo: _, ...rest } = cfg;
  return hash(stable(rest));
};
/** The demo the cards bring: changes whenever examples/demo*.yaml does. */
export const DEMO_VERSION = hash(stable(DEMO_DASHBOARD) + stable(DEMO_POPUPS));

/** Every string `from` in a config replaced by `to` (the pop-ups dashboard a demo points to). */
function renamed<T>(node: T, from: string, to: string): T {
  if (node === from) return to as T;
  if (Array.isArray(node)) return node.map((x) => renamed(x, from, to)) as T;
  if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, renamed(v, from, to)])) as T;
  return node;
}
const stamped = (cfg: Cfg): Cfg => ({ ...cfg, glass_demo: { v: DEMO_VERSION, sum: sumOf(cfg), news: DEMO_NEWS.length } satisfies Stamp });

const TITLES: Record<string, string> = { [DEMO_URL]: "Glass demo", [DEMO_LATEST_URL]: "Glass demo – newest" };

async function dashboards(hass: WS) {
  return hass.callWS<{ id: string; url_path: string; title?: string }[]>({ type: "lovelace/dashboards/list" });
}

/** The cards' demo written to `url` (and its pop-ups beside it) – over what is there, kept first. */
async function writeDemo(hass: WS, url: string, title = TITLES[url] ?? "Glass demo") {
  const list = await dashboards(hass);
  const pops = popupsOf(url);
  const dash = { ...renamed(structuredClone(DEMO_DASHBOARD), DEMO_POPUPS_URL, pops), title };
  const popups = { ...structuredClone(DEMO_POPUPS), title: `${title} – pop-ups` };
  for (const [u, cfg, side] of [
    [pops, popups, false],
    [url, dash, true],
  ] as const) {
    if (list.some((d) => d.url_path === u)) {
      // what it was: "Undo the last save" in the studio puts it back
      const old = await loadConfig(hass, u).catch(() => undefined);
      if (old?.views?.length) await backup(u, old);
    } else
      await hass.callWS({ type: "lovelace/dashboards/create", url_path: u, title: side ? title : `${title} – pop-ups`, icon: side ? "mdi:creation-outline" : "mdi:window-restore", show_in_sidebar: side, require_admin: false, mode: "storage" });
    await saveConfig(hass, u, stamped(cfg));
  }
}

/**
 * The demo dashboard (src/demo) as a dashboard of its own: created once, then only
 * opened – what the user changed in it is never overwritten.
 */
export async function addDemoDashboard(hass: WS): Promise<string> {
  const list = await dashboards(hass);
  if (list.some((d) => d.url_path === DEMO_URL)) {
    // its pop-ups gone (deleted by hand): back
    if (!list.some((d) => d.url_path === DEMO_POPUPS_URL)) {
      await hass.callWS({ type: "lovelace/dashboards/create", url_path: DEMO_POPUPS_URL, title: "Glass demo – pop-ups", icon: "mdi:window-restore", show_in_sidebar: false, require_admin: false, mode: "storage" });
      await saveConfig(hass, DEMO_POPUPS_URL, stamped(structuredClone(DEMO_POPUPS)));
    }
    return DEMO_URL;
  }
  await writeDemo(hass, DEMO_URL);
  return DEMO_URL;
}

/** A demo dashboard in HA: is it older than the cards' demo, did the user change it. */
export interface DemoState {
  url: string;
  outdated: boolean;
  /** changed since it was written (a demo from before the stamps counts as changed) */
  changed: boolean;
  /** what the cards' demo has that this one hasn't */
  news: string[];
}

async function demoState(hass: WS, url: string): Promise<DemoState | undefined> {
  const [dash, pops] = await Promise.all([loadConfig(hass, url).catch(() => undefined), loadConfig(hass, popupsOf(url)).catch(() => undefined)]);
  if (!dash?.views?.length) return undefined;
  const st = dash.glass_demo as Stamp | undefined;
  const pst = pops?.glass_demo as Stamp | undefined;
  const outdated = st?.v !== DEMO_VERSION;
  const changed = !st || st.sum !== sumOf(dash) || (!!pops?.views?.length && (!pst || pst.sum !== sumOf(pops)));
  return { url, outdated, changed, news: DEMO_NEWS.slice(st?.news ?? 0) };
}

/**
 * The demos in HA against the cards' one: an unchanged older demo is brought up to date here (the
 * old one kept for "Undo the last save"); a changed one is left as it is and returned, for the
 * studio to offer the newest beside it.
 */
export async function checkDemos(hass: WS, skip?: string | null): Promise<{ updated: string[]; outdated: DemoState[] }> {
  const list = await dashboards(hass).catch(() => []);
  const out = { updated: [] as string[], outdated: [] as DemoState[] };
  // with the newest demo in HA, news comes through it: the user's own demo is not asked again
  const hasLatest = list.some((d) => d.url_path === DEMO_LATEST_URL);
  for (const url of [DEMO_URL, DEMO_LATEST_URL]) {
    if (!list.some((d) => d.url_path === url)) continue;
    const s = await demoState(hass, url).catch(() => undefined);
    if (!s?.outdated) continue;
    if (s.changed) {
      if (url !== DEMO_URL || !hasLatest) out.outdated.push(s);
    }
    // one open in an editor right now is not written under it
    else if (url !== skip) {
      await writeDemo(hass, url);
      out.updated.push(url);
    }
  }
  return out;
}

/** Once per page: an administrator opening a demo brings an unchanged older one up to date. */
let checked: Promise<unknown> | undefined;
export function checkDemosOnce(hass: WS) {
  return (checked ??= checkDemos(hass).catch(() => undefined));
}

/** The newest demo beside the user's: written (over an older newest one) and its url. */
export async function writeLatestDemo(hass: WS): Promise<string> {
  await writeDemo(hass, DEMO_LATEST_URL);
  return DEMO_LATEST_URL;
}

/** The user's demo replaced by the newest one (theirs kept in the browser for "Undo the last save"). */
export async function replaceDemo(hass: WS, url: string): Promise<string> {
  await writeDemo(hass, url);
  return url;
}

/**
 * A demo the user changed, kept as a dashboard of their own (glass-demo-mine-N, its pop-ups
 * beside it, no stamp: never offered an update) – then the newest demo written where it was.
 */
export async function keepDemoAsOwn(hass: WS, url: string): Promise<string> {
  const list = await dashboards(hass);
  let n = 1;
  while (list.some((d) => d.url_path === `glass-demo-mine-${n}`)) n++;
  const mine = `glass-demo-mine-${n}`;
  const title = `Glass demo – mine${n > 1 ? ` ${n}` : ""}`;
  const [dash, pops] = await Promise.all([loadConfig(hass, url), loadConfig(hass, popupsOf(url)).catch(() => undefined)]);
  const strip = (c: Cfg) => {
    const { glass_demo: _, ...rest } = c;
    return rest;
  };
  if (pops?.views?.length) {
    await hass.callWS({ type: "lovelace/dashboards/create", url_path: popupsOf(mine), title: `${title} – pop-ups`, icon: "mdi:window-restore", show_in_sidebar: false, require_admin: false, mode: "storage" });
    await saveConfig(hass, popupsOf(mine), { ...strip(pops), title: `${title} – pop-ups` });
  }
  await hass.callWS({ type: "lovelace/dashboards/create", url_path: mine, title, icon: "mdi:creation-outline", show_in_sidebar: true, require_admin: false, mode: "storage" });
  await saveConfig(hass, mine, { ...renamed(strip(dash), popupsOf(url), popupsOf(mine)), title });
  await writeDemo(hass, url);
  return mine;
}

/** A demo dashboard removed from HA with its pop-ups. */
export async function deleteDemo(hass: WS, url: string) {
  const list = await dashboards(hass);
  for (const u of [url, popupsOf(url)]) {
    const d = list.find((x) => x.url_path === u);
    if (d) await hass.callWS({ type: "lovelace/dashboards/delete", dashboard_id: d.id });
  }
}

/** Every glass-dashboard card of a dashboard: where it sits and which view it is in. */
export function findGlass(cfg: Cfg): { path: Path; label: string }[] {
  const out: { path: Path; label: string }[] = [];
  const walk = (c: any, path: Path, label: string) => {
    if (!c || typeof c !== "object") return;
    if (c.type === "custom:glass-dashboard") {
      out.push({ path, label });
      return;
    }
    if (Array.isArray(c.cards)) c.cards.forEach((x: any, i: number) => walk(x, [...path, "cards", i], label));
    if (c.card) walk(c.card, [...path, "card"], label);
  };
  (cfg.views ?? []).forEach((v: any, vi: number) => {
    const label = String(v.title ?? v.path ?? `${vi + 1}`);
    (v.cards ?? []).forEach((c: any, i: number) => walk(c, ["views", vi, "cards", i], label));
    (v.sections ?? []).forEach((s: any, si: number) => (s.cards ?? []).forEach((c: any, i: number) => walk(c, ["views", vi, "sections", si, "cards", i], label)));
  });
  return out;
}

/** `value` put at `path` of a copy of `root`. */
export function putAt(root: Cfg, path: Path, value: unknown): Cfg {
  const next = structuredClone(root);
  let o: any = next;
  for (const k of path.slice(0, -1)) o = o[k] ??= {};
  o[path[path.length - 1]] = value;
  return next;
}

/* ── backups: the last few saved-over versions per dashboard ────────────── */

const KEEP = 5;

function db(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    const r = indexedDB.open("glass-studio", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("backups", { keyPath: "id", autoIncrement: true }).createIndex("url", "url");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
}

type Backup = { id?: number; url: string; time: number; config: Cfg };

async function backups(url: string | null): Promise<Backup[]> {
  const d = await db();
  return new Promise((ok, fail) => {
    const r = d.transaction("backups").objectStore("backups").index("url").getAll(url ?? "");
    r.onsuccess = () => ok((r.result as Backup[]).sort((a, b) => b.time - a.time));
    r.onerror = () => fail(r.error);
  });
}

/** Keeps `config` (the version about to be saved over); the oldest beyond KEEP go. */
export async function backup(url: string | null, config: Cfg) {
  try {
    const old = await backups(url);
    const d = await db();
    const st = d.transaction("backups", "readwrite").objectStore("backups");
    st.add({ url: url ?? "", time: Date.now(), config });
    for (const b of old.slice(KEEP - 1)) st.delete(b.id!);
  } catch (e) {
    console.warn("glass-studio: backup", e);
  }
}

/** The newest backup of a dashboard, if any. */
export async function lastBackup(url: string | null): Promise<Backup | undefined> {
  try {
    return (await backups(url))[0];
  } catch {
    return undefined;
  }
}

export async function dropBackup(id: number) {
  const d = await db();
  d.transaction("backups", "readwrite").objectStore("backups").delete(id);
}
