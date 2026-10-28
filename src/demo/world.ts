import type { HassEntity } from "../core/types";
import { HISTORY, HOME } from "./home.generated";

/**
 * The demo home: Alex and Sam, six rooms, a heat pump, solar panels with a battery, a
 * washing machine, a robot vacuum and a lawn mower. Every name is made up – the same
 * home runs the web site's live demo and the demo dashboard inside Home Assistant
 * (examples/demo.yaml), so what the docs show is what you get.
 */

/** A state, or a state with its attributes. */
export type DemoState = string | [string, Record<string, any>];

const iso = (minutesFromNow: number) => new Date(Date.now() + minutesFromNow * 60000).toISOString();

/** A person's picture: initials on a soft gradient, no photo of anyone real. */
function avatar(initials: string, from: string, to: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="96" height="96" fill="url(#g)"/><text x="48" y="60" font-family="system-ui,sans-serif" font-size="38" font-weight="600" fill="white" text-anchor="middle">${initials}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * What's going on in the demo home right now – a lively evening rather than the quiet
 * moment the snapshot happened to catch (examples/demo.yaml shows these first).
 */
// day (7–19, as the demo's sun) or night: the light outside and the blinds follow it
const hourNow = new Date().getHours();
const daytime = hourNow >= 7 && hourNow < 19;
// the light outside: rising to a sunny afternoon's 60 klx
const lux = daytime ? Math.round(60000 * Math.sin(((hourNow + 0.5 - 7) / 12) * Math.PI)) : 0;
const blindAt = (name: string, position: number, tilt: number): DemoState => [
  position > 0 ? "open" : "closed",
  { friendly_name: name, current_position: position, current_tilt_position: tilt, device_class: "blind", supported_features: 255 },
];

const LIVE: Record<string, DemoState> = {
  "person.alex": ["home", { friendly_name: "Alex", entity_picture: avatar("A", "#7aa7ff", "#5161d6") }],
  "person.sam": ["Work", { friendly_name: "Sam", entity_picture: avatar("S", "#ffb37a", "#e0617d") }],
  "zone.work": ["0", { friendly_name: "Work", icon: "mdi:briefcase" }],
  "sensor.alex_phone_battery": ["82", { unit_of_measurement: "%", device_class: "battery" }],
  "sensor.alex_phone_battery_state": "charging",
  "sensor.sam_phone_battery": ["46", { unit_of_measurement: "%", device_class: "battery" }],
  "sensor.sam_phone_battery_state": "discharging",
  "media_player.apple_tv_4k": ["playing", { friendly_name: "Living room TV", media_title: "A nature documentary", app_name: "TV" }],
  "media_player.office": ["playing", { friendly_name: "Kitchen speaker", media_title: "Morning jazz", media_artist: "Radio" }],
  "sensor.washer_machine_state": ["run", { friendly_name: "Washer" }],
  "sensor.washer_job_state": ["rinse", { friendly_name: "Washer job" }],
  "sensor.washer_remaining_time": ["0:42", { friendly_name: "Washer time left" }],
  "sensor.washer_completion_time": [iso(42), { device_class: "timestamp", friendly_name: "Washer done at" }],
  "binary_sensor.washer_power": ["on", { friendly_name: "Washer power" }],
  "binary_sensor.heat_pump_compressor": ["on", { friendly_name: "Compressor" }],
  "sensor.glass_notifications": [
    "1",
    {
      friendly_name: "Notifications",
      notes: [
        { id: "window_open", level: "warning", title: "Window open", icon: "mdi:window-open-variant", time: Date.now() / 1000 - 1500 },
      ],
    },
  ],
  // the sun in the shading azimuth by day: the office and the kids' room shaded, the balcony open
  "sensor.sun_sensor_luminance": [String(lux), { friendly_name: "Sun sensor luminance", unit_of_measurement: "lx", device_class: "illuminance", state_class: "measurement" }],
  "sensor.blinds_shading_level": [daytime ? "mid" : "open", { friendly_name: "Blinds shading level" }],
  "sensor.blinds_target_tilt": [daytime ? "45" : "100", { friendly_name: "Blinds target tilt", unit_of_measurement: "%" }],
  "cover.office": blindAt("Office", 0, daytime ? 45 : 0),
  "cover.kids_room": blindAt("Kids room", 0, daytime ? 45 : 0),
  "cover.balcony": blindAt("Balcony", 100, 100),
  // the weather now: what the forecast (demoForecast) starts with, by day or night
  "weather.home": [new Date().getHours() >= 7 && new Date().getHours() < 19 ? "partlycloudy" : "clear-night", { friendly_name: "Home", temperature: 14.6, temperature_unit: "°C", humidity: 64, pressure: 1016, pressure_unit: "hPa", wind_speed: 14, wind_speed_unit: "km/h", wind_bearing: 240, apparent_temperature: 13.2, cloud_coverage: 45, supported_features: 3 }],
  "sensor.heat_pump_outside_temperature": ["14.8", { unit_of_measurement: "°C", device_class: "temperature", state_class: "measurement", friendly_name: "Outside" }],
};

export const WORLD: Record<string, DemoState> = { ...HOME, ...LIVE };

type Ctx = { set: (id: string, s: DemoState) => void; get: (id: string) => HassEntity | undefined; data: Record<string, any> };

const lights = (ctx: Ctx, list: [string, number][]) => {
  for (const [id, b] of list) ctx.set(id, b ? ["on", { brightness: b }] : ["off", { brightness: null }]);
};
const scene = (room: string, levels: Record<string, number>) => (ctx: Ctx) => lights(ctx, [[`light.${room}`, levels[room] ?? 0]]);
const blind = (room: string, cover: string) => ({
  [`script.open_blinds_${room}`]: (ctx: Ctx) => ctx.set(cover, ["open", { current_position: 100 }]),
  [`script.close_blinds_${room}`]: (ctx: Ctx) => ctx.set(cover, ["closed", { current_position: 0 }]),
  [`script.tilt_blinds_${room}_min`]: (ctx: Ctx) => ctx.set(cover, ["open", { current_tilt_position: 20 }]),
  [`script.tilt_blinds_${room}_mid`]: (ctx: Ctx) => ctx.set(cover, ["open", { current_tilt_position: 50 }]),
  [`script.tilt_blinds_${room}_max`]: (ctx: Ctx) => ctx.set(cover, ["open", { current_tilt_position: 90 }]),
});
const kitchenPreset = (upper: boolean, lower: boolean) => (ctx: Ctx) => {
  ctx.set("binary_sensor.kitchen_lights_upper_on", upper ? "on" : "off");
  ctx.set("binary_sensor.kitchen_lights_lower_on", lower ? "on" : "off");
  ctx.set("binary_sensor.kitchen_lights_all_on", upper && lower ? "on" : "off");
  ctx.set("binary_sensor.kitchen_lights_off_on", !upper && !lower ? "on" : "off");
  ctx.set("binary_sensor.kitchen_lights_any_on", upper || lower ? "on" : "off");
  ctx.set("light.kitchen_led", upper || lower ? ["on", { brightness: 200 }] : "off");
};

/** What scenes, scripts and helpers do in the demo home. */
export const EFFECTS: Record<string, (ctx: Ctx) => void> = {
  ...Object.fromEntries(
    (["living_room", "kitchen", "hallway"] as const).flatMap((room) => [
      [`scene.${room}_relax`, scene(room, { [room]: 110 })],
      [`scene.${room}_read`, scene(room, { [room]: 230 })],
      [`scene.${room}_concentrate`, scene(room, { [room]: 255 })],
      [`scene.${room}_natural_light`, scene(room, { [room]: 190 })],
      [`scene.${room}_nightlight`, scene(room, { [room]: 18 })],
    ]),
  ),
  ...blind("office", "cover.office"),
  ...blind("kids", "cover.kids_room"),
  ...blind("bedroom", "cover.balcony"),
  "select.kitchen_led_preset=Lights off": kitchenPreset(false, false),
  "select.kitchen_led_preset=Upper light": kitchenPreset(true, false),
  "select.kitchen_led_preset=Lower light": kitchenPreset(false, true),
  "select.kitchen_led_preset=All lights": kitchenPreset(true, true),
  "script.kids_radio_button_toggle": (ctx) => ctx.set("input_boolean.kids_radio", ctx.get("input_boolean.kids_radio")?.state === "on" ? "off" : "on"),
  "script.kids_bedtime": (ctx) => {
    const v = ctx.data.volba ?? ctx.data.choice;
    const on = v === "both" ? true : v === "off" ? false : !(ctx.get("input_boolean.kids_radio")?.state === "on" || ctx.get("input_boolean.star_projector")?.state === "on");
    ctx.set("input_boolean.kids_radio", on ? "on" : "off");
    ctx.set("input_boolean.star_projector", on ? "on" : "off");
  },
  "script.bathroom_lights_toggle": (ctx) => {
    const ids = ["switch.switch", "switch.switch_switch1", "switch.switch_switch2"];
    const on = !ids.some((id) => ctx.get(id)?.state === "on");
    for (const id of ids) ctx.set(id, on ? "on" : "off");
  },
  "script.vacuum_and_mop": (ctx) => {
    ctx.set("vacuum.vacuum", "cleaning");
    ctx.set("vacuum.mop", "cleaning");
  },
  "script.mower_pause": (ctx) => ctx.set("lawn_mower.mower", "paused"),
  "script.mower_unpause": (ctx) => ctx.set("lawn_mower.mower", "mowing"),
};

/* ── Made-up history, forecast and calendar ─────────────────────────────── */

/** A repeatable pseudo-random number for a name and a step, so a reload draws the same lines. */
function noise(seed: string, i: number) {
  let h = 2166136261;
  for (const ch of `${seed}:${i}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

/**
 * History for the cards' graphs: numbers drift around their current value with the day
 * (warmer in the afternoon), switches go on and off now and then; it ends at the state now.
 */
export function demoHistory(id: string, now: HassEntity, start: number, end: number): { s: string; lu: number }[] {
  const out: { s: string; lu: number }[] = [];
  // a few sensors have their real past (the heating pop-up's graphs): it ends now
  const real = HISTORY[id];
  if (real) {
    const first = real.findIndex(([ago]) => end - ago * 1000 >= start);
    for (const [ago, s] of real.slice(first < 0 ? -1 : Math.max(0, first - 1))) out.push({ s, lu: Math.max(start, end - ago * 1000) / 1000 });
    out.push({ s: now.state, lu: end / 1000 });
    return out;
  }
  const step = 10 * 60000;
  const value = parseFloat(now.state);
  const numeric = Number.isFinite(value);
  const outside = /outdoor|outside/.test(id);
  // a meter (kWh since ever) only grows: back in time it was lower, by a day's worth
  if (numeric && now.attributes.state_class === "total_increasing") {
    const perStep = (Math.max(value, 1) / 2000) * (step / 3600000);
    for (let t = start, i = 0; t < end; t += step, i++) out.push({ s: (value - ((end - t) / step) * perStep * (0.6 + noise(id, i) * 0.8)).toFixed(2), lu: t / 1000 });
    out.push({ s: now.state, lu: end / 1000 });
    return out;
  }
  for (let t = start, i = 0; t < end; t += step, i++) {
    const hour = new Date(t).getHours() + new Date(t).getMinutes() / 60;
    let s: string;
    if (numeric) {
      const day = Math.sin(((hour - 9) / 24) * Math.PI * 2);
      const swing = outside ? 4 : id.includes("temperature") ? 0.7 : Math.abs(value) * 0.15;
      const v = value + day * swing + (noise(id, i) - 0.5) * swing * 0.4 - Math.sin(((new Date(end).getHours() - 9) / 24) * Math.PI * 2) * swing;
      s = v.toFixed(1);
    } else s = noise(id, Math.floor(i / 6)) > 0.6 ? "on" : "off";
    out.push({ s, lu: t / 1000 });
  }
  out.push({ s: now.state, lu: end / 1000 });
  return out;
}

/**
 * Long-term statistics (what apexcharts-card asks for energy charts): per period a mean,
 * min, max and a growing sum, like HA's recorder keeps them.
 */
export function demoStatistics(id: string, now: HassEntity, start: number, end: number, period: string) {
  const step = { "5minute": 300000, hour: 3600000, day: 86400000, week: 7 * 86400000, month: 30 * 86400000 }[period] ?? 3600000;
  const value = Math.abs(parseFloat(now.state)) || 1;
  const out: { start: number; end: number; mean: number; min: number; max: number; sum: number; state: number; change: number }[] = [];
  let sum = 0;
  for (let t = start, i = 0; t < end; t += step, i++) {
    const hour = new Date(t).getHours();
    const day = step < 86400000 ? Math.max(0, Math.sin(((hour - 6) / 24) * Math.PI * 2)) : 1;
    const change = (value / (step < 86400000 ? 24 : 1)) * (0.4 + noise(id, i) * 0.9) * (id.includes("pv") || id.includes("generation") ? day : 1);
    sum += change;
    out.push({ start: t, end: t + step, mean: change, min: change * 0.7, max: change * 1.3, sum, state: sum, change });
  }
  return out;
}

const CONDITIONS = ["partlycloudy", "cloudy", "partlycloudy", "sunny", "rainy", "partlycloudy", "cloudy"];

/** The forecast weather/subscribe_forecast hands the clock & weather card. */
export function demoForecast(type: string) {
  const now = new Date();
  if (type === "daily") {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, 12);
      const hi = 15 + Math.round(noise("hi", i) * 6);
      return {
        datetime: d.toISOString(),
        condition: CONDITIONS[i % CONDITIONS.length],
        temperature: hi,
        templow: hi - 6 - Math.round(noise("lo", i) * 3),
        precipitation: CONDITIONS[i % CONDITIONS.length] === "rainy" ? 4.2 : 0,
        precipitation_probability: CONDITIONS[i % CONDITIONS.length] === "rainy" ? 70 : Math.round(noise("pp", i) * 20),
      };
    });
  }
  const base = new Date(now);
  base.setMinutes(0, 0, 0);
  return Array.from({ length: 24 }, (_, i) => {
    const t = new Date(base.getTime() + (i + 1) * 3600000);
    const h = t.getHours();
    const rain = i >= 3 && i <= 5;
    return {
      datetime: t.toISOString(),
      condition: rain ? "rainy" : h >= 20 || h < 6 ? "clear-night" : i < 3 ? "partlycloudy" : "cloudy",
      temperature: Math.round((14 + 4 * Math.sin(((h - 9) / 24) * Math.PI * 2)) * 10) / 10,
      precipitation: rain ? 0.8 : 0,
      precipitation_probability: rain ? 65 : 10,
    };
  });
}

/** Calendar events in the asked window, as HA's calendar API returns them. */
export function demoCalendar(id: string, from: number, to: number) {
  const day = (d: number, h?: number, m = 0) => {
    const t = new Date();
    t.setDate(t.getDate() + d);
    if (h === undefined) return { date: `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}` };
    t.setHours(h, m, 0, 0);
    return { dateTime: t.toISOString() };
  };
  const events =
    id === "calendar.utilities"
      ? [
          { summary: "Paper and plastic", start: day(1), end: day(2) },
          { summary: "General waste", start: day(4), end: day(5) },
        ]
      : id === "calendar.holidays"
        ? [{ summary: "Holiday", start: day(5), end: day(6) }]
        : [
          { summary: "Swimming lesson", start: day(0, 17, 30), end: day(0, 18, 30), location: "City pool" },
          { summary: "Dinner with Jamie", start: day(0, 19, 30), end: day(0, 22, 0) },
          { summary: "Dentist", start: day(1, 9, 0), end: day(1, 9, 45), location: "Main Street 12" },
          { summary: "Grandma's birthday", start: day(2), end: day(3) },
          { summary: "Car service", start: day(3, 8, 0), end: day(3, 10, 0) },
        ];
  return events.filter((e) => {
    const s = Date.parse(e.start.dateTime ?? `${e.start.date}T00:00:00`);
    return s < to && s + 86400000 > from;
  });
}
