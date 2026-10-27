import { tr } from "../i18n";
import { css, html, nothing } from "lit";
import { GlassElement } from "../core/glass-element";
import type { ActionConfig, BaseCardConfig, HassEntity, HomeAssistant } from "../core/types";
import { registerCard } from "../core/registry";
import { makeEditor } from "../editor/editor";
import { clockWeatherSpec } from "../editor/specs";
import { hour12, language } from "../core/settings";
import { isUnavailable } from "../core/format";
import { surface } from "../core/styles";
import { pressHandlers, runAction, type ActionKind } from "../core/actions";
import { cssColor } from "../core/colors";
import type { FontSpec } from "../core/typography";
import { weatherDefs, weatherIcon, weatherIconStyles } from "./weather-icons";
import { weather3dDefs, weather3dStyles, weatherIcon3d, weatherMdi } from "./weather-icons-3d";
import { LiquidController } from "../core/liquid";
import { CLOCK_WEATHER_PARTS } from "../core/card-parts";

/**
 * Clock + current weather + forecast, one card for the left panel.
 *
 *   type: custom:glass-clock-weather
 *   weather: weather.home
 *   temperature_entity: sensor.outdoor_temperature   # optional, more precise "now"
 *   forecast_type: hourly          # hourly | daily | twice_daily | none
 *   forecast_rows: 5
 *   details: [humidity, wind_speed, pressure, precipitation]   # optional
 */
interface ClockWeatherConfig extends BaseCardConfig {
  weather: string;
  temperature_entity?: string;
  /** `compact`: one line with icon, condition and temperature – for phone headers. */
  variant?: "full" | "compact";
  show_clock?: boolean;
  /** false = clock only (use with a separate glass-divider and a weather-only card). */
  show_weather?: boolean;
  show_seconds?: boolean;
  show_date?: boolean;
  clock_align?: "start" | "center" | "end";
  /** now_style line: where the "12° Prší, přestane …" line sits */
  now_align?: "start" | "center" | "end";
  /** Legacy single forecast; use hourly_forecast / daily_forecast instead. */
  forecast_type?: "hourly" | "daily" | "twice_daily" | "none";
  forecast_rows?: number;
  /** Hours of hourly forecast (0 = off). */
  hourly_forecast?: number;
  /** Days of daily forecast (0 = off). */
  daily_forecast?: number;
  show_icon?: boolean;
  show_temperature?: boolean;
  /** false: no condition text – icon and temperature line up side by side */
  show_condition?: boolean;
  temperature_decimals?: number;
  show_precipitation?: boolean;
  /**
   * Rain in the next two hours (Open-Meteo, 15-minute steps, at the home's location
   * rounded to ~1 km): "Rain from 11:15" with a bar per step – shown only when rain is coming.
   */
  rain_nowcast?: boolean;
  /** rain_nowcast: the bars per 15 minutes (false: just the sentence) */
  rain_bars?: boolean;
  /** `line`: the current weather as one line – "7° Cloudy, rain from 11:20" – no big icon. */
  now_style?: "block" | "line";
  /** `text`: forecast rows as plain text – "Tue  3° / 9°" – no icons or bars. */
  forecast_style?: "bars" | "text" | "columns";
  /** Legacy: line between clock and weather in one card – use a glass-divider card instead. */
  divider?: boolean;
  /** Divider lines under the current weather and above each forecast block. */
  dividers?: boolean;
  details?: string[];
  /** Details as a grid with this many columns (default: one wrapping line). */
  details_columns?: number;
  animated_icons?: boolean;
  /** Big icon: flat (default, the original set) | realistic | mdi. Forecast icons always stay flat. */
  icon_style?: "realistic" | "flat" | "mdi";
  /** forecast bars: temperature (default, warm to cold colours) or single (bar_color); track_color under them */
  bar_style?: "temperature" | "single";
  bar_color?: string;
  track_color?: string;
  /** the precipitation figures in the forecast and the rain bars of the next two hours */
  precip_color?: string;
  rain_color?: string;
  /** divider lines (dividers: true): colour and thickness in px */
  divider_color?: string;
  divider_size?: number;
  /** the detail line (humidity, wind…): text and icons */
  fonts?: Record<string, FontSpec>;
  tap_action?: ActionConfig;
}

interface Forecast {
  datetime: string;
  condition?: string;
  temperature: number;
  templow?: number;
  precipitation?: number;
  precipitation_probability?: number;
  is_daytime?: boolean;
}

const isWet = (s: { mm: number }) => s.mm >= 0.1;
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** HA weather features: which forecasts the entity can deliver. */
const FEATURE: Record<string, number> = { daily: 1, hourly: 2, twice_daily: 4 };

/**
 * Days from an hourly (or twice-daily) forecast, for entities without a daily one:
 * highest / lowest temperature of the day, the weather around midday, rain summed.
 */
function toDaily(list: Forecast[]): Forecast[] {
  const days = new Map<string, Forecast[]>();
  for (const f of list) {
    const d = new Date(f.datetime);
    const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!days.has(k)) days.set(k, []);
    days.get(k)!.push(f);
  }
  return [...days.values()].map((fs) => {
    const hi = Math.max(...fs.map((f) => f.temperature));
    const lo = Math.min(...fs.map((f) => f.templow ?? f.temperature));
    const noon = fs.reduce((b, f) => (Math.abs(new Date(f.datetime).getHours() - 13) < Math.abs(new Date(b.datetime).getHours() - 13) ? f : b));
    const rain = fs.reduce((sum, f) => sum + (f.precipitation ?? 0), 0);
    const prob = Math.max(0, ...fs.map((f) => f.precipitation_probability ?? 0));
    return { datetime: fs[0].datetime, temperature: hi, templow: lo, condition: noon.condition, precipitation: Math.round(rain * 10) / 10, precipitation_probability: prob, is_daytime: true };
  });
}

