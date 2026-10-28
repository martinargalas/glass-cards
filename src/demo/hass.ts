import type { ActionConfig, HassEntity, HomeAssistant } from "../core/types";
import { MOWER_GEO } from "./home.generated";
import { EFFECTS, WORLD, demoCalendar, demoForecast, demoHistory, demoStatistics, type DemoState } from "./world";
import { DEMO_POPUPS, DEMO_POPUPS_URL } from "./dashboard";

/**
 * Demo mode: a made-up home the cards run on, inside any Home Assistant (`demo: true`
 * on glass-dashboard) or on a web page with no HA at all. The cards get a `hass` whose
 * states are the demo home's; switching, dimming or opening anything changes those
 * states here and never reaches a real device.
 *
 *   demoHass(realHass)      the real hass with the demo home's states (in HA)
 *   demoHass()              a stand-alone one (a web page)
 *   onDemoChange(cb)        called after the demo home changed
 */

type Attrs = Record<string, any>;
type ServiceData = Record<string, any> | undefined;

const states: Record<string, HassEntity> = {};
const listeners = new Set<() => void>();
const startedAt = new Date().toISOString();

function put(id: string, s: DemoState) {
  const old = states[id];
  const [state, attributes = {}] = typeof s === "string" ? [s, {}] : s;
  const changed = !old || old.state !== state;
  const at = new Date().toISOString();
  states[id] = {
    entity_id: id,
    state,
    attributes: { ...(old?.attributes ?? {}), ...attributes },
    last_changed: changed ? (old ? at : startedAt) : old.last_changed,
    last_updated: old ? at : startedAt,
  };
}
for (const [id, s] of Object.entries(WORLD)) put(id, s);

let pending = 0;
function changed() {
  // several services in one tap (a scene, "switch off everything"): one update
  if (pending) return;
  pending = requestAnimationFrame(() => {
    pending = 0;
    listeners.forEach((cb) => cb());
  });
}

