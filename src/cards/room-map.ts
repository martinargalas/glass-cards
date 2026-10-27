import { locale, tr } from "../i18n";
import { css, html, nothing, svg, type PropertyValues } from "lit";
import { GlassElement } from "../core/glass-element";
import type { BaseCardConfig, HomeAssistant } from "../core/types";
import { registerCard } from "../core/registry";
import { makeEditor } from "../editor/editor";
import { roomMapSpec } from "../editor/specs";
import { control, surface } from "../core/styles";
import { haptic } from "../core/actions";
import { isDark } from "../core/settings";
import { cssColor } from "../core/colors";
import { materials, matTint, type Material } from "../core/materials";

/**
 * A robot's map: tap rooms (or lawn zones) on the map or in the list under it,
 * then clean / mow just those – or everything when none is picked.
 * The picked rooms live in the card only (no helpers in Home Assistant).
 *
 * Robot vacuum (Roomba+ `image.*_rooms_map`):
 *   type: custom:glass-room-map
 *   entity: vacuum.roomba
 *   map: image.roomba_rooms_map
 *   room_names: { Hallway: Chodba, Kitchen: Kuchyň }   # optional display names
 *   service: roomba_plus.clean_room                  # default; gets room_name: [..]
 *
 * Mammotion mower (zones from `mammotion.get_geojson` over a satellite picture):
 *   type: custom:glass-room-map
 *   entity: lawn_mower.luba
 *   tracker: device_tracker.luba                     # optional: the mower on the map
 *   room_names: { "Area 3": Za domem }               # optional display names
 *   tiles: cuzk                                      # optional: esri (default) | cuzk | a {z}/{y}/{x} URL
 *   settings:                                        # optional: set before mowing (the mower's number entities)
 *     angle: number.luba_cutting_path_angle          #   also previews the stripes in the picked zones
 *     height: number.luba_blade_height
 *     speed: number.luba_working_speed
 *     spacing: number.luba_path_spacing              #   only for the preview
 * While a job runs, its planned route and the part already mown are drawn too.
 *
 * Either kind can show choices under the map (select entities, as dropdowns):
 *   options:
 *     - { entity: select.roomba_carpet_boost_select, name: Sací výkon, icon: mdi:fan, option_names: { eco: Úsporný } }
 *
 * Look: accent_color (picked rooms, the mower, what's mown), own materials (core/materials) tinted by *_color –
 * settings_* (the setting bars, settings_fill_color their fill), options_* (the choices), rooms_* / picked_*
 * (the room pills), button_* (clean / mow). Text and icons of each part: fonts / icons (core/typography) –
 * map / map_on (the rooms' names, picked), room / room_on (the pills), setting, option_name, option, menu / menu_on,
 * button; icons: room, setting, steps (− / +), option, chevron, button.
 */
interface RoomMapConfig extends BaseCardConfig {
  entity: string;
  map?: string;
  tracker?: string;
  room_names?: Record<string, string>;
  service?: string;
  satellite?: boolean;
  /** vacuum: show the robot's own (dark) map picture instead of drawing the rooms */
  picture?: boolean;
  /** the aerial picture: `esri` (world), `cuzk` (Czech orthophoto, sharper) or a `{z}/{y}/{x}` URL */
  tiles?: string;
  max_zoom?: number;
  settings?: { angle?: string; height?: string; speed?: string; spacing?: string };
  /** where it works now – default `sensor.<name>_work_area` (mower) / `sensor.<name>_mission_progress` (its `current_room`) */
  current?: string;
  /** mower: charging (default `binary_sensor.<name>_charging`) – during a job, the button then resumes it */
  charging?: string;
  /** during a job, the values it mows with (default `sensor.<name>_blade_height` / `_mowing_speed`) */
  live?: { height?: string; speed?: string };
  options?: { entity: string; name?: string; icon?: string; option_names?: Record<string, string> }[];
  title?: string;
  accent_color?: string;
  settings_glass?: Material;
  settings_color?: string;
  settings_fill_color?: string;
  options_glass?: Material;
  options_color?: string;
  rooms_glass?: Material;
  rooms_color?: string;
  picked_glass?: Material;
  picked_color?: string;
  button_glass?: Material;
  button_color?: string;
}

const has = (v?: string) => !!v && v !== "none";
/** An element's own material (a colour alone tints the default one). */
function part(m: Material | undefined, color: string | undefined, def: Material) {
  const use = m ?? (has(color) ? def : undefined);
  return use ? { cls: `mat mat-${use}`, style: has(color) ? matTint(color) : "--mat-tint:initial;--mat-tinted:initial;--mat-sheen:initial" } : { cls: "", style: "" };
}

type Pt = [number, number];

interface Shape {
  /** what picking it passes on: the room name, or the zone's switch */
  key: string;
  name: string;
  /** the zone's own title (mower) */
  raw?: string;
  pts: Pt[];
}

/** The affine map from robot coordinates (mm) to image pixels, from three calibration points. */
function affine(points: { vacuum: { x: number; y: number }; map: { x: number; y: number } }[]): ((p: Pt) => Pt) | undefined {
  if (!points || points.length < 3) return undefined;
  const [a, b, c] = points;
  const det = a.vacuum.x * (b.vacuum.y - c.vacuum.y) - a.vacuum.y * (b.vacuum.x - c.vacuum.x) + (b.vacuum.x * c.vacuum.y - c.vacuum.x * b.vacuum.y);
  if (!det) return undefined;
  const solve = (k: "x" | "y") => {
    const [u, v, w] = [a.map[k], b.map[k], c.map[k]];
    const p = (u * (b.vacuum.y - c.vacuum.y) - a.vacuum.y * (v - w) + (v * c.vacuum.y - w * b.vacuum.y)) / det;
    const q = (a.vacuum.x * (v - w) - u * (b.vacuum.x - c.vacuum.x) + (b.vacuum.x * w - c.vacuum.x * v)) / det;
    const r = (a.vacuum.x * (b.vacuum.y * w - c.vacuum.y * v) - a.vacuum.y * (b.vacuum.x * w - c.vacuum.x * v) + u * (b.vacuum.x * c.vacuum.y - c.vacuum.x * b.vacuum.y)) / det;
    return [p, q, r];
  };
  const [px, qx, rx] = solve("x");
  const [py, qy, ry] = solve("y");
  return ([x, y]) => [px * x + qx * y + rx, py * x + qy * y + ry];
}

/* ---- the mower's lawn: GeoJSON in web-mercator "pixels" at zoom Z ---- */

const Z = 22;
const WORLD = 256 * 2 ** Z;
const merc = ([lon, lat]: Pt): Pt => {
  const s = Math.sin((lat * Math.PI) / 180);
  return [((lon + 180) / 360) * WORLD, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * WORLD];
};

interface Geo {
  type: string;
  features: { properties: Record<string, any>; geometry: { type: string; coordinates: any } }[];
}

const TILES: Record<string, { url: string; max: number }> = {
  esri: { url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", max: 18 },
  cuzk: { url: "https://ags.cuzk.gov.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer/tile/{z}/{y}/{x}", max: 20 },
};

/** Every line in a GeoJSON answer (routes, mown strips, outlines), whatever geometry carries it. */
function lines(g?: Geo): Pt[][] {
  const out: Pt[][] = [];
  for (const f of g?.features ?? []) {
    const { type, coordinates: c } = f.geometry ?? {};
    if (type === "LineString") out.push(c);
    else if (type === "MultiLineString" || type === "Polygon") out.push(...c);
    else if (type === "MultiPolygon") for (const p of c) out.push(...p);
  }
  return out.map((l) => l.map(merc));
}

const JOB_STATES = ["mowing", "paused", "returning"];

/** The zones a mow was started with (empty = all), kept per browser for the job's preview. */
interface JobZones {
  keys: string[];
  at: number;
  /** the job has been seen running (the integration reports it a minute or two late) */
  seen?: boolean;
}
const jobKey = (entity: string) => `glass-mow-zones:${entity}`;
function readJob(entity: string): JobZones | undefined {
  try {
    return JSON.parse(localStorage.getItem(jobKey(entity)) ?? "null") ?? undefined;
  } catch {
    return undefined;
  }
}
function writeJob(entity: string, j?: JobZones) {
  try {
    if (j) localStorage.setItem(jobKey(entity), JSON.stringify(j));
    else localStorage.removeItem(jobKey(entity));
  } catch {
    /* private mode: the preview just shows every zone */
  }
}

/** One fetch per mower and page load (the zones barely change); a failed one is retried on the next render. */
const geoCache = new Map<string, Promise<Geo | undefined>>();
function loadGeo(hass: HomeAssistant, entity: string): Promise<Geo | undefined> {
  let p = geoCache.get(entity);
  if (!p) {
    p = hass
      .callWS<{ response: Geo }>({
        type: "call_service",
        domain: "mammotion",
        service: "get_geojson",
        target: { entity_id: entity },
        return_response: true,
      })
      .then((r) => r.response)
      .catch(() => {
        geoCache.delete(entity);
        return undefined;
      });
    geoCache.set(entity, p);
  }
  return p!;
}

/** The roomiest point inside a polygon (and how far it is from the nearest edge): where its name fits best. */
function roomiest(pts: Pt[]): [number, number, number] {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of pts) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
  const inside = (x: number, y: number) => {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const edge = (x: number, y: number) => {
    let d = Infinity;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [ax, ay] = pts[j];
      const [bx, by] = pts[i];
      const [dx, dy] = [bx - ax, by - ay];
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      d = Math.min(d, Math.hypot(x - ax - t * dx, y - ay - t * dy));
    }
    return d;
  };
  let best: [number, number, number] = [(x0 + x1) / 2, (y0 + y1) / 2, 0];
  const n = 24;
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= n; j++) {
      const [x, y] = [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * j) / n];
      if (!inside(x, y)) continue;
      const d = edge(x, y);
      if (d > best[2]) best = [x, y, d];
    }
  return best;
}

