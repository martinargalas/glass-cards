import { tr } from "../i18n";
import { roomToDock } from "../core/dock-space";
import { css, html, nothing, type PropertyValues } from "lit";
import { GlassElement } from "../core/glass-element";
import type { BaseCardConfig, HassEntity, HomeAssistant } from "../core/types";
import { createCard, registerCard } from "../core/registry";
import { makeEditor } from "../editor/editor";
import { cameraSpec } from "../editor/specs";
import { haptic } from "../core/actions";
import { control, surface } from "../core/styles";
import { materials, matTint, type Material } from "../core/materials";
import { cssColor } from "../core/colors";
import { CAMERA_PARTS } from "../core/card-parts";
import { buildChildren, forward, type ChildEl, type Mode } from "../core/container";
import { hour12, language, resolveGlass, settings } from "../core/settings";
import { screenUnits } from "../core/layout";
import { webglAvailable } from "../core/liquid-gl";
import { conditionEntities, evalCondition, type Condition } from "../core/conditions";
import type { ChipConfig } from "./status-bar";

/**
 * Cameras: the live picture and what Frigate recorded, in one card. A tap on a recording plays
 * it where the live picture is (✕ or "Live" goes back); the cameras' own switches and selects
 * (a light, night vision…) sit under it, the objects Frigate sees right now on it.
 *
 *   type: custom:glass-camera
 *   cameras:
 *     - camera: camera.frontdoor      # the live picture (HA's stream: WebRTC / HLS / MJPEG)
 *       name: Front door
 *       icon: mdi:door
 *       url: rtsp://user:pass@cam/live   # the live picture: an RTSP link or a go2rtc stream's name
 *                                     #   (default: the camera entity's own stream)
 *       poster: camera.frontdoor      # WebRTC Camera's settings, all of them, as in its docs: poster,
 *       mode: webrtc,mse              #   poster_remote, mode, media, server, ui, muted, background,
 *                                     #   intersection, style, shortcuts, ptz, digital_ptz, streams,
 *                                     #   title… – on a camera for it, on the card for every camera
 *       live_card: { type: picture-entity, … }   # optional: any other card as the live picture
 *       active: { entity: input_boolean.camera_1, state: "on" }   # optional: shown while this holds
 *                                     #   (switched elsewhere, e.g. a pop-up header's buttons)
 *       frigate_camera: frontdoor     # optional: Frigate's name (default: the camera's camera_name)
 *       items:                        # optional: entities under the picture, as glass-status-bar pills
 *         - switch.front_door_light
 *         - { entity: select.front_door_nightvision, dropdown: true }
 *   layout: auto            # auto (by the card's width) | side (recordings left) | stacked (phone)
 *   list_width: minmax(320px, 0.36fr)   # side: the recordings' column (as a dashboard's left side)
 *   list_columns: 2         # thumbnails in a row (default: as many as fit)
 *   height: fill            # optional: down to the dock / the screen's bottom (or any CSS height)
 *                           #   – the recordings fill it and scroll
 *   badge_position: top-left       # "Live" / a recording's time: top-left | top-right | bottom-…
 *   aspect_ratio: 16/9      # the picture's shape; fit: cover | contain
 *   severity: all           # all | alert | detection – which of Frigate's review items
 *   show_severity: true     # the switch All / Alerts / Detections above the recordings
 *   show_fullscreen: true   # the full-screen button on the picture
 *   zoom: true              # wheel / pinch zoom on the picture, a double tap back
 *   hours: 48               # how far back the recordings go
 *   show_live / show_events / show_controls / show_detections: true
 *   show_switcher: …        # the cameras' switch in the card – default only when no camera has
 *                           #   `active` (switched elsewhere, e.g. in a pop-up header)
 *   show_timeline: false    # a time line of the recordings under the picture
 *   controls: below         # below | overlay (the entities on the picture)
 *   return_after: 30        # s after a recording ended / was paused: back to live (0 = stay)
 *   list_glass / label_glass / badge_glass / seen_glass / player_glass / switcher_glass /
 *   controls_glass / timeline_glass (+ *_color); alert_color, selected_color
 *
 * The live picture is WebRTC Camera's (custom:webrtc-camera, the WebRTC integration from HACS –
 * required): it plays the camera's RTSP through go2rtc and keeps up with a camera that restarts.
 * Its settings go through this card unchanged (WEBRTC_KEYS), a camera's own over the card's; the
 * camera entity is its poster until the stream runs (unless poster is set).
 *
 * Recordings come from the Frigate integration (frigate/reviews/get – Frigate 0.14+, else
 * frigate/events/get) through its signed media URLs; any other camera just shows live.
 */
export interface CameraDef {
  camera?: string;
  name?: string;
  icon?: string;
  live_card?: BaseCardConfig;
  /** the live picture: an RTSP link or a go2rtc stream's name (default: the camera entity) */
  url?: string;
  [webrtc: string]: unknown;
  active?: Condition;
  frigate_camera?: string;
  frigate_instance?: string;
  items?: (string | ChipConfig)[];
  /** occupancy sensors shown on the picture (default: Frigate's binary_sensor.<camera>_<label>_occupancy) */
  detections?: string[];
}

/** WebRTC Camera's own settings – passed on as they are (its documentation lists them). */
const WEBRTC_KEYS = ["url", "entity", "streams", "poster", "poster_remote", "title", "mode", "media", "server", "ui", "muted", "background", "intersection", "style", "shortcuts", "ptz", "digital_ptz", "mse", "webrtc"];

interface CameraConfig extends BaseCardConfig {
  /** the cameras: camera, name, icon, url, items, active… – see Cameras above */
  cameras?: CameraDef[];
  /** one camera: the same as cameras: [{ camera }] */
  camera?: string;
  /** auto: by the card's width (default); side: recordings left of the picture; stacked: the picture on top */
  layout?: "auto" | "side" | "stacked";
  /** side: the recordings' column (CSS grid track, default as a dashboard's left side) */
  list_width?: string;
  /** thumbnails in a row (default: as many as fit) */
  list_columns?: number;
  /** the card's height (CSS; vh / dvh follow the screen), or fill: down to the dock / the
   *  screen's bottom – the recordings fill it and scroll */
  height?: string;
  /** where "Live" and a recording's time sit on the picture (detections take the other side) */
  badge_position?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  /** "Live" and a recording's time on the picture: material and colour */
  badge_glass?: Material;
  badge_color?: string;
  /** what the camera sees now (on the picture): material and colour */
  seen_glass?: Material;
  seen_color?: string;
  /** a recording's controls: material and colour */
  player_glass?: Material;
  player_color?: string;
  /** Frigate's alerts: their thumbnails' ring and their marks on the time line */
  alert_color?: string;
  /** the recording playing: its thumbnail's ring */
  selected_color?: string;
  /** the picture's shape: 16/9 (default), 4/3, 1/1, 9/16… */
  aspect_ratio?: string;
  /** cover: fills the picture, the edges cropped (default); contain: the whole picture */
  fit?: "cover" | "contain";
  /** the camera's entities (items): under the picture (default) or on it */
  controls?: "below" | "overlay";
  /** which recordings: all (Frigate's alerts and detections, default), alert or detection */
  severity?: "all" | "alert" | "detection";
  /** the switch All / Alerts / Detections above the recordings (default on) */
  show_severity?: boolean;
  /** the button that shows the picture full screen (default on) */
  show_fullscreen?: boolean;
  /** zoom into the picture: the mouse wheel, two fingers, a double tap back (default on) */
  zoom?: boolean;
  /** how far back the recordings go, in hours (default 48) */
  hours?: number;
  /** at most this many recordings (default 60) */
  limit?: number;
  /** recordings of every camera in the card, not only the one shown */
  all_cameras?: boolean;
  /** seconds after a recording ended or was paused: back to live (default 30, 0 = stay) */
  return_after?: number;
  /** stacked: the picture stays at the top while the recordings scroll under it */
  sticky?: boolean;
  show_live?: boolean;
  show_events?: boolean;
  show_switcher?: boolean;
  show_controls?: boolean;
  show_detections?: boolean;
  show_timeline?: boolean;
  list_glass?: Material;
  list_color?: string;
  /** material of the camera switch (default: the control glass, as the status bar's pills) */
  switcher_glass?: Material;
  switcher_color?: string;
  /** material of the camera's entities (pills) (default: the control glass, as the status bar's pills) */
  controls_glass?: Material;
  controls_color?: string;
  label_glass?: Material;
  label_color?: string;
  /** material of the time line (default: the control glass, as the status bar's pills) */
  timeline_glass?: Material;
  timeline_color?: string;
}

/** A recording: Frigate's review item (0.14+) or event, whichever the integration gave. */
interface Rec {
  id: string;
  cam: number;
  fcam: string;
  start: number;
  end?: number;
  labels: string[];
  alert: boolean;
  thumb: string;
  clip: string;
}

const has = (v?: string) => !!v && v !== "none";
function matPart(m: Material | undefined, color: string | undefined, def: Material) {
  const use = m ?? (has(color) ? def : undefined);
  return use ? { cls: `mat mat-${use}`, style: matTint(has(color) ? color : undefined) } : { cls: "", style: "" };
}

const LABEL_ICONS: Record<string, string> = {
  person: "mdi:account",
  face: "mdi:face-recognition",
  car: "mdi:car",
  motorcycle: "mdi:motorbike",
  bicycle: "mdi:bicycle",
  bus: "mdi:bus",
  truck: "mdi:truck",
  boat: "mdi:sail-boat",
  dog: "mdi:dog",
  cat: "mdi:cat",
  bird: "mdi:bird",
  horse: "mdi:horse",
  cow: "mdi:cow",
  sheep: "mdi:sheep",
  bear: "mdi:teddy-bear",
  deer: "mdi:deer",
  rabbit: "mdi:rabbit",
  fox: "mdi:paw",
  package: "mdi:package-variant-closed",
  license_plate: "mdi:card-text-outline",
  speech: "mdi:account-voice",
  bark: "mdi:dog",
};
const LABEL_NAMES: Record<string, string> = {
  person: "Person",
  car: "Car",
  motorcycle: "Motorcycle",
  bicycle: "Bicycle",
  dog: "Dog",
  cat: "Cat",
  bird: "Bird",
  fox: "Fox",
  package: "Package",
  face: "Face",
  license_plate: "Licence plate",
  horse: "Horse",
  deer: "Deer",
  rabbit: "Rabbit",
  bus: "Bus",
  truck: "Truck",
};
const labelIcon = (l: string) => LABEL_ICONS[l] ?? "mdi:shape-outline";
const labelName = (l: string) => (LABEL_NAMES[l] ? tr(LABEL_NAMES[l]) : l.replace(/_/g, " ").replace(/^./, (s) => s.toUpperCase()));

/* signed media URLs (HA's auth/sign_path): kept for hours – a video asks again on every seek */
const SIGN_FOR = 6 * 3600;
const signed = new Map<string, { url: string; until: number }>();
async function sign(hass: HomeAssistant, path: string): Promise<string> {
  const c = signed.get(path);
  if (c && c.until > Date.now()) return c.url;
  const r = await hass.callWS<{ path: string }>({ type: "auth/sign_path", path, expires: SIGN_FOR });
  signed.set(path, { url: r.path, until: Date.now() + (SIGN_FOR - 600) * 1000 });
  return r.path;
}

/* ---------- demo mode (the made-up home): its pictures instead of Frigate and a stream ---------- */
const isDemo = (h?: HomeAssistant) => !!(h as { demo?: unknown } | undefined)?.demo;
/** a picture beside the bundle (dist/demo-<file>) – the address in a variable, so Vite leaves it be */
function demoFile(f: string): string {
  const bundle = import.meta.url;
  return new URL(`./demo-${f}`, bundle).href;
}
/** which of the demo's two cameras a camera of the card is */
/** the demo's pictures stand in only for a camera with nothing of its own to show: no stream
 *  (url, streams, live_card) and no Frigate named – a demo dashboard can still show real cameras */
