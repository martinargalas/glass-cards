import { tr } from "../i18n";
import { css, html, nothing } from "lit";
import { GlassElement } from "../core/glass-element";
import type { BaseCardConfig, HomeAssistant } from "../core/types";
import { registerCard } from "../core/registry";
import { makeEditor } from "../editor/editor";
import { radarSpec } from "../editor/specs";
import { surface } from "../core/styles";
import { LiquidController } from "../core/liquid";
import { hour12, isDark, language } from "../core/settings";
import { cssColor } from "../core/colors";
import { materials, matTint, type Material } from "../core/materials";
import { RADAR_PARTS } from "../core/card-parts";

/**
 * Weather radar: real clouds from the satellite plus precipitation, animated over
 * the last hour.
 *
 *   type: custom:glass-radar
 *   zoom: 7               # 5–10 (web map zoom)
 *   frames: 7             # 10-minute steps shown in the loop
 *   forecast: 3           # + hours of precipitation forecast (DWD ICON-EU model)
 *   height: 320           # px, fill (take the room the container gives) – or aspect_ratio: 16/10
 *   style: satellite      # satellite: real-colour Meteosat picture (clouds by day, infrared by night)
 *                         # rain: dark map, precipitation only
 *                         # clouds: dark map, clouds shaded by how high / dense they are (infrared)
 *   satellite: true       # show the satellite layer (either style)
 *   satellite_delay: 40   # min; the satellite is published ~30–40 min late
 *   radar: true           # RainViewer precipitation
 *   labels: true          # borders and place names (Esri reference layer)
 *   styles: [rain, clouds] # tabs on the map (satellite | clouds | rain)
 *   autoplay: false       # default: still on the newest frame, ▶ plays the last hour
 *   latitude / longitude  # default: home from HA
 *   radar_provider: dwd   # rainviewer (default, worldwide) | dwd (Germany and its borders, 5-min composite)
 *   map_provider: carto   # the drawn map under rain / clouds: esri (default) | carto | osm
 *   show_forecast: false  # no forecast frames, whatever `forecast` says
 *   controls_glass: liquid  # own materials (core/materials), *_color tints them: the zoom, the
 *   play_glass: dark        #   time bar and the tabs (controls), the play button, the chosen tab
 *   tab_glass: liquid       #   timeline_color / marker_color: the past steps, the home dot
 *
 * Cheap on purpose: every layer is plain images (one satellite picture per frame,
 * a handful of 256 px tiles for radar and labels), frames switch by opacity. Nothing
 * loads before the card is on screen and the loop stops while it is hidden.
 */
interface RadarConfig extends BaseCardConfig {
  latitude?: number;
  longitude?: number;
  zoom?: number;
  frames?: number;
  /** Hours of precipitation forecast after the radar frames (DWD ICON-EU), 0–12; default 0. */
  forecast?: number;
  height?: number | string;
  aspect_ratio?: number | string;
  satellite?: boolean;
  satellite_layer?: string;
  style?: RadarStyle;
  /** Tabs on the map (default: satellite, clouds). */
  styles?: RadarStyle[];
  /** Switch on the map between the two styles (default true). */
  style_switch?: boolean;
  /** Minutes the satellite lags behind real time (EUMETSAT publishes ~30 min late). */
  satellite_delay?: number;
  radar?: boolean;
  radar_opacity?: number;
  radar_color?: number;
  labels?: boolean;
  /** Country borders on the drawn maps (rain / clouds). */
  borders?: boolean;
  marker?: boolean;
  autoplay?: boolean;
  speed?: number;
  title?: string;
  radar_provider?: "rainviewer" | "dwd";
  map_provider?: "esri" | "carto" | "osm";
  show_forecast?: boolean;
  controls_glass?: Material;
  controls_color?: string;
  play_glass?: Material;
  play_color?: string;
  tab_glass?: Material;
  tab_color?: string;
  timeline_color?: string;
  marker_color?: string;
}

const has = (v?: string) => !!v && v !== "none";
/** An element's own material (a colour alone tints the default one). */
function part(m: Material | undefined, color: string | undefined, def: Material) {
  const use = m ?? (has(color) ? def : undefined);
  // no colour of its own: not the one of the control it sits in (the play button in the time bar)
  return use ? { cls: `mat mat-${use}`, style: has(color) ? matTint(color) : "--mat-tint:initial;--mat-tinted:initial;--mat-sheen:initial" } : { cls: "", style: "" };
}

/** satellite: real-colour picture · clouds: dark map + cloud cover by density · rain: dark map, precipitation only */
type RadarStyle = "satellite" | "clouds" | "rain";
const STYLE_NAMES: Record<RadarStyle, string> = {
  satellite: "Clouds",
  clouds: "Cloud cover",
  rain: "Rain",
};

interface Frame {
  time: number;
  path?: string;
  /** Model forecast (DWD ICON-EU hourly precipitation), not a radar picture. */
  fc?: boolean;
  /** DWD's radar composite at this time (radar_provider: dwd). */
  dwd?: boolean;
}

/* ── Precipitation forecast ──────────────────────────────────────────────────
 * DWD's public WMS (ICON-EU, ~7 km, hourly, all of Europe) in its own grey /
 * yellow / red steps, recoloured once per frame to the radar's blues so past
 * and future read as one scale. */
