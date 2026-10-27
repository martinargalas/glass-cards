import type { HomeAssistant } from "./types";

/** One recorded value: time (ms) and number (on/off → 1/0). */
export interface Point {
  t: number;
  v: number;
}

const ON = new Set(["on", "heat", "heating", "open", "true", "home"]);
const OFF = new Set(["off", "idle", "closed", "false", "not_home"]);

/** A state as a number: numeric states as they are, on/off-like ones as 1/0, anything else NaN. */
export function stateValue(s: string | undefined): number {
  if (s === undefined) return NaN;
  const n = parseFloat(s);
  if (!Number.isNaN(n)) return n;
  if (ON.has(s)) return 1;
  if (OFF.has(s)) return 0;
  return NaN;
}

/** Recent history is shared by every card that asks for it within a few minutes. */
const cache = new Map<string, { at: number; data: Promise<Point[]> }>();
const TTL = 5 * 60 * 1000;

/**
 * Recorder history of a few entities over the last `hours`: one WebSocket call,
 * states only (no attributes), cached per entity for a few minutes.
 */
export async function fetchHistory(hass: HomeAssistant, ids: string[], hours: number): Promise<Record<string, Point[]>> {
  const now = Date.now();
  const missing = ids.filter((id) => {
    const hit = cache.get(`${id}|${hours}`);
    return !hit || now - hit.at > TTL;
  });
  if (missing.length) {
    const req = hass
      .callWS<Record<string, { s: string; lu?: number; lc?: number }[]>>({
        type: "history/history_during_period",
        start_time: new Date(now - hours * 3600 * 1000).toISOString(),
        entity_ids: missing,
        minimal_response: true,
        no_attributes: true,
        significant_changes_only: false,
      })
      .catch(() => ({}) as Record<string, { s: string; lu?: number; lc?: number }[]>);
    for (const id of missing) {
      cache.set(`${id}|${hours}`, {
        at: now,
        data: req.then((res) =>
          (res[id] ?? [])
            .map((r) => ({ t: (r.lu ?? r.lc ?? 0) * 1000, v: stateValue(r.s) }))
            .filter((p) => p.t && !Number.isNaN(p.v)),
        ),
      });
    }
  }
  const out: Record<string, Point[]> = {};
  await Promise.all(ids.map(async (id) => (out[id] = [...((await cache.get(`${id}|${hours}`)?.data) ?? [])])));
  return out;
}

/**
 * Values at `n` even steps from `start` to `end`: each step the average of the
 * held state over its slice (a state lasts until the next one), then smoothed
 * by a moving average (`smooth` steps to each side) – a calm line like a sparkline, not every sensor jitter.
 */
export function resample(points: Point[], start: number, end: number, n: number, smooth = 1): (number | undefined)[] {
  const out: (number | undefined)[] = [];
  if (!points.length) return out;
  const step = (end - start) / n;
  let i = 0;
  let cur: number | undefined;
  // the state already in force at `start`
  while (i < points.length && points[i].t <= start) cur = points[i++].v;
  for (let k = 0; k < n; k++) {
    const a = start + k * step;
    const b = a + step;
    let sum = 0;
    let dur = 0;
    let t = a;
    while (i < points.length && points[i].t < b) {
      if (cur !== undefined) {
        sum += cur * (points[i].t - t);
        dur += points[i].t - t;
      }
      t = points[i].t;
      cur = points[i++].v;
    }
    if (cur !== undefined) {
      sum += cur * (b - t);
      dur += b - t;
    }
    out.push(dur > 0 ? sum / dur : undefined);
  }
  // moving average over the known values, `smooth` steps to each side
  return out.map((v, k) => {
    if (v === undefined) return v;
    const w = out.slice(Math.max(0, k - smooth), k + smooth + 1).filter((x): x is number => x !== undefined);
    return w.reduce((s, x) => s + x, 0) / w.length;
  });
}

/**
 * A smooth SVG path (Catmull-Rom as cubic Béziers) through the values, in a
 * 0–100 × 0–100 box: x spread evenly, y from `min` (bottom) to `max` (top).
 * Gaps (undefined) start a new segment.
 */
export function smoothPath(values: (number | undefined)[], min: number, max: number): string {
  const n = values.length;
  if (n < 2) return "";
  const x = (k: number) => (k / (n - 1)) * 100;
  const y = (v: number) => 100 - ((v - min) / (max - min || 1)) * 100;
  let d = "";
  let run: [number, number][] = [];
  const flush = () => {
    if (run.length > 1) {
      d += `M${run[0][0].toFixed(2)},${run[0][1].toFixed(2)}`;
      for (let k = 0; k < run.length - 1; k++) {
        const p0 = run[k - 1] ?? run[k];
        const p1 = run[k];
        const p2 = run[k + 1];
        const p3 = run[k + 2] ?? p2;
        const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
        const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
        d += `C${c1[0].toFixed(2)},${c1[1].toFixed(2)} ${c2[0].toFixed(2)},${c2[1].toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
      }
    }
    run = [];
  };
  values.forEach((v, k) => (v === undefined ? flush() : run.push([x(k), y(v)])));
  flush();
  return d;
}

/** Spans (0–100 along x) where an on/off series is on. */
export function onSpans(points: Point[], start: number, end: number): [number, number][] {
  const out: [number, number][] = [];
  const pos = (t: number) => ((Math.min(end, Math.max(start, t)) - start) / (end - start)) * 100;
  let from: number | undefined;
  let state = 0;
  for (const p of points) {
    if (p.t <= start) {
      state = p.v;
      continue;
    }
    if (from === undefined && state > 0) from = start;
    if (p.v > 0 && state <= 0) from = p.t;
    if (p.v <= 0 && state > 0 && from !== undefined) {
      out.push([pos(from), pos(p.t)]);
      from = undefined;
    }
    state = p.v;
  }
  if (state > 0) out.push([pos(from ?? start), 100]);
  return out.filter(([a, b]) => b - a > 0.2);
}

/**
 * The value on the curve `smoothPath` draws, at `f` (0–1 along x) – the same
 * Catmull-Rom segment, so a marker sits exactly on the line.
 */
export function curveAt(values: (number | undefined)[], f: number): number | undefined {
  const n = values.length;
  if (n < 2) return values[0];
  const pos = Math.min(n - 1, Math.max(0, f * (n - 1)));
  const k = Math.min(n - 2, Math.floor(pos));
  const t = pos - k;
  const p1 = values[k];
  const p2 = values[k + 1];
  if (p1 === undefined || p2 === undefined) return t < 0.5 ? (p1 ?? p2) : (p2 ?? p1);
  const p0 = values[k - 1] ?? p1;
  const p3 = values[k + 2] ?? p2;
  const c1 = p1 + (p2 - p0) / 6;
  const c2 = p2 - (p3 - p1) / 6;
  const u = 1 - t;
  return u * u * u * p1 + 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t * p2;
}