export function onDemoChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Change a demo entity from outside (the web demo's "busy home" button…). */
export function setDemoState(id: string, state: string, attributes: Attrs = {}) {
  put(id, [state, attributes]);
  changed();
}

const ON_OFF: Record<string, [string, string]> = {
  media_player: ["playing", "paused"],
  cover: ["open", "closed"],
  lock: ["locked", "unlocked"],
  vacuum: ["cleaning", "docked"],
  lawn_mower: ["mowing", "docked"],
};
const isOn = (s?: HassEntity) => !!s && !["off", "closed", "idle", "paused", "standby", "docked", "unlocked", "unavailable", "unknown"].includes(s.state);

function ids(data: ServiceData, target?: Attrs): string[] {
  const raw = target?.entity_id ?? data?.entity_id;
  return (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((id: string) => states[id]);
}

function switchTo(id: string, on: boolean, attrs: Attrs = {}) {
  const domain = id.split(".")[0];
  const [yes, no] = ON_OFF[domain] ?? ["on", "off"];
  if (domain === "light" && on && !states[id].attributes.brightness && !attrs.brightness) attrs = { brightness: 200, ...attrs };
  if (domain === "light" && !on) attrs = { brightness: null, ...attrs };
  if (domain === "cover") attrs = { current_position: on ? 100 : 0, ...attrs };
  put(id, [on ? yes : no, attrs]);
}

function lightAttrs(data: Attrs): Attrs {
  const a: Attrs = {};
  if (data.brightness_pct !== undefined) a.brightness = Math.round((Number(data.brightness_pct) / 100) * 255);
  if (data.brightness !== undefined) a.brightness = Number(data.brightness);
  if (data.color_temp_kelvin !== undefined) a.color_temp_kelvin = Number(data.color_temp_kelvin);
  if (data.hs_color !== undefined) a.hs_color = data.hs_color;
  if (data.rgb_color !== undefined) a.rgb_color = data.rgb_color;
  return a;
}

/** What a service does to the demo home: the common ones, near enough to look real. */
async function callService(domain: string, service: string, data?: ServiceData, target?: Attrs): Promise<unknown> {
  const list = ids(data, target);
  const d = data ?? {};
  // a scene, script or automation run: the world knows what it does
  if ((domain === "scene" || domain === "script") && (service === "turn_on" || service === "toggle")) {
    for (const id of list) WORLD_EFFECTS[id]?.(d);
    if (domain === "script" && !list.length) WORLD_EFFECTS[`${domain}.${service}`]?.(d);
    changed();
    return;
  }
  // a script that runs a list of actions (one tap, several services), as dashboards use them
  if (domain === "script" && Array.isArray(d.actions)) {
    for (const x of d.actions as Attrs[]) {
      const [dm, sv] = String(x.service ?? x.action ?? "").split(".");
      if (dm && sv) void callService(dm, sv, { ...(x.data ?? {}), ...(x.entity_id ? { entity_id: x.entity_id } : {}) }, x.target);
    }
    return;
  }
  if (domain === "script" && WORLD_EFFECTS[`script.${service}`]) {
    WORLD_EFFECTS[`script.${service}`](d);
    changed();
    return;
  }
  for (const id of list) {
    const s = states[id];
    const dom = id.split(".")[0];
    switch (service) {
      case "toggle":
        switchTo(id, !isOn(s));
        break;
      case "turn_on":
        switchTo(id, true, dom === "light" ? lightAttrs(d) : {});
        break;
      case "turn_off":
        switchTo(id, false);
        break;
      case "media_play":
        put(id, "playing");
        break;
      case "media_pause":
      case "media_stop":
        put(id, "paused");
        break;
      case "media_play_pause":
        put(id, s.state === "playing" ? "paused" : "playing");
        break;
      case "open_cover":
        put(id, ["open", { current_position: 100 }]);
        break;
      case "close_cover":
        put(id, ["closed", { current_position: 0 }]);
        break;
      case "stop_cover":
        break;
      case "set_cover_position": {
        const p = Number(d.position);
        put(id, [p > 0 ? "open" : "closed", { current_position: p }]);
        break;
      }
      case "set_cover_tilt_position":
        put(id, [s.state, { current_tilt_position: Number(d.tilt_position) }]);
        break;
      case "set_temperature":
        put(id, [d.hvac_mode ?? s.state, { temperature: Number(d.temperature) }]);
        break;
      case "set_hvac_mode":
        put(id, [String(d.hvac_mode), {}]);
        break;
      case "set_preset_mode":
        put(id, [s.state, { preset_mode: d.preset_mode }]);
        break;
      case "set_operation_mode":
        put(id, [String(d.operation_mode), {}]);
        break;
      case "set_value":
        put(id, String(d.value));
        break;
      case "increment":
      case "decrement": {
        // a number helper (the period bar's back / forward): one step, within its limits
        const step = Number(s.attributes.step ?? 1);
        const v = parseFloat(s.state) + (service === "increment" ? step : -step);
        const min = s.attributes.min ?? -Infinity;
        const max = s.attributes.max ?? Infinity;
        put(id, String(Math.min(max, Math.max(min, v))));
        break;
      }
      case "select_option":
        put(id, String(d.option));
        WORLD_EFFECTS[`${id}=${d.option}`]?.(d);
        break;
      case "select_next":
      case "select_previous": {
        const opts: string[] = s.attributes.options ?? [];
        const i = opts.indexOf(s.state) + (service === "select_next" ? 1 : -1);
        put(id, opts[(i + opts.length) % opts.length] ?? s.state);
        break;
      }
      case "set_datetime":
        put(id, String(d.datetime ?? d.time ?? d.date));
        break;
      case "start":
      case "start_mowing":
        put(id, dom === "vacuum" ? "cleaning" : "mowing");
        break;
      case "pause":
        put(id, "paused");
        break;
      case "return_to_base":
      case "dock":
        put(id, "returning");
        setTimeout(() => {
          put(id, "docked");
          changed();
        }, 4000);
        break;
      case "alarm_arm_home":
        put(id, "armed_home");
        break;
      case "alarm_arm_away":
        put(id, "armed_away");
        break;
      case "alarm_arm_night":
        put(id, "armed_night");
        break;
      case "alarm_disarm":
        put(id, "disarmed");
        break;
      case "trigger":
        break;
      default:
        WORLD_EFFECTS[`${domain}.${service}`]?.(d);
    }
  }
  if (!list.length) WORLD_EFFECTS[`${domain}.${service}`]?.(d);
  changed();
}

/**
 * Side effects the world defines for scenes, scripts and helpers ("movie scene" dims
 * the lights and closes the blinds) – world.ts keeps them, so this file stays generic.
 */
const WORLD_EFFECTS: Record<string, (data: Attrs) => void> = Object.fromEntries(
  Object.entries(EFFECTS).map(([k, fn]) => [k, (data: Attrs) => fn({ set: put, get: (id: string) => states[id], data })]),
);

/**
 * The demo's own pictures (`glass:demo/…`, beside the bundle) as addresses: Home Assistant's
 * picture card shows the cameras' views and events, and it knows no `glass:`.
 */
function bundledFiles(node: unknown): unknown {
  if (typeof node === "string") {
    // the bundle's address in a variable: Vite would turn `new URL(…, import.meta.url)` into a file lookup
    const bundle = import.meta.url;
    return /^glass:demo\/[\w.-]+$/.test(node) ? new URL(`./demo-${node.slice(11)}`, bundle).href : node;
  }
  if (Array.isArray(node)) return node.map(bundledFiles);
  if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, bundledFiles(v)]));
  return node;
}