const FC_COLORS: [number, number, number, number][] = [
  [150, 196, 255, 0.55], // light (grey in DWD's scheme)
  [70, 140, 255, 0.72], // moderate (yellow)
  [30, 80, 230, 0.85], // heavy (orange / red)
  [150, 70, 220, 0.9], // extreme (violet / blue)
];
const fcCache = new Map<string, Promise<string>>();
function recolorForecast(url: string): Promise<string> {
  let p = fcCache.get(url);
  if (p) return p;
  p = new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onerror = () => reject(new Error("forecast"));
    img.onload = () => {
      const cv = document.createElement("canvas");
      cv.width = img.naturalWidth;
      cv.height = img.naturalHeight;
      const ctx = cv.getContext("2d", { willReadFrequently: true })!;
      // the model grid is coarse: soften its blocks a little
      ctx.filter = `blur(${Math.max(1, Math.round(cv.width / 320))}px)`;
      ctx.drawImage(img, 0, 0);
      ctx.filter = "none";
      const data = ctx.getImageData(0, 0, cv.width, cv.height);
      const px = data.data;
      for (let i = 0; i < px.length; i += 4) {
        const a = px[i + 3];
        if (a < 8) continue;
        const r = px[i];
        const g = px[i + 1];
        const b = px[i + 2];
        const grey = Math.max(r, g, b) - Math.min(r, g, b) < 24;
        const k = grey ? 0 : r > 180 && g > 150 && b < 140 ? 1 : r > 170 && g < 150 ? 2 : 3;
        const c = FC_COLORS[k];
        px[i] = c[0];
        px[i + 1] = c[1];
        px[i + 2] = c[2];
        px[i + 3] = Math.round(c[3] * a);
      }
      ctx.putImageData(data, 0, 0);
      cv.toBlob((bl) => (bl ? resolve(URL.createObjectURL(bl)) : reject(new Error("blob"))), "image/png");
    };
    img.src = url;
  });
  fcCache.set(url, p);
  if (fcCache.size > 60) {
    const [first, old] = fcCache.entries().next().value as [string, Promise<string>];
    fcCache.delete(first);
    old.then((u) => URL.revokeObjectURL(u)).catch(() => {});
  }
  return p;
}

const STEP = 600;
const frames0 = (n: number) => Array.from({ length: n }, () => true); // s – both sources update every 10 minutes
const REFRESH_MS = 10 * 60 * 1000;
const R = 6378137;
const WORLD = 2 * Math.PI * R;

/* ── RainViewer frame list, shared by every radar on the page ─────────────── */
let maps: { at: number; host: string; frames: Frame[] } | undefined;
let loading: Promise<typeof maps> | undefined;
function radarFrames(): Promise<typeof maps> {
  if (maps && Date.now() - maps.at < 5 * 60 * 1000) return Promise.resolve(maps);
  loading ??= fetch("https://api.rainviewer.com/public/weather-maps.json")
    .then((r) => r.json())
    .then((j) => (maps = { at: Date.now(), host: j.host, frames: (j.radar?.past ?? []).map((f: any) => ({ time: f.time, path: f.path })) }))
    .catch(() => maps)
    .finally(() => (loading = undefined));
  return loading;
}

/** Web Mercator: lon/lat → world pixels at zoom z (256 px tiles). */
function project(lat: number, lon: number, z: number) {
  const size = 256 * 2 ** z;
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return { x: ((lon + 180) / 360) * size, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size, size };
}

interface Tile {
  url: string;
  left: number;
  top: number;
  size: number;
}

/** Tiles from zoom `zs` covering a w×h view centred on (cx, cy) world px at zoom z. */
function tiles(cx: number, cy: number, z: number, zs: number, w: number, h: number, url: (x: number, y: number, z: number) => string): Tile[] {
  const k = 2 ** (z - zs);
  const n = 2 ** zs;
  const left = cx / k - w / 2 / k;
  const top = cy / k - h / 2 / k;
  const out: Tile[] = [];
  for (let ty = Math.floor(top / 256); ty <= Math.floor((top + h / k) / 256); ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = Math.floor(left / 256); tx <= Math.floor((left + w / k) / 256); tx++) {
      out.push({ url: url(((tx % n) + n) % n, ty, zs), left: (tx * 256 - left) * k, top: (ty * 256 - top) * k, size: 256 * k });
    }
  }
  return out;
}

/* ── Cloud shading from the infrared picture ─────────────────────────────────
 * In Meteosat infrared, cold = bright: high, thick clouds are white, clear ground
 * dark. Each frame is recoloured once on a canvas (cached by URL): the clear
 * ground (low percentile) becomes transparent, then a ramp from thin blue-grey
 * through white to violet for the coldest tops. */