const demoPics = (h: HomeAssistant | undefined, d: CameraDef | undefined) =>
  isDemo(h) && !!d && !d.url && !d.streams && !d.live_card && !d.frigate_instance;
const demoCam = (d: CameraDef) => (/garden|zahrad/i.test(`${d.frigate_camera ?? ""} ${d.camera ?? ""} ${d.name ?? ""}`) ? "garden" : "front");
/** the demo's recordings: [picture, minutes ago, length s, labels, alert] */
const DEMO_RECS: Record<string, [number, number, number, string[], boolean][]> = {
  front: [
    [4, 18, 24, ["dog"], false],
    [3, 165, 41, ["person"], true],
    [2, 402, 19, ["cat"], false],
    [1, 431, 36, ["person"], true],
    [6, 960, 22, ["cat"], false],
    [5, 1002, 47, ["person"], true],
  ],
  garden: [
    [4, 42, 58, ["person"], true],
    [3, 236, 33, ["cat"], false],
    [2, 494, 27, ["dog"], false],
    [1, 548, 31, ["fox"], false],
    [6, 1061, 44, ["fox"], false],
    [5, 1127, 39, ["fox"], false],
  ],
};
/** a picture as a video (a canvas's stream): the glass on it then works as on a camera's stream */
const demoStreams = new Map<string, MediaStream>();
function demoStream(url: string): MediaStream | undefined {
  let st = demoStreams.get(url);
  if (st) return st;
  const cv = document.createElement("canvas");
  if (!cv.captureStream) return undefined;
  st = cv.captureStream(4);
  demoStreams.set(url, st);
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    cv.width = img.naturalWidth;
    cv.height = img.naturalHeight;
    const ctx = cv.getContext("2d")!;
    // drawn again now and then: a canvas stream sends frames only when it is drawn on
    const draw = () => ctx.drawImage(img, 0, 0);
    draw();
    setInterval(draw, 250);
  };
  img.src = url;
  return st;
}
function demoRecs(list: { i: number; cam: string }[]): Rec[] {
  const now = Date.now() / 1000;
  const out: Rec[] = [];
  for (const { i, cam } of list)
    for (const [n, ago, len, labels, alert] of DEMO_RECS[cam]) {
      const start = Math.floor(now - ago * 60);
      out.push({ id: `demo-${cam}-${n}`, cam: i, fcam: cam, start, end: start + len, labels, alert, thumb: demoFile(`event-${cam}-${n}.jpg`), clip: "" });
    }
  return out.sort((a, b) => b.start - a.start);
}

class GlassCamera extends GlassElement<CameraConfig> {
  static override parts = CAMERA_PARTS;
  static override properties = {
    ...GlassElement.properties,
    _pick: { state: true },
    _play: { state: true },
    _recs: { state: true },
    _wide: { state: true },
    _paused: { state: true },
    _pos: { state: true },
    _span: { state: true },
    _note: { state: true },
    _narrow: { state: true },
    _glFail: { state: true },
    _fillH: { state: true },
    _end: { state: true },
    _sev: { state: true },
    _fs: { state: true },
  };
  /** the recordings picked in the card (All / Alerts / Detections) – the config's severity until then */
  declare _sev?: "all" | "alert" | "detection";
  /** the picture is full screen */
  declare _fs: boolean;
  /** Frigate before 0.14 gave events (no alerts / detections): no switch */
  private _events = false;
  /** the time line's right end (s); undefined = now – it moves back by drag or ‹ › */
  declare _end?: number;
  /** a narrow card (a phone): a recording's controls go under the picture, the badges get small */
  declare _narrow: boolean;
  /** WebGL glass can't draw from this picture (a phone's browser that won't read the stream's
   *  frames, a picture that isn't a video): the parts show their CSS glass instead */
  declare _glFail: boolean;
  /** the camera picked in the card (index) – a camera's `active` that holds wins */
  declare _pick?: number;
  /** what plays instead of live: a recording, or a stretch of the time line */
  declare _play?: { rec?: Rec; from?: number; url: string; dl: string; at: number };
  declare _recs?: Rec[] | "loading" | "none" | "error";
  declare _wide: boolean;
  declare _paused: boolean;
  declare _pos: number;
  declare _span: number;
  declare _note?: string;

  constructor() {
    super();
    this._wide = false;
    this._paused = false;
    this._pos = 0;
    this._span = 24;
    this._narrow = false;
    this._glFail = false;
    this._fs = false;
  }

  static getConfigElement() {
    return makeEditor(cameraSpec);
  }

  static getStubConfig(hass?: HomeAssistant) {
    const ids = Object.keys(hass?.states ?? {}).filter((e) => e.startsWith("camera."));
    const frigate = ids.find((e) => hass!.states[e].attributes.client_id !== undefined);
    const cam = frigate ?? ids[0] ?? "camera.front_door";
    return { cameras: [{ camera: cam }] };
  }

  private _mode: Mode = settings.mode;
  /** each camera's entities under the picture (a glass-status-bar), built with the config */
  private _ctl: (ChildEl | undefined)[] = [];
  /** each camera's live picture, kept while the card lives (switching back is instant) */
  private _live = new Map<number, HTMLElement>();
  /** each camera's Frigate instance / name as last seen: a camera that restarts (unavailable,
   *  its attributes gone for a while) keeps its recordings and live picture */
  private _fmemo = new Map<string, { inst: string; cam: string }>();

  private _ro?: ResizeObserver;
  private _unsub?: Promise<() => void>;
  private _subFor?: string;
  private _poll?: number;
  private _back?: number;
  private _fetchKey?: string;
  private _refetch?: number;
  private _seenOn = "";
  private _occ = new Map<string, { n: number; ids: string[] }>();
  private _cover?: { key: string; segs: [number, number][] };

  protected override validateConfig(c: CameraConfig): CameraConfig {
    if (!c.cameras && c.camera) c = { ...c, cameras: [{ camera: c.camera }] };
    if (!Array.isArray(c.cameras) || !c.cameras.length) throw new Error(tr("Pick a camera"));
    return c;
  }

  protected watchedEntities(c: CameraConfig) {
    const out = new Set<string>();
    for (const d of c.cameras ?? []) {
      if (d.camera) out.add(d.camera);
      conditionEntities(d.active, undefined, out);
      for (const id of d.detections ?? []) out.add(id);
    }
    return out;
  }

  override setConfig(config: CameraConfig) {
    super.setConfig(config);
    for (const el of this._live.values()) el.remove();
    this._live.clear();

    this._play = undefined;
    this._build();
    this._fetchKey = undefined;
    this._cover = undefined;
  }

  private _build() {
    const c = this._config;
    this._ctl = (c.cameras ?? []).map((d) => {
      const items = (d.items ?? []).map((i) => (typeof i === "string" ? { entity: i } : i)).filter((i) => i && (i.entity || (i as any).icon));
      if (!items.length) return undefined;
      const cfg: Record<string, unknown> = {
        type: "custom:glass-status-bar",
        layout: "pills",
        columns: Math.min(items.length, 4),
        items,
        ...(c.controls_glass ? { pill_glass: c.controls_glass } : {}),
        ...(c.controls_color ? { pill_color: c.controls_color } : {}),
      };
      return buildChildren(cfg as BaseCardConfig, this._hass, { nested: true, glass: resolveGlass(settings.tile_glass ?? c.glass), mode: this._mode })[0];
    });
  }

  setMode(mode: Mode) {
    if (mode === this._mode) return;
    this._mode = mode;
    if (this._config) {
      this._build();
      this.requestUpdate();
    }
  }

  /* ---------- which camera ---------- */

  private _cams(): CameraDef[] {
    return this._config?.cameras ?? [];
  }

  /** The camera shown: picked in the card, else the first whose `active` holds, else the first. */
  private _cur(): number {
    const cams = this._cams();
    const hass = this._hass;
    if (this._pick !== undefined && this._pick < cams.length) return this._pick;
    if (hass) {
      const i = cams.findIndex((d) => d.active !== undefined && evalCondition(d.active, hass));
      if (i >= 0) return i;
    }
    return 0;
  }

  /** Frigate's instance and camera name for a camera of the card (none: not a Frigate camera). */
  private _frigate(d: CameraDef): { inst: string; cam: string } | undefined {
    if (demoPics(this._hass, d)) return { inst: "demo", cam: demoCam(d) };
    const st = d.camera ? this._hass?.states[d.camera] : undefined;
    const inst = d.frigate_instance ?? (st?.attributes.client_id as string | undefined);
    const cam = d.frigate_camera ?? (st?.attributes.camera_name as string | undefined);
    const key = d.camera ?? d.frigate_camera ?? "";
    if (inst && cam) {
      this._fmemo.set(key, { inst, cam });
      return { inst, cam };
    }
    return this._fmemo.get(key);
  }

  /* ---------- hass ---------- */

  protected override forwardHass(hass: HomeAssistant) {
    forward(this._ctl.filter(Boolean) as ChildEl[], hass);
    for (const [i, el] of this._live) {
      const d = this._cams()[i];
      if (!d) continue;
      (el as any).hass = hass;
    }
    // what Frigate sees now: a change re-draws the card, a new object fetches the recordings anew
    const on = this._detections().map((x) => x.id).join(",");
    if (on !== this._seenOn) {
      const more = on.length > this._seenOn.length;
      this._seenOn = on;
      this.requestUpdate();
      if (more) this._soon();
    }
  }

  /** The occupancy sensors of the camera shown that are on now: { id, label }. */
  private _detections(): { id: string; label: string }[] {
    const hass = this._hass;
    const c = this._config;
    if (!hass || !c || c.show_detections === false) return [];
    const d = this._cams()[this._cur()];
    if (!d) return [];
    let ids = d.detections;
    if (!ids) {
      const f = this._frigate(d);
      if (!f) return [];
      // Frigate names them binary_sensor.<camera>_<label>_occupancy (all = any object)
      const n = Object.keys(hass.states).length;
      const key = f.cam;
      let hit = this._occ.get(key);
      if (!hit || hit.n !== n) {
        const pre = `binary_sensor.${f.cam}_`;
        hit = { n, ids: Object.keys(hass.states).filter((e) => e.startsWith(pre) && e.endsWith("_occupancy") && e !== `${pre}all_occupancy`) };
        this._occ.set(key, hit);
      }
      ids = hit.ids;
    }
    const pre = d.detections ? "" : `binary_sensor.${this._frigate(d)?.cam}_`;
    return ids
      .filter((id) => hass.states[id]?.state === "on")
      .map((id) => ({ id, label: pre ? id.slice(pre.length, -"_occupancy".length) : (hass.states[id]?.attributes.friendly_name ?? id) }));
  }

  /* ---------- recordings ---------- */

  private _key(): string | undefined {
    const c = this._config;
    if (!c || c.show_events === false && !c.show_timeline) return undefined;
    const cams = c.all_cameras ? this._cams() : [this._cams()[this._cur()]];
    const fs = cams.map((d) => d && this._frigate(d)).filter(Boolean) as { inst: string; cam: string }[];
    if (!fs.length) return undefined;
    return JSON.stringify([fs, this._sevNow(), c.hours ?? 48, c.limit ?? 60]);
  }

  private _sevNow(): "all" | "alert" | "detection" {
    return this._sev ?? this._config?.severity ?? "all";
  }

  /** Fetch again in a moment (a new detection; Frigate writes its review item a little later). */
  private _soon() {
    clearTimeout(this._refetch);
    this._refetch = window.setTimeout(() => {
      this._fetchKey = undefined;
      this._load();
    }, 2500);
  }