class GlassRoomMap extends GlassElement<RoomMapConfig> {
  static override properties = {
    ...GlassElement.properties,
    _picked: { state: true },
    _size: { state: true },
    _geo: { state: true },
    _box: { state: true },
    _job: { state: true },
    _drag: { state: true },
    _zoom: { state: true },
    _pan: { state: true },
    _menu: { state: true },
  };
  declare _picked: string[];
  declare _size?: [number, number];
  declare _geo?: Geo;
  declare _box?: [number, number];
  /** the running job: its planned route and what is already mown */
  declare _job?: { route: Pt[][]; done: Pt[][] };
  /** settings being dragged (entity → value), sent when let go */
  declare _drag: Record<string, number>;
  /** the lawn map's zoom (1 = the whole lawn) and how far it is moved from the middle (map units) */
  declare _zoom: number;
  declare _pan: Pt;
  /** the open dropdown (its entity) */
  declare _menu?: string;
  /** the lawn map as last drawn: the whole view and the zoomed one */
  private _base?: [number, number, number, number];
  private _view?: [number, number, number, number];
  private _pointers = new Map<number, Pt>();
  private _moved = 0;
  private _dragEnd = 0;
  private _ro?: ResizeObserver;
  private _poll?: number;
  private _rep?: number;
  private _streamAt = 0;
  private _spots = new Map<string, [number, number, number]>();
  /** the dropdown just pressed: its chevron lit for a moment (touch screens show no :active) */
  private _hitDrop?: string;
  private _hitTimer?: number;
  /** values sent but not yet confirmed by the entity (entity → value, when) – shown meanwhile, so the bar doesn't jump back */
  private _pending = new Map<string, { v: number; at: number }>();

  constructor() {
    super();
    this._picked = [];
    this._drag = {};
    this._zoom = 1;
    this._pan = [0, 0];
  }

  static getConfigElement() {
    return makeEditor(roomMapSpec);
  }

  static getStubConfig(hass: HomeAssistant) {
    const map = Object.keys(hass.states).find((e) => e.startsWith("image.") && e.endsWith("_rooms_map"));
    const v = Object.keys(hass.states).find((e) => e.startsWith("vacuum."));
    return { entity: v ?? "", map: map ?? "" };
  }

  private get _lawn() {
    return this._config?.entity.startsWith("lawn_mower.");
  }

  protected override validateConfig(c: RoomMapConfig) {
    if (!c.entity) throw new Error("`entity` (vacuum or lawn_mower) is required");
    if (!c.entity.startsWith("lawn_mower.") && !c.map) throw new Error("`map` (image) is required for a vacuum");
    return c;
  }

  protected watchedEntities(c: RoomMapConfig) {
    return [c.entity, c.map, c.tracker, this._currentId(c), this._chargingId(c), ...Object.values(this._liveIds(c)), ...Object.values(c.settings ?? {}), ...(c.options ?? []).map((o) => o.entity)].filter(Boolean) as string[];
  }

  private _currentId(c: RoomMapConfig) {
    const obj = c.entity.split(".")[1];
    return c.current ?? (c.entity.startsWith("lawn_mower.") ? `sensor.${obj}_work_area` : `sensor.${obj}_mission_progress`);
  }

  private _chargingId(c: RoomMapConfig) {
    return c.entity.startsWith("lawn_mower.") ? (c.charging ?? `binary_sensor.${c.entity.split(".")[1]}_charging`) : undefined;
  }

  /** a job on, but the mower is charging in its dock: going on makes more sense than ending it */
  private _recharging() {
    const id = this._chargingId(this._config);
    return !!id && this._hass?.states[id]?.state === "on" && JOB_STATES.includes(this._hass?.states[this._config.entity]?.state ?? "");
  }

  private _liveIds(c: RoomMapConfig) {
    const obj = c.entity.split(".")[1];
    return c.entity.startsWith("lawn_mower.") ? { height: c.live?.height ?? `sensor.${obj}_blade_height`, speed: c.live?.speed ?? `sensor.${obj}_mowing_speed` } : {};
  }

  /** The room / zone it is working in right now (only while it works). */
  private _here(shapes: Shape[]): string | undefined {
    const hass = this._hass!;
    const st = hass.states[this._config.entity]?.state ?? "";
    if (!["cleaning", "mowing", "paused"].includes(st)) return undefined;
    const cur = hass.states[this._currentId(this._config)];
    if (!this._lawn) {
      const room = cur?.attributes.current_room as string | undefined;
      return room && shapes.some((s) => s.key === room) ? room : undefined;
    }
    // a zone's switch, by name: "<mower> Area Prostřední " – the trailing spaces as the mower has them
    const zone = (name: string) => {
      const n = name.trim();
      return shapes.find((s) => {
        const fn = String(hass.states[s.key]?.attributes.friendly_name ?? "").trim();
        const en = String((hass as any).entities?.[s.key]?.name ?? "").trim();
        return s.raw?.trim() === n || en === n || en === `Area ${n}` || fn.endsWith(` ${n}`);
      })?.key;
    };
    // where it is now – while out on the lawn
    const v = cur?.state;
    if (v && !["Not working", "path", "unknown", "unavailable"].includes(v)) {
      const k = zone(v);
      if (k) return k;
    }
    // else (charging in the middle of a job, say): the job's zone being mown
    for (const id of this._taskIds()) {
      const t = hass.states[id];
      if (t?.state !== "MOWING") continue;
      const m = String(t.attributes.friendly_name ?? "").match(/Task area (.*)$/);
      const k = m && zone(m[1]);
      if (k) return k;
    }
    return undefined;
  }

  /** The mower's per-zone job states (`sensor.…_task_area_…`), looked up now and then. */
  private _tasks?: { at: number; ids: string[] };
  private _taskIds() {
    const hass = this._hass!;
    if (!this._tasks || Date.now() - this._tasks.at > 60_000) {
      const name = String(hass.states[this._config.entity]?.attributes.friendly_name ?? "");
      const ids = Object.keys(hass.states).filter(
        (e) => e.startsWith("sensor.") && e.includes("_task_area_") && String(hass.states[e].attributes.friendly_name ?? "").startsWith(name),
      );
      this._tasks = { at: Date.now(), ids };
    }
    return this._tasks.ids;
  }

  private _taskSeen = new Map<string, unknown>();

  /** the task sensors come and go with the job: watched here, not in the config's list */
  protected override hassChanged(hass: HomeAssistant) {
    if (!this._config || !this._lawn) return;
    let changed = false;
    for (const id of this._taskIds()) {
      if (this._taskSeen.get(id) !== hass.states[id]) {
        this._taskSeen.set(id, hass.states[id]);
        changed = true;
      }
    }
    if (changed) this.requestUpdate();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._ro?.disconnect();
    this._ro = undefined;
    clearInterval(this._poll);
    this._poll = undefined;
  }

  /** The job's route and mown part – the integration only has them while a job is on. */
  private async _loadJob() {
    const hass = this._hass;
    if (!hass) return;
    const get = (service: string) =>
      hass
        .callWS<{ response: Geo }>({ type: "call_service", domain: "mammotion", service, target: { entity_id: this._config.entity }, return_response: true })
        .then((r) => r.response)
        .catch(() => undefined);
    // asking for the map keeps the mower's live report stream on (it lapses after 5 min): fresher position and progress
    if (Date.now() - this._streamAt > 4 * 60_000) {
      this._streamAt = Date.now();
      get("get_geojson").then((g) => g?.features?.length && (this._geo = g));
    }
    const [route, done] = await Promise.all([get("get_mow_path_geojson"), get("get_mow_progress_geojson")]);
    this._job = { route: lines(route), done: lines(done) };
  }