const RAMP: [number, [number, number, number, number]][] = [
  [0, [110, 130, 160, 0]],
  [0.12, [118, 138, 168, 0.18]],
  [0.35, [160, 176, 200, 0.5]],
  [0.6, [214, 222, 234, 0.78]],
  [0.82, [248, 249, 252, 0.9]],
  [0.94, [232, 220, 255, 0.93]],
  [1, [206, 166, 255, 0.95]],
];
/** On the light map (day): the same steps in slate blue, so thin cloud still shows on light grey. */
const RAMP_LIGHT: [number, [number, number, number, number]][] = [
  [0, [96, 112, 140, 0]],
  [0.12, [96, 112, 140, 0.16]],
  [0.35, [88, 104, 134, 0.38]],
  [0.6, [74, 90, 122, 0.55]],
  [0.82, [58, 72, 104, 0.68]],
  [0.94, [92, 70, 150, 0.72]],
  [1, [110, 60, 170, 0.78]],
];
const shaded = new Map<string, Promise<string>>();
/** Brightness range per view (URL without its time): shared by all frames, so the loop doesn't pulse. */
const norms = new Map<string, { lo: number; hi: number }>();
function shadeClouds(url: string, light: boolean): Promise<string> {
  const ramp = light ? RAMP_LIGHT : RAMP;
  const key = `${light ? "l" : "d"}|${url}`;
  let p = shaded.get(key);
  if (p) return p;
  p = new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onerror = () => reject(new Error("satellite"));
    img.onload = () => {
      const cv = document.createElement("canvas");
      cv.width = img.naturalWidth;
      cv.height = img.naturalHeight;
      const ctx = cv.getContext("2d", { willReadFrequently: true })!;
      // soften first: rounded cloud shapes (as on Windy) instead of satellite pixels
      ctx.filter = `blur(${Math.max(2, Math.round(cv.width / 140))}px)`;
      ctx.drawImage(img, 0, 0);
      ctx.filter = "none";
      const data = ctx.getImageData(0, 0, cv.width, cv.height);
      const px = data.data;
      // brightness histogram → clear ground (10th percentile) and the coldest tops (99.5th)
      const hist = new Uint32Array(256);
      for (let i = 0; i < px.length; i += 4) hist[px[i]]++;
      const total = px.length / 4;
      const pct = (q: number) => {
        let acc = 0;
        for (let v = 0; v < 256; v++) if ((acc += hist[v]) >= total * q) return v;
        return 255;
      };
      const view = url.replace(/&time=[^&]*/, "");
      let n = norms.get(view);
      if (!n) {
        const lo = Math.min(pct(0.1) + 10, 150);
        n = { lo, hi: Math.max(lo + 45, pct(0.995)) };
        norms.set(view, n);
      }
      const { lo, hi } = n;
      const lut = new Uint8ClampedArray(256 * 4);
      for (let v = 0; v < 256; v++) {
        const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
        let k = 1;
        while (k < ramp.length - 1 && ramp[k][0] < t) k++;
        const [t0, c0] = ramp[k - 1];
        const [t1, c1] = ramp[k];
        const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
        for (let j = 0; j < 4; j++) lut[v * 4 + j] = (c0[j] + (c1[j] - c0[j]) * f) * (j === 3 ? 255 : 1);
      }
      for (let i = 0; i < px.length; i += 4) {
        const o = px[i] * 4;
        px[i] = lut[o];
        px[i + 1] = lut[o + 1];
        px[i + 2] = lut[o + 2];
        px[i + 3] = lut[o + 3];
      }
      ctx.putImageData(data, 0, 0);
      cv.toBlob((b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error("blob"))), "image/png");
    };
    img.src = url;
  });
  shaded.set(key, p);
  // keep the cache small: frames older than the loop are not needed again
  if (shaded.size > 40) {
    const [first, old] = shaded.entries().next().value as [string, Promise<string>];
    shaded.delete(first);
    old.then((u) => URL.revokeObjectURL(u)).catch(() => {});
  }
  return p;
}

class GlassRadar extends GlassElement<RadarConfig> {
  static override parts = RADAR_PARTS;
  static getConfigElement() {
    return makeEditor(radarSpec);
  }

  static getStubConfig() {
    return { zoom: 7, frames: 7 };
  }

  static override properties = {
    ...GlassElement.properties,
    _frames: { state: true },
    _idx: { state: true },
    _playing: { state: true },
    _w: { state: true },
    _h: { state: true },
    _visible: { state: true },
    _style: { state: true },
    _zoom: { state: true },
    _view: { state: true },
  };
  declare _style: RadarStyle;
  declare _zoom: number;
  /** Map centre after dragging, in world units (0–1); undefined = home. */
  declare _view?: { x: number; y: number };
  private _drag?: { id: number; x: number; y: number; dx: number; dy: number; moved: boolean };
  private _dragged = false;
  /** Fingers on the map (pinch zoom) and the last wheel step (one zoom step per gesture). */
  private _touches = new Map<number, { x: number; y: number }>();
  private _pinch?: number;
  private _wheelAt = 0;
  declare _frames: Frame[];
  declare _idx: number;
  declare _playing: boolean;
  declare _w: number;
  declare _h: number;
  declare _visible: boolean;

  private _host = "";
  private _timer?: number;
  private _refresh?: number;
  private _ro?: ResizeObserver;
  private _io?: IntersectionObserver;
  private _hold = 0;
  private _prev = -1;
  /** Per frame: is its picture ready (clouds are recoloured asynchronously). */
  private _ready: boolean[] = [];

  constructor() {
    super();
    this._frames = [];
    this._idx = 0;
    this._playing = true;
    this._w = 0;
    this._h = 0;
    this._visible = false;
    new LiquidController(this, ".frame");
  }

  protected override validateConfig(c: RadarConfig) {
    // still by default: the newest frame; ▶ plays the last hour
    this._playing = c.autoplay === true;
    this._style = c.style ?? c.styles?.[0] ?? "satellite";
    this._zoom = Math.max(4, Math.min(10, c.zoom ?? 7));
    return c;
  }

  protected watchedEntities() {
    return [];
  }

  override connectedCallback() {
    super.connectedCallback();
    this._io = new IntersectionObserver((e) => this._setVisible(e.some((x) => x.isIntersecting)));
    this._io.observe(this);
    document.addEventListener("visibilitychange", this._onDoc);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._io?.disconnect();
    this._ro?.disconnect();
    this._ro = undefined;
    document.removeEventListener("visibilitychange", this._onDoc);
    this._stop();
    clearInterval(this._refresh);
    this._refresh = undefined;
  }

  private _onDoc = () => this._setVisible(this._visible);

  private _setVisible(v: boolean) {
    this._visible = v;
    const on = v && document.visibilityState === "visible";
    if (on) {
      if (!this._refresh) {
        this._load();
        this._refresh = window.setInterval(() => this._load(), REFRESH_MS);
      }
      if (this._playing) this._start();
    } else {
      this._stop();
      clearInterval(this._refresh);
      this._refresh = undefined;
    }
  }

  protected override firstUpdated() {
    this._ro = new ResizeObserver(() => {
      const map = this.renderRoot.querySelector<HTMLElement>(".map");
      if (!map) return;
      const w = Math.round(map.clientWidth);
      const h = Math.round(map.clientHeight);
      if (w !== this._w || h !== this._h) {
        this._w = w;
        this._h = h;
      }
    });
    const map = this.renderRoot.querySelector(".map");
    if (map) this._ro.observe(map);
  }