  private async _load() {
    const hass = this._hass;
    const key = this._key();
    if (!hass || !key) {
      if (!key) this._recs = "none";
      return;
    }
    if (key === this._fetchKey) return;
    this._fetchKey = key;
    if (!Array.isArray(this._recs)) this._recs = "loading";
    const c = this._config;
    const cams = this._cams();
    const want = c.all_cameras ? cams.map((_, i) => i) : [this._cur()];
    const after = Math.floor(Date.now() / 1000 - (c.hours ?? 48) * 3600);
    const byInst = new Map<string, { cam: string; i: number }[]>();
    for (const i of want) {
      const f = this._frigate(cams[i]);
      if (f) byInst.set(f.inst, [...(byInst.get(f.inst) ?? []), { cam: f.cam, i }]);
    }
    const sev = this._sevNow();
    if (want.length && want.every((i) => demoPics(hass, cams[i]))) {
      this._recs = demoRecs(want.map((i) => ({ i, cam: demoCam(cams[i]) }))).filter((r) => sev === "all" || r.alert === (sev === "alert"));
      return;
    }
    try {
      const out: Rec[] = [];
      for (const [inst, list] of byInst) {
        const idx = (fcam: string) => list.find((x) => x.cam === fcam)?.i ?? list[0].i;
        const base = `/api/frigate/${encodeURIComponent(inst)}`;
        const q = { instance_id: inst, cameras: list.map((x) => x.cam), after, limit: c.limit ?? 60 };
        let rows: any[] | undefined;
        try {
          rows = JSON.parse(await hass.callWS<string>({ type: "frigate/reviews/get", ...q, ...(sev !== "all" ? { severity: sev } : {}) }));
          this._events = false;
          for (const r of rows ?? [])
            out.push({
              id: r.id,
              cam: idx(r.camera),
              fcam: r.camera,
              start: r.start_time,
              end: r.end_time ?? undefined,
              labels: [...new Set<string>([...(r.data?.objects ?? []), ...(r.data?.audio ?? [])].map((l: string) => l.replace(/-verified$/, "")))],
              alert: r.severity === "alert",
              thumb: `${base}/notifications/${r.id}/${r.camera}/review_thumbnail.webp`,
              clip: "",
            });
        } catch {
          // Frigate before 0.14 (no review items): its events
          this._events = true;
          rows = JSON.parse(await hass.callWS<string>({ type: "frigate/events/get", ...q, has_clip: true }));
          for (const e of rows ?? [])
            out.push({
              id: e.id,
              cam: idx(e.camera),
              fcam: e.camera,
              start: e.start_time,
              end: e.end_time ?? undefined,
              labels: [e.label],
              alert: false,
              thumb: `${base}/notifications/${e.id}/thumbnail.jpg`,
              clip: `${base}/notifications/${e.id}/clip.mp4`,
            });
        }
        for (const r of out)
          if (!r.clip) r.clip = `${base}/recording/${r.fcam}/start/${Math.floor(r.start - 2)}/end/${Math.ceil((r.end ?? Date.now() / 1000) + 2)}`;
      }
      out.sort((a, b) => b.start - a.start);
      if (key !== this._fetchKey) return;
      // the pictures' signed URLs before they are shown (no broken images on the way)
      await Promise.all(out.map(async (r) => (r.thumb = await sign(hass, r.thumb).catch(() => ""))));
      if (key !== this._fetchKey) return;
      this._recs = out;
      this._subscribe([...byInst.keys()][0]);
    } catch (e) {
      console.warn("glass-camera: recordings", e);
      if (key === this._fetchKey) this._recs = "error";
    }
  }

  /** New review items as they come (frigate/reviews/subscribe); else a look every minute. */
  private _subscribe(inst: string) {
    if (this._subFor === inst) return;
    this._unsubscribe();
    this._subFor = inst;
    const conn = this._hass?.connection as any;
    try {
      this._unsub = conn
        .subscribeMessage(() => this._soon(), { type: "frigate/reviews/subscribe", instance_id: inst })
        .catch(() => {
          this._poll = window.setInterval(() => this._soon(), 60_000);
          return () => {};
        });
    } catch {
      this._poll = window.setInterval(() => this._soon(), 60_000);
    }
  }

  private _unsubscribe() {
    this._unsub?.then((u) => u?.()).catch(() => {});
    this._unsub = undefined;
    this._subFor = undefined;
    clearInterval(this._poll);
  }

  /** Where Frigate has recordings in the time line's span (frigate/recordings/get). */
  /** The time line's span: [from, to] in s. */
  private _win(): { from: number; to: number; span: number } {
    const span = this._span * 3600;
    const to = this._end ?? Date.now() / 1000;
    return { from: to - span, to, span };
  }

  /** Moves the time line so `t` is in view (a little in from the right), never past now. */
  private _show(t: number, at = 0.65) {
    const span = this._span * 3600;
    const now = Date.now() / 1000;
    const end = t + span * (1 - at);
    this._end = end >= now - 60 ? undefined : end;
    this._cover = undefined;
  }

  private async _loadCover() {
    const hass = this._hass;
    const d = this._cams()[this._cur()];
    const f = d && this._frigate(d);
    if (!hass || !f || !this._config.show_timeline) return;
    const w = this._win();
    const before = Math.ceil(w.to);
    const after = Math.floor(w.from);
    const key = `${f.inst}|${f.cam}|${this._span}|${this._end === undefined ? Math.floor(before / 300) : before}`;
    if (this._cover?.key === key) return;
    this._cover = { key, segs: [] };
    if (demoPics(hass, d)) {
      // the demo records on motion: a little before and after each recording
      const segs = (Array.isArray(this._recs) ? this._recs : [])
        .filter((r) => r.fcam === f.cam)
        .map((r) => [r.start - 90, (r.end ?? r.start) + 120] as [number, number])
        .sort((a, b) => a[0] - b[0]);
      this._cover = { key, segs };
      this.requestUpdate();
      return;
    }
    try {
      const rows = JSON.parse(await hass.callWS<string>({ type: "frigate/recordings/get", instance_id: f.inst, camera: f.cam, after, before }));
      const segs: [number, number][] = [];
      for (const r of rows ?? []) {
        const last = segs[segs.length - 1];
        if (last && r.start_time - last[1] < 15) last[1] = Math.max(last[1], r.end_time);
        else segs.push([r.start_time, r.end_time]);
      }
      if (this._cover?.key === key) {
        this._cover = { key, segs };
        this.requestUpdate();
      }
    } catch {
      /* no recordings API: the time line shows the recordings only */
    }
  }

  /* ---------- playing ---------- */

  private async _open(r: Rec) {
    const hass = this._hass;
    if (!hass) return;
    haptic("selection");
    if (this._pick === undefined && this._config.all_cameras && r.cam !== this._cur()) this._pick = r.cam;
    // the time line follows: the recording in view
    if (this._config.show_timeline) {
      const w = this._win();
      if (r.start < w.from || r.start > w.to) this._show(r.start);
    }
    if (demoPics(hass, this._cams()[r.cam])) {
      // a picture, not a video: shown paused
      this._play = { rec: r, url: "", dl: "", at: r.start };
      this._paused = true;
      return;
    }
    try {
      const url = await sign(hass, r.clip);
      this._play = { rec: r, url, dl: url, at: r.start };
      this._paused = false;
      this._pos = 0;
      clearTimeout(this._back);
    } catch (e) {
      console.warn("glass-camera: clip", e);
    }
  }

  /** The time line: a recording near the spot, else what Frigate recorded from there on. */
  private async _openAt(t: number) {
    const hass = this._hass;
    const recs = Array.isArray(this._recs) ? this._recs.filter((r) => r.cam === this._cur()) : [];
    const tol = (this._span * 3600) / 120;
    const near = recs.find((r) => t >= r.start - tol && t <= (r.end ?? r.start) + tol);
    if (near) return this._open(near);
    const d = this._cams()[this._cur()];
    const f = d && this._frigate(d);
    if (!hass || !f) return;
    const covered = this._cover?.segs.some(([a, b]) => t >= a && t <= b);
    if ((this._cover?.segs.length && !covered) || demoPics(hass, d)) {
      this._toast(tr("Nothing recorded at {time}", { time: this._time(t) }));
      return;
    }
    haptic("selection");
    const path = `/api/frigate/${encodeURIComponent(f.inst)}/recording/${f.cam}/start/${Math.floor(t)}/end/${Math.floor(t + 120)}`;
    try {
      const url = await sign(hass, path);
      this._play = { from: t, url, dl: url, at: t };
      this._paused = false;
      this._pos = 0;
    } catch (e) {
      console.warn("glass-camera: recording", e);
    }
  }

  private _goLive() {
    clearTimeout(this._back);
    this._play = undefined;
    this._pos = 0;
  }

  private _toast(text: string) {
    this._note = text;
    window.setTimeout(() => this._note === text && (this._note = undefined), 2500);
  }

  /** The recording before / after the one playing (in the list's order: newest first). */
  private _step(d: -1 | 1) {
    const recs = Array.isArray(this._recs) ? this._recs.filter((r) => this._config.all_cameras || r.cam === this._cur()) : [];
    const cur = this._play?.rec;
    const i = cur ? recs.findIndex((r) => r.id === cur.id) : -1;
    const next = recs[i + d];
    if (next) this._open(next);
  }

  private _video(): HTMLVideoElement | null {
    return this.renderRoot.querySelector("video.clip");
  }

  /** Paused or over: back to live after a while (return_after s; 0 = stay). */
  private _idle() {
    clearTimeout(this._back);
    const s = this._config.return_after ?? 30;
    if (s > 0) this._back = window.setTimeout(() => this._goLive(), s * 1000);
  }

  /* ---------- lifecycle ---------- */

  override connectedCallback() {
    super.connectedCallback();
    this._ro = new ResizeObserver(([e]) => {
      const l = this._config?.layout ?? "auto";
      const wide = l === "side" || (l === "auto" && e.contentRect.width >= 720);
      if (wide !== this._wide) this._wide = wide;
      const narrow = e.contentRect.width < 520;
      if (narrow !== this._narrow) this._narrow = narrow;
    });
    this._ro.observe(this);
    document.addEventListener("fullscreenchange", this._onFs);
    document.addEventListener("webkitfullscreenchange", this._onFs);
    requestAnimationFrame(() => this._stickyTop());
    window.addEventListener("resize", this._onFill);
    window.addEventListener("location-changed", this._onOpen);
    window.addEventListener("hashchange", this._onOpen);
    // a pop-up slides in: measure again once it is in place
    for (const ms of [0, 350, 900]) window.setTimeout(this._onFill, ms);
  }

  /** height: fill – from the card's top down to the dock (a glass-dock on screen) or the screen's bottom. */
  declare _fillH?: number;
  private _onOpen = () => {
    for (const ms of [50, 400, 900]) window.setTimeout(this._onFill, ms);
  };
  private _onFill = () => {
    if (this._config?.height !== "fill" || !this.isConnected) return;
    const h = roomToDock(this);
    if (h !== this._fillH) this._fillH = h;
  };

