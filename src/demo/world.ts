import type { HassEntity } from "../core/types";

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

const temp = (v: number, name: string): DemoState => [String(v), { unit_of_measurement: "°C", device_class: "temperature", state_class: "measurement", friendly_name: name }];
const room = (current: number, target: number, action: "heating" | "idle", name: string): DemoState => [
  "heat",
  { current_temperature: current, temperature: target, hvac_action: action, hvac_modes: ["off", "heat"], min_temp: 5, max_temp: 30, target_temp_step: 0.5, friendly_name: name },
];
const pollutant = (v: number, name: string, device_class: string, unit = "µg/m³"): DemoState => [String(v), { unit_of_measurement: unit, device_class, state_class: "measurement", friendly_name: name }];
const tilt = (v: number, name: string): DemoState => [String(v), { min: 0, max: 100, step: 5, mode: "box", unit_of_measurement: "%", friendly_name: name }];

export const WORLD: Record<string, DemoState> = {
  // people
  "person.alex": ["home", { friendly_name: "Alex", entity_picture: avatar("A", "#7aa7ff", "#5161d6") }],
  "person.sam": ["Work", { friendly_name: "Sam", entity_picture: avatar("S", "#ffb37a", "#e0617d") }],
  "zone.work": ["0", { friendly_name: "Work", icon: "mdi:briefcase" }],
  "sensor.alex_phone_battery": ["82", { unit_of_measurement: "%", device_class: "battery" }],
  "sensor.alex_phone_battery_state": "charging",
  "sensor.sam_phone_battery": ["46", { unit_of_measurement: "%", device_class: "battery" }],
  "sensor.sam_phone_battery_state": "discharging",

  // weather and outside
  "weather.home": [
    "partlycloudy",
    { friendly_name: "Home", temperature: 14.6, temperature_unit: "°C", humidity: 64, pressure: 1016, pressure_unit: "hPa", wind_speed: 14, wind_speed_unit: "km/h", wind_bearing: 240, apparent_temperature: 13.2, cloud_coverage: 45, supported_features: 3 },
  ],
  "sensor.outdoor_temperature": temp(14.8, "Outside"),
  "sensor.outdoor_illuminance": ["23400", { unit_of_measurement: "lx", device_class: "illuminance", friendly_name: "Light outside" }],
  "sensor.air_quality_index": ["38", { device_class: "aqi", state_class: "measurement", friendly_name: "Air quality" }],
  "sensor.air_quality_pm2_5": pollutant(9, "PM2.5", "pm25"),
  "sensor.air_quality_pm10": pollutant(17, "PM10", "pm10"),
  "sensor.air_quality_ozone": pollutant(41, "Ozone", "ozone"),
  "sensor.air_quality_nitrogen_dioxide": pollutant(12, "Nitrogen dioxide", "nitrogen_dioxide"),

  // security and the house
  "alarm_control_panel.home_alarm": ["armed_home", { friendly_name: "Home alarm" }],
  "binary_sensor.bedroom_window": ["off", { device_class: "window", friendly_name: "Bedroom window" }],
  "sensor.glass_notifications": ["0", { friendly_name: "Notifications", notes: [] }],

  // energy
  "sensor.grid_power": ["-1240", { unit_of_measurement: "W", device_class: "power", friendly_name: "Grid" }],
  "sensor.home_battery": ["76", { unit_of_measurement: "%", device_class: "battery", friendly_name: "Home battery" }],

  // heat pump and hot water
  "climate.heat_pump": [
    "heat",
    { friendly_name: "Heating", hvac_modes: ["off", "heat"], hvac_action: "heating", preset_modes: ["comfort", "eco", "away"], preset_mode: "comfort", current_temperature: 21.6, temperature: 21.5 },
  ],
  "water_heater.hot_water": ["heat_pump", { friendly_name: "Hot water", temperature: 48, current_temperature: 47, min_temp: 10, max_temp: 60, operation_list: ["eco", "heat_pump", "performance", "off"], operation_mode: "heat_pump" }],
  "binary_sensor.heat_pump_compressor": ["on", { friendly_name: "Compressor" }],
  "binary_sensor.heat_pump_heating": ["on", { friendly_name: "Heating the house" }],
  "binary_sensor.hot_water_heating": ["off", { friendly_name: "Heating the water" }],
  "sensor.heat_pump_supply_temperature": temp(34.2, "Supply"),
  "sensor.heat_pump_return_temperature": temp(29.8, "Return"),
  "sensor.hot_water_temperature": temp(47, "Hot water"),
  "number.heating_curve_shift": ["2", { min: -13, max: 40, step: 1, friendly_name: "Curve shift" }],
  "number.heating_curve_slope": ["1.1", { min: 0.2, max: 3.5, step: 0.1, friendly_name: "Curve slope" }],

  // rooms: climate
  "climate.living_room": room(22.1, 22, "idle", "Living room"),
  "climate.bedroom": room(19.4, 20, "heating", "Bedroom"),
  "climate.kids_room": room(21.2, 21.5, "heating", "Kids' room"),
  "sensor.living_room_temperature": temp(22.1, "Living room"),
  "sensor.kitchen_temperature": temp(22.8, "Kitchen"),
  "sensor.office_temperature": temp(21.4, "Office"),
  "sensor.bedroom_temperature": temp(19.4, "Bedroom"),
  "sensor.kids_room_temperature": temp(21.2, "Kids' room"),

  // rooms: lights, media, blinds
  "light.living_room": ["on", { friendly_name: "Living room ceiling", brightness: 178, color_mode: "color_temp", color_temp_kelvin: 2900, min_color_temp_kelvin: 2200, max_color_temp_kelvin: 6500, supported_color_modes: ["color_temp"] }],
  "light.living_room_lamp": ["on", { friendly_name: "Floor lamp", brightness: 120, supported_color_modes: ["brightness"], color_mode: "brightness" }],
  "light.living_room_strip": ["off", { friendly_name: "TV backlight", supported_color_modes: ["hs"], hs_color: [220, 80] }],
  "scene.living_room_relax": ["2026-01-01T18:00:00+00:00", { friendly_name: "Relax" }],
  "scene.living_room_read": ["2026-01-01T18:00:00+00:00", { friendly_name: "Read" }],
  "scene.living_room_movie": ["2026-01-01T18:00:00+00:00", { friendly_name: "Movie" }],
  "scene.living_room_night": ["2026-01-01T18:00:00+00:00", { friendly_name: "Night" }],
  "media_player.living_room_tv": ["playing", { friendly_name: "Living room TV", media_title: "Nature documentary", app_name: "TV" }],
  "cover.living_room_blind": ["open", { friendly_name: "Living room blind", current_position: 100, current_tilt_position: 50 }],
  "light.kitchen_ceiling": ["off", { friendly_name: "Kitchen ceiling", supported_color_modes: ["brightness"] }],
  "light.kitchen_counter": ["on", { friendly_name: "Counter LED", brightness: 210, supported_color_modes: ["brightness"], color_mode: "brightness" }],
  "media_player.kitchen_speaker": ["playing", { friendly_name: "Kitchen speaker", media_title: "Morning jazz", media_artist: "Radio" }],
  "switch.office_pc": ["on", { friendly_name: "Office PC" }],
  "cover.office_blind": ["open", { friendly_name: "Office blind", current_position: 100, current_tilt_position: 40 }],
  "switch.office_blind_pause": ["off", { friendly_name: "Pause the office blind" }],
  "light.bedroom": ["off", { friendly_name: "Bedroom lamp", supported_color_modes: ["brightness"] }],
  "cover.bedroom_blind": ["closed", { friendly_name: "Bedroom blind", current_position: 0, current_tilt_position: 20 }],
  "light.kids_room": ["off", { friendly_name: "Kids' room light", supported_color_modes: ["brightness"] }],
  "input_boolean.star_projector": ["off", { friendly_name: "Star projector" }],
  "switch.bathroom_light": ["off", { friendly_name: "Bathroom light" }],
  "media_player.bathroom_speaker": ["paused", { friendly_name: "Bathroom speaker" }],

  // blinds automation
  "automation.blinds_by_sun": ["on", { friendly_name: "Blinds follow the sun", last_triggered: iso(-38) }],
  "sensor.blinds_shading_level": ["mid", { friendly_name: "Shading", options: ["open", "min", "mid", "max"] }],
  "input_number.tilt_summer_low": tilt(35, "Summer, low sun"),
  "input_number.tilt_summer_high": tilt(60, "Summer, high sun"),
  "input_number.tilt_winter_low": tilt(15, "Winter, low sun"),
  "input_number.tilt_winter_high": tilt(30, "Winter, high sun"),

  // machines
  "sensor.washer_machine_state": ["run", { friendly_name: "Washer" }],
  "sensor.washer_job_state": ["rinse", { friendly_name: "Washer job" }],
  "sensor.washer_remaining_time": ["0:42", { friendly_name: "Washer time left" }],
  "sensor.washer_completion_time": [iso(42), { device_class: "timestamp", friendly_name: "Washer done at" }],
  "vacuum.robot_vacuum": ["docked", { friendly_name: "Robot vacuum", battery_level: 100, fan_speed: "Automatic" }],
  "sensor.robot_vacuum_battery": ["100", { unit_of_measurement: "%", device_class: "battery" }],
  "lawn_mower.garden_mower": ["mowing", { friendly_name: "Lawn mower" }],
  "sensor.garden_mower_battery": ["64", { unit_of_measurement: "%", device_class: "battery" }],
  "sensor.garden_mower_progress": ["37", { unit_of_measurement: "%" }],

  // calendars
  "calendar.family": ["off", { friendly_name: "Family" }],
  "calendar.waste_collection": ["off", { friendly_name: "Waste collection" }],
};