  private async _load() {
    const c = this._config;
    if (!c) return;
    const count = Math.max(1, Math.min(13, c.frames ?? 7));
    let frames: Frame[] = [];
    const dwd = c.radar_provider === "dwd";
    if (c.radar !== false && !dwd) {
      const m = await radarFrames();
      if (m) {
        this._host = m.host;
        frames = m.frames.slice(-count);
      }
    }
    if (!frames.length) {
      // satellite only (or radar list unavailable): the last full 10-minute steps
      // (DWD's composite is ready ~10 min after its time; it has no list to ask)
      const last = Math.floor(Date.now() / 1000 / STEP) * STEP - (dwd ? 1 : 2) * STEP;
      frames = Array.from({ length: count }, (_, i) => ({ time: last - (count - 1 - i) * STEP, dwd: dwd && c.radar !== false }));
    }
    const past = frames.length;
    const hours = c.show_forecast === false ? 0 : Math.max(0, Math.min(12, c.forecast ?? 0));
    if (hours && c.radar !== false) {
      const first = Math.floor(frames[past - 1].time / 3600) * 3600 + 3600;
      for (let i = 0; i < hours; i++) frames.push({ time: first + i * 3600, fc: true });
    }
    const fresh = frames.map((f) => f.time).join() !== this._frames.map((f) => f.time).join();
    if (fresh) {
      this._frames = frames;
      this._idx = past - 1; // "now" – the forecast is ahead on the timeline
    }
  }

  private _start() {
    if (this._timer || !this._visible) return;
    this._timer = window.setInterval(() => {
      const n = this._frames.length;
      if (n < 2) return;
      // rest a moment on the newest frame before looping
      if (this._idx === n - 1 && this._hold < 3) {
        this._hold++;
        return;
      }
      const next = (this._idx + 1) % n;
      if (this._ready[next] === false) return; // wait for its picture – no empty frame
      this._hold = 0;
      this._prev = this._idx;
      this._idx = next;
    }, Math.max(250, this._config?.speed ?? 650));
  }

  private _stop() {
    clearInterval(this._timer);
    this._timer = undefined;
  }

  private _toggle(e?: Event) {
    e?.stopPropagation();
    // the click that ends a drag is not a tap
    if (this._dragged) {
      this._dragged = false;
      return;
    }
    this._playing = !this._playing;
    if (this._playing) this._start();
    else this._stop();
  }

  private _seek(i: number, e: Event) {
    e.stopPropagation();
    this._playing = false;
    this._stop();
    this._prev = this._idx;
    this._idx = i;
  }