// Temperature → colour stops for forecast bars.
// macOS system colours, cold → hot (green / yellow / red as the window controls)
const STOPS: [number, [number, number, number]][] = [
  [-10, [10, 132, 255]],
  [0, [100, 210, 255]],
  [10, [102, 212, 207]],
  [17, [40, 200, 64]],
  [22, [254, 188, 46]],
  [28, [255, 159, 10]],
  [35, [255, 95, 87]],
];

function tempColor(t: number): string {
  if (t <= STOPS[0][0]) return `rgb(${STOPS[0][1].join(",")})`;
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, c1] = STOPS[i];
    const [t0, c0] = STOPS[i - 1];
    if (t <= t1) {
      const f = (t - t0) / (t1 - t0);
      return `rgb(${c0.map((v, k) => Math.round(v + (c1[k] - v) * f)).join(",")})`;
    }
  }
  return `rgb(${STOPS[STOPS.length - 1][1].join(",")})`;
}

const DETAIL_ICONS: Record<string, string> = {
  humidity: "mdi:water-percent",
  wind_speed: "mdi:weather-windy",
  pressure: "mdi:gauge",
  precipitation: "mdi:weather-pouring",
  visibility: "mdi:eye-outline",
  uv_index: "mdi:sun-wireless-outline",
  dew_point: "mdi:thermometer-water",
  cloud_coverage: "mdi:cloud-percent-outline",
  apparent_temperature: "mdi:thermometer-lines",
  wind: "mdi:weather-windy",
  wind_gust_speed: "mdi:weather-windy-variant",
  sunrise: "mdi:weather-sunset-up",
  sunset: "mdi:weather-sunset-down",
};
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

class GlassClockWeather extends GlassElement<ClockWeatherConfig> {
  static override parts = CLOCK_WEATHER_PARTS;
  static getConfigElement() {
    return makeEditor(clockWeatherSpec);
  }

  static override properties = { ...GlassElement.properties, _forecasts: { state: true }, _nowcast: { state: true } };
  /** rain_nowcast: start of each 15-minute step and its rain in mm. */
  declare _nowcast?: { t: number; mm: number }[];
  private _nowcastTimer?: number;
  /** Forecast per type (hourly / daily / twice_daily) from weather/subscribe_forecast. */
  declare _forecasts?: Record<string, Forecast[]>;
  private _unsubs: Promise<() => Promise<void>>[] = [];
  private _subKey?: string;
  private _timer?: number;

  constructor() {
    super();
    new LiquidController(this, ".frame");
  }

  static getStubConfig(hass: HomeAssistant) {
    return { weather: Object.keys(hass.states).find((e) => e.startsWith("weather.")) ?? "weather.home" };
  }

  protected override validateConfig(c: ClockWeatherConfig) {
    if (!c.weather && c.show_weather !== false) throw new Error("`weather` entity is required (or show_weather: false for a clock only)");
    return c;
  }

  protected watchedEntities(c: ClockWeatherConfig) {
    // a clock-only card ticks on its own timer – no weather updates needed
    if (c.show_weather === false && c.variant !== "compact") return [];
    return [c.weather, c.temperature_entity, "sun.sun"].filter(Boolean) as string[];
  }

  override connectedCallback() {
    super.connectedCallback();
    this._tick();
    if (this._hass) this._subscribe(this._hass);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    clearTimeout(this._timer);
    clearTimeout(this._nowcastTimer);
    this._nowcastTimer = undefined;
    this._unsubscribe();
  }