  override firstUpdated() {
    // a drag on the map or a setting is ours: a pop-up around (Bubble Card) must not move with it
    const stop = (e: Event) => {
      const path = e.composedPath();
      if (path.some((n) => n instanceof Element && (n.matches(".map.lawn svg") || n.classList.contains("tune")))) e.stopPropagation();
    };
    for (const t of ["pointerdown", "pointermove", "touchstart", "touchmove", "mousedown", "mousemove"]) this.renderRoot.addEventListener(t, stop);
  }

  protected override updated(changed: PropertyValues) {
    super.updated(changed);
    if (this._busy && this._picked.length) this._picked = [];
    if (this._lawn && !this._geo && this._hass) {
      loadGeo(this._hass, this._config.entity).then((g) => g && (this._geo = g));
    }
    // during a job: its route and progress, refreshed every half minute
    const job = this._lawn && JOB_STATES.includes(this._hass?.states[this._config.entity]?.state ?? "");
    if (job && !this._poll) {
      this._hass!.callService("mammotion", "fetch_mow_path", {}, { entity_id: this._config.entity }).catch(() => undefined);
      this._loadJob();
      this._poll = window.setInterval(() => this._loadJob(), 30_000);
    }
    // the zones of the job: kept while it runs, dropped once it is over (or never showed up)
    if (this._lawn) {
      const j = readJob(this._config.entity);
      if (j && job && !j.seen) writeJob(this._config.entity, { ...j, seen: true });
      else if (j && !job && (j.seen || Date.now() - j.at > 10 * 60_000)) writeJob(this._config.entity);
    }
    if (!job && this._poll) {
      clearInterval(this._poll);
      this._poll = undefined;
      this._job = undefined;
    }
    const map = this.renderRoot.querySelector(".map");
    if (map && !this._ro) {
      this._ro = new ResizeObserver(([e]) => {
        const { width, height } = e.contentRect;
        if (width && height) this._box = [width, height];
      });
      this._ro.observe(map);
    }
  }

  private _name(r: string) {
    return this._config.room_names?.[r] ?? r;
  }

  /** a job on (running, paused, on its way home): its zones are set – nothing more to pick */
  private get _busy() {
    return ["cleaning", "mowing", "paused", "returning"].includes(this._hass?.states[this._config.entity]?.state ?? "");
  }

  private _toggle(r: string) {
    if (this._busy) return;
    if (Date.now() - this._dragEnd < 300) return; // the end of a drag on the map, not a tap
    haptic("selection");
    this._picked = this._picked.includes(r) ? this._picked.filter((x) => x !== r) : [...this._picked, r];
  }

  private _clean() {
    const hass = this._hass!;
    const c = this._config;
    haptic();
    if (this._recharging()) {
      hass.callService("lawn_mower", "start_mowing", {}, { entity_id: c.entity });
      return;
    }
    if (this._lawn && JOB_STATES.includes(hass.states[c.entity]?.state ?? "")) {
      // during a job: end it and send the mower home
      hass
        .callService("mammotion", "cancel_job", {}, { entity_id: c.entity })
        .then(() => hass.callService("lawn_mower", "dock", {}, { entity_id: c.entity }));
      return;
    }
    if (this._lawn) {
      writeJob(c.entity, { keys: this._picked, at: Date.now() });
      if (this._picked.length) hass.callService("mammotion", "start_mow", { areas: this._picked }, { entity_id: c.entity });
      else hass.callService("lawn_mower", "start_mowing", {}, { entity_id: c.entity });
    } else if (!this._picked.length) {
      hass.callService("vacuum", "start", { entity_id: c.entity });
    } else {
      const [domain, service] = (c.service ?? "roomba_plus.clean_room").split(".");
      hass.callService(domain, service, { room_name: this._picked, ordered: true }, { entity_id: c.entity });
    }
    this._picked = [];
  }

  /** Rooms from the Roomba+ map picture, in its pixels. */
  private _rooms() {
    const img = this._hass!.states[this._config.map!];
    const rooms: Record<string, { outline?: Pt[] }> = img?.attributes.rooms ?? {};
    const tf = affine(img?.attributes.calibration_points);
    const [w, h] = this._size ?? [0, 0];
    const shapes: Shape[] = Object.keys(rooms).map((r) => ({ key: r, name: this._name(r), pts: tf && rooms[r].outline ? rooms[r].outline!.map(tf) : [] }));
    return { shapes, view: tf && w ? ([0, 0, w, h] as const) : undefined, url: img?.attributes.entity_picture as string | undefined };
  }

  /** Zones of the lawn: each one picked through its area switch (matched by the zone's hash). */
  private _zones() {
    const hass = this._hass!;
    const feats = this._geo?.features ?? [];
    const switches = Object.keys(hass.states).filter((e) => e.startsWith("switch.") && hass.states[e].attributes.hash != null);
    const ring = (f: (typeof feats)[number]) => (f.geometry.type === "Polygon" ? (f.geometry.coordinates[0] as Pt[]).map(merc) : []);
    const shapes: Shape[] = [];
    for (const f of feats) {
      if (f.properties.type_name !== "area") continue;
      const sw = switches.find((e) => hass.states[e].attributes.hash === f.properties.hash);
      if (sw) {
        const raw = String(f.properties.title ?? "").trim();
        shapes.push({ key: sw, name: this._name(raw), raw, pts: ring(f) });
      }
    }
    shapes.sort((a, b) => a.name.localeCompare(b.name, locale()));
    const obstacles = feats.filter((f) => f.properties.type_name === "obstacle").map(ring);
    const paths = feats.filter((f) => f.geometry.type === "LineString").map((f) => (f.geometry.coordinates as Pt[]).map(merc));
    const dock = feats.find((f) => f.properties.type_name === "station" && /dock/i.test(f.properties.title ?? ""));
    const tr = this._config.tracker ? hass.states[this._config.tracker]?.attributes : undefined;
    const mower = tr?.latitude != null ? merc([tr.longitude, tr.latitude]) : undefined;
    const lat = (feats.find((f) => f.properties.type_name === "area")?.geometry.coordinates[0]?.[0]?.[1] as number) ?? 50;
    const perMetre = WORLD / (2 * Math.PI * 6378137 * Math.cos((lat * Math.PI) / 180));
    return { shapes, obstacles, paths, dock: dock ? merc(dock.geometry.coordinates) : undefined, mower, perMetre };
  }