type Ctx = { set: (id: string, s: DemoState) => void; get: (id: string) => HassEntity | undefined; data: Record<string, any> };

const lights = (ctx: Ctx, list: [string, number | 0][]) => {
  for (const [id, b] of list) ctx.set(id, b ? ["on", { brightness: b }] : ["off", { brightness: null }]);
};

/** What scenes, scripts and helpers do in the demo home. */
export const EFFECTS: Record<string, (ctx: Ctx) => void> = {
  "scene.living_room_relax": (ctx) =>
    lights(ctx, [
      ["light.living_room", 110],
      ["light.living_room_lamp", 140],
      ["light.living_room_strip", 0],
    ]),
  "scene.living_room_read": (ctx) =>
    lights(ctx, [
      ["light.living_room", 255],
      ["light.living_room_lamp", 200],
      ["light.living_room_strip", 0],
    ]),
  "scene.living_room_movie": (ctx) => {
    lights(ctx, [
      ["light.living_room", 0],
      ["light.living_room_lamp", 40],
      ["light.living_room_strip", 160],
    ]);
    ctx.set("cover.living_room_blind", ["closed", { current_position: 0 }]);
    ctx.set("media_player.living_room_tv", "playing");
  },
  "scene.living_room_night": (ctx) =>
    lights(ctx, [
      ["light.living_room", 0],
      ["light.living_room_lamp", 20],
      ["light.living_room_strip", 0],
    ]),
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
  const step = 10 * 60000;
  const value = parseFloat(now.state);
  const numeric = Number.isFinite(value);
  const outside = id === "sensor.outdoor_temperature";
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
    id === "calendar.waste_collection"
      ? [
          { summary: "Paper and plastic", start: day(1), end: day(2) },
          { summary: "General waste", start: day(4), end: day(5) },
        ]
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