  /* ── dragging the map ───────────────────────────────────────────────────────
   * While the finger moves only the layers' transform changes (no re-render, no
   * downloads); on release the centre moves and the pictures for it load. */
  private _down = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest(".bar, .zoom, .styles")) return;
    this._touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this._touches.size === 2) {
      // second finger: a pinch, not a drag
      const [a, b] = [...this._touches.values()];
      this._pinch = Math.hypot(a.x - b.x, a.y - b.y);
      this._cancelDrag();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    this._drag = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  private _move = (e: PointerEvent) => {
    if (this._touches.has(e.pointerId)) this._touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this._pinch && this._touches.size === 2) {
      const [a, b] = [...this._touches.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      // a step each time the fingers spread / close by a quarter
      if (dist > this._pinch * 1.25 || dist < this._pinch / 1.25) {
        this._setZoom(dist > this._pinch ? 1 : -1);
        this._pinch = dist;
      }
      return;
    }
    const d = this._drag;
    if (!d || d.id !== e.pointerId) return;
    d.dx = e.clientX - d.x;
    d.dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(d.dx, d.dy) < 5) return;
    d.moved = true;
    const pan = this.renderRoot.querySelector<HTMLElement>(".pan");
    if (pan) pan.style.transform = `translate(${d.dx}px, ${d.dy}px)`;
  };

  private _up = (e: PointerEvent) => {
    this._touches.delete(e.pointerId);
    if (this._pinch) {
      if (this._touches.size < 2) this._pinch = undefined;
      this._dragged = true; // the lifted finger's click is no tap
      return;
    }
    const d = this._drag;
    if (!d || d.id !== e.pointerId) return;
    this._drag = undefined;
    if (!d.moved) return;
    this._dragged = true;
    const size = 256 * 2 ** this._zoom;
    const home = this._hass ? this._homeWorld(this._hass) : { x: 0.5, y: 0.5 };
    const v = this._view ?? home;
    this._view = { x: v.x - d.dx / size, y: Math.max(0, Math.min(1, v.y - d.dy / size)) };
    this._prev = -1;
    // the layers are rebuilt for the new centre; drop the temporary shift with them
    this.updateComplete.then(() => {
      const pan = this.renderRoot.querySelector<HTMLElement>(".pan");
      if (pan) pan.style.transform = "";
    });
  };

  private _cancelDrag() {
    this._drag = undefined;
    const pan = this.renderRoot.querySelector<HTMLElement>(".pan");
    if (pan) pan.style.transform = "";
  }

  /** Mouse wheel / trackpad: one zoom step per gesture (not per wheel tick). */
  private _wheel = {
    handleEvent: (e: WheelEvent) => {
      e.preventDefault();
      const now = Date.now();
      if (now - this._wheelAt < 280 || Math.abs(e.deltaY) < 2) return;
      this._wheelAt = now;
      this._setZoom(e.deltaY < 0 ? 1 : -1);
    },
    passive: false,
  };

  /** Home position in world units (0–1). */
  private _homeWorld(hass: HomeAssistant) {
    const { lat, lon } = this._center(hass);
    const p = project(lat, lon, 0);
    return { x: p.x / p.size, y: p.y / p.size };
  }

  private _recenter() {
    this._view = undefined;
    this._prev = -1;
  }

  private _setZoom(d: number) {
    this._zoom = Math.max(4, Math.min(10, this._zoom + d));
    this._prev = -1;
  }

  private _setStyle(s: RadarStyle) {
    if (s === this._style) return;
    this._style = s;
    this._prev = -1;
  }

  private _center(hass: HomeAssistant) {
    const c = this._config;
    const cfg = (hass.config ?? {}) as { latitude?: number; longitude?: number };
    return { lat: c.latitude ?? cfg.latitude ?? 50.08, lon: c.longitude ?? cfg.longitude ?? 14.42 };
  }

  private _fc = new Map<string, string>();
  /** Recoloured forecast picture for a frame, once ready. */
  private _forecastSrc(url: string): string | undefined {
    const hit = this._fc.get(url);
    if (hit) return hit;
    if (!this._fc.has(url)) {
      this._fc.set(url, "");
      recolorForecast(url)
        .then((u) => {
          this._fc.set(url, u);
          this.requestUpdate();
        })
        .catch(() => {});
    }
    return undefined;
  }

  private _shaded = new Map<string, string>();
  /** Recoloured cloud picture for a frame, once it is ready (re-renders when it is). */
  private _cloudsSrc(src: string, light: boolean): string | undefined {
    const url = `${light ? "l" : "d"}|${src}`;
    const hit = this._shaded.get(url);
    if (hit) return hit;
    if (!this._shaded.has(url)) {
      this._shaded.set(url, "");
      shadeClouds(src, light)
        .then((u) => {
          this._shaded.set(url, u);
          this.requestUpdate();
        })
        .catch(() => {});
    }
    return undefined;
  }

  /** WMS box of the current view: bbox in EPSG:3857 and the picture size. */
  private _box(cx: number, cy: number, size: number) {
    const w = this._w;
    const h = this._h;
    const res = WORLD / size; // metres per css px
    const mx = (cx / size) * WORLD - WORLD / 2;
    const my = WORLD / 2 - (cy / size) * WORLD;
    const q = Math.min(1.5, window.devicePixelRatio || 1);
    const pw = Math.min(1280, Math.round(w * q));
    const ph = Math.min(1280, Math.round(h * q));
    const bbox = [mx - (w / 2) * res, my - (h / 2) * res, mx + (w / 2) * res, my + (h / 2) * res].map((v) => v.toFixed(0)).join(",");
    return `&bbox=${bbox}&width=${pw}&height=${ph}`;
  }

  private _satUrl(t: number, cx: number, cy: number, size: number) {
    const c = this._config;
    // shifted by the publishing delay, so every frame is a different picture and the clouds move
    const sat = Math.floor((t - (c.satellite_delay ?? 40) * 60) / STEP) * STEP;
    const time = new Date(sat * 1000).toISOString().slice(0, 16) + ":00Z";
    return (
      "https://view.eumetsat.int/geoserver/wms?service=WMS&version=1.3.0&request=GetMap&styles=&crs=EPSG:3857&format=image/jpeg" +
      `&layers=${encodeURIComponent(c.satellite_layer ?? (this._style === "clouds" ? "mtg_fd:ir105_hrfi" : "mtg_fd:rgb_geocolour"))}${this._box(cx, cy, size)}&time=${time}`
    );
  }

  protected override render() {
    const c = this._config;
    const hass = this._hass;
    if (!c || !hass) return nothing;
    const lang = language(hass);
    const fill = c.height === "fill";
    const h = typeof c.height === "number" ? `${c.height}px` : c.height;
    const style = fill ? "flex:1;min-height:160px" : h ? `height:${h}` : `aspect-ratio:${c.aspect_ratio ?? "16 / 10"}`;
    this.toggleAttribute("fill", fill);
    return html`<div class="frame surface">
      ${c.title ? html`<div class="title">${c.title}</div>` : nothing}
      <div class="map" style="${style};--fade:${Math.round(Math.min(900, (c.speed ?? 650) * 0.75))}ms" @click=${this._toggle}
        @pointerdown=${this._down}
        @pointermove=${this._move}
        @pointerup=${this._up}
        @pointercancel=${this._up}
        @wheel=${this._wheel}
      >
        ${this._w && this._visible ? this._layers(hass, lang) : nothing}
      </div>
    </div>`;
  }

  private _layers(hass: HomeAssistant, lang: string) {
    const c = this._config;
    const z = this._zoom;
    const homeW = this._homeWorld(hass);
    const v = this._view ?? homeW;
    const size = 256 * 2 ** z;
    const p = { x: v.x * size, y: v.y * size, size };
    const w = this._w;
    const h = this._h;
    const sat = c.satellite !== false && this._style !== "rain";
    const clouds = this._style === "clouds";
    const tabs = c.styles ?? (c.satellite === false ? [] : (["satellite", "clouds"] as RadarStyle[]));
    this._ready = frames0(this._frames.length);
    const dark = isDark(hass, this);
    // light map by day, dark at night – like the room cards (the satellite picture is always dark)
    this.toggleAttribute("light", !dark && this._style !== "satellite");
    const rz = Math.min(z, 7); // RainViewer's free tiles stop at zoom 7
    const color = c.radar_color ?? 2;
    const esri = (service: string) => (x: number, y: number, zz: number) => `https://server.arcgisonline.com/ArcGIS/rest/services/${service}/MapServer/tile/${zz}/${y}/${x}`;
    const carto = (layer: string) => (x: number, y: number, zz: number) => `https://basemaps.cartocdn.com/${layer}/${zz}/${x}/${y}.png`;
    const mp = c.map_provider ?? "esri";
    const baseUrl =
      mp === "carto"
        ? carto(dark ? "dark_nolabels" : "light_nolabels")
        : mp === "osm"
          ? (x: number, y: number, zz: number) => `https://tile.openstreetmap.org/${zz}/${x}/${y}.png`
          : esri(dark ? "Canvas/World_Dark_Gray_Base" : "Canvas/World_Light_Gray_Base");
    // OpenStreetMap carries its own names: no second layer of them
    const labelUrl = sat
      ? esri("Reference/World_Boundaries_and_Places")
      : mp === "carto"
        ? carto(dark ? "dark_only_labels" : "light_only_labels")
        : mp === "osm"
          ? undefined
          : esri(dark ? "Canvas/World_Dark_Gray_Reference" : "Canvas/World_Light_Gray_Reference");
    const ctl = part(c.controls_glass, c.controls_color, "liquid");
    const play = part(c.play_glass, c.play_color, "liquid");
    const tab = part(c.tab_glass, c.tab_color, "liquid");
    const tileEls = (list: Tile[], cls: string) =>
      list.map((t) => html`<img class=${cls} src=${t.url} style="left:${t.left}px;top:${t.top}px;width:${t.size}px;height:${t.size}px" alt="" draggable="false" />`);
    const frames = this._frames;
    const cur = frames[this._idx];
    const h12 = hour12(hass);
    const fmt = (t: number) => new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit", hour12: h12 }).format(new Date(t * 1000));
    const ago = cur ? Math.round((Date.now() / 1000 - cur.time) / 60) : 0;
    const ahead = Math.max(1, Math.round(-ago / 60));
    const agoText = cur?.fc ? tr("forecast in {n} h", { n: ahead }) : ago < 5 ? tr("now") : tr("{n} min ago", { n: ago });

    return html`<div class="pan">
      ${sat && !clouds
        ? nothing
        : html`<div class="base ${mp}">${tileEls(tiles(p.x, p.y, z, z, w, h, baseUrl), "t")}</div>`}
      ${frames.map(
        (f, i) => html`<div class="frame-layer ${i === this._idx ? "on" : i === this._prev ? "prev" : ""}">
          ${!sat
            ? nothing
            : clouds
              ? (() => {
                  const src = this._cloudsSrc(this._satUrl(f.time, p.x, p.y, p.size).replace("format=image/jpeg", "format=image/png"), !dark);
                  this._ready[i] = !!src;
                  return src ? html`<img class="sat clouds" src=${src} alt="" draggable="false" />` : nothing;
                })()
              : html`<img class="sat" src=${this._satUrl(f.time, p.x, p.y, p.size)} alt="" draggable="false" />`}
          ${f.fc
            ? (() => {
                const u = `https://maps.dwd.de/geoserver/dwd/wms?service=WMS&version=1.3.0&request=GetMap&styles=&crs=EPSG:3857&format=image/png&transparent=true&layers=dwd:Icon-eu_reg00625_fd_sl_TOTPREC01H${this._box(p.x, p.y, p.size)}&time=${new Date(f.time * 1000).toISOString().slice(0, 13)}:00:00Z`;
                const src = this._forecastSrc(u);
                this._ready[i] = !!src;
                return src ? html`<img class="sat" src=${src} alt="" draggable="false" />` : nothing;
              })()
            : nothing}
          ${f.dwd
            ? html`<img
                class="sat dwd"
                style="opacity:${c.radar_opacity ?? 0.85}"
                src=${`https://maps.dwd.de/geoserver/dwd/wms?service=WMS&version=1.3.0&request=GetMap&styles=&crs=EPSG:3857&format=image/png&transparent=true&layers=dwd:Niederschlagsradar${this._box(p.x, p.y, p.size)}&time=${new Date(f.time * 1000).toISOString().slice(0, 16)}:00Z`}
                alt=""
                draggable="false"
              />`
            : nothing}
          ${c.radar !== false && f.path
            ? html`<div class="radar" style="opacity:${c.radar_opacity ?? 0.85}">
                ${tileEls(
                  tiles(p.x, p.y, z, rz, w, h, (x, y, zz) => `${this._host}${f.path}/256/${zz}/${x}/${y}/${color}/1_1.png`),
                  "t",
                )}
              </div>`
            : nothing}
        </div>`,
      )}
      ${c.borders === false || sat
        ? nothing
        : (() => {
            // country borders as a mask, so they take the map's colour (dark on light, light on dark)
            const u = `url("https://view.eumetsat.int/geoserver/wms?service=WMS&version=1.3.0&request=GetMap&styles=&crs=EPSG:3857&format=image/png&transparent=true&layers=osmgray:ne_10m_admin_0_boundary_lines_land${this._box(p.x, p.y, p.size)}")`;
            return html`<div class="borders" style="-webkit-mask-image:${u};mask-image:${u}"></div>`;
          })()}
      ${c.labels === false || !labelUrl
        ? nothing
        : html`<div class="labels">${tileEls(tiles(p.x, p.y, z, Math.min(z, 13), w, h, labelUrl), "t")}</div>`}
      ${c.marker === false
        ? nothing
        : html`<i class="marker" style="${has(c.marker_color) ? `--mk:${cssColor(c.marker_color)};` : ""}left:${w / 2 + (homeW.x - v.x) * size}px;top:${h / 2 + (homeW.y - v.y) * size}px"></i>`}
      </div>
      <div class="zoom ${ctl.cls}" style=${ctl.style} @click=${(e: Event) => e.stopPropagation()}>
        <button @click=${() => this._setZoom(1)} ?disabled=${z >= 10} aria-label="zoom in"><ha-icon icon="mdi:plus"></ha-icon></button>
        <button @click=${() => this._setZoom(-1)} ?disabled=${z <= 4} aria-label="zoom out"><ha-icon icon="mdi:minus"></ha-icon></button>
        ${this._view ? html`<button @click=${() => this._recenter()} aria-label="home"><ha-icon icon="mdi:crosshairs-gps"></ha-icon></button>` : nothing}
      </div>
      ${frames.length
        ? html`<div class="bar ${ctl.cls}" style="${ctl.style};${has(c.timeline_color) ? `--tl:${cssColor(c.timeline_color)}` : ""}" @click=${(e: Event) => e.stopPropagation()}>
            <button class="play ${play.cls}" style=${play.style} @click=${this._toggle} aria-label=${this._playing ? "pause" : "play"}>
              <ha-icon icon=${this._playing ? "mdi:pause" : "mdi:play"}></ha-icon>
            </button>
            <div class="track">
              ${frames.map((_f, i) => html`<span class="tick ${i <= this._idx ? "past" : ""} ${_f.fc ? "fc" : ""}" @click=${(e: Event) => this._seek(i, e)}></span>`)}
            </div>
            <span class="time">${cur ? fmt(cur.time) : ""} · ${agoText}</span>
          </div>
          ${tabs.length > 1 && c.style_switch !== false
            ? html`<div class="styles ${ctl.cls}" style=${ctl.style} @click=${(e: Event) => e.stopPropagation()}>
                ${tabs.map(
                  (s) =>
                    html`<button class=${this._style === s ? `on ${tab.cls}` : ""} style=${this._style === s ? tab.style : ""} @click=${() => this._setStyle(s)}>
                      ${STYLE_NAMES[s] ? tr(STYLE_NAMES[s]) : s}
                    </button>`,
                )}
              </div>`
            : nothing}`
        : nothing}
      <span class="attr"
        >${sat ? "EUMETSAT · " : ""}${c.radar !== false ? (c.radar_provider === "dwd" ? "DWD · " : "RainViewer · ") : ""}${!sat && mp === "carto"
          ? "© OpenStreetMap · CARTO"
          : !sat && mp === "osm"
            ? "© OpenStreetMap"
            : "Esri"}</span
      >
    `;
  }

  static override styles = [
    GlassElement.styles,
    surface,
    css`
      :host {
        display: block;
      }
      :host([fill]) {
        height: 100%;
        min-height: 0;
      }
      :host([fill]) .frame {
        height: 100%;
        box-sizing: border-box;
      }
      .frame {
        border-radius: var(--g-radius-lg);
        padding: 8px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .title {
        padding: 6px 12px 0;
        font-size: 15px;
        font-weight: 500;
        text-shadow: var(--g-text-shadow);
      }
      /* inside a panel the panel is the glass; the map sits on it directly */
      /* (a card with its own glass on a panel without any – own-tile – is its own tile) */
      :host([nested][glass]:not([own-tile])) .frame.surface {
        background: none !important;
        border: none !important;
        box-shadow: none !important;
        -webkit-backdrop-filter: none !important;
        backdrop-filter: none !important;
        padding: 0;
      }
      :host([nested]:not([own-tile])) .frame::before,
      :host([nested]:not([own-tile])) .frame::after {
        display: none;
      }
      /* home tiles on a panel without glass: the card is its own tile (like the room cards) */
      :host([nested][on-bare][glass="home"]) .frame.surface {
        background: var(--glass-home-fill, linear-gradient(var(--glass-home-surface, rgba(246, 246, 248, 0.8)), var(--glass-home-surface, rgba(246, 246, 248, 0.8)))) !important;
        border: 0.5px solid var(--glass-home-border, rgba(255, 255, 255, 0.35)) !important;
        box-shadow: var(--glass-home-shadow, 0 4px 16px rgba(0, 0, 0, 0.1)) !important;
        -webkit-backdrop-filter: blur(calc(var(--glass-home-blur, 24px) * var(--glass-blur-scale, 1))) saturate(var(--glass-home-saturate, 100%)) !important;
        backdrop-filter: blur(calc(var(--glass-home-blur, 24px) * var(--glass-blur-scale, 1))) saturate(var(--glass-home-saturate, 100%)) !important;
        padding: 0;
        border-radius: var(--g-radius);
      }
      /* no tile of its own → the text keeps the panel's colours */
      :host([nested]:not([on-bare])) .frame.surface {
        --g-text: inherit;
        --g-text-2: inherit;
        --g-text-shadow: inherit;
        color: inherit;
      }
      .map {
        position: relative;
        overflow: hidden;
        border-radius: calc(var(--g-radius-lg) - 8px);
        background: #1b2230;
        cursor: pointer;
        isolation: isolate;
        contain: strict;
        -webkit-tap-highlight-color: transparent;
      }
      /* --glass-radar-radius: e.g. the panel's radius when the map fills a panel with padding 0 */
      :host([nested]) .map {
        border-radius: var(--glass-radar-radius, var(--g-radius));
      }
      /* as a tile the map is the tile, edge to edge */
      :host([nested][on-bare][glass="home"]) .map {
        border-radius: var(--g-radius);
      }
      /* light map (day): light controls */
      :host([light]) .map {
        background: #e9ebee;
      }
      :host([light]) .bar:not(.mat),
      :host([light]) .styles:not(.mat) {
        background: rgba(255, 255, 255, 0.62);
        border-color: rgba(0, 0, 0, 0.08);
        color: #1c1c1e;
      }
      :host([light]) .play:not(.mat) {
        background: rgba(0, 0, 0, 0.08);
        color: #1c1c1e;
      }
      :host([light]) .tick {
        background: rgba(0, 0, 0, 0.16);
      }
      /* forecast steps: hollow until reached */
      .tick.fc {
        background: none;
        box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.45);
      }
      .tick.fc.past {
        background: rgba(255, 255, 255, 0.5);
      }
      :host([light]) .tick.fc {
        background: none;
        box-shadow: inset 0 0 0 1.5px rgba(0, 0, 0, 0.3);
      }
      :host([light]) .tick.fc.past {
        background: rgba(28, 28, 30, 0.4);
      }
      :host([light]) .tick.past {
        background: var(--tl, rgba(28, 28, 30, 0.75));
      }
      :host([light]) .styles button:not(.mat) {
        color: rgba(28, 28, 30, 0.7);
      }
      :host([light]) .styles button.on:not(.mat) {
        background: rgba(0, 0, 0, 0.08);
        color: #1c1c1e;
      }
      :host([light]) .attr {
        color: rgba(0, 0, 0, 0.55);
        text-shadow: none;
      }
      .base,
      .frame-layer,
      .labels,
      .radar {
        position: absolute;
        inset: 0;
        pointer-events: none;
      }
      /* only the incoming frame fades; the previous one stays fully under it,
         so the map never dips to the background between frames */
      .frame-layer {
        opacity: 0;
      }
      .frame-layer.prev {
        opacity: 1;
        z-index: 1;
      }
      .frame-layer.on {
        opacity: 1;
        z-index: 2;
        transition: opacity var(--fade, 0.45s) ease;
      }
      .labels,
      .borders,
      .marker,
      .bar,
      .zoom,
      .attr {
        z-index: 3;
      }
      .borders {
        position: absolute;
        inset: 0;
        pointer-events: none;
        background: rgba(255, 255, 255, 0.5);
        -webkit-mask-size: 100% 100%;
        mask-size: 100% 100%;
      }
      :host([light]) .borders {
        background: rgba(40, 44, 52, 0.55);
      }
      .zoom {
        position: absolute;
        right: 10px;
        top: 10px;
        display: flex;
        flex-direction: column;
        border-radius: 18px;
        overflow: hidden;
        background: rgba(20, 24, 34, 0.42);
        border: 1px solid rgba(255, 255, 255, 0.16);
        -webkit-backdrop-filter: blur(calc(14px * var(--glass-blur-scale, 1))) saturate(140%);
        backdrop-filter: blur(calc(14px * var(--glass-blur-scale, 1))) saturate(140%);
      }
      .zoom button {
        width: 34px;
        height: 34px;
        border: 0;
        padding: 0;
        display: grid;
        place-items: center;
        background: none;
        color: #fff;
        cursor: pointer;
        --mdc-icon-size: 20px;
      }
      .zoom button + button {
        border-top: 1px solid rgba(255, 255, 255, 0.14);
      }
      .zoom button:disabled {
        opacity: 0.35;
        cursor: default;
      }
      :host([light]) .zoom:not(.mat) {
        background: rgba(255, 255, 255, 0.62);
        border-color: rgba(0, 0, 0, 0.08);
      }
      :host([light]) .zoom:not(.mat) button {
        color: #1c1c1e;
      }
      :host([light]) .zoom button + button {
        border-top-color: rgba(0, 0, 0, 0.08);
      }
      img.t {
        position: absolute;
        user-select: none;
      }
      img.sat {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        filter: saturate(0.9) brightness(0.96);
      }
      img.sat.clouds {
        filter: none;
      }
      .radar img.t {
        image-rendering: auto;
      }
      .labels {
        opacity: 0.85;
      }
      .pan {
        position: absolute;
        inset: 0;
        will-change: transform;
      }
      .map {
        touch-action: none;
        user-select: none;
        -webkit-user-select: none;
      }
      .marker {
        position: absolute;
        width: 12px;
        height: 12px;
        margin: -6px 0 0 -6px;
        border-radius: 50%;
        background: var(--mk, #0a84ff);
        box-shadow:
          0 0 0 3px rgba(255, 255, 255, 0.9),
          0 0 0 9px color-mix(in srgb, var(--mk, #0a84ff) 25%, transparent);
      }
      .bar {
        position: absolute;
        left: 10px;
        right: 10px;
        bottom: 10px;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 5px 12px 5px 5px;
        border-radius: 999px;
        background: rgba(20, 24, 34, 0.42);
        border: 1px solid rgba(255, 255, 255, 0.16);
        -webkit-backdrop-filter: blur(calc(14px * var(--glass-blur-scale, 1))) saturate(140%);
        backdrop-filter: blur(calc(14px * var(--glass-blur-scale, 1))) saturate(140%);
        color: #fff;
        cursor: default;
      }
      .play {
        flex: none;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        border: 0;
        padding: 0;
        display: grid;
        place-items: center;
        background: rgba(255, 255, 255, 0.2);
        color: #fff;
        cursor: pointer;
        --mdc-icon-size: 20px;
      }
      .play:active {
        transform: scale(0.92);
      }
      .track {
        flex: 1;
        display: flex;
        gap: 4px;
        align-items: center;
        min-width: 0;
      }
      .tick {
        flex: 1;
        height: 6px;
        border-radius: 3px;
        background: rgba(255, 255, 255, 0.22);
        cursor: pointer;
        transition: background 0.3s ease;
      }
      .tick.past {
        background: var(--tl, rgba(255, 255, 255, 0.85));
      }
      /* own materials: they replace the dark blur of the controls (the shape stays) */
      .zoom.mat,
      .bar.mat,
      .styles.mat {
        border: 0;
      }
      .zoom.mat button,
      .bar.mat,
      .styles.mat button {
        color: inherit;
      }
      /* OpenStreetMap's colourful map: quieter under the rain */
      .base.osm {
        filter: saturate(0.6);
      }
      :host([dark]) .base.osm {
        filter: saturate(0.5) brightness(0.55);
      }
      .time {
        flex: none;
        font-size: 13px;
        font-weight: 500;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .styles {
        position: absolute;
        left: 10px;
        top: 10px;
        z-index: 3;
        display: flex;
        gap: 2px;
        padding: 3px;
        border-radius: 999px;
        background: rgba(20, 24, 34, 0.42);
        border: 1px solid rgba(255, 255, 255, 0.16);
        -webkit-backdrop-filter: blur(calc(14px * var(--glass-blur-scale, 1))) saturate(140%);
        backdrop-filter: blur(calc(14px * var(--glass-blur-scale, 1))) saturate(140%);
      }
      .styles button {
        border: 0;
        border-radius: 999px;
        padding: 5px 12px;
        font: 500 12px var(--g-font);
        cursor: pointer;
      }
      .styles button:not(.mat) {
        background: none;
        color: rgba(255, 255, 255, 0.8);
      }
      .styles button.on:not(.mat) {
        background: rgba(255, 255, 255, 0.24);
        color: #fff;
      }
      .attr {
        position: absolute;
        right: 16px;
        bottom: 54px;
        font-size: 9px;
        color: rgba(255, 255, 255, 0.7);
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
        pointer-events: none;
      }
    `,
    // after the card's own rules: a picked material replaces the default glass
    materials,
  ];
}

registerCard("glass-radar", GlassRadar, {
  name: "Glass – radar",
  description: "Satellite clouds and precipitation radar, animated over the last hour.",
});