/** A card's action (tap, hold…) in demo mode: run here instead of by HA's frontend. */
function runAction(action: ActionConfig, entity?: string): boolean {
  switch (action.action) {
    case "toggle":
      if (entity) void callService(entity.split(".")[0], "toggle", { entity_id: entity });
      return true;
    case "perform-action":
    case "call-service": {
      const svc = String(action.perform_action ?? action.service ?? "");
      const [domain, service] = svc.split(".");
      if (domain && service) void callService(domain, service, action.data ?? action.service_data, action.target);
      return true;
    }
    case "more-info":
      // no dialog for a made-up entity
      return true;
    default:
      // navigate, url, assist… are fine for HA's frontend to run
      return false;
  }
}

/** The sun for the demo: the real one in HA, else by the clock (up 7–19). */
function sun(real?: HassEntity): HassEntity {
  if (real) return real;
  const h = new Date().getHours();
  const at = (hour: number, dayOffset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };
  const up = h >= 7 && h < 19;
  return {
    entity_id: "sun.sun",
    state: up ? "above_horizon" : "below_horizon",
    attributes: {
      next_rising: at(7, h >= 7 ? 1 : 0),
      next_setting: at(19, h >= 19 ? 1 : 0),
      elevation: up ? 35 : -12,
      azimuth: 90 + ((h - 6) / 12) * 180,
      rising: h < 13,
      friendly_name: "Sun",
    },
    last_changed: startedAt,
    last_updated: startedAt,
  };
}

const fmtNumber = (v: string, lang: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString(lang, { maximumFractionDigits: 1 }) : v;
};

/** HA's own formatting where there is one (in HA), else a plain one (web page). */
function formatter(base: Partial<HomeAssistant> | undefined, lang: string) {
  if (base?.formatEntityState) return base.formatEntityState.bind(base);
  const words: Record<string, string> = {
    on: "On", off: "Off", home: "Home", not_home: "Away", open: "Open", closed: "Closed", playing: "Playing", paused: "Paused", idle: "Idle", docked: "Docked",
    "clear-night": "Clear", cloudy: "Cloudy", fog: "Fog", hail: "Hail", lightning: "Lightning", "lightning-rainy": "Thunderstorm", partlycloudy: "Partly cloudy",
    pouring: "Pouring", rainy: "Rainy", snowy: "Snowy", "snowy-rainy": "Sleet", sunny: "Sunny", windy: "Windy", "windy-variant": "Windy",
  };
  return (s: HassEntity, state = s.state) => {
    const unit = s.attributes.unit_of_measurement;
    const v = unit ? fmtNumber(state, lang) : (words[state] ?? state.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()));
    return unit ? `${v} ${unit}` : v;
  };
}

const forecastSubs = new Set<() => void>();

/**
 * The cards' hass in demo mode. With a real hass (inside HA) everything that is not a
 * card's business – the user, the theme, the language, the dashboards – stays HA's own;
 * the states, services, history, forecast and calendars are the demo home's.
 */