  /** The lawn's bounds, widened to the card's shape so the picture fills it edge to edge. */
  private _lawnView(shapes: Shape[]): [number, number, number, number] | undefined {
    const all = shapes.flatMap((s) => s.pts);
    if (!all.length || !this._box) return undefined;
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of all) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
    const pad = Math.max(x1 - x0, y1 - y0) * 0.06;
    let [w, h] = [x1 - x0 + 2 * pad, y1 - y0 + 2 * pad];
    const [bw, bh] = this._box;
    if (w / h < bw / bh) w = (h * bw) / bh;
    else h = (w * bh) / bw;
    return [(x0 + x1 - w) / 2, (y0 + y1 - h) / 2, w, h];
  }

  /** Esri satellite tiles under the view, at the zoom closest to the screen's own sharpness (drawn from the view's corner). */
  private _tiles([vx, vy, vw, vh]: [number, number, number, number]) {
    const dpr = window.devicePixelRatio || 1;
    const want = Math.round(Z - Math.log2(vw / (this._box![0] * dpr)));
    const src = TILES[this._config.tiles ?? "esri"] ?? { url: this._config.tiles!, max: 19 };
    const top = this._config.max_zoom ?? src.max;
    // closer than the photo is sharp: no photo, just the lawn
    if (want > top + 1) return undefined;
    const tz = Math.max(12, Math.min(top, want));
    const span = 256 * 2 ** (Z - tz);
    const out = [];
    for (let ty = Math.floor(vy / span); ty * span < vy + vh; ty++)
      for (let tx = Math.floor(vx / span); tx * span < vx + vw; tx++)
        out.push(
          svg`<image href=${src.url.replace("{z}", String(tz)).replace("{y}", String(ty)).replace("{x}", String(tx))} x=${tx * span - vx} y=${ty * span - vy} width=${span + span / 256} height=${span + span / 256} preserveAspectRatio="none"></image>`,
        );
    return out;
  }

  private _num(id?: string, live?: string) {
    if (id && id in this._drag) return this._drag[id];
    // during a job: what it really mows with, once the mower has reported it
    const lv = live ? parseFloat(this._hass?.states[live]?.state ?? "") : NaN;
    const v = Number.isFinite(lv) && lv > 0 ? lv : id ? Number(this._hass?.states[id]?.state) : NaN;
    const p = id ? this._pending.get(id) : undefined;
    if (p) {
      if (Math.abs(p.v - v) > 1e-6 && Date.now() - p.at < 8000) return p.v;
      this._pending.delete(id!);
    }
    return Number.isFinite(v) ? v : undefined;
  }

  /** One setting: a bar to drag (filled to the value, as on the lights) with − and + at its ends. */
  private _step(
    id: string | undefined,
    icon: string,
    label: string,
    step: number,
    fmt: (v: number) => string,
    wrap = false,
    snap = 0,
    o: { live?: string; locked?: number; lockedLabel?: string } = {},
  ) {
    const st = id ? this._hass!.states[id] : undefined;
    const v = o.locked ?? this._num(id, o.live);
    if (!id || !st || v === undefined) return nothing;
    if (o.locked !== undefined) {
      // can't be changed now: the value alone, its buttons out
      const min = Number(st.attributes.min ?? 0);
      const max = Number(st.attributes.max ?? 100);
      const m = part(this._config.settings_glass, this._config.settings_color, "home");
      return html`<div class="step locked ${m.cls}" title=${o.lockedLabel ?? label} style="${m.style};--pct:${((v - min) / (max - min || 1)) * 100}">
        <i class="sfill"></i>
        <button aria-label="−" disabled><ha-icon icon="mdi:minus"></ha-icon></button>
        <span class="sv"><ha-icon icon="mdi:lock-outline"></ha-icon>${fmt(v)}</span>
        <button aria-label="+" disabled><ha-icon icon="mdi:plus"></ha-icon></button>
      </div>`;
    }
    const min = Number(st.attributes.min ?? 0);
    const max = Number(st.attributes.max ?? 100);
    const fine = Number(st.attributes.step) || step;
    const clamp = (n: number) => Math.min(max, Math.max(min, Number(n.toFixed(2))));
    const send = (n: number) => {
      if (n === Number(st.state)) return;
      this._pending.set(id, { v: n, at: Date.now() });
      this._hass!.callService("number", "set_value", { value: n }, { entity_id: id }).catch(() => this._pending.delete(id));
      // if the entity never confirms, fall back to its value once the wait is over
      window.setTimeout(() => this.requestUpdate(), 8100);
    };
    // − / +: a step per tap; held, it keeps stepping (shown at once, sent when let go)
    const nudge = (d: number) => {
      const cur = this._num(id, o.live)!;
      let n = Math.round((cur + d) / step) * step;
      if (wrap) n = n > max ? n - 360 : n < min ? n + 360 : n;
      n = clamp(n);
      if (n === cur) return;
      haptic("selection");
      this._drag = { ...this._drag, [id]: n };
    };
    const hold = (d: number) => (e: PointerEvent) => {
      clearTimeout(this._rep);
      clearInterval(this._rep);
      if (e.type === "pointerdown") {
        nudge(d);
        this._rep = window.setTimeout(() => (this._rep = window.setInterval(() => nudge(d), 70)), 400);
        return;
      }
      if (!(id in this._drag)) return;
      const { [id]: last, ...rest } = this._drag;
      this._drag = rest;
      send(last);
    };
    const slide = (e: PointerEvent) => {
      const el = e.currentTarget as HTMLElement;
      if (e.type === "pointerdown") el.setPointerCapture(e.pointerId);
      else if (!el.hasPointerCapture(e.pointerId)) return;
      // measured on the whole bar, as its fill is
      const r = el.parentElement!.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      let n = clamp(Math.round((min + f * (max - min)) / fine) * fine);
      // the angle clicks to whole 15° when let go near them
      if (snap && Math.abs(n - Math.round(n / snap) * snap) <= snap / 5) n = Math.round(n / snap) * snap;
      if (e.type === "pointerup" || e.type === "pointercancel") {
        el.releasePointerCapture(e.pointerId);
        const { [id]: last, ...rest } = this._drag;
        this._drag = rest;
        if (e.type === "pointerup") send(last ?? n);
        return;
      }
      if (this._drag[id] !== n) {
        if (id in this._drag) haptic("selection");
        this._drag = { ...this._drag, [id]: n };
      }
    };
    const pct = ((v - min) / (max - min || 1)) * 100;
    const m = part(this._config.settings_glass, this._config.settings_color, "home");
    return html`<div class="step ${id in this._drag ? "drag" : ""} ${m.cls}" title=${label} style="${m.style};--pct:${pct}">
      <i class="sfill"></i>
      <button aria-label="−" @pointerdown=${hold(-step)} @pointerup=${hold(-step)} @pointercancel=${hold(-step)} @pointerleave=${hold(-step)}><ha-icon icon="mdi:minus"></ha-icon></button>
      <span class="sv" @pointerdown=${slide} @pointermove=${slide} @pointerup=${slide} @pointercancel=${slide}>
        <ha-icon .icon=${icon}></ha-icon>${fmt(v)}
      </span>
      <button aria-label="+" @pointerdown=${hold(step)} @pointerup=${hold(step)} @pointercancel=${hold(step)} @pointerleave=${hold(step)}><ha-icon icon="mdi:plus"></ha-icon></button>
    </div>`;
  }

  private _outside = (e: Event) => {
    if (!e.composedPath().includes(this)) this._open(undefined);
  };

  private _open(entity: string | undefined) {
    this._menu = entity;
    if (entity === undefined) document.removeEventListener("pointerdown", this._outside, true);
    else document.addEventListener("pointerdown", this._outside, true);
  }

  /** One choice: a pill with its value and a chevron; the menu opens upwards. */
  private _option(o: NonNullable<RoomMapConfig["options"]>[number]) {
    const st = this._hass!.states[o.entity];
    const options: string[] = st?.attributes.options ?? [];
    if (!st || !options.length) return nothing;
    const name = (v: string) => o.option_names?.[v] ?? v;
    const open = this._menu === o.entity;
    const m = part(this._config.options_glass, this._config.options_color, "home");
    return html`<div class="drop-wrap">
      <button
        class="step drop ${m.cls}"
        style=${m.style}
        aria-haspopup="listbox"
        aria-expanded=${open ? "true" : "false"}
        @click=${() => {
          this._hitDrop = o.entity;
          clearTimeout(this._hitTimer);
          this._hitTimer = window.setTimeout(() => ((this._hitDrop = undefined), this.requestUpdate()), 260);
          this._open(open ? undefined : o.entity);
        }}
      >
        ${o.icon ? html`<ha-icon class="dico" .icon=${o.icon}></ha-icon>` : nothing}
        <span class="dwords">
          ${o.name ? html`<span class="dname">${o.name}</span>` : nothing}
          <span class="dval">${name(st.state)}</span>
        </span>
        <span class="chev ${open ? "open" : ""} ${this._hitDrop === o.entity ? "hit" : ""}"><ha-icon icon="mdi:chevron-down"></ha-icon></span>
      </button>
      ${open
        ? html`<div class="menu" role="listbox">
            ${options.map(
              (v) => html`<button
                role="option"
                aria-selected=${v === st.state ? "true" : "false"}
                class=${v === st.state ? "cur" : ""}
                @click=${() => {
                  haptic("selection");
                  this._hass!.callService(o.entity.split(".")[0], "select_option", { entity_id: o.entity, option: v });
                  this._open(undefined);
                }}
              >
                <span>${name(v)}</span>${v === st.state ? html`<ha-icon icon="mdi:check"></ha-icon>` : nothing}
              </button>`,
            )}
          </div>`
        : nothing}
    </div>`;
  }

  /** Stripes at the set angle across the zones about to be mown, drawn as the Mammotion app previews them:
   *  as the Mammotion app previews it: a compass bearing of the angle + 90° (78° ≈ north–south,
   *  leaning to the west) – checked on a route started from here (16. 10.: 78° → route at a bearing of 168°). */
  private _stripes(target: Shape[], unit: number, perMetre: number) {
    const a = this._num(this._config.settings?.angle);
    const all = target.flatMap((s) => s.pts);
    if (a === undefined || !all.length) return nothing;
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of all) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
    const [cx, cy, half] = [(x0 + x1) / 2, (y0 + y1) / 2, Math.hypot(x1 - x0, y1 - y0) / 2];
    const r = ((a + 90) * Math.PI) / 180; // the app's angle as a compass bearing
    const [dx, dy] = [Math.sin(r), -Math.cos(r)]; // screen y points down
    const [nx, ny] = [-dy, dx];
    const real = ((this._num(this._config.settings?.spacing) ?? 25) / 100) * perMetre;
    const gap = real * Math.max(1, Math.ceil((7 * unit) / real)); // the real spacing, thinned out to stay readable
    const ls = [];
    for (let k = -Math.floor(half / gap) * gap; k <= half; k += gap) {
      const [px, py] = [cx + nx * k, cy + ny * k];
      ls.push(svg`<line x1=${px - dx * half} y1=${py - dy * half} x2=${px + dx * half} y2=${py + dy * half}></line>`);
    }
    const ring = (p: Pt[]) => p.map((q) => q.map((v) => v.toFixed(1)).join(",")).join(" ");
    return svg`<clipPath id="mow-zones">${target.map((s) => svg`<polygon points=${ring(s.pts)}></polygon>`)}</clipPath>
      <g class="stripes" clip-path="url(#mow-zones)">${ls}</g>`;
  }

  /** The zones of the running job (from when it was started here); empty = all. */
  private _jobKeys(): string[] | undefined {
    const st = this._hass!.states[this._config.entity]?.state ?? "";
    const j = readJob(this._config.entity);
    return JOB_STATES.includes(st) || (j && !j.seen) ? (j?.keys ?? []) : undefined;
  }

  /** The base view zoomed in and moved. */
  private _zoomed([x, y, w, h]: [number, number, number, number]): [number, number, number, number] {
    const [zw, zh] = [w / this._zoom, h / this._zoom];
    return [x + w / 2 + this._pan[0] - zw / 2, y + h / 2 + this._pan[1] - zh / 2, zw, zh];
  }

  /** Zoom by `f` keeping the map point under (px, py) on screen where it is. */
  private _zoomAt(px: number, py: number, f: number) {
    const base = this._base;
    const view = this._view;
    const r = this.renderRoot.querySelector(".map")?.getBoundingClientRect();
    if (!base || !view || !r) return;
    const z = Math.min(80, Math.max(1, this._zoom * f));
    if (z === this._zoom) return;
    const [fx, fy] = [(px - r.left) / r.width, (py - r.top) / r.height];
    const [ux, uy] = [view[0] + fx * view[2], view[1] + fy * view[3]];
    const [w, h] = [base[2] / z, base[3] / z];
    this._zoom = z;
    this._pan = z === 1 ? [0, 0] : [ux - fx * w + w / 2 - (base[0] + base[2] / 2), uy - fy * h + h / 2 - (base[1] + base[3] / 2)];
  }

  private _wheel(e: WheelEvent) {
    e.preventDefault();
    this._zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
  }

  /** One finger moves the zoomed map, two pinch it. */
  private _point(e: PointerEvent) {
    const p: Pt = [e.clientX, e.clientY];
    if (e.type === "pointerdown") {
      this._pointers.set(e.pointerId, p);
      if (this._pointers.size === 1) this._moved = 0;
      return;
    }
    const prev = this._pointers.get(e.pointerId);
    if (!prev) return;
    if (e.type !== "pointermove") {
      this._pointers.delete(e.pointerId);
      if (this._moved > 6) this._dragEnd = Date.now();
      return;
    }
    const pts = [...this._pointers.values()];
    this._pointers.set(e.pointerId, p);
    if (pts.length === 2) {
      const other = pts.find((q) => q !== prev)!;
      const d0 = Math.hypot(prev[0] - other[0], prev[1] - other[1]);
      const d1 = Math.hypot(p[0] - other[0], p[1] - other[1]);
      this._moved += 10;
      if (d0 > 0) this._zoomAt((p[0] + other[0]) / 2, (p[1] + other[1]) / 2, d1 / d0);
      return;
    }
    const [dx, dy] = [p[0] - prev[0], p[1] - prev[1]];
    this._moved += Math.abs(dx) + Math.abs(dy);
    if (this._zoom === 1 || this._moved <= 6 || !this._view || !this._box) return;
    const unit = this._view[2] / this._box[0];
    this._pan = [this._pan[0] - dx * unit, this._pan[1] - dy * unit];
  }

  /** The running job's angle, read off its route, as the app numbers it (bearing − 90°; checked 16. 10.: set 78°, route at 168°). */
  private _routeAngle(): number | undefined {
    const route = this._job?.route;
    if (!route?.length) return undefined;
    const bins = new Array(180).fill(0);
    for (const line of route)
      for (let i = 1; i < line.length; i++) {
        // web-mercator points (x east, y down – already true to shape): north is −y
        const dx = line[i][0] - line[i - 1][0];
        const dn = line[i - 1][1] - line[i][1];
        const len = Math.hypot(dx, dn);
        if (!len) continue;
        bins[Math.round((((Math.atan2(dx, dn) * 180) / Math.PI) % 180) + 180) % 180] += len;
      }
    // smoothed over ±2°: a route's lines wobble a little
    let best = -1;
    let at = 0;
    for (let a = 0; a < 180; a++) {
      let sum = 0;
      for (let d = -2; d <= 2; d++) sum += bins[(a + d + 180) % 180];
      if (sum > best) [best, at] = [sum, a];
    }
    return best > 0 ? (at + 90) % 180 : undefined;
  }

  /** The zones the stripes preview: during a job the ones it was started with, else the picked ones (none picked = all). */
  private _mowing(shapes: Shape[]) {
    const keys = this._jobKeys() ?? this._picked;
    return keys.length ? shapes.filter((s) => keys.includes(s.key)) : shapes;
  }

  /** The names on the map, each in its roomiest spot – left out where it wouldn't fit. `unit`: map units per screen pixel. */
  private _labels(shapes: Shape[], unit: number) {
    return svg`<g class="labels">${shapes.map((s) => {
      if (s.pts.length < 3 || !s.name) return nothing;
      // kept relative to the first corner: the lawn's shapes only move (zoom, pan), so one search per shape will do
      const [px, py] = s.pts[0];
      const ck = `${s.key}|${s.pts.length}|${(s.pts[1][0] - px).toFixed(2)}|${(s.pts[1][1] - py).toFixed(2)}`;
      let rel = this._spots.get(ck);
      if (!rel) {
        const [bx, by, bd] = roomiest(s.pts);
        rel = [bx - px, by - py, bd];
        this._spots.set(ck, rel);
      }
      const [x, y, d] = [rel[0] + px, rel[1] + py, rel[2]];
      const r = d / unit; // room around the spot, in screen pixels
      if (r < 9 || r * 2.6 < s.name.length * 7) return nothing;
      return svg`<text x=${x} y=${y} font-size=${12 * unit} stroke-width=${3 * unit} class="${this._picked.includes(s.key) ? "on" : ""} ${this._cur === s.key ? "cur" : ""}">${s.name}</text>`;
    })}</g>`;
  }

  /** the room / zone it works in now: marked on the map and its pill */
  private _cur?: string;

  private _poly(s: Shape) {
    if (!s.pts.length) return nothing;
    const pts = s.pts.map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" ");
    return svg`<polygon class="room ${this._picked.includes(s.key) ? "on" : ""} ${this._cur === s.key ? "cur" : ""}" points=${pts} @click=${() => this._toggle(s.key)}><title>${s.name}</title></polygon>`;
  }

  protected override render() {
    const c = this._config;
    const hass = this._hass;
    if (!c || !hass) return nothing;
    this.toggleAttribute("dark", isDark(hass, this));
    const st = hass.states[c.entity]?.state;
    const lawn = this._lawn;
    const job = lawn && JOB_STATES.includes(st ?? "");
    const busy = st === "cleaning" || st === "returning";

    let shapes: Shape[];
    let map;
    if (lawn) {
      const z = this._zones();
      // the whole lawn – or, during a job started here with some zones, just those – then zoomed
      const jk = this._jobKeys();
      const focus = jk?.length ? z.shapes.filter((s) => jk.includes(s.key)) : z.shapes;
      const base = this._lawnView(focus.length ? focus : z.shapes);
      const view = base && this._zoomed(base);
      this._base = base;
      this._view = view;
      // drawn from the view's corner: the browser draws SVG in single precision, which the raw mercator numbers outrun
      const [ox, oy] = view ?? [0, 0];
      const at = ([x, y]: Pt): Pt => [x - ox, y - oy];
      shapes = z.shapes.map((s) => ({ ...s, pts: s.pts.map(at) }));
      this._cur = this._here(shapes);
      const unit = view ? view[2] / this._box![0] : 1; // map units per screen pixel
      const line = (pts: Pt[]) => pts.map((p) => at(p).map((v) => v.toFixed(1)).join(",")).join(" ");
      const dock = z.dock && at(z.dock);
      const mower = z.mower && at(z.mower);
      const tiles = c.satellite === false || !view ? undefined : this._tiles(view);
      map = view
        ? html`<svg
              class=${tiles ? "" : "plain"}
              viewBox="0 0 ${view[2]} ${view[3]}"
              preserveAspectRatio="xMidYMid slice"
              @wheel=${(e: WheelEvent) => this._wheel(e)}
              @pointerdown=${(e: PointerEvent) => this._point(e)}
              @pointermove=${(e: PointerEvent) => this._point(e)}
              @pointerup=${(e: PointerEvent) => this._point(e)}
              @pointercancel=${(e: PointerEvent) => this._point(e)}
            >
              ${tiles ?? nothing}
            ${shapes.map((s) => this._poly(s))}
            ${z.obstacles.map((o) => (o.length ? svg`<polygon class="obstacle" points=${line(o)}></polygon>` : nothing))}
            ${z.paths.map((p) => svg`<polyline class="path" points=${line(p)}></polyline>`)}
            ${this._job?.route.length
              ? svg`${this._job.done.map((p) => svg`<polyline class="done" stroke-width=${((this._num(c.settings?.spacing) ?? 25) / 100) * z.perMetre} points=${line(p)}></polyline>`)}
                  ${this._job.route.map((p) => svg`<polyline class="route" points=${line(p)}></polyline>`)}`
              : this._stripes(this._mowing(shapes), unit, z.perMetre)}
            ${this._labels(shapes, unit)}
            ${dock ? svg`<circle class="dock" cx=${dock[0]} cy=${dock[1]} r=${5 * unit}></circle>` : nothing}
            ${mower ? svg`<circle class="mower" cx=${mower[0]} cy=${mower[1]} r=${7 * unit}></circle>` : nothing}
          </svg>
          ${this._zoom > 1
            ? html`<button class="reset" aria-label=${tr("Whole lawn")} @click=${() => ((this._zoom = 1), (this._pan = [0, 0]))}>
                <ha-icon icon="mdi:arrow-collapse-all"></ha-icon>
              </button>`
            : nothing}`
        : html`<div class="empty">${this._geo ? (tr("No map yet")) : tr("Loading the map…")}</div>`;
    } else {
      const r = this._rooms();
      shapes = r.shapes;
      this._cur = this._here(shapes);
      const drawn = shapes.flatMap((s) => s.pts);
      if (!c.picture && drawn.length) {
        // the rooms drawn in the card's own colours – the robot's picture is dark and can't be recoloured
        let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
        for (const [x, y] of drawn) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
        const pad = Math.max(x1 - x0, y1 - y0) * 0.04;
        const [vw, vh] = [x1 - x0 + 2 * pad, y1 - y0 + 2 * pad];
        const unit = this._box ? Math.max(vw / this._box[0], vh / this._box[1]) : vw / 600;
        map = html`<svg class="plain" viewBox="${x0 - pad} ${y0 - pad} ${vw} ${vh}" preserveAspectRatio="xMidYMid meet">
          ${shapes.map((s) => this._poly(s))} ${this._labels(shapes, unit)}
        </svg>`;
      } else map = html`${r.url
        ? html`<img
            src=${r.url}
            alt=""
            @load=${(e: Event) => {
              const i = e.target as HTMLImageElement;
              this._size = [i.naturalWidth, i.naturalHeight];
            }}
          />`
        : html`<div class="empty">${tr("No map yet")}</div>`}
      ${r.view
        ? html`<svg viewBox=${r.view.join(" ")} preserveAspectRatio="xMidYMid meet">
            ${shapes.map((s) => this._poly(s))}
            ${this._labels(shapes, this._box ? Math.max(r.view[2] / this._box[0], r.view[3] / this._box[1]) : 1)}
          </svg>`
        : nothing}`;
    }

    const n = this._picked.length;
    const recharging = this._recharging();
    const label = recharging
      ? tr("Continue")
      : job
      ? tr("End and dock")
      : lawn
      ? n
        ? tr("Mow selected ({n})", { n })
        : tr("Mow all")
      : n
        ? tr("Clean selected ({n})", { n })
        : tr("Clean all");
    const t = c.settings;
    const lv = this._liveIds(c);
    // the running job's angle can't be changed: shown as its route runs, else as set
    // the route's own direction wobbles a degree or two: within 5° of the set value it is the set value
    const routeA = job ? this._routeAngle() : undefined;
    const setA = this._num(t?.angle);
    const near = routeA !== undefined && setA !== undefined && Math.abs(((routeA - setA + 270) % 180) - 90) <= 5;
    const jobAngle = job ? (near ? setA : (routeA ?? setA)) : undefined;
    const pill = part(c.rooms_glass, c.rooms_color, "home");
    const picked = part(c.picked_glass, c.picked_color, "frosted");
    const go = part(c.button_glass, c.button_color, "dark");
    const look = `${has(c.accent_color) ? `--rm-accent:${cssColor(c.accent_color)};` : ""}${has(c.settings_fill_color) ? `--rm-fill:${cssColor(c.settings_fill_color)};` : ""}`;
    return html`<div class="wrap ${this.tile}" style=${look}>
      <div class="map ${lawn ? "lawn" : c.picture ? "" : "rooms-drawn"} ${this._busy ? "busy" : ""}">${map}</div>
      ${c.options?.length ? html`<div class="tune">${c.options.map((o) => this._option(o))}</div>` : nothing}
      ${lawn && t
        ? html`<div class="tune">
            ${this._step(t.angle, "mdi:angle-acute", tr("Mowing angle"), 1, (v) => `${Math.round(v)}°`, true, 0, {
              locked: jobAngle,
              lockedLabel: tr("Mowing angle – can't be changed while mowing"),
            })}
            ${this._step(t.height, "mdi:arrow-collapse-vertical", tr("Cutting height"), 5, (v) => `${Math.round(v)} mm`, false, 0, { live: job ? lv.height : undefined })}
            ${this._step(t.speed, "mdi:speedometer", tr("Speed"), 0.1, (v) => `${v.toFixed(1)} m/s`, false, 0, { live: job ? lv.speed : undefined })}
          </div>`
        : nothing}
      <div class="rooms">
        <div class="pills">
        ${shapes.map(
          (s) => html`<button
            class="room-pill ${this._picked.includes(s.key) ? `on ${picked.cls}` : pill.cls} ${this._cur === s.key ? "cur" : ""}"
            style=${this._picked.includes(s.key) ? picked.style : pill.style}
            ?disabled=${this._busy} @click=${() => this._toggle(s.key)}>
            ${this._picked.includes(s.key) ? html`<span class="n">${this._picked.indexOf(s.key) + 1}</span>` : nothing}${this._cur === s.key ? html`<ha-icon class="here" icon=${this._lawn ? "mdi:robot-mower" : "mdi:robot-vacuum"}></ha-icon>` : nothing}${s.name}
          </button>`,
        )}
        </div>
        <button class="go ${go.cls}" style=${go.style} ?disabled=${busy} @click=${() => this._clean()}>
          <ha-icon .icon=${job && !recharging ? "mdi:home-import-outline" : "mdi:play"}></ha-icon>
          <span>${label}</span>
        </button>
      </div>
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
        height: 100%;
        container: map / inline-size;
        /* the drawn floors, the names' halo, the settings' buttons – by day */
        --map-floor: rgba(255, 255, 255, 0.55);
        --map-lawn: rgba(255, 255, 255, 0.45);
        --map-halo: rgba(255, 255, 255, 0.85);
        --map-button: rgba(255, 255, 255, 0.55);
        --map-photo: none;
      }
      /* by night: dim floors, light names on a dark halo, the photo toned down */
      :host([dark]) {
        --map-floor: rgba(255, 255, 255, 0.13);
        --map-lawn: rgba(255, 255, 255, 0.12);
        --map-halo: rgba(0, 0, 0, 0.6);
        --map-button: rgba(255, 255, 255, 0.16);
        --map-photo: brightness(0.72) saturate(0.9);
      }
      .lawn svg image {
        filter: var(--map-photo);
      }
      .wrap {
        height: 100%;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .map {
        position: relative;
        flex: 1;
        min-height: 0;
        border-radius: 22px;
        overflow: hidden;
        display: grid;
        /* one cell as big as the free space – the picture and its rooms fit into it together */
        grid-template: minmax(0, 1fr) / minmax(0, 1fr);
      }
      .map img,
      .map svg {
        grid-area: 1 / 1;
        width: 100%;
        height: 100%;
        min-width: 0;
        min-height: 0;
        object-fit: contain;
      }
      .map.lawn {
        background: var(--glass-home-control, rgba(118, 118, 128, 0.16));
      }
      .empty {
        place-self: center;
        color: var(--glass-home-text-2, rgba(60, 60, 67, 0.68));
        font-size: 14px;
      }
      /* the rooms on the map: invisible until picked, a hint of colour on hover */
      .room {
        fill: transparent;
        stroke: transparent;
        stroke-width: 6;
        cursor: pointer;
        transition: fill 0.2s ease;
      }
      .busy .room {
        cursor: default;
      }
      .room:hover {
        fill: color-mix(in srgb, var(--rm-accent, var(--glass-color-orange, #ff9f0a)) 18%, transparent);
      }
      .room.on {
        fill: color-mix(in srgb, var(--rm-accent, var(--glass-color-orange, #ff9f0a)) 38%, transparent);
        stroke: var(--rm-accent, var(--glass-color-orange, #ff9f0a));
      }
      /* the lawn's zones sit on a photo: always outlined, so they can be found */
      .lawn .room {
        fill: rgba(255, 255, 255, 0.08);
        stroke: rgba(255, 255, 255, 0.7);
        stroke-width: 1.5;
        vector-effect: non-scaling-stroke;
      }
      .lawn .room.on {
        fill: color-mix(in srgb, var(--rm-accent, var(--glass-color-orange, #ff9f0a)) 38%, transparent);
        stroke: var(--rm-accent, var(--glass-color-orange, #ff9f0a));
        stroke-width: 2.5;
      }
      /* zoomed past the photo (or no photo): the lawn alone, drawn in the text colours */
      .lawn .plain .room {
        fill: var(--map-lawn);
        stroke: var(--glass-home-text-2, rgba(60, 60, 67, 0.68));
      }
      .lawn .plain .room.on {
        fill: color-mix(in srgb, var(--rm-accent, var(--glass-color-orange, #ff9f0a)) 30%, transparent);
        stroke: var(--rm-accent, var(--glass-color-orange, #ff9f0a));
      }
      .lawn .plain .stripes line,
      .lawn .plain .route,
      .lawn .plain .path {
        stroke: var(--glass-home-text-2, rgba(60, 60, 67, 0.68));
      }
      .lawn svg {
        touch-action: none;
      }
      /* back to the whole lawn: the dark glass of the other controls */
      .reset {
        position: absolute;
        top: 10px;
        right: 10px;
        width: 36px;
        height: 36px;
        padding: 0;
        border-radius: 50%;
        display: grid;
        place-items: center;
        color: #fff;
        background: var(--glass-control-bg);
        box-shadow: var(--glass-control-shadow);
        -webkit-backdrop-filter: var(--glass-control-backdrop, none);
        backdrop-filter: var(--glass-control-backdrop, none);
      }
      .reset ha-icon {
        --mdc-icon-size: 18px;
        display: flex;
      }
      /* the vacuum's rooms, drawn: light floors with an outline, the picked ones orange */
      .rooms-drawn .room {
        fill: var(--map-floor);
        stroke: var(--glass-home-text-2, rgba(60, 60, 67, 0.68));
        stroke-width: 1.5;
        stroke-linejoin: round;
        vector-effect: non-scaling-stroke;
      }
      .rooms-drawn .room:hover {
        fill: color-mix(in srgb, var(--rm-accent, var(--glass-color-orange, #ff9f0a)) 14%, var(--map-floor));
      }
      .rooms-drawn .room.on {
        fill: color-mix(in srgb, var(--rm-accent, var(--glass-color-orange, #ff9f0a)) 38%, transparent);
        stroke: var(--rm-accent, var(--glass-color-orange, #ff9f0a));
        stroke-width: 2.5;
      }
      /* where it works now: the accent's outline, drawn over the zone (picked or not) */
      .room.cur,
      .lawn .room.cur,
      .lawn .plain .room.cur,
      .rooms-drawn .room.cur {
        stroke: var(--rm-accent, var(--glass-color-orange, #ff9f0a));
        stroke-width: 3;
        vector-effect: non-scaling-stroke;
      }
      .room.cur:not(.on) {
        fill: color-mix(in srgb, var(--rm-accent, var(--glass-color-orange, #ff9f0a)) 16%, transparent);
      }
      /* the names: dark text with a light halo, so they read on a photo too */
      .labels text {
        fill: var(--gt-map-color, var(--glass-home-text, #1c1c1e));
        stroke: var(--map-halo);
        paint-order: stroke;
        stroke-linejoin: round;
        font-weight: var(--gt-map-weight, 600);
        text-anchor: middle;
        dominant-baseline: central;
        pointer-events: none;
        user-select: none;
      }
      .labels text.on {
        fill: var(--gt-map_on-color, #fff);
        font-weight: var(--gt-map_on-weight, var(--gt-map-weight, 600));
        stroke: color-mix(in srgb, var(--rm-accent, var(--glass-color-orange, #ff9f0a)) 80%, #000);
      }
      .obstacle {
        fill: rgba(0, 0, 0, 0.35);
        stroke: none;
        pointer-events: none;
      }
      .path {
        fill: none;
        stroke: rgba(255, 255, 255, 0.55);
        stroke-width: 1;
        stroke-dasharray: 3 3;
        vector-effect: non-scaling-stroke;
        pointer-events: none;
      }
      .dock {
        fill: rgba(var(--glass-home-side-rgb, 22, 30, 46), 0.85);
        stroke: #fff;
        stroke-width: 1.5;
        vector-effect: non-scaling-stroke;
        pointer-events: none;
      }
      .mower {
        fill: var(--rm-accent, var(--glass-color-orange, #ff9f0a));
        stroke: #fff;
        stroke-width: 2;
        vector-effect: non-scaling-stroke;
        pointer-events: none;
      }
      /* the angle preview and the running job's route over the photo */
      .stripes line {
        stroke: rgba(255, 255, 255, 0.75);
        stroke-width: 1;
        vector-effect: non-scaling-stroke;
      }
      .stripes {
        pointer-events: none;
      }
      .route {
        fill: none;
        stroke: rgba(255, 255, 255, 0.6);
        stroke-width: 0.75;
        vector-effect: non-scaling-stroke;
        pointer-events: none;
      }
      .done {
        fill: none;
        stroke: color-mix(in srgb, var(--rm-accent, var(--glass-color-orange, #ff9f0a)) 45%, transparent);
        stroke-linecap: round;
        stroke-linejoin: round;
        pointer-events: none;
      }
      /* settings before mowing: − value + */
      .tune {
        flex: none;
        display: flex;
        gap: 8px;
      }
      .step {
        position: relative;
        isolation: isolate;
        overflow: hidden;
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 4px;
        height: 40px;
        padding: 0 4px;
        border-radius: 999px;
        color: var(--glass-home-text, #1c1c1e);
      }
      .step:not(.mat) {
        background: var(--glass-home-control, rgba(118, 118, 128, 0.16));
      }
      /* the value: the bar fills from the left, as on the lights */
      .sfill {
        position: absolute;
        inset: 0;
        z-index: -1;
        pointer-events: none;
        background: linear-gradient(
          90deg,
          color-mix(in srgb, var(--rm-fill, var(--glass-home-text, #1c1c1e)) 20%, transparent),
          color-mix(in srgb, var(--rm-fill, var(--glass-home-text, #1c1c1e)) 12%, transparent)
        );
        clip-path: inset(0 calc(100% - var(--pct) * 1%) 0 0);
        transition: clip-path 0.25s ease;
      }
      .step.locked button {
        opacity: 0.35;
      }
      .step.locked .sv {
        cursor: default;
      }
      .step.drag .sfill {
        transition: none;
      }
      .step button {
        flex: none;
        width: 32px;
        height: 32px;
        padding: 0;
        border-radius: 50%;
        display: grid;
        place-items: center;
        color: inherit;
        background: var(--map-button);
      }
      .step button ha-icon {
        --mdc-icon-size: var(--gi-steps-size, 18px);
        color: var(--gi-steps-color, inherit);
        display: flex;
      }
      .sv {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        font-size: var(--gt-setting-size, 14px);
        font-weight: var(--gt-setting-weight, 600);
        color: var(--gt-setting-color, inherit);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        align-self: stretch;
        cursor: ew-resize;
        touch-action: pan-y;
        user-select: none;
        -webkit-user-select: none;
      }
      .sv ha-icon {
        --mdc-icon-size: var(--gi-setting-size, 18px);
        display: flex;
        color: var(--gi-setting-color, var(--glass-home-text-2, rgba(60, 60, 67, 0.68)));
      }
      /* the rooms wrap on the left; the start button keeps its own column on the right */
      /* choices (select entities): pills like the settings, a menu above */
      .drop-wrap {
        position: relative;
        flex: 1;
        min-width: 0;
        display: flex;
      }
      .drop-wrap:has(.menu) {
        z-index: 5;
      }
      .step.drop {
        gap: 10px;
        padding: 0 12px 0 14px;
        border: 0;
        font: inherit;
        text-align: left;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }
      .dico {
        flex: none;
        --mdc-icon-size: var(--gi-option-size, 18px);
        display: flex;
        color: var(--gi-option-color, var(--glass-home-text-2, rgba(60, 60, 67, 0.68)));
      }
      .dwords {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: baseline;
        gap: 8px;
        white-space: nowrap;
        overflow: hidden;
      }
      .dname {
        font-size: var(--gt-option_name-size, 13px);
        font-weight: var(--gt-option_name-weight, 500);
        color: var(--gt-option_name-color, var(--glass-home-text-2, rgba(60, 60, 67, 0.68)));
      }
      .dval {
        font-size: var(--gt-option-size, 14px);
        font-weight: var(--gt-option-weight, 600);
        color: var(--gt-option-color, inherit);
        overflow: hidden;
        text-overflow: ellipsis;
      }
      /* the pill itself stays put when pressed – only its chevron reacts */
      .step.drop:active {
        transform: none;
      }
      /* the chevron: the dark liquid glass of the other controls */
      .chev {
        flex: none;
        width: 32px;
        height: 32px;
        margin-right: -8px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        color: #fff;
        background: var(--glass-control-bg);
        box-shadow: var(--glass-control-shadow);
        -webkit-backdrop-filter: var(--glass-control-backdrop, none);
        backdrop-filter: var(--glass-control-backdrop, none);
        transition:
          transform 0.15s ease,
          background 0.2s ease;
      }
      .chev ha-icon {
        --mdc-icon-size: var(--gi-chevron-size, 20px);
        color: var(--gi-chevron-color, inherit);
        display: flex;
        transition: transform 0.25s ease;
      }
      .chev.open ha-icon {
        transform: rotate(180deg);
      }
      /* pressed: lighter and a small bump, held a moment so a tap is seen */
      .step.drop:active .chev,
      .chev.hit {
        transform: scale(0.88);
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.3), rgba(255, 255, 255, 0.1) 60%),
          rgba(var(--glass-home-side-rgb, 22, 30, 46), 0.5);
      }
      .menu {
        position: absolute;
        bottom: calc(100% + 8px);
        right: 0;
        min-width: 180px;
        padding: 6px;
        border-radius: 22px;
        display: flex;
        flex-direction: column;
        gap: 2px;
        color: var(--glass-home-text, #1c1c1e);
        background: var(--glass-home-fill, linear-gradient(var(--glass-home-surface, rgba(246, 246, 248, 0.86)), var(--glass-home-surface, rgba(246, 246, 248, 0.86))));
        border: 0.5px solid var(--glass-home-border, rgba(255, 255, 255, 0.35));
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
        -webkit-backdrop-filter: blur(calc(24px * var(--glass-blur-scale, 1))) saturate(160%);
        backdrop-filter: blur(calc(24px * var(--glass-blur-scale, 1))) saturate(160%);
      }
      .menu button {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        height: 40px;
        padding: 0 14px;
        border: 0;
        border-radius: 16px;
        background: none;
        color: var(--gt-menu-color, inherit);
        font: inherit;
        font-size: var(--gt-menu-size, 14px);
        font-weight: var(--gt-menu-weight, 400);
        font-weight: 500;
        text-align: left;
        cursor: pointer;
      }
      .menu button:hover {
        background: var(--glass-home-control, rgba(118, 118, 128, 0.12));
      }
      .menu button.cur {
        font-size: var(--gt-menu_on-size, var(--gt-menu-size, 14px));
        font-weight: var(--gt-menu_on-weight, 600);
        color: var(--gt-menu_on-color, var(--glass-color-blue, #0a84ff));
      }
      .menu ha-icon {
        --mdc-icon-size: 18px;
      }
      .rooms {
        flex: none;
        display: flex;
        align-items: center;
        gap: 16px;
      }
      .pills {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .go {
        flex: none;
      }
      /* phone width: a square map, the settings one under another, the zones in one
         sideways-scrolling row and the start button across the whole width */
      @container map (max-width: 520px) {
        .wrap {
          height: auto;
        }
        .map {
          flex: none;
          aspect-ratio: 1;
        }
        .tune {
          flex-direction: column;
        }
        .tune .step {
          flex: none;
        }
        .rooms {
          flex-direction: column;
          align-items: stretch;
          gap: 12px;
        }
        .pills {
          flex-wrap: nowrap;
          overflow-x: auto;
          scrollbar-width: none;
          margin: -3px;
          padding: 3px;
        }
        .pills::-webkit-scrollbar {
          display: none;
        }
        .room-pill {
          flex: none;
        }
        .go {
          justify-content: center;
        }
      }
      .spacer {
        flex: 1;
      }
      button {
        font: inherit;
        border: 0;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        transition:
          transform 0.15s ease,
          background 0.2s ease;
      }
      button:active {
        transform: scale(0.94);
      }
      .room-pill {
        display: flex;
        align-items: center;
        gap: 6px;
        height: 40px;
        padding: 0 16px;
        border-radius: 999px;
        font-size: var(--gt-room-size, 14px);
        font-weight: var(--gt-room-weight, 600);
        color: var(--gt-room-color, var(--glass-home-text, #1c1c1e));
      }
      .room-pill.on {
        font-size: var(--gt-room_on-size, var(--gt-room-size, 14px));
        font-weight: var(--gt-room_on-weight, var(--gt-room-weight, 600));
      }
      .room-pill.on.mat {
        color: var(--gt-room_on-color, var(--gt-room-color, inherit));
      }
      .room-pill:not(.mat) {
        background: var(--glass-home-control, rgba(118, 118, 128, 0.16));
      }
      .room-pill.on:not(.mat) {
        /* picked: neutral, like the rest of the panel's controls – the accent stays on the map */
        color: var(--gt-room_on-color, var(--gt-room-color, var(--glass-home-text, #1c1c1e)));
        background: color-mix(in srgb, var(--glass-home-text, #1c1c1e) 24%, transparent);
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--glass-home-text, #1c1c1e) 18%, transparent);
      }
      /* during a job: nothing to pick – still readable, just not pressable */
      .room-pill:disabled {
        cursor: default;
        transform: none;
      }
      .room-pill:disabled:not(.cur) {
        opacity: 0.38;
        filter: grayscale(1);
      }
      :host([dark]) .room-pill:disabled:not(.cur) {
        opacity: 0.6;
      }
      .room-pill.cur:not(.on) {
        box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--glass-home-text, #1c1c1e) 55%, transparent);
      }
      .room-pill .here {
        --mdc-icon-size: var(--gi-room-size, 16px);
        color: var(--gi-room-color, inherit);
        display: flex;
      }
      .room-pill.cur:not(.on) .here {
        color: var(--gi-room-color, var(--glass-home-text, #1c1c1e));
      }
      .n {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        font-size: 11px;
        background: rgba(255, 255, 255, 0.3);
      }
      /* clean: the dark liquid glass of the other controls */
      .go {
        display: flex;
        align-items: center;
        gap: 8px;
        height: 44px;
        padding: 0 20px 0 14px;
        border-radius: 999px;
        font-size: var(--gt-button-size, 14px);
        font-weight: var(--gt-button-weight, 600);
      }
      .go.mat {
        color: var(--gt-button-color, inherit);
      }
      .go:not(.mat) {
        color: var(--gt-button-color, var(--glass-home-side-text, #fff));
        background: var(--glass-control-bg);
        box-shadow: var(--glass-control-shadow);
        -webkit-backdrop-filter: var(--glass-control-backdrop, none);
        backdrop-filter: var(--glass-control-backdrop, none);
      }
      .go:disabled {
        opacity: 0.4;
        cursor: default;
      }
      .go ha-icon {
        --mdc-icon-size: var(--gi-button-size, 20px);
        color: var(--gi-button-color, inherit);
        display: flex;
      }
      /* own materials: the pill shape */
      .step.mat,
      .room-pill.mat,
      .go.mat {
        border-radius: 999px;
      }
    `,
    materials,
  ];
}

registerCard("glass-room-map", GlassRoomMap, {
  name: "Glass – room map",
  description: "A robot's map (vacuum rooms or Mammotion lawn zones): pick them on the map or in the list and clean / mow just those.",
});
