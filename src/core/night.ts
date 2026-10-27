/**
 * `dark:` – a card's night look: any of its settings again, used while it is dark (the
 * dashboard's appearance: by the sun, the HA theme…), merged over the day ones – objects
 * key by key, anything else replaced.
 *
 *   glass: liquid
 *   wallpaper: /local/wallpapers/day.jpg
 *   fonts: { name: { color: "#222" } }
 *   dark:
 *     glass: frosted
 *     wallpaper: /local/wallpapers/night.jpg
 *     fonts: { name: { color: "#eee" } }
 */

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);

/** `b` over `a`: objects merged key by key, anything else (lists too) replaced. */
export function mergeDeep(a: Record<string, any>, b: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = isObj(v) && isObj(a[k]) ? mergeDeep(a[k], v) : v;
  return out;
}

/** The config for the time of day, without its `dark:`. */
export function nightConfig<T extends Record<string, any>>(cfg: T, dark: boolean): T {
  const { dark: night, ...day } = cfg ?? ({} as T);
  if (!dark || !isObj(night)) return day as T;
  // when it is night is the dashboard's to say, not the night's
  const { appearance: _when, ...over } = night;
  return mergeDeep(day, over) as T;
}

/** What `next` (the night look edited in full) changes on `day`: the keys that differ, deep. */
export function nightDiff(day: Record<string, any>, next: Record<string, any>): Record<string, any> | undefined {
  const out: Record<string, any> = {};
  for (const k of new Set([...Object.keys(day), ...Object.keys(next)])) {
    if (k === "dark") continue;
    const a = day[k];
    const b = next[k];
    if (isObj(a) && isObj(b)) {
      const d = nightDiff(a, b);
      if (d) out[k] = d;
    } else if (JSON.stringify(a) !== JSON.stringify(b) && b !== undefined) out[k] = b;
  }
  return Object.keys(out).length ? out : undefined;
}