  /** rain_nowcast: fetch now and every 10 minutes while connected. */
  private _fetchNowcast(hass: HomeAssistant) {
    if (!this._config?.rain_nowcast || this._nowcastTimer !== undefined) return;
    const lat = Number(hass.config?.latitude);
    const lon = Number(hass.config?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const run = () => {
      fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&minutely_15=precipitation&forecast_minutely_15=12&timeformat=unixtime&timezone=auto`,
      )
        .then((r) => r.json())
        .then((d) => {
          const t: number[] = d?.minutely_15?.time ?? [];
          const p: number[] = d?.minutely_15?.precipitation ?? [];
          this._nowcast = t.map((x, i) => ({ t: x * 1000, mm: p[i] ?? 0 }));
        })
        .catch(() => {});
      this._nowcastTimer = window.setTimeout(run, 600000);
    };
    run();
  }

  override setConfig(config: ClockWeatherConfig) {
    super.setConfig(config);
    if (this._hass && this.isConnected) this._subscribe(this._hass);
  }

  protected override hassChanged(hass: HomeAssistant) {
    if (this.isConnected) {
      this._subscribe(hass);
      this._fetchNowcast(hass);
    }
  }

  /** rain_nowcast: the next two hours in 15-minute steps and "Rain from 11:15" – undefined when it stays dry. */
  private _rainInfo(hass: HomeAssistant, lang: string): { text: string; steps: { t: number; mm: number }[]; raining: boolean } | undefined {
    const now = Date.now();
    // the whole fetched window (3 h) for when it starts / stops, two hours of bars
    const all = (this._nowcast ?? []).filter((s) => s.t + 900000 > now);
    const steps = all.slice(0, 8);
    if (!steps.some(isWet)) return undefined;
    const time = new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit", hour12: hour12(hass) });
    const raining = isWet(steps[0]);
    const edge = raining ? all.find((s) => !isWet(s)) : steps.find(isWet);
    const text = raining
      ? edge
        ? `${tr("rain until")} ${time.format(new Date(edge.t))}`
        : this._rainEnd(lang, time, all[all.length - 1].t + 900000)
      : `${tr("rain from")} ${time.format(new Date(edge!.t))}`;
    return { text, steps, raining };
  }

  /**
   * Raining past the nowcast's three hours: the hourly forecast says when it stops
   * ("prší, přestane kolem 13:00"), else "prší, přestane po 10:00" (the window's end).
   */
  private _rainEnd(lang: string, time: Intl.DateTimeFormat, after: number): string {
    const dry = (this._forecasts?.hourly ?? []).find(
      (f) => new Date(f.datetime).getTime() >= after && (f.precipitation ?? 0) < 0.1 && !/rain|pouring|lightning-rainy|snowy-rainy|hail/.test(f.condition ?? ""),
    );
    if (dry) return `${tr("rain until about")} ${time.format(new Date(dry.datetime))}`;
    return `${tr("rain past")} ${time.format(new Date(after))}`;
  }

  /** A bar per 15 minutes (with the sentence unless it's already in the line above). */
  private _rain(hass: HomeAssistant, lang: string, withText: boolean) {
    const r = this._rainInfo(hass, lang);
    if (!r || (this._config.rain_bars === false && !withText)) return nothing;
    if (this._config.rain_bars === false) return html`<div class="rain"><span class="rain-text">${r.text.charAt(0).toUpperCase() + r.text.slice(1)}</span></div>`;
    const max = Math.max(1, ...r.steps.map((s) => s.mm));
    const text = r.text.charAt(0).toUpperCase() + r.text.slice(1);
    return html`<div class="rain">
      ${withText ? html`<span class="rain-text">${text}</span>` : nothing}
      <span class="rain-bars">${r.steps.map((s) => html`<i class=${isWet(s) ? "wet" : ""} style="height:${isWet(s) ? Math.max(18, (s.mm / max) * 100) : 8}%"></i>`)}</span>
    </div>`;
  }

  /** Re-render on the minute (or second) boundary, not on a free-running interval. */
  private _tick() {
    clearTimeout(this._timer);
    if (this._config?.show_clock === false) return;
    const now = Date.now();
    const period = this._config?.show_seconds ? 1000 : 60000;
    this._timer = window.setTimeout(
      () => {
        this.requestUpdate();
        this._tick();
      },
      period - (now % period) + 20,
    );
  }

  /** Which forecasts to show: hourly_forecast / daily_forecast, else the legacy forecast_type. */
  private _blocks(): { type: string; count: number }[] {
    const c = this._config;
    if (!c || c.show_weather === false || c.variant === "compact") return [];
    if (c.hourly_forecast !== undefined || c.daily_forecast !== undefined) {
      const out: { type: string; count: number }[] = [];
      if (c.hourly_forecast) out.push({ type: "hourly", count: c.hourly_forecast });
      if (c.daily_forecast) out.push({ type: "daily", count: c.daily_forecast });
      return out;
    }
    const type = c.forecast_type ?? "hourly";
    return type === "none" ? [] : [{ type, count: c.forecast_rows ?? 5 }];
  }

  private _subscribe(hass: HomeAssistant) {
    if (!this._config) return;
    // a type the entity cannot deliver comes from one it can (days from hours)
    const sf = Number(hass.states[this._config.weather]?.attributes.supported_features ?? 0);
    const source = (t: string) => (!sf || sf & FEATURE[t] ? t : t === "daily" && sf & FEATURE.twice_daily ? "twice_daily" : sf & FEATURE.hourly ? "hourly" : t);
    const types = [...new Set(this._blocks().map((b) => source(b.type)))];
    const key = `${this._config.weather}|${types.join(",")}`;
    if (key === this._subKey) return;
    this._unsubscribe();
    this._subKey = key;
    for (const type of types)
      this._unsubs.push(
        hass.connection
          .subscribeMessage<{ forecast: Forecast[] }>((ev) => (this._forecasts = { ...this._forecasts, [type]: ev.forecast }), {
            type: "weather/subscribe_forecast",
            forecast_type: type,
            entity_id: this._config.weather,
          })
          // unsupported: stay unsubscribed (retrying on every state change would only repeat the error)
          .catch(() => async () => {}),
      );
  }

  private _unsubscribe() {
    for (const u of this._unsubs) u.then((f) => f()).catch(() => {});
    this._unsubs = [];
    this._subKey = undefined;
  }

  /** The condition as text; some sources (Aladin) say "sunny" all night – that's a clear night. */
  private _condText(hass: HomeAssistant, st: HassEntity): string {
    const s = st.state === "sunny" && this._isNight(hass) ? { ...st, state: "clear-night" } : st;
    return hass.formatEntityState ? hass.formatEntityState(s) : s.state;
  }

  private _isNight(hass: HomeAssistant, at?: Date): boolean {
    const sun = hass.states["sun.sun"];
    if (!sun) return false;
    if (!at) return sun.state === "below_horizon";
    const rise = new Date(sun.attributes.next_rising);
    const set = new Date(sun.attributes.next_setting);
    const minutes = (d: Date) => d.getHours() * 60 + d.getMinutes();
    const m = minutes(at);
    return m < minutes(rise) || m > minutes(set);
  }

  /** Inside an Apple Home sidebar the weather icons go monochrome (unless icon_style is realistic / mdi). */
  private get _mono() {
    // "flat" is the default (the editor writes it out), so only realistic / mdi opt out
    const style = this._config.icon_style;
    return (!style || style === "flat") && getComputedStyle(this).getPropertyValue("--glass-mono-icons").trim() === "1";
  }

  override firstUpdated() {
    // the panel's glass attribute may arrive after the first render
    requestAnimationFrame(() => this._mono && this.requestUpdate());
  }

  private _bigIcon(condition: string, night: boolean) {
    const style = this._mono ? "mdi" : (this._config.icon_style ?? "flat");
    if (style === "mdi") {
      const color = cssColor(this._config.icons?.weather?.color);
      return html`<ha-icon class="mdi" .icon=${weatherMdi(condition, night)} style=${color ? `color:${color}` : ""}></ha-icon>`;
    }
    return style === "flat" ? weatherIcon(condition, night) : weatherIcon3d(condition, night);
  }

  private _clock(lang: string) {
    const c = this._config;
    const now = new Date();
    const h12 = hour12(this._hass) ?? false;
    const parts = new Intl.DateTimeFormat(lang, {
      hour: h12 ? "numeric" : "2-digit",
      minute: "2-digit",
      second: c.show_seconds ? "2-digit" : undefined,
      hour12: h12,
    }).formatToParts(now);
    const time = parts
      .filter((p) => p.type !== "dayPeriod")
      .map((p) => p.value)
      .join("")
      .trim();
    const period = parts.find((p) => p.type === "dayPeriod")?.value;
    return html`<div class="clock" style="text-align:${c.clock_align ?? "center"}">
      <span class="time">${time}</span>${period ? html`<span class="ampm">${period}</span>` : nothing}
      ${c.show_date
        ? html`<div class="date">${new Intl.DateTimeFormat(lang, { weekday: "long", day: "numeric", month: "long" }).format(now)}</div>`
        : nothing}
    </div>`;
  }

  private _now(hass: HomeAssistant, st: HassEntity, lang: string) {
    const c = this._config;
    const tempSt = c.temperature_entity ? hass.states[c.temperature_entity] : undefined;
    const raw = tempSt && !isUnavailable(tempSt) ? Number(tempSt.state) : Number(st.attributes.temperature);
    const unit = st.attributes.temperature_unit ?? tempSt?.attributes.unit_of_measurement ?? "°C";
    const temp = Number.isNaN(raw) ? "–" : new Intl.NumberFormat(lang, { maximumFractionDigits: c.temperature_decimals ?? 0 }).format(raw);
    let cond = this._condText(hass, st);
    const f = this._forecasts;
    const today = f?.daily?.[0] ?? (f?.twice_daily ?? f?.hourly ? toDaily((f.twice_daily ?? f.hourly)!)[0] : undefined);
    const showIcon = c.show_icon !== false;
    const showTemp = c.show_temperature !== false;
    const showCond = c.show_condition !== false;
    if (!showIcon && !showTemp && !showCond) return nothing;
    if (c.now_style === "line") {
      // "7° Zataženo, déšť od 11:20"; while it rains the sentence says it all: "12° Prší do 9:30"
      const ri = c.rain_nowcast ? this._rainInfo(hass, lang) : undefined;
      const rain = ri?.text;
      if (ri?.raining) cond = rain!.charAt(0).toUpperCase() + rain!.slice(1);
      return html`<div class="now-line" style=${c.now_align ? `justify-content:${c.now_align === "start" ? "flex-start" : c.now_align === "end" ? "flex-end" : "center"}` : ""}>
        ${showIcon && c.icon_style === "mdi" ? html`<span class="line-icon">${this._bigIcon(st.state, this._isNight(hass))}</span>` : nothing}
        ${showTemp ? html`<span class="temp">${temp}°</span>` : nothing}
        ${showCond ? html`<span class="cond">${cond}${rain && !ri?.raining ? `, ${rain}` : ""}</span>` : nothing}
      </div>`;
    }
    return html`<div class="now">
      ${showIcon ? html`<div class="big-icon ${c.animated_icons === false ? "" : "animated"}">${this._bigIcon(st.state, this._isNight(hass))}</div>` : nothing}
      <div class="now-text">
        ${showCond ? html`<div class="cond">${cond}</div>` : nothing}
        ${showTemp ? html`<div class="temp">${temp}<span class="unit">${unit}</span></div>` : nothing}
        ${today?.templow !== undefined
          ? html`<div class="hilo">↑ ${Math.round(today.temperature)}° ↓ ${Math.round(today.templow)}°</div>`
          : nothing}
      </div>
    </div>`;
  }

  private _details(hass: HomeAssistant, st: HassEntity, lang: string) {
    const list = this._config.details ?? [];
    if (!list.length) return nothing;
    const nf = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 });
    const unitOf: Record<string, string | undefined> = {
      wind_speed: st.attributes.wind_speed_unit,
      wind: st.attributes.wind_speed_unit,
      wind_gust_speed: st.attributes.wind_speed_unit,
      pressure: st.attributes.pressure_unit,
      visibility: st.attributes.visibility_unit,
      precipitation: st.attributes.precipitation_unit,
      humidity: "%",
      cloud_coverage: "%",
      dew_point: st.attributes.temperature_unit,
      apparent_temperature: st.attributes.temperature_unit,
    };
    const cols = this._config.details_columns;
    const icon = (k: string) => html`<ha-icon .icon=${DETAIL_ICONS[k] ?? "mdi:information-outline"}></ha-icon>`;
    return html`<div class="details ${cols ? "cols" : ""}" style=${cols ? `--cols:${cols}` : ""}>
      ${list.map((k) => {
        // wind: speed with the direction it blows from (arrow points where it goes)
        if (k === "wind") {
          const sp = st.attributes.wind_speed;
          if (sp === undefined || sp === null) return nothing;
          const b = st.attributes.wind_bearing;
          const dir = typeof b === "number" ? tr(`compass.${COMPASS[Math.round(b / 45) % 8]}`) : "";
          return html`<span>${icon(k)}${dir ? html`<ha-icon class="arrow" icon="mdi:navigation" style="transform:rotate(${(b as number) + 180}deg)"></ha-icon>${dir}&nbsp;` : nothing}${nf.format(sp)}<small>${unitOf[k] ?? ""}</small></span>`;
        }
        if (k === "sunrise" || k === "sunset") {
          const t = hass.states["sun.sun"]?.attributes[k === "sunrise" ? "next_rising" : "next_setting"];
          if (!t) return nothing;
          const time = new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit", hour12: hour12(hass) }).format(new Date(t));
          return html`<span>${icon(k)}${time}</span>`;
        }
        let v = st.attributes[k];
        if (k === "precipitation" && v === undefined) v = (this._forecasts?.hourly ?? this._forecasts?.daily)?.[0]?.precipitation;
        if (v === undefined || v === null) return nothing;
        const val = typeof v === "number" ? nf.format(v) : v;
        return html`<span><ha-icon .icon=${DETAIL_ICONS[k] ?? "mdi:information-outline"}></ha-icon>${val}${unitOf[k] ? html`<small>${unitOf[k]}</small>` : nothing}</span>`;
      })}
    </div>`;
  }

  private _forecastRows(hass: HomeAssistant, lang: string, type: string, count: number) {
    const c = this._config;
    const now = Date.now();
    const f = this._forecasts;
    const list = f?.[type] ?? (type === "daily" && (f?.twice_daily ?? f?.hourly) ? toDaily((f.twice_daily ?? f.hourly)!) : []);
    const rows = list
      // Hourly: upcoming full hours. Daily: from today on.
      .filter((f) => new Date(f.datetime).getTime() > (type === "hourly" ? now : now - 86400e3))
      .slice(0, count);
    if (!rows.length) return nothing;
    const temps = rows.flatMap((r) => [r.temperature, r.templow ?? r.temperature]);
    const min = Math.min(...temps);
    const max = Math.max(...temps);
    const span = Math.max(1, max - min);
    const pos = (t: number) => ((t - min) / span) * 100;
    const fmt =
      type === "hourly"
        ? new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit", hour12: hour12(hass) })
        : new Intl.DateTimeFormat(lang, { weekday: "short" });
    if (c.forecast_style === "text")
      return html`<div class="forecast-text">
        ${rows.map(
          (r) => html`<div class="row"><span>${cap(fmt.format(new Date(r.datetime)))}</span><span class="t">${r.templow !== undefined ? html`${Math.round(r.templow)}° / ` : nothing}${Math.round(r.temperature)}°</span></div>`,
        )}
      </div>`;
    const mono = this._mono;
    // one colour for the bars: the mono look (MDI icons) or bar_style: single
    const one = mono || this._config.bar_style === "single";
    // forecast_style: columns – time, icon and temperature side by side (Apple's hourly strip)
    if (c.forecast_style === "columns")
      return html`<div class="forecast-cols" style="grid-template-columns:repeat(${rows.length},1fr)">
        ${rows.map((r) => {
          const when = new Date(r.datetime);
          const night = r.is_daytime === undefined ? type === "hourly" && this._isNight(hass, when) : !r.is_daytime;
          const color = cssColor(c.icons?.forecast?.color ?? c.icons?.weather?.color);
          return html`<div class="col">
            <span class="when">${cap(fmt.format(when))}</span>
            <span class="mini-icon"
              >${mono || c.icon_style === "mdi" ? html`<ha-icon class="mdi" .icon=${weatherMdi(r.condition, night)} style=${color ? `color:${color}` : ""}></ha-icon>` : weatherIcon(r.condition, night)}</span
            >
            <span class="t">${r.templow !== undefined ? html`${Math.round(r.templow)}° / ` : nothing}${Math.round(r.temperature)}°</span>
          </div>`;
        })}
      </div>`;
    const showPrecip = c.show_precipitation ?? false;
    const unit = (hass.states[c.weather]?.attributes.temperature_unit as string | undefined) ?? "°C";
    return html`<div class="forecast ${showPrecip ? "with-precip" : ""}">
      ${rows.map((r) => {
        const when = new Date(r.datetime);
        const night = r.is_daytime === undefined ? type === "hourly" && this._isNight(hass, when) : !r.is_daytime;
        const lo = r.templow ?? r.temperature;
        const precip = r.precipitation_probability ?? (r.precipitation ? undefined : 0);
        const wet = showPrecip && ((r.precipitation ?? 0) > 0 || (r.precipitation_probability ?? 0) >= 20);
        return html`<div class="row">
          <span class="when">${fmt.format(when)}</span>
          <span class="mini-icon"
            >${mono ? html`<ha-icon class="mdi" .icon=${weatherMdi(r.condition, night)}></ha-icon>` : weatherIcon(r.condition, night)}</span
          >
          <span class="t lo">${Math.round(lo)}${unit}</span>
          <span class="bar">
            ${r.templow !== undefined
              ? html`<i
                  class="range"
                  style="left:${pos(lo)}%;width:${Math.max(4, pos(r.temperature) - pos(lo))}%;background:${one
                    ? "var(--glass-bar-mono, currentColor)"
                    : `linear-gradient(90deg,${tempColor(lo)},${tempColor(r.temperature)})`}"
                ></i>`
              : html`<i
                  class="dot"
                  style="left:calc(10px + (100% - 20px) * ${pos(r.temperature) / 100});background:${one ? "var(--glass-bar-mono, currentColor)" : tempColor(r.temperature)}"
                ></i>`}
          </span>
          <span class="t hi">${Math.round(r.temperature)}${unit}</span>
          ${showPrecip
            ? html`<span class="precip ${wet ? "" : "dry"}"
                >${wet ? (precip !== undefined && precip > 0 ? `${precip}%` : `${r.precipitation} mm`) : ""}</span
              >`
            : nothing}
        </div>`;
      })}
    </div>`;
  }

  private _compact(hass: HomeAssistant, st: HassEntity | undefined, lang: string, h: ReturnType<typeof pressHandlers>) {
    if (!st) return html`<div class="missing">${this._config.weather}?</div>`;
    const c = this._config;
    const tempSt = c.temperature_entity ? hass.states[c.temperature_entity] : undefined;
    const raw = tempSt && !isUnavailable(tempSt) ? Number(tempSt.state) : Number(st.attributes.temperature);
    const unit = st.attributes.temperature_unit ?? "°C";
    const temp = Number.isNaN(raw) ? "–" : new Intl.NumberFormat(lang, { maximumFractionDigits: c.temperature_decimals ?? 0 }).format(raw);
    return html`${weatherDefs}${weather3dDefs}
      <div class="compact" role="button" tabindex="0" @pointerdown=${h.down} @pointerup=${h.up} @pointercancel=${h.cancel} @keydown=${h.key}>
        <div class="c-icon ${c.animated_icons === false ? "" : "animated"}">${this._bigIcon(st.state, this._isNight(hass))}</div>
        <div class="c-text">
          <span class="c-temp">${temp}<small>${unit}</small></span>
          <span class="c-cond">${this._condText(hass, st)}</span>
        </div>
      </div>`;
  }

  protected override render() {
    if (!this._config || !this._hass) return nothing;
    const hass = this._hass;
    const c = this._config;
    const st = hass.states[c.weather];
    const lang = language(hass);
    const target = { entity: c.weather, tap_action: c.tap_action ?? { action: "more-info" } };
    const h = pressHandlers(
      () => target,
      (kind: ActionKind) => runAction(this, hass, target, kind),
    );
    if (c.variant === "compact") return this._compact(hass, st, lang, h);
    const col = (v: string | undefined, name: string) => (v && v !== "none" ? `${name}:${cssColor(v)};` : "");
    const look =
      col(c.bar_color, "--glass-bar-mono") +
      col(c.track_color, "--glass-bar-track") +
      col(c.precip_color, "--cw-precip") +
      col(c.rain_color, "--cw-rain") +
      col(c.divider_color, "--glass-divider-color") +
      (c.divider_size ? `--glass-divider-size:${c.divider_size}px;` : "");
    // glass: none – no frame of its own, just the text on whatever is behind (a phone's header)
    return html`<div class="frame ${c.glass === "none" ? "flat" : "surface"}" style=${look}>
      ${weatherDefs}${weather3dDefs} ${c.show_clock === false ? nothing : this._clock(lang)}
      ${c.show_weather === false
        ? nothing
        : st
        ? html`<div class="weather" role="button" tabindex="0" @pointerdown=${h.down} @pointerup=${h.up} @pointercancel=${h.cancel} @keydown=${h.key}>
            ${c.show_clock !== false && c.divider ? html`<hr />` : nothing} ${this._now(hass, st, lang)}
            ${c.rain_nowcast ? this._rain(hass, lang, c.now_style !== "line") : nothing}
            ${c.dividers && (c.details ?? []).length ? html`<hr />` : nothing} ${this._details(hass, st, lang)}
            ${this._blocks().map((b) => html`${c.dividers ? html`<hr />` : nothing}${this._forecastRows(hass, lang, b.type, b.count)}`)}
          </div>`
        : html`<div class="missing">${c.weather}?</div>`}
    </div>`;
  }

  static override styles = [
    GlassElement.styles,
    surface,
    weatherIconStyles,
    weather3dStyles,
    css`
      .big-icon ha-icon.mdi,
      .c-icon ha-icon.mdi {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
        --mdc-icon-size: 78%;
        filter: var(--g-icon-shadow);
        color: var(--glass-accent-icon, currentColor);
      }
      .big-icon ha-icon.mdi {
        --mdc-icon-size: calc(var(--glass-weather-icon-size, clamp(80px, 36cqi, 150px)) * 0.62);
        color: var(--glass-weather-icon-color, var(--glass-accent-icon, currentColor));
      }
      .c-icon ha-icon.mdi {
        --mdc-icon-size: calc(var(--glass-weather-icon-size, 46px) * 0.85);
      }
      :host {
        display: block;
      }
      :host(:not([nested])) {
        height: 100%;
      }
      .frame {
        container-type: inline-size;
        height: 100%;
        border-radius: var(--g-radius-lg);
        padding: 22px 26px;
        display: flex;
        flex-direction: column;
        gap: 14px;
        text-shadow: var(--g-text-shadow);
      }
      .frame.flat {
        padding: 0;
        border-radius: 0;
      }
      /* inside a panel the panel is the glass; the frame is only a layout box */
      /* (a card with its own glass on a panel without any – own-tile – is its own tile) */
      :host([nested][glass]:not([own-tile])) .frame.surface {
        background: none !important;
        border: none !important;
        box-shadow: none !important;
        -webkit-backdrop-filter: none !important;
        backdrop-filter: none !important;
        padding: 0;
      }
      /* home tiles on a panel without glass: the card is its own tile */
      :host([nested][on-bare][glass="home"]) .frame.surface {
        background: var(--glass-home-fill, linear-gradient(var(--glass-home-surface, rgba(246, 246, 248, 0.8)), var(--glass-home-surface, rgba(246, 246, 248, 0.8)))) !important;
        border: 0.5px solid var(--glass-home-border, rgba(255, 255, 255, 0.35)) !important;
        box-shadow: var(--glass-home-shadow, 0 4px 16px rgba(0, 0, 0, 0.1)) !important;
        -webkit-backdrop-filter: blur(calc(var(--glass-home-blur, 24px) * var(--glass-blur-scale, 1))) saturate(var(--glass-home-saturate, 100%)) !important;
        backdrop-filter: blur(calc(var(--glass-home-blur, 24px) * var(--glass-blur-scale, 1))) saturate(var(--glass-home-saturate, 100%)) !important;
        padding: 18px 22px;
        border-radius: var(--g-radius);
      }
      /* no tile of its own → the text keeps the panel's colours, not the tile material's */
      /* on a panel the frame is no tile: the text keeps the panel's colours */
      :host([nested]:not([on-bare])) .frame.surface {
        --g-text: inherit;
        --g-text-2: inherit;
        --g-text-shadow: inherit;
        --g-icon-shadow: inherit;
        --wi-cloud-top: inherit;
        --wi-cloud-bottom: inherit;
        --wi-cloud-back-top: inherit;
        --wi-cloud-back-bottom: inherit;
        color: inherit;
      }
      :host([nested]:not([own-tile])) .frame::before,
      :host([nested]:not([own-tile])) .frame::after {
        display: none;
      }
      .clock {
        line-height: 0.82;
        font-variant-numeric: tabular-nums;
      }
      .time {
        font-family: var(--gt-time-font, inherit);
        font-size: var(--gt-time-size, var(--glass-clock-size, clamp(64px, 41cqi, 170px)));
        font-weight: var(--gt-time-weight, var(--glass-clock-weight, 300));
        font-style: var(--gt-time-style, normal);
        color: var(--gt-time-color, inherit);
        letter-spacing: var(--gt-time-spacing, -0.035em);
      }
      .ampm {
        font-size: 22px;
        margin-left: 6px;
        font-weight: 400;
      }
      .date {
        font-family: var(--gt-date-font, inherit);
        font-size: var(--gt-date-size, 18px);
        font-weight: var(--gt-date-weight, 400);
        font-style: var(--gt-date-style, normal);
        letter-spacing: var(--gt-date-spacing, normal);
        margin-top: 8px;
        color: var(--gt-date-color, var(--g-text-2));
      }
      hr {
        align-self: center;
        border: none;
        height: var(--glass-divider-size, 2px);
        border-radius: 2px;
        /* follows the text colour, so it works on light (home) materials too */
        background: var(--glass-divider-color, color-mix(in srgb, var(--g-text) 55%, transparent));
        width: 92%;
        margin: 6px 0 4px;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
      }
      .weather {
        display: flex;
        flex-direction: column;
        gap: 14px;
        cursor: pointer;
        outline: none;
      }
      /* icon and temperature as one centered group, about as wide as the clock */
      .now {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: clamp(14px, 8cqi, 36px);
      }
      .big-icon {
        width: var(--glass-weather-icon-size, clamp(80px, 36cqi, 150px));
        height: var(--glass-weather-icon-size, clamp(80px, 36cqi, 150px));
        flex: none;
        margin: -10px 0 -10px -8px;
      }
      .now-text {
        text-align: right;
      }
      .cond {
        font-family: var(--gt-condition-font, inherit);
        font-size: var(--gt-condition-size, 15px);
        font-weight: var(--gt-condition-weight, 500);
        font-style: var(--gt-condition-style, normal);
        letter-spacing: var(--gt-condition-spacing, normal);
        color: var(--gt-condition-color, var(--g-text-2));
      }
      .temp {
        font-family: var(--gt-temperature-font, inherit);
        font-size: var(--gt-temperature-size, var(--glass-weather-temp-size, clamp(40px, 18cqi, 76px)));
        font-weight: var(--gt-temperature-weight, var(--glass-weather-temp-weight, 400));
        font-style: var(--gt-temperature-style, normal);
        color: var(--gt-temperature-color, inherit);
        line-height: 1;
        letter-spacing: var(--gt-temperature-spacing, -0.02em);
      }
      .unit {
        font-size: 0.55em;
        vertical-align: top;
        margin-left: 2px;
        font-weight: 400;
      }
      .hilo {
        font-size: 13px;
        color: var(--g-text-2);
        margin-top: 4px;
      }
      .details {
        display: flex;
        flex-wrap: wrap;
        gap: 6px 14px;
        font-family: var(--gt-details-font, inherit);
        font-size: var(--gt-details-size, 13px);
        font-weight: var(--gt-details-weight, 500);
        font-style: var(--gt-details-style, normal);
        letter-spacing: var(--gt-details-spacing, normal);
        color: var(--gt-details-color, var(--g-text-2));
      }
      .details span {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      /* columns as wide as their values, spread evenly over the card: the block sits
         centred under the temperature, each column still left-aligned */
      .details.cols {
        display: grid;
        grid-template-columns: repeat(var(--cols), auto);
        justify-content: space-evenly;
        gap: 10px 16px;
      }
      .details.cols span {
        white-space: nowrap;
      }
      .details ha-icon.arrow {
        --mdc-icon-size: 13px;
        color: inherit;
      }
      .details small {
        font-size: 11px;
        opacity: 0.8;
      }
      .details ha-icon {
        --mdc-icon-size: 16px;
        color: var(--glass-accent-icon, inherit);
      }
      .forecast {
        display: grid;
        grid-template-columns: max-content 22px max-content minmax(0, 1fr) max-content;
        align-items: center;
        column-gap: 8px;
        row-gap: 8px;
        line-height: 20px;
        font-family: var(--gt-forecast-font, inherit);
        font-size: var(--gt-forecast-size, 14px);
        font-weight: var(--gt-forecast-weight, 400);
        font-style: var(--gt-forecast-style, normal);
        letter-spacing: var(--gt-forecast-spacing, normal);
        color: var(--gt-forecast-color, inherit);
        font-variant-numeric: tabular-nums;
      }
      .forecast.with-precip {
        grid-template-columns: max-content 22px max-content minmax(0, 1fr) max-content max-content;
      }
      .row {
        display: contents;
      }
      .when {
        color: var(--g-text-2);
        white-space: nowrap;
      }
      .mini-icon {
        display: block;
        width: 22px;
        height: 22px;
      }
      .mini-icon ha-icon.mdi {
        --mdc-icon-size: 22px;
        color: var(--glass-accent-icon, currentColor);
      }
      .mini-icon > * {
        display: block;
        width: 100%;
        height: 100%;
      }
      .t {
        text-align: right;
      }
      .t.hi {
        text-align: left;
      }
      .bar {
        position: relative;
        height: 20px;
        border-radius: 10px;
        background: var(--glass-bar-track, color-mix(in srgb, var(--g-text) 18%, transparent));
        box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.06);
      }
      .bar .dot,
      .bar .range {
        position: absolute;
        top: 0;
        height: 20px;
        border-radius: 10px;
        box-shadow:
          0 1px 4px rgba(0, 0, 0, 0.15),
          inset 0 1px 1px rgba(255, 255, 255, 0.5);
      }
      .bar .dot {
        width: 20px;
        margin-left: -10px;
      }
      .precip {
        font-size: 11px;
        color: var(--cw-precip, #9fd8ff);
        min-width: 26px;
        text-align: right;
      }
      .precip.dry {
        min-width: 0;
      }
      /* now_style: line – "7° Zataženo, déšť od 11:20" */
      .now-line {
        display: flex;
        align-items: baseline;
        gap: 10px;
        flex-wrap: wrap;
      }
      .now-line .temp {
        font-size: 34px;
        font-weight: 400;
        line-height: 1;
      }
      .now-line .cond {
        font-size: 14px;
        opacity: 0.8;
      }
      .now-line .line-icon {
        align-self: center;
        display: flex;
      }
      .now-line .line-icon ha-icon {
        --mdc-icon-size: 26px;
      }
      /* forecast_style: columns */
      .forecast-cols {
        display: grid;
        gap: 4px;
        text-align: center;
      }
      .forecast-cols .col {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
      }
      .forecast-cols .when {
        font-size: 12px;
        color: var(--g-text-2);
        font-variant-numeric: tabular-nums;
      }
      .forecast-cols .mini-icon ha-icon {
        --mdc-icon-size: 22px;
      }
      .forecast-cols .t {
        font-size: 15px;
        font-variant-numeric: tabular-nums;
      }
      /* forecast_style: text – "Út   3° / 9°" */
      .forecast-text {
        display: flex;
        flex-direction: column;
        gap: 8px;
        font-size: 14px;
      }
      .forecast-text .row {
        display: flex;
        justify-content: space-between;
      }
      .forecast-text .t {
        opacity: 0.75;
        font-variant-numeric: tabular-nums;
      }
      /* rain_nowcast: a line of text, then a bar per 15 minutes */
      .rain {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-top: 10px;
        font-size: 13px;
      }
      .rain-text {
        flex: none;
        opacity: 0.85;
      }
      .rain-bars {
        flex: 1;
        height: 18px;
        display: flex;
        align-items: flex-end;
        gap: 3px;
      }
      .rain-bars i {
        flex: 1;
        border-radius: 2px;
        background: currentColor;
        opacity: 0.18;
      }
      .rain-bars i.wet {
        background: var(--cw-rain, #64d2ff);
        opacity: 0.9;
      }
      .missing {
        opacity: 0.6;
      }
      .compact {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
        cursor: pointer;
        outline: none;
        text-shadow: var(--g-text-shadow);
      }
      .c-icon {
        width: var(--glass-weather-icon-size, 46px);
        height: var(--glass-weather-icon-size, 46px);
        flex: none;
      }
      .c-text {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        line-height: 1.1;
      }
      .c-temp {
        font-size: var(--glass-weather-temp-size, 26px);
        font-weight: var(--glass-weather-temp-weight, 400);
        letter-spacing: -0.01em;
      }
      .c-temp small {
        font-size: 0.6em;
        margin-left: 1px;
        vertical-align: top;
      }
      .c-cond {
        font-size: 12px;
        font-weight: 500;
        color: var(--g-text-2);
      }
    `,
  ];
}

registerCard("glass-clock-weather", GlassClockWeather, {
  name: "Glass – clock & weather",
  description: "Large clock, current weather with an animated icon and a forecast with temperature bars.",
});
