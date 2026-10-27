/*
 * The large editor outside HA's card dialog: lists dashboards, finds their
 * glass-dashboard cards and saves straight to HA (lovelace/config/save) – after
 * checking nobody changed the dashboard meanwhile and keeping the previous
 * version in the browser (IndexedDB), to put back with "Undo the last save".
 */

import { DEMO_DASHBOARD, DEMO_POPUPS, DEMO_POPUPS_URL } from "../demo/dashboard";

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

/** Where the demo dashboard lives once added. */
export const DEMO_URL = "glass-demo";

/**
 * The demo dashboard (src/demo) as a dashboard of its own: created once, then only
 * opened – what the user changed in it is never overwritten.
 */
export async function addDemoDashboard(hass: WS): Promise<string> {
  const list = await hass.callWS<any[]>({ type: "lovelace/dashboards/list" });
  // the pop-ups first (a hidden dashboard of their own, as Glass Cards keeps them), then the dashboard
  if (!list.some((d) => d.url_path === DEMO_POPUPS_URL)) {
    await hass.callWS({ type: "lovelace/dashboards/create", url_path: DEMO_POPUPS_URL, title: "Glass demo – pop-ups", icon: "mdi:window-restore", show_in_sidebar: false, require_admin: false, mode: "storage" });
    await saveConfig(hass, DEMO_POPUPS_URL, structuredClone(DEMO_POPUPS));
  }
  if (list.some((d) => d.url_path === DEMO_URL)) return DEMO_URL;
  await hass.callWS({ type: "lovelace/dashboards/create", url_path: DEMO_URL, title: "Glass demo", icon: "mdi:creation-outline", show_in_sidebar: true, require_admin: false, mode: "storage" });
  await saveConfig(hass, DEMO_URL, structuredClone(DEMO_DASHBOARD));
  return DEMO_URL;
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