  /**
   * Where the stuck picture stops: under HA's top bar when the page itself scrolls, at the top
   * of a pop-up (Bubble Card) or any other box that scrolls on its own.
   */
  private _stickyTop() {
    let n: Node | null = this;
    let own = false;
    while (n) {
      const p: Node | null = (n as Element).assignedSlot ?? n.parentNode ?? ((n as ShadowRoot).host as Node | undefined) ?? null;
      if (p instanceof Element && p !== document.documentElement && p !== document.body) {
        const o = getComputedStyle(p).overflowY;
        if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight + 1) {
          own = true;
          break;
        }
      }
      n = p;
    }
    this.style.setProperty("--cam-top", own ? "0px" : "calc(var(--header-height, 56px) + env(safe-area-inset-top, 0px))");
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("resize", this._onFill);
    window.removeEventListener("location-changed", this._onOpen);
    window.removeEventListener("hashchange", this._onOpen);
    document.removeEventListener("fullscreenchange", this._onFs);
    document.removeEventListener("webkitfullscreenchange", this._onFs);
    this._ro?.disconnect();
    this._unsubscribe();
    clearTimeout(this._back);
    clearTimeout(this._refetch);
    this._fetchKey = undefined;
  }

  /** Glass on the picture lies over the video playing there (the recording, or live). */
  protected override glassUnder(el: HTMLElement): Element | undefined {
    const stage = el.closest(".stage");
    if (!stage) return undefined;
    // no frame yet: the picture itself (nothing to draw from) – never the wallpaper, which isn't there
    return this._stageVideo() ?? stage;
  }

  private _stageVideo(): HTMLVideoElement | undefined {
    const stage = this.renderRoot.querySelector(".stage");
    if (!stage) return undefined;
    const clip = stage.querySelector<HTMLVideoElement>("video.clip");
    if (clip) return clip;
    const find = (r: ParentNode, depth = 0): HTMLVideoElement | undefined => {
      for (const e of r.querySelectorAll("*")) {
        if (e instanceof HTMLVideoElement && e.videoWidth) return e;
        if (e.shadowRoot && depth < 4) {
          const v = find(e.shadowRoot, depth + 1);
          if (v) return v;
        }
      }
      return undefined;
    };
    const live = stage.querySelector(".live");
    return live ? (live instanceof HTMLVideoElement ? live : find(live.shadowRoot ?? live)) : undefined;
  }

  /** While WebGL glass lies on a moving picture: drawn again with every new frame of the video
   *  (requestVideoFrameCallback, else the screen's frames); a quarter-second check besides picks
   *  up a video that was swapped (live ↔ a recording) or paused. */
  private _glLoop?: number;
  private _glT = -1;
  private _glGen = 0;
  private _glWait?: number;
  private _glTick = () => {
    const gen = ++this._glGen;
    this._glLoop = undefined;
    if (!this.isConnected || document.hidden || !this.renderRoot.querySelector(".stage .mat-liquid-gl, .stage .mat-dark-liquid-gl")) return;
    const v = this._stageVideo();
    const t = v ? v.currentTime : -1;
    if (t !== this._glT) {
      this._glT = t;
      this.partsGl.refresh(true);
    }
    // no glass drawn two seconds on: its CSS glass shows (hidden while it waits for a frame)
    const drawn = !!this.renderRoot.querySelector(".stage .lg-on");
    const now = performance.now();
    if (drawn) {
      this._glWait = undefined;
      if (this._glFail) this._glFail = false;
    } else if (!this._glFail) {
      this._glWait ??= now;
      if (now - this._glWait > 2000) this._glFail = true;
    }
    const next = () => gen === this._glGen && this._glTick();
    if (v && "requestVideoFrameCallback" in v) (v as any).requestVideoFrameCallback(next);
    else requestAnimationFrame(next);
    this._glLoop = window.setTimeout(next, 250);
  };

  protected override updated(changed: PropertyValues) {
    super.updated(changed);
    // a list that fits (or isn't scrolled yet): its fades from where it is now
    for (const el of this.renderRoot.querySelectorAll<HTMLElement>(".side .list .scroll, .stacked.fixed .list")) {
      el.classList.toggle("scrolled", el.scrollTop > 2);
      el.classList.toggle("at-end", el.scrollTop + el.clientHeight >= el.scrollHeight - 2);
    }
    if (!this._glLoop && this.renderRoot.querySelector(".stage .mat-liquid-gl, .stage .mat-dark-liquid-gl")) this._glLoop = requestAnimationFrame(this._glTick);
    // another picture (a recording, live, another camera): from the whole of it
    const zel = this._zoomEl() ?? undefined;
    if (zel !== this._zEl) {
      if (this._zEl) this._zEl.style.transform = "";
      this._zEl = zel;
      this._z = { s: 1, x: 0, y: 0 };
      this.renderRoot.querySelector(".stage")?.classList.remove("zoomed");
    }
    this._load();
    if (this._config?.show_timeline) this._loadCover();
  }

  /* ---------- drawing ---------- */

  private _time(t: number): string {
    return new Intl.DateTimeFormat(language(this._hass), { hour: "numeric", minute: "2-digit", hour12: hour12(this._hass) }).format(t * 1000);
  }

  private _tick(t: number): string {
    const whole = new Date(t * 1000).getMinutes() === 0;
    return new Intl.DateTimeFormat(language(this._hass), whole ? { hour: "numeric", hour12: hour12(this._hass) } : { hour: "numeric", minute: "2-digit", hour12: hour12(this._hass) }).format(t * 1000);
  }

  private _day(t: number): string {
    const d = new Date(t * 1000);
    const today = new Date();
    const y = new Date(today);
    y.setDate(today.getDate() - 1);
    const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
    if (same(d, today)) return tr("Today");
    if (same(d, y)) return tr("Yesterday");
    return new Intl.DateTimeFormat(language(this._hass), { weekday: "long", day: "numeric", month: "numeric" }).format(d);
  }

  private _dur(r: Rec): string {
    if (!r.end) return tr("Now");
    const s = Math.max(1, Math.round(r.end - r.start));
    return s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  /** The live picture: WebRTC Camera with the card's and the camera's own settings. */
  private _liveEl(i: number): HTMLElement | undefined {
    const d = this._cams()[i];
    if (!d) return undefined;
    let el = this._live.get(i);
    if (el) return el;
    if (d.live_card) el = createCard(d.live_card, this._hass) as unknown as HTMLElement;
    else {
      const own: Record<string, unknown> = {};
      for (const src of [this._config as Record<string, unknown>, d as Record<string, unknown>])
        for (const k of WEBRTC_KEYS) if (src[k] !== undefined && !(src === this._config && (k === "url" || k === "entity"))) own[k] = src[k];
      if (!own.url && !own.entity && !own.streams) {
        if (!d.camera) return undefined;
        own.entity = d.camera;
      }
      // the camera's picture until the stream runs
      if (own.poster === undefined && d.camera) own.poster = d.camera;
      const fit = this._config.fit ?? "cover";
      el = createCard(
        {
          type: "custom:webrtc-camera",
          ui: false,
          muted: true,
          // the card zooms the picture itself: the player's own zoom would take the fingers (and
          // keep a zoom of its own, remembered in the browser)
          digital_ptz: false,
          ...own,
          // fills the picture; a style of its own comes after
          style: `ha-card{height:100%;margin:0;border-radius:0;background:none;box-shadow:none;border:0} .player{height:100%;padding:0!important} video,img.poster{width:100%;height:100%;object-fit:var(--cam-fit,${fit})} ${own.ui ? "" : "video::-webkit-media-controls{display:none!important} video::-webkit-media-controls-enclosure{display:none!important}"} ${own.style ?? ""}`,
        } as unknown as BaseCardConfig,
        this._hass,
      ) as unknown as HTMLElement;
    }
    el.classList.add("live");
    this._live.set(i, el);
    return el;
  }

  private _labels(labels: string[], cls = "") {
    const m = matPart(this._config.label_glass, this._config.label_color, "dark");
    return labels.slice(0, 3).map(
      (l) => html`<span class="tag ${cls} ${m.cls || "plain"}" style=${m.style}><ha-icon .icon=${labelIcon(l)}></ha-icon><span>${labelName(l)}</span></span>`,
    );
  }

  private _stage(cur: number) {
    const c = this._config;
    const d = this._cams()[cur];
    const p = this._play;
    const st: HassEntity | undefined = d?.camera ? this._hass?.states[d.camera] : undefined;
    const ratio = (c.aspect_ratio ?? "16/9").replace(":", "/");
    const det = this._detections();
    const ctl = c.show_controls !== false && c.controls === "overlay" ? this._ctl[cur] : undefined;
    const showLive = c.show_live !== false;
    if (!showLive && !p) return nothing;
    const badge = matPart(c.badge_glass, c.badge_color, "dark");
    const seen = matPart(c.seen_glass, c.seen_color, "dark");
    // the full-screen button on live: a corner the badge and the controls leave free
    const bp = c.badge_position ?? "top-left";
    const fsAt = ctl ? (bp === "top-right" ? "top-left" : "top-right") : bp === "bottom-right" ? "bottom-left" : "bottom-right";
    return html`<div
      class="stage ${p ? "playing" : ""} ${webglAvailable && !this._glFail ? "gl" : ""} fit-${c.fit ?? "cover"} ${c.zoom === false ? "" : "can-zoom"}"
      style="aspect-ratio:${ratio}"
      @wheel=${this._onWheel}
      @pointerdown=${this._onDown}
      @pointermove=${this._onMove}
      @pointerup=${this._onUp}
      @pointercancel=${this._onUp}
      @touchstart=${this._onTouch}
      @touchmove=${this._onTouch}
      @touchend=${this._onTouch}
      @touchcancel=${this._onTouch}
      @click=${{ handleEvent: this._onClickCapture, capture: true }}
      @dblclick=${this._onDbl}
    >
      ${demoPics(this._hass, d) && (p?.rec || (!p && showLive))
        ? html`<video class="live demo" muted autoplay playsinline .srcObject=${demoStream(p?.rec ? p.rec.thumb : demoFile(`camera-${demoCam(d!)}.jpg`))}></video>`
        : p
        ? html`<video
            class="clip"
            .src=${p.url}
            autoplay
            muted
            playsinline
            @timeupdate=${(e: Event) => (this._pos = (e.target as HTMLVideoElement).currentTime)}
            @play=${() => ((this._paused = false), clearTimeout(this._back))}
            @pause=${() => ((this._paused = true), this._idle())}
            @ended=${() => ((this._paused = true), this._idle())}
            @click=${() => this._toggle()}
          ></video>`
        : showLive
          ? (this._liveEl(cur) ?? html`<div class="empty">${tr("Pick a camera")}</div>`)
          : nothing}
      <div class="top pos-${c.badge_position ?? "top-left"} ${this._narrow ? "small" : ""} ${p && !this._narrow ? "over-bar" : ""}">
        ${p
          ? html`<button class="pill back ${badge.cls || "plain"}" style=${badge.style} @click=${() => this._goLive()} title=${tr("Back to live")}>
              <ha-icon .icon=${"mdi:chevron-left"}></ha-icon><span>${showLive ? tr("Live") : tr("Close")}</span>
            </button>
            <span class="pill when ${badge.cls || "plain"}" style=${badge.style}
              >${p.rec ? html`${this._labels(p.rec.labels, "bare")}` : nothing}<span
                >${this._narrow ? "" : `${this._day(p.at)} `}${this._time(p.at + (p.from !== undefined ? this._pos : 0))}</span
              ></span
            >`
          : html`<span class="pill live-dot ${badge.cls || "plain"}" style=${badge.style}
              ><i></i><span>${tr("Live")}</span>${d?.name || st?.attributes.friendly_name ? html`<span class="cam">${d?.name ?? st?.attributes.friendly_name}</span>` : nothing}</span
            >`}
        <span class="grow"></span>
        ${p ? nothing : det.map((x) => html`<span class="pill seen ${seen.cls || "plain"}" style=${seen.style}><ha-icon .icon=${labelIcon(x.label)}></ha-icon><span>${labelName(x.label)}</span></span>`)}
      </div>
      ${p && !this._narrow ? this._bar(p) : nothing} ${ctl && !p ? html`<div class="over-ctl">${ctl}</div>` : nothing}
      ${p ? nothing : this._fsButton(`pill fs at-${fsAt} ${badge.cls || "plain"}`, badge.style)}
      ${this._note ? html`<div class="note plain">${this._note}</div>` : nothing}
    </div>`;
  }

  private _toggle() {
    const v = this._video();
    if (!v) return;
    haptic();
    if (v.paused) v.play();
    else v.pause();
  }

  /** A recording's controls: back / play / forward, where it is, the one before / after, download. */
  private _bar(p: NonNullable<GlassCamera["_play"]>, under = false) {
    const v = this._video();
    const dur = v && isFinite(v.duration) ? v.duration : 0;
    const seek = (d: number) => {
      const el = this._video();
      if (el) el.currentTime = Math.max(0, Math.min((el.duration || 0) - 0.1, el.currentTime + d));
    };
    const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
    const m = matPart(this._config.player_glass, this._config.player_color, "dark");
    return html`<div class="bar ${under ? "under" : ""} ${m.cls || "plain"}" style=${m.style} @click=${(e: Event) => e.stopPropagation()}>
      ${p.rec ? html`<button class="ib" title=${tr("Newer")} @click=${() => this._step(-1)}><ha-icon .icon=${"mdi:skip-previous"}></ha-icon></button>` : nothing}
      <button class="ib" title="−10 s" @click=${() => seek(-10)}><ha-icon .icon=${"mdi:rewind-10"}></ha-icon></button>
      <button class="ib main" title=${tr(this._paused ? "Play" : "Pause")} @click=${() => this._toggle()}>
        <ha-icon .icon=${this._paused ? "mdi:play" : "mdi:pause"}></ha-icon>
      </button>
      <button class="ib" title="+10 s" @click=${() => seek(10)}><ha-icon .icon=${"mdi:fast-forward-10"}></ha-icon></button>
      ${p.rec ? html`<button class="ib" title=${tr("Older")} @click=${() => this._step(1)}><ha-icon .icon=${"mdi:skip-next"}></ha-icon></button>` : nothing}
      <input
        class="seek"
        type="range"
        min="0"
        max=${dur || 1}
        step="0.1"
        .value=${String(this._pos)}
        style="--p:${dur ? (this._pos / dur) * 100 : 0}%"
        @input=${(e: Event) => {
          const el = this._video();
          if (el) el.currentTime = Number((e.target as HTMLInputElement).value);
        }}
      />
      <span class="t">${fmt(this._pos)}${dur ? ` / ${fmt(dur)}` : ""}</span>
      ${p.dl ? html`<a class="ib" title=${tr("Download")} href=${p.dl} download><ha-icon .icon=${"mdi:download"}></ha-icon></a>` : nothing} ${this._fsButton("ib")}
    </div>`;
  }

  /** The full-screen button (none where the browser can't): in the player's bar, or alone on live. */
  private _fsButton(cls: string, style = "") {
    if (this._config.show_fullscreen === false) return nothing;
    const can = document.fullscreenEnabled || !!(document as any).webkitFullscreenEnabled || !!(HTMLVideoElement.prototype as any).webkitEnterFullscreen;
    if (!can) return nothing;
    return html`<button class=${cls} style=${style} title=${tr(this._fs ? "Exit full screen" : "Full screen")} @click=${(e: Event) => (e.stopPropagation(), this._fullscreen())}>
      <ha-icon .icon=${this._fs ? "mdi:fullscreen-exit" : "mdi:fullscreen"}></ha-icon>
    </button>`;
  }

  private _fullscreen() {
    haptic();
    const root = this.renderRoot as ShadowRoot;
    const doc = document as any;
    if (root.fullscreenElement || doc.webkitFullscreenElement) {
      (document.exitFullscreen ?? doc.webkitExitFullscreen)?.call(document);
      return;
    }
    const stage = root.querySelector(".stage") as any;
    if (!stage) return;
    const req = stage.requestFullscreen ?? stage.webkitRequestFullscreen;
    if (req) {
      Promise.resolve(req.call(stage)).catch(() => this._videoFullscreen());
      return;
    }
    this._videoFullscreen();
  }

  /** iPhone: no full screen for an element – the video's own */
  private _videoFullscreen() {
    (this._stageVideo() as any)?.webkitEnterFullscreen?.();
  }

  private _onFs = () => {
    const root = this.renderRoot as ShadowRoot;
    const on = !!(root.fullscreenElement ?? (document as any).webkitFullscreenElement);
    if (on !== this._fs) this._fs = on;
    this._resetZoom();
  };

  /* ---------- zoom: the wheel, two fingers; one finger / the mouse moves it; a double tap back ---------- */
  private _z = { s: 1, x: 0, y: 0 };
  private _zEl?: HTMLElement;
  private _ptrs = new Map<number, { x: number; y: number }>();
  private _pinch?: { d: number; s: number; mx: number; my: number; x: number; y: number };
  private _moved = false;

  /** what zooms: the recording, else the live picture */
  private _zoomEl(): HTMLElement | null {
    const el = this.renderRoot.querySelector<HTMLElement>(".stage > video.clip, .stage > .live");
    // a player card sits in a display:contents holder, which has no box to scale: the card itself
    const card = el && getComputedStyle(el).display === "contents" ? ((el.firstElementChild as HTMLElement | null) ?? el) : el;
    // WebRTC Camera: the picture inside it (as its own zoom does). It stops the stream once less
    // than 3/4 of the card is in view (IntersectionObserver on the card): a card scaled past the
    // picture's edges would be "out of view" and show its loading picture
    return card?.shadowRoot?.querySelector<HTMLElement>(".ptz-transform") ?? card;
  }

  private _applyZoom() {
    const el = this._zoomEl();
    const stage = this.renderRoot.querySelector<HTMLElement>(".stage");
    if (!el || !stage) return;
    const { s } = this._z;
    // never past the picture's edges
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    this._z.x = Math.min(0, Math.max(w * (1 - s), this._z.x));
    this._z.y = Math.min(0, Math.max(h * (1 - s), this._z.y));
    el.style.transformOrigin = "0 0";
    el.style.transform = s > 1.001 ? `translate(${this._z.x}px, ${this._z.y}px) scale(${s})` : "";
    stage.classList.toggle("zoomed", s > 1.001);
    // the glass over it shows the new spot
    cancelAnimationFrame(this._zRaf);
    this._zRaf = requestAnimationFrame(() => this.partsGl.refresh(true));
  }
  private _zRaf = 0;

  private _resetZoom() {
    this._z = { s: 1, x: 0, y: 0 };
    this._applyZoom();
  }

  /** zoom by k around (px, py) – the stage's own coordinates */
  private _zoomBy(k: number, px: number, py: number) {
    const z = this._z;
    const s = Math.min(6, Math.max(1, z.s * k));
    const r = s / z.s;
    z.x = px - (px - z.x) * r;
    z.y = py - (py - z.y) * r;
    z.s = s;
    this._applyZoom();
  }

  private _local(e: { clientX: number; clientY: number }) {
    const r = this.renderRoot.querySelector(".stage")!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private _onWheel = (e: WheelEvent) => {
    if (this._config.zoom === false) return;
    // a wheel counting lines or pages (Firefox): in px, as the others
    const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
    // the wheel over the picture is the picture's: never the page behind it (zoomed out too)
    e.preventDefault();
    if (this._z.s <= 1.001 && dy > 0) return;
    const p = this._local(e);
    this._zoomBy(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), p.x, p.y);
  };

  /** Fingers: touch events, not pointer ones – a phone's browser cancels the pointers as soon as
   *  two fingers move (its own gesture), and only a touch it is told to leave alone stays ours.
   *  Two fingers zoom; one moves the picture once zoomed; a tap stays a tap. */
  private _tPrev?: { x: number; y: number };
  /** a swipe across a recording playing (not zoomed): the one before / after it */
  private _swipe?: { x: number; y: number };
  private _swipeStart(x: number, y: number, target: EventTarget | null) {
    const on = !!this._play?.rec && this._z.s <= 1.001 && !(target as HTMLElement | null)?.closest?.("button, a, input, .bar, .top, .over-ctl, .fs");
    this._swipe = on ? { x, y } : undefined;
  }
  /** true once it is a swipe (sideways, past a few px) */
  private _swipeMove(x: number, y: number) {
    const w = this._swipe;
    if (!w) return false;
    const dx = x - w.x;
    const dy = y - w.y;
    if (Math.abs(dy) > 24 && Math.abs(dy) > Math.abs(dx)) {
      this._swipe = undefined;
      return false;
    }
    if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) this._moved = true;
    return Math.abs(dx) > 10;
  }
  private _swipeEnd(x: number, y: number) {
    const w = this._swipe;
    this._swipe = undefined;
    if (!w) return;
    const dx = x - w.x;
    const dy = y - w.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    this._moved = true;
    // to the left: the next in the list (older), to the right: the one before it (newer)
    this._step(dx < 0 ? 1 : -1);
  }
  private _onTouch = {
    passive: false,
    handleEvent: (e: TouchEvent) => {
      const t = e.touches;
      // zoomed in, or two fingers on it: the gesture is the picture's – a Bubble Card pop-up
      // around it must not slide with it (it starts on touchstart, follows touchmove on the page)
      if (this._config.zoom !== false && (t.length > 1 || this._z.s > 1.001 || this._pinch) && e.type !== "touchend" && e.type !== "touchcancel") e.stopPropagation();
      // nor does the page behind scroll under a finger on the picture (Safari without touch-action)
      if (this._config.zoom !== false && e.type === "touchmove" && e.cancelable) e.preventDefault();
      if (e.type === "touchstart") this._swipeStart(t.length === 1 ? t[0].clientX : NaN, t.length === 1 ? t[0].clientY : NaN, e.target);
      else if (e.type === "touchmove" && t.length === 1 && this._swipeMove(t[0].clientX, t[0].clientY)) e.preventDefault();
      else if (e.type === "touchend" && !t.length && e.changedTouches.length) this._swipeEnd(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
      if (t.length > 1 || e.type === "touchcancel") this._swipe = undefined;
      if (this._config.zoom === false) return;
      if (e.type === "touchstart" && (e.target as HTMLElement).closest?.("button, a, input, .bar, .top, .over-ctl, .fs")) return;
      if (t.length >= 2) {
        e.preventDefault();
        const [a, b] = [t[0], t[1]];
        const m = this._local({ clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 });
        const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (!this._pinch) this._pinch = { d, s: this._z.s, mx: m.x, my: m.y, x: this._z.x, y: this._z.y };
        else {
          const p = this._pinch;
          const s = Math.min(6, Math.max(1, (p.s * d) / Math.max(1, p.d)));
          const r = s / p.s;
          this._z = { s, x: m.x - (p.mx - p.x) * r, y: m.y - (p.my - p.y) * r };
          this._moved = true;
          this._applyZoom();
        }
        this._tPrev = undefined;
        return;
      }
      this._pinch = undefined;
      if (t.length !== 1) {
        this._tPrev = undefined;
        return;
      }
      const now = { x: t[0].clientX, y: t[0].clientY };
      if (e.type === "touchmove" && this._z.s > 1.001 && this._tPrev) {
        e.preventDefault();
        const dx = now.x - this._tPrev.x;
        const dy = now.y - this._tPrev.y;
        if (Math.abs(dx) + Math.abs(dy) > 0.5) this._moved = true;
        this._z.x += dx;
        this._z.y += dy;
        this._applyZoom();
      }
      if (e.type === "touchstart" && t.length === 1) this._moved = false;
      this._tPrev = now;
    },
  };

  private _onDown = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    this._swipeStart(e.clientX, e.clientY, e.target);
    if (this._config.zoom === false || (e.target as HTMLElement).closest("button, a, input, .bar, .top, .over-ctl, .fs")) return;
    this._ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this._moved = false;
    if (this._ptrs.size === 2) {
      const [a, b] = [...this._ptrs.values()];
      const m = this._local({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
      this._pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: this._z.s, mx: m.x, my: m.y, x: this._z.x, y: this._z.y };
    }
    if (this._ptrs.size === 2 || this._z.s > 1.001) (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  private _onMove = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    if (e.buttons) this._swipeMove(e.clientX, e.clientY);
    const last = this._ptrs.get(e.pointerId);
    if (!last) return;
    const now = { x: e.clientX, y: e.clientY };
    this._ptrs.set(e.pointerId, now);
    if (this._ptrs.size === 2 && this._pinch) {
      const [a, b] = [...this._ptrs.values()];
      const p = this._pinch;
      const m = this._local({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
      const s = Math.min(6, Math.max(1, (p.s * Math.hypot(a.x - b.x, a.y - b.y)) / Math.max(1, p.d)));
      const r = s / p.s;
      // the spot under the fingers stays under them, and moves with them
      this._z = { s, x: m.x - (p.mx - p.x) * r, y: m.y - (p.my - p.y) * r };
      this._moved = true;
      this._applyZoom();
    } else if (this._ptrs.size === 1 && this._z.s > 1.001) {
      const dx = now.x - last.x;
      const dy = now.y - last.y;
      if (Math.abs(dx) + Math.abs(dy) > 0.5) this._moved = true;
      this._z.x += dx;
      this._z.y += dy;
      this._applyZoom();
    }
  };

  private _onUp = (e: PointerEvent) => {
    if (e.pointerType !== "touch") {
      if (e.type === "pointerup") this._swipeEnd(e.clientX, e.clientY);
      else this._swipe = undefined;
    }
    this._ptrs.delete(e.pointerId);
    if (this._ptrs.size < 2) this._pinch = undefined;
  };

  /** a drag or pinch is not a tap (no play / pause after it) */
  private _onClickCapture = (e: Event) => {
    if (this._moved) {
      e.stopPropagation();
      e.preventDefault();
      this._moved = false;
    }
  };

  private _onDbl = (e: MouseEvent) => {
    if (this._config.zoom === false || (e.target as HTMLElement).closest("button, a, input, .bar, .top, .over-ctl")) return;
    if (this._z.s > 1.001) this._resetZoom();
    else {
      const p = this._local(e);
      this._zoomBy(2.5, p.x, p.y);
    }
  }

  private _switcher(cur: number) {
    const c = this._config;
    const cams = this._cams();
    // by default only when nothing else switches them (a camera's `active`, e.g. a header's buttons)
    const show = c.show_switcher ?? !cams.some((d) => d.active !== undefined);
    if (!show || cams.length < 2) return nothing;
    // no material of its own: the control glass, as the pills under it
    const track = matPart(c.switcher_glass, c.switcher_color, "home");
    return html`<div class="tabs ${track.cls || "control still"}" style=${track.style}>
      ${cams.map((d, i) => {
        const name = d.name ?? (d.camera ? this._hass?.states[d.camera]?.attributes.friendly_name : undefined) ?? `${i + 1}`;
        return html`<button
          class="tab ${i === cur ? "on" : ""}"
          @click=${() => {
            haptic("selection");
            this._pick = i;
            this._play = undefined;
            this._cover = undefined;
          }}
        >
          ${d.icon ? html`<ha-icon .icon=${d.icon}></ha-icon>` : nothing}<span>${name}</span>
        </button>`;
      })}
    </div>`;
  }

  /** The time line: the span's recordings and recorded stretches; a tap plays from there. */
  /** The time line: the span's recordings and recorded stretches; a tap plays from there, a drag
   *  (or ‹ ›) goes back and forth in time, an empty stretch offers the latest recording. */
  private _tlDrag?: { id: number; x: number; w: number; end: number; span: number; from: number; moved: boolean };

  private _timeline(cur: number) {
    const c = this._config;
    if (!c.show_timeline) return nothing;
    const now = Date.now() / 1000;
    const { from, to, span } = this._win();
    const x = (t: number) => `${Math.max(0, Math.min(100, ((t - from) / span) * 100))}%`;
    const mine = Array.isArray(this._recs) ? this._recs.filter((r) => r.cam === cur) : [];
    const recs = mine.filter((r) => (r.end ?? now) >= from && r.start <= to);
    // a handful of ticks, whole hours as just the hour, midnight as the day
    const step = this._span <= 1 ? 900 : this._span <= 6 ? 3600 : 6 * 3600;
    const ticks: number[] = [];
    for (let t = Math.ceil(from / step) * step; t < to; t += step) ticks.push(t);
    const tickText = (t: number) => {
      const d = new Date(t * 1000);
      return d.getHours() === 0 && d.getMinutes() === 0
        ? new Intl.DateTimeFormat(language(this._hass), { weekday: "short", day: "numeric" }).format(d)
        : this._tick(t);
    };
    const m = matPart(c.timeline_glass, c.timeline_color, "home");
    const p = this._play;
    const head = p ? (p.from !== undefined ? p.from + this._pos : p.at + this._pos) : undefined;
    // a tap plays, a drag (a swipe) pans – the drag lives on the card: each step re-renders it
    // (and so does a recording playing), which would drop a drag kept in here
    const down = (e: PointerEvent) => {
      if (e.button) return;
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      this._tlDrag = { id: e.pointerId, x: e.clientX, w: r.width, end: to, span, from, moved: false };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      const drag = this._tlDrag;
      if (!drag || drag.id !== e.pointerId) return;
      const dx = e.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) < 5) return;
      drag.moved = true;
      const t = Date.now() / 1000;
      const end = Math.min(t, drag.end - (dx / drag.w) * drag.span);
      this._end = end >= t - 60 ? undefined : end;
    };
    const up = (e: PointerEvent) => {
      const d = this._tlDrag;
      this._tlDrag = undefined;
      if (!d || d.id !== e.pointerId) return;
      if (d.moved) {
        this._cover = undefined;
        return;
      }
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      this._openAt(d.from + ((e.clientX - r.left) / r.width) * d.span);
    };
    const page = (k: number) => {
      haptic("selection");
      const end = Math.min(now, to + k * span * 0.8);
      this._end = end >= now - 60 ? undefined : end;
      this._cover = undefined;
    };
    const latest = mine[0];
    const empty = !recs.length && !(this._cover?.segs ?? []).some(([a, b]) => b >= from && a <= to);
    return html`<div class="timeline ${m.cls || "control still"}" style=${m.style}>
      <button class="nav" title=${tr("Earlier")} @click=${() => page(-1)}><ha-icon .icon=${"mdi:chevron-left"}></ha-icon></button>
      <div class="track" @pointerdown=${down} @pointermove=${move} @pointerup=${up} @pointercancel=${() => (this._tlDrag = undefined)}>
        ${(this._cover?.segs ?? []).map(([a, b]) => (b < from || a > to ? nothing : html`<i class="cov" style="left:${x(a)};width:calc(${x(b)} - ${x(a)})"></i>`))}
        ${recs.map((r) => html`<i class="mark ${r.alert ? "alert" : ""}" style="left:${x(r.start)};width:max(3px, calc(${x(r.end ?? now)} - ${x(r.start)}))" title=${`${this._time(r.start)} ${r.labels.map(labelName).join(", ")}`}></i>`)}
        ${ticks.map((t) => html`<span class="tick" style="left:${x(t)}">${tickText(t)}</span>`)}
        ${head !== undefined && head >= from && head <= to ? html`<i class="ph" style="left:${x(head)}"></i>` : nothing}
        ${empty
          ? html`<span class="tl-empty"
              >${latest && latest.start < from
                ? html`<button
                    @pointerdown=${(e: Event) => e.stopPropagation()}
                    @pointerup=${(e: Event) => e.stopPropagation()}
                    @click=${(e: Event) => (e.stopPropagation(), haptic("selection"), this._show(latest.start))}
                  >
                    ${tr("Latest: {when}", { when: `${this._day(latest.start)} ${this._time(latest.start)}` })}
                  </button>`
                : tr("Nothing recorded here")}</span
            >`
          : nothing}
      </div>
      <button class="nav" title=${tr("Later")} ?disabled=${this._end === undefined} @click=${() => page(1)}><ha-icon .icon=${"mdi:chevron-right"}></ha-icon></button>
      <span class="zoom">
        ${this._end !== undefined ? html`<button @click=${() => ((this._end = undefined), (this._cover = undefined))}>${tr("Now")}</button>` : nothing}
        ${[1, 6, 24].map((h) => html`<button class=${h === this._span ? "on" : ""} @click=${() => ((this._span = h), (this._cover = undefined))}>${h} h</button>`)}
      </span>
    </div>`;
  }

  private _list(cur: number) {
    const c = this._config;
    if (c.show_events === false) return nothing;
    const m = matPart(c.list_glass, c.list_color, "home");
    const recs = this._recs;
    let body: unknown;
    if (recs === "none" || recs === undefined) body = html`<div class="hint">${tr("No Frigate camera: recordings come from the Frigate integration.")}</div>`;
    else if (recs === "loading") body = html`<div class="grid">${[0, 1, 2, 3].map(() => html`<span class="ev skel"></span>`)}</div>`;
    else if (recs === "error") body = html`<div class="hint">${tr("The recordings could not be loaded.")}</div>`;
    else {
      const mine = c.all_cameras ? recs : recs.filter((r) => r.cam === cur);
      if (!mine.length)
        body = html`<div class="hint">
          ${tr(this._sevNow() === "alert" ? "No alerts in the last {hours} h" : this._sevNow() === "detection" ? "No detections in the last {hours} h" : "Nothing recorded in the last {hours} h", {
            hours: c.hours ?? 48,
          })}
        </div>`;
      else {
        const days: [string, Rec[]][] = [];
        for (const r of mine) {
          const k = this._day(r.start);
          const last = days[days.length - 1];
          if (last?.[0] === k) last[1].push(r);
          else days.push([k, [r]]);
        }
        const playing = this._play?.rec?.id;
        const many = c.all_cameras && this._cams().length > 1;
        body = days.map(
          ([day, list]) => html`<div class="day">${day}</div>
            <div class="grid">
              ${list.map(
                (r) => html`<button class="ev ${r.id === playing ? "cur" : ""} ${r.alert ? "alert" : ""}" @click=${() => this._open(r)}>
                  ${r.thumb ? html`<img loading="lazy" src=${r.thumb} alt="" />` : nothing}
                  <span class="tags">${this._labels(r.labels)}</span>
                  <span class="foot"><span class="when">${this._time(r.start)}</span>${many ? html`<span class="which">${this._cams()[r.cam]?.name ?? r.fcam}</span>` : nothing}<span class="dur">${this._dur(r)}</span></span>
                </button>`,
              )}
            </div>`,
        );
      }
    }
    const cols = c.list_columns ? `--cam-cols:repeat(${c.list_columns}, minmax(0, 1fr));` : "";
    // the fades follow the scroll (no re-render): top once scrolled, bottom while more is below
    const edges = (e: Event) => {
      const el = e.currentTarget as HTMLElement;
      el.classList.toggle("scrolled", el.scrollTop > 2);
      el.classList.toggle("at-end", el.scrollTop + el.clientHeight >= el.scrollHeight - 2);
    };
    const sev = this._sevNow();
    const pick = (v: "all" | "alert" | "detection") => {
      if (v === sev) return;
      haptic("selection");
      this._sev = v;
    };
    const sw =
      c.show_severity !== false && !this._events && recs !== "none" && recs !== undefined
        ? html`<div class="sev">
            ${(
              [
                ["all", "All"],
                ["alert", "Alerts"],
                ["detection", "Detections"],
              ] as const
            ).map(([v, l]) => html`<button class=${v === sev ? "on" : ""} @click=${() => pick(v)}>${tr(l)}</button>`)}
          </div>`
        : nothing;
    return html`<div class="list ${m.cls}" style=${cols + m.style} @scroll=${edges}><div class="scroll" @scroll=${edges}>${sw}${body}</div></div>`;
  }

  protected override render() {
    const c = this._config;
    if (!c || !this._hass) return nothing;
    const cur = this._cur();
    const ctl = c.show_controls !== false && c.controls !== "overlay" ? this._ctl[cur] : undefined;
    const stage = this._stage(cur);
    const under = this._narrow && this._play ? this._bar(this._play, true) : nothing;
    const main = html`${stage}${under}${this._timeline(cur)}${this._switcher(cur)}${ctl ? html`<div class="ctl">${ctl}</div>` : nothing}`;
    const h = c.height === "fill" ? (this._fillH ? `${this._fillH}px` : "") : c.height ? screenUnits(c.height) : "";
    const vars = `${h ? `height:${h};` : ""}${c.alert_color ? `--cam-alert:${cssColor(c.alert_color)};` : ""}${c.selected_color ? `--cam-cur:${cssColor(c.selected_color)};` : ""}`;
    const list = this._list(cur);
    const onlyList = stage === nothing;
    if (this._wide && list !== nothing && !onlyList)
      return html`<div class="frame surface side ${h ? "fixed" : ""}" style="grid-template-columns:${c.list_width ?? "minmax(320px, 0.36fr)"} minmax(0, 1fr);${vars}">
        ${list}
        <div class="main">${main}</div>
      </div>`;
    return html`<div class="frame surface stacked ${onlyList ? "only-list" : ""} ${h ? "fixed" : ""}" style=${vars}>
      <div class="head ${c.sticky === false || h ? "" : "sticky"}">${stage}${under}${this._timeline(cur)}</div>
      ${this._switcher(cur)}${ctl ? html`<div class="ctl">${ctl}</div>` : nothing} ${list}
    </div>`;
  }

  override getCardSize() {
    return 6;
  }

  static override styles = [
    GlassElement.styles,
    surface,
    control,
    css`
      :host {
        display: block;
        min-width: 0;
        --cam-r: calc(var(--g-radius) - 6px);
      }
      .frame {
        box-sizing: border-box;
        height: 100%;
        padding: 12px;
        border-radius: var(--g-radius);
        color: var(--g-text);
      }
      .side {
        display: grid;
        grid-template-columns: minmax(320px, 0.36fr) minmax(0, 1fr);
        gap: 12px;
      }
      .side .main {
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-width: 0;
      }
      /* the list as tall as the picture beside it: it scrolls, it doesn't push */
      .side .list {
        position: relative;
        min-height: 240px;
      }
      .side .list {
        overflow: hidden;
      }
      .side .list .scroll {
        position: absolute;
        inset: 0;
        overflow-y: auto;
        padding: 10px;
        overscroll-behavior: contain;
        scrollbar-width: none;
      }
      .side .list .scroll::-webkit-scrollbar {
        display: none;
      }
      /* what scrolls fades out at the panel's edges, softly (eased steps, never cut off) – only
         at an edge with more beyond it: the first row isn't faded before you scroll */
      .side .list .scroll,
      .stacked.fixed .list {
        --ft: 0px;
        --fb: 30px;
        -webkit-mask-image: linear-gradient(
          180deg,
          transparent 0,
          rgba(0, 0, 0, 0.18) calc(var(--ft) * 0.2),
          rgba(0, 0, 0, 0.5) calc(var(--ft) * 0.45),
          rgba(0, 0, 0, 0.82) calc(var(--ft) * 0.72),
          #000 var(--ft),
          #000 calc(100% - var(--fb)),
          rgba(0, 0, 0, 0.82) calc(100% - var(--fb) * 0.72),
          rgba(0, 0, 0, 0.5) calc(100% - var(--fb) * 0.45),
          rgba(0, 0, 0, 0.18) calc(100% - var(--fb) * 0.2),
          transparent 100%
        );
        mask-image: linear-gradient(
          180deg,
          transparent 0,
          rgba(0, 0, 0, 0.18) calc(var(--ft) * 0.2),
          rgba(0, 0, 0, 0.5) calc(var(--ft) * 0.45),
          rgba(0, 0, 0, 0.82) calc(var(--ft) * 0.72),
          #000 var(--ft),
          #000 calc(100% - var(--fb)),
          rgba(0, 0, 0, 0.82) calc(100% - var(--fb) * 0.72),
          rgba(0, 0, 0, 0.5) calc(100% - var(--fb) * 0.45),
          rgba(0, 0, 0, 0.18) calc(100% - var(--fb) * 0.2),
          transparent 100%
        );
      }
      .side .list .scroll.scrolled,
      .stacked.fixed .list.scrolled {
        --ft: 30px;
      }
      .side .list .scroll.at-end,
      .stacked.fixed .list.at-end {
        --fb: 0px;
      }
      .stacked {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .stacked .head {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      /* stuck: the card's glass behind it, so the recordings scroll away underneath */
      .stacked .head.sticky {
        position: sticky;
        top: var(--cam-top, 0px);
        z-index: 2;
        margin: -12px -12px 0;
        padding: 12px;
        border-radius: var(--g-radius) var(--g-radius) calc(var(--g-radius) - 4px) calc(var(--g-radius) - 4px);
        background: var(--cam-sticky-bg, var(--g-surface));
        -webkit-backdrop-filter: blur(24px) saturate(160%);
        backdrop-filter: blur(24px) saturate(160%);
      }
      .stacked .list .scroll {
        padding: 10px;
      }
      .stacked.only-list .list .scroll {
        padding: 0;
      }

      /* ---- the picture ---- */
      .stage {
        position: relative;
        width: 100%;
        border-radius: var(--cam-r);
        overflow: hidden;
        background: #0b0d10;
        isolation: isolate;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
      }
      /* zoom: every gesture on the picture is the card's – the page (a pop-up) behind it does not
         scroll: a pinch starts with one finger, and a page already scrolling would take it */
      .stage.can-zoom {
        touch-action: none;
        overscroll-behavior: contain;
      }
      .stage.can-zoom:fullscreen {
        touch-action: none;
      }
      .stage.zoomed {
        touch-action: none;
        cursor: grab;
      }
      .stage:fullscreen {
        /* the whole picture (live too): zoom in with two fingers */
        --cam-fit: contain;
        aspect-ratio: auto !important;
        width: 100%;
        height: 100%;
        border-radius: 0;
        box-shadow: none;
      }
      .stage:fullscreen > video {
        object-fit: contain;
      }
      .pill.fs {
        position: absolute;
        z-index: 3;
        width: 34px;
        height: 34px;
        padding: 0;
        justify-content: center;
        border: 0;
        cursor: pointer;
      }
      .pill.fs ha-icon {
        --mdc-icon-size: 20px;
      }
      .pill.fs.at-top-right {
        top: 10px;
        right: 10px;
      }
      .pill.fs.at-top-left {
        top: 10px;
        left: 10px;
      }
      .pill.fs.at-bottom-right {
        bottom: 10px;
        right: 10px;
      }
      .pill.fs.at-bottom-left {
        bottom: 10px;
        left: 10px;
      }
      .sev {
        display: flex;
        gap: 2px;
        padding: 3px;
        margin: 0 0 10px;
        border-radius: 999px;
        background: color-mix(in srgb, currentColor 10%, transparent);
      }
      .sev button {
        flex: 1;
        border: 0;
        background: none;
        font: inherit;
        font-size: 12px;
        font-weight: 600;
        color: inherit;
        opacity: 0.65;
        padding: 6px 4px;
        border-radius: 999px;
        cursor: pointer;
        white-space: nowrap;
      }
      .sev button.on {
        opacity: 1;
        background: color-mix(in srgb, currentColor 18%, transparent);
      }
      .stage > .live,
      .stage > .live[style*="contents"] > *,
      .stage > video,
      .stage > .empty {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        display: block;
      }
      .stage > video {
        object-fit: cover;
        background: #000;
      }
      .stage.fit-contain > video {
        object-fit: contain;
      }
      .empty {
        display: flex !important;
        align-items: center;
        justify-content: center;
        color: rgba(255, 255, 255, 0.7);
      }
      .top {
        position: absolute;
        left: 10px;
        right: 10px;
        top: 10px;
        display: flex;
        align-items: center;
        gap: 6px;
        z-index: 2;
        pointer-events: none;
      }
      .top > * {
        pointer-events: auto;
      }
      /* WebGL glass over the video: more blur (the picture's detail stays out of the text), deeper
         shading over a bright picture and a faint smoke in the glass (a colour of its own wins),
         white text and icons with a shadow – legible over snow, sun, a white wall */
      .stage .mat-liquid-gl,
      .stage .mat-dark-liquid-gl {
        --glass-liquid-blur: 14;
        --glass-liquid-contrast: 2.2;
        --glass-liquid-dispersion: 0.15;
        color: #fff;
        text-shadow:
          0 1px 2px rgba(0, 0, 0, 0.55),
          0 0 10px rgba(0, 0, 0, 0.25);
      }
      .stage .mat-liquid-gl:not([style*="--mat-tinted"]) {
        --glass-panel-tint: 16, 18, 22;
        --glass-panel-tint-a: 0.26;
      }
      .stage .mat-liquid-gl ha-icon,
      .stage .mat-dark-liquid-gl ha-icon,
      .stage .mat-liquid-gl .ib,
      .stage .mat-dark-liquid-gl .ib {
        color: #fff;
        filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
      }
      .stage .mat-liquid-gl .seek,
      .stage .mat-dark-liquid-gl .seek {
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
      }
      /* WebGL glass waits for the video's first frame: shown (faded in) once it is drawn, never a
         stand-in before – where WebGL works at all (.gl on the picture) */
      .stage .mat-liquid-gl,
      .stage .mat-dark-liquid-gl {
        transition: opacity 0.25s ease;
      }
      .stage.gl .mat-liquid-gl:not(.lg-on),
      .stage.gl .mat-dark-liquid-gl:not(.lg-on) {
        opacity: 0;
        pointer-events: none;
      }
      /* "Live" in another corner: the detections take the other side */
      .top.pos-top-right,
      .top.pos-bottom-right {
        flex-direction: row-reverse;
      }
      .top.pos-bottom-left,
      .top.pos-bottom-right {
        top: auto;
        bottom: 10px;
      }
      .top.over-bar.pos-bottom-left,
      .top.over-bar.pos-bottom-right {
        bottom: 60px;
      }
      .top.small {
        left: 8px;
        right: 8px;
        top: 8px;
        gap: 4px;
      }
      .top.small.pos-bottom-left,
      .top.small.pos-bottom-right {
        top: auto;
        bottom: 8px;
      }
      .top.small .pill {
        height: 24px;
        padding: 0 9px;
        font-size: 11px;
        gap: 4px;
      }
      .top.small .pill ha-icon {
        --mdc-icon-size: 14px;
      }
      .top.small .live-dot .cam {
        display: none;
      }
      .grow {
        flex: 1;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 30px;
        padding: 0 12px;
        border: 0;
        border-radius: 999px;
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        color: #fff;
        white-space: nowrap;
      }
      .plain {
        background: rgba(18, 20, 24, 0.42);
        -webkit-backdrop-filter: blur(14px) saturate(140%);
        backdrop-filter: blur(14px) saturate(140%);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.14);
        color: #fff;
      }
      .pill ha-icon {
        --mdc-icon-size: 17px;
        display: flex;
      }
      .back {
        cursor: pointer;
        padding-left: 6px;
      }
      .live-dot i {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #ff453a;
        box-shadow: 0 0 0 0 rgba(255, 69, 58, 0.6);
        animation: rec 1.6s ease-out infinite;
      }
      .live-dot.wait i {
        background: rgba(255, 255, 255, 0.55);
        animation: none;
      }
      .stage > video.live {
        object-fit: cover;
      }
      .live-dot .cam {
        font-weight: 500;
        opacity: 0.85;
      }
      @keyframes rec {
        70% {
          box-shadow: 0 0 0 7px rgba(255, 69, 58, 0);
        }
        100% {
          box-shadow: 0 0 0 0 rgba(255, 69, 58, 0);
        }
      }
      .seen.plain {
        background: rgba(255, 149, 0, 0.78);
        animation: seen 1.8s ease-in-out infinite;
      }
      @keyframes seen {
        50% {
          background: rgba(255, 149, 0, 0.5);
        }
      }
      .when .tag.bare {
        padding: 0;
        background: none;
        box-shadow: none;
        backdrop-filter: none;
      }
      .note {
        position: absolute;
        left: 50%;
        bottom: 14px;
        transform: translateX(-50%);
        padding: 8px 14px;
        border-radius: 999px;
        font-size: 13px;
        z-index: 3;
      }
      .over-ctl {
        position: absolute;
        left: 10px;
        right: 10px;
        bottom: 10px;
        z-index: 2;
      }

      /* ---- a recording's controls ---- */
      /* a phone: under the picture, the picture left whole */
      .bar.under {
        position: static;
        margin-top: -2px;
        border-radius: 999px;
      }
      .bar.under.plain {
        background: var(--glass-home-control, rgba(118, 118, 128, 0.16));
        backdrop-filter: none;
        box-shadow: none;
        color: var(--g-text);
      }
      .bar.under.plain .ib,
      .bar.under.plain .t {
        color: var(--g-text);
      }
      .bar.under.plain .ib.main {
        background: color-mix(in srgb, var(--g-text, #000) 12%, transparent);
      }
      .bar.under.plain .seek {
        background: linear-gradient(90deg, var(--g-text, #000) var(--p), color-mix(in srgb, var(--g-text, #000) 22%, transparent) var(--p));
      }
      /* a height of its own: the row is as tall as the picture's side (never taller than the card),
         and the recordings beside it are no taller than that */
      .side.fixed {
        grid-template-rows: fit-content(100%);
        align-content: start;
      }
      .side.fixed .main {
        min-height: 0;
        overflow-y: auto;
      }
      .stacked.fixed .list {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
      }
      .bar {
        position: absolute;
        left: 10px;
        right: 10px;
        bottom: 10px;
        z-index: 2;
        display: flex;
        align-items: center;
        gap: 2px;
        padding: 4px 10px 4px 4px;
        border-radius: 999px;
      }
      .ib {
        flex: none;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: none;
        color: #fff;
        cursor: pointer;
        --mdc-icon-size: 21px;
      }
      .ib.main {
        background: rgba(255, 255, 255, 0.2);
      }
      .ib:hover {
        background: rgba(255, 255, 255, 0.14);
      }
      .seek {
        flex: 1;
        min-width: 40px;
        height: 4px;
        margin: 0 8px;
        -webkit-appearance: none;
        appearance: none;
        border-radius: 99px;
        background: linear-gradient(90deg, #fff var(--p), rgba(255, 255, 255, 0.3) var(--p));
        cursor: pointer;
      }
      .seek::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
      }
      .seek::-moz-range-thumb {
        width: 14px;
        height: 14px;
        border: 0;
        border-radius: 50%;
        background: #fff;
      }
      .t {
        flex: none;
        font-size: 12px;
        font-variant-numeric: tabular-nums;
        color: rgba(255, 255, 255, 0.9);
        margin-right: 2px;
      }
      @container camera (max-width: 420px) {
        .bar .ib:not(.main):not(:last-child) {
          display: none;
        }
      }

      /* ---- cameras ---- */
      .tabs {
        display: flex;
        gap: 4px;
        padding: 4px;
        border-radius: 999px;
      }
      /* the control glass on a bar (time line, camera switch): not a button – no press, no hand */
      .control.still {
        cursor: default;
      }
      .control.still:active {
        transform: translateZ(0);
      }
      /* the status bar's pills (Light, Night vision) under them: the same white glass by day,
         the same faint sheen by night – one look for the whole bottom of the card */
      :host(:not([dark])[control-glass]) .control.still {
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.34), rgba(255, 255, 255, 0.12) 55%, rgba(255, 255, 255, 0.2)) !important;
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.55),
          0 1px 2px rgba(0, 0, 0, 0.04),
          0 4px 12px rgba(0, 0, 0, 0.06) !important;
        border: 0 !important;
      }
      :host([dark][control-glass]) .control.still {
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.13), rgba(255, 255, 255, 0.04) 55%, rgba(255, 255, 255, 0.07)) !important;
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.16),
          0 1px 2px rgba(0, 0, 0, 0.1),
          0 4px 12px rgba(0, 0, 0, 0.12) !important;
        border: 0 !important;
      }
      .tab {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        height: 38px;
        border: 0;
        border-radius: 999px;
        background: none;
        font: inherit;
        font-size: var(--gt-tab-size, 14px);
        font-weight: var(--gt-tab-weight, 600);
        color: var(--gt-tab-color, var(--g-text));
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }
      .tab ha-icon {
        --mdc-icon-size: 18px;
        display: flex;
      }
      .tab.on {
        color: var(--glass-home-side-text, #fff);
        background: var(--glass-control-bg, rgba(28, 28, 30, 0.85));
        box-shadow: var(--glass-control-shadow);
      }

      /* ---- the time line ---- */
      .timeline {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 14px 6px 12px;
        border-radius: 999px;
      }
      .track {
        position: relative;
        flex: 1;
        height: 40px;
        cursor: pointer;
      }
      .track::before {
        content: "";
        position: absolute;
        left: 0;
        right: 0;
        top: 10px;
        height: 12px;
        border-radius: 6px;
        background: color-mix(in srgb, currentColor 10%, transparent);
      }
      .cov {
        position: absolute;
        top: 10px;
        height: 12px;
        border-radius: 6px;
        background: color-mix(in srgb, currentColor 22%, transparent);
      }
      .mark {
        position: absolute;
        top: 8px;
        height: 16px;
        border-radius: 4px;
        background: #0a84ff;
      }
      .mark.alert {
        background: var(--cam-alert, #ff9f0a);
      }
      .ph {
        position: absolute;
        top: 4px;
        width: 2px;
        height: 24px;
        margin-left: -1px;
        border-radius: 1px;
        background: #ff453a;
      }
      .tick {
        position: absolute;
        top: 26px;
        transform: translateX(-50%);
        font-size: 10px;
        opacity: 0.6;
        white-space: nowrap;
        pointer-events: none;
      }
      .zoom {
        display: flex;
        gap: 2px;
      }
      .timeline .nav {
        flex: none;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: none;
        color: inherit;
        cursor: pointer;
        --mdc-icon-size: 20px;
      }
      .timeline .nav:disabled {
        opacity: 0.3;
        cursor: default;
      }
      .track {
        touch-action: pan-y;
        user-select: none;
      }
      .tl-empty {
        position: absolute;
        left: 0;
        right: 0;
        top: 4px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        opacity: 0.75;
        pointer-events: none;
      }
      .tl-empty button {
        pointer-events: auto;
        border: 0;
        border-radius: 999px;
        padding: 3px 10px;
        font: inherit;
        font-weight: 600;
        color: inherit;
        background: color-mix(in srgb, currentColor 14%, transparent);
        cursor: pointer;
      }
      .zoom button {
        border: 0;
        background: none;
        font: inherit;
        font-size: 12px;
        font-weight: 600;
        color: inherit;
        opacity: 0.6;
        padding: 4px 8px;
        border-radius: 999px;
        cursor: pointer;
      }
      .zoom button.on {
        opacity: 1;
        background: color-mix(in srgb, currentColor 14%, transparent);
      }

      /* ---- recordings ---- */
      .list {
        min-width: 0;
        border-radius: var(--cam-r);
        container: camlist / inline-size;
      }
      .list:not(.mat) {
        background: color-mix(in srgb, var(--g-text, #000) 6%, transparent);
      }
      .day {
        font-size: var(--gt-day-size, 13px);
        font-weight: var(--gt-day-weight, 600);
        color: var(--gt-day-color, inherit);
        opacity: 0.75;
        margin: 12px 4px 8px;
      }
      .day:first-child {
        margin-top: 2px;
      }
      .grid {
        display: grid;
        grid-template-columns: var(--cam-cols, repeat(auto-fill, minmax(130px, 1fr)));
        gap: 8px;
      }
      .ev {
        position: relative;
        aspect-ratio: 16 / 9;
        padding: 0;
        border: 0;
        border-radius: 12px;
        overflow: hidden;
        background: #1c1f24;
        cursor: pointer;
        font: inherit;
        color: #fff;
        -webkit-tap-highlight-color: transparent;
        transition: transform 0.15s ease;
      }
      .ev:active {
        transform: scale(0.97);
      }
      .ev img {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .ev::after {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        pointer-events: none;
        background: linear-gradient(180deg, transparent 55%, rgba(0, 0, 0, 0.55));
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
      }
      .ev.alert::after {
        box-shadow: inset 0 0 0 2px var(--cam-alert, rgba(255, 159, 10, 0.85));
      }
      .ev.cur::after {
        box-shadow: inset 0 0 0 3px var(--cam-cur, #0a84ff);
      }
      .ev.skel {
        cursor: default;
        animation: skel 1.4s ease-in-out infinite;
        background: color-mix(in srgb, var(--g-text, #000) 10%, transparent);
      }
      .ev.skel::after {
        display: none;
      }
      @keyframes skel {
        50% {
          opacity: 0.5;
        }
      }
      .tags {
        position: absolute;
        left: 6px;
        top: 6px;
        display: flex;
        gap: 4px;
        z-index: 1;
      }
      .tag {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        height: 22px;
        padding: 0 8px 0 6px;
        border-radius: 999px;
        font-size: var(--gt-tag-size, 11px);
        font-weight: var(--gt-tag-weight, 600);
        color: var(--gt-tag-color, #fff);
      }
      .tag ha-icon {
        --mdc-icon-size: var(--gi-tag-size, 14px);
        color: var(--gi-tag-color, inherit);
        display: flex;
      }
      /* a narrow thumbnail: the labels' icons only */
      @container camlist (max-width: 300px) {
        .grid .tag span {
          display: none;
        }
        .grid .tag {
          padding: 0 4px;
        }
      }
      .foot {
        position: absolute;
        left: 8px;
        right: 8px;
        bottom: 6px;
        display: flex;
        align-items: baseline;
        gap: 6px;
        z-index: 1;
        font-size: var(--gt-when-size, 12px);
        font-weight: var(--gt-when-weight, 600);
        color: var(--gt-when-color, #fff);
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
      }
      .which {
        font-weight: 500;
        opacity: 0.85;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dur {
        margin-left: auto;
        font-weight: 500;
        opacity: 0.85;
        font-variant-numeric: tabular-nums;
      }
      .hint {
        padding: 18px 8px;
        text-align: center;
        font-size: 13px;
        opacity: 0.7;
      }
      .ctl {
        min-width: 0;
      }
      .frame {
        container: camera / inline-size;
      }
    `,
    materials,
  ];
}

registerCard("glass-camera", GlassCamera, {
  requires: "WebRTC Camera",
  name: "Glass – camera",
  description: "Live picture and Frigate's recordings in one card: a tap plays a recording in place of live; the camera's light, night vision… under it.",
});