export function demoHass(base?: Partial<HomeAssistant>): HomeAssistant & { demo: { action: typeof runAction } } {
  const lang = base?.locale?.language ?? base?.language ?? navigator.language?.slice(0, 2) ?? "en";
  const all: Record<string, HassEntity> = { ...states, "sun.sun": sun(base?.states?.["sun.sun"]) };
  const realConn = base?.connection as any;
  const connection = {
    subscribeMessage: async (cb: (m: unknown) => void, msg: Record<string, unknown>) => {
      if (msg.type === "weather/subscribe_forecast" && states[String(msg.entity_id)]) {
        const push = () => cb({ type: msg.forecast_type, forecast: demoForecast(String(msg.forecast_type)) });
        push();
        forecastSubs.add(push);
        return async () => void forecastSubs.delete(push);
      }
      return realConn?.subscribeMessage ? realConn.subscribeMessage(cb, msg) : async () => {};
    },
  };
  return {
    ...(base as HomeAssistant),
    states: all,
    language: base?.language ?? lang,
    locale: base?.locale ?? { language: lang, number_format: "language", time_format: "language" },
    themes: base?.themes ?? { darkMode: matchMedia?.("(prefers-color-scheme: dark)").matches ?? false },
    config: { latitude: 50.08, longitude: 14.43, time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone, unit_system: { temperature: "°C" }, ...(base?.config ?? {}) },
    user: base?.user ?? { id: "demo", name: "Demo", is_admin: false },
    connection: connection as HomeAssistant["connection"],
    formatEntityState: formatter(base, lang),
    localize: base?.localize ?? ((k: string) => k),
    callService,
    callWS: async <T>(msg: Record<string, unknown>): Promise<T> => {
      if (msg.type === "history/history_during_period") {
        const list = (msg.entity_ids as string[]) ?? [];
        const start = Date.parse(String(msg.start_time));
        const out: Record<string, { s: string; lu: number }[]> = {};
        for (const id of list) if (all[id]) out[id] = demoHistory(id, all[id], start, Date.now());
        // ids that are not the demo's (none, normally) go to HA
        const rest = list.filter((id) => !all[id]);
        if (rest.length && base?.callWS) Object.assign(out, await base.callWS<typeof out>({ ...msg, entity_ids: rest }).catch(() => ({})));
        return out as T;
      }
      if (msg.type === "recorder/statistics_during_period") {
        const list = ((msg.statistic_ids as string[]) ?? []).filter((id) => all[id]);
        return Object.fromEntries(list.map((id) => [id, demoStatistics(id, all[id], Date.parse(String(msg.start_time)), msg.end_time ? Date.parse(String(msg.end_time)) : Date.now(), String(msg.period ?? "hour"))])) as T;
      }
      // the demo's pop-ups: HA's own copy when it has one (edited in Dashboard Studio), else the bundled one
      // the mower's lawn (glass-room-map asks Mammotion for it); no job on, so no route yet
      if (msg.type === "call_service" && msg.domain === "mammotion") {
        const empty = { type: "FeatureCollection", features: [] };
        return { response: msg.service === "get_geojson" ? structuredClone(MOWER_GEO) : empty } as T;
      }
      if (msg.type === "lovelace/config" && msg.url_path === DEMO_POPUPS_URL) {
        const own = base?.callWS ? await base.callWS<T>(msg).catch(() => undefined) : undefined;
        return bundledFiles(own ?? structuredClone(DEMO_POPUPS)) as T;
      }
      if (!base?.callWS) throw Object.assign(new Error("Not available in the demo"), { code: "not_found" });
      return base.callWS<T>(msg);
    },
    callApi: async <T>(method: "GET" | "POST", path: string, data?: Record<string, unknown>): Promise<T> => {
      const m = /^calendars\/([^?]+)\?start=([^&]+)&end=(.+)$/.exec(path);
      if (m && states[decodeURIComponent(m[1])]) return demoCalendar(decodeURIComponent(m[1]), Date.parse(decodeURIComponent(m[2])), Date.parse(decodeURIComponent(m[3]))) as T;
      // HA's REST history (apexcharts-card): one list of full states per entity
      const h = /^history\/period(?:\/([^?]+))?\?(.*)$/.exec(path);
      if (h) {
        const q = new URLSearchParams(h[2]);
        const ids = (q.get("filter_entity_id") ?? "").split(",").filter((id) => all[id]);
        const start = h[1] ? Date.parse(decodeURIComponent(h[1])) : Date.now() - 86400000;
        const end = q.get("end_time") ? Date.parse(q.get("end_time")!) : Date.now();
        return ids.map((id) =>
          demoHistory(id, all[id], start, end).map((p) => {
            const at = new Date(p.lu * 1000).toISOString();
            return { entity_id: id, state: p.s, attributes: all[id].attributes, last_changed: at, last_updated: at };
          }),
        ) as T;
      }
      if (!base?.callApi) return [] as T;
      return base.callApi<T>(method, path, data);
    },
    demo: { action: runAction },
  };
}
