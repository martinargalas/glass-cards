import { locale, tr } from "../i18n";
import { css, html, nothing, svg } from "lit";
import { GlassElement } from "../core/glass-element";
import type { BaseCardConfig, HassEntity, HomeAssistant } from "../core/types";
import { registerCard } from "../core/registry";
import { makeEditor } from "../editor/editor";
import { heatPumpSpec } from "../editor/specs";
import { haptic } from "../core/actions";
import { cssColor } from "../core/colors";
import { materials, matTint, type Material } from "../core/materials";
import { HEAT_PUMP_PARTS } from "../core/card-parts";
import { surface } from "../core/styles";

/**
 * Heat pump: the flow of heat drawn like the energy flow card (glowing nodes, laser
 * beams along the pipes) – outside air → the pump → heating and / or the hot water
 * tank – with the heating mode, the hot water set point and the heating curve under it,
 * and a service drawer (starts, hours, pressure, flow).
 *
 *   type: custom:glass-heat-pump
 *   device: 0123456789abcdef0123456789abcdef   # the pump's device: its entities are found by name
 *   entities:                                   # optional: any of them by hand (other brands)
 *     climate: climate.e3_tcu10_x07_heating
 *     water_heater: water_heater.e3_tcu10_x07_domestic_hot_water
 *     compressor: binary_sensor.e3_tcu10_x07_compressor
 *     outside: sensor.e3_tcu10_x07_outside_temperature
 *     supply: sensor.e3_tcu10_x07_secondary_circuit_supply_temperature
 *     return: sensor.e3_tcu10_x07_return_temperature
 *     dhw: sensor.e3_tcu10_x07_dhw_storage_temperature
 *     curve_shift: number.e3_tcu10_x07_heating_curve_shift
 *     curve_slope: number.e3_tcu10_x07_heating_curve_slope
 *
 *     heating_active: sensor.heating_on      # on while it heats the house
 *     dhw_active: sensor.water_heating_on     # on while it heats the hot water
 *     rod: binary_sensor.heat_pump_heating_rod # on while the electric heating rod runs: the pump turns red
 *   show_dhw_setpoint: false                  # no − / + for the hot water
 *   show_animation: false                     # no beams, breathing or spinning
 *   show_modes: false                         # no heating mode (off / presets)
 *   show_settings: false                      # no settings drawer (water mode, curve, service)
 *
 *   modes_glass: flat        # the modes' track (core/materials); modes_color tints it
 *   active_glass: liquid     # the picked mode (default Apple Home's dark glass); active_color
 *   buttons_glass: frosted   # the − value + fields (default dark glass); buttons_color
 *   outside_color / heating_color / dhw_color / rod_color / idle_color   # the scheme's nodes and beams
 *   icons: { node: { color: white } }   # the symbols in the nodes (core/card-parts)
 *
 * Whatever has no entity is left out and the rest closes up: a value without a sensor,
 * the hot water without a tank, the curve without its numbers, the service lines one by one.
 *
 * Where the heat goes: `heating_active` / `dhw_active` when given, else into the heating
 * while the climate entity says `heating` and otherwise (compressor running) into the tank.
 * The circulation pump is a small disc on the heating pipe, frost protection a snowflake
 * on the outside node; both lit while on.
 */
type Role =
  | "climate"
  | "water_heater"
  | "compressor"
  | "pump"
  | "frost"
  | "phase"
  | "outside"
  | "supply"
  | "return"
  | "dhw"
  | "dhw_mode"
  | "curve_shift"
  | "curve_slope"
  | "compressor_starts"
  | "compressor_hours"
  | "rod_starts"
  | "rod_hours"
  | "pressure"
  | "flow"
  | "heating_active"
  | "dhw_active"
  | "rod";

interface HeatPumpConfig extends BaseCardConfig {
  device?: string;
  entities?: Partial<Record<Role, string>>;
  name?: string;
  /** The hot water set point (− / +) under the scheme; false hides it. */
  show_dhw_setpoint?: boolean;
  show_animation?: boolean;
  show_modes?: boolean;
  show_settings?: boolean;
  modes_glass?: Material;
  modes_color?: string;
  active_glass?: Material;
  active_color?: string;
  buttons_glass?: Material;
  buttons_color?: string;
  outside_color?: string;
  heating_color?: string;
  dhw_color?: string;
  rod_color?: string;
  idle_color?: string;
}

/** How each role is recognised among the device's entities (domain, end of the entity id). */
const FIND: [Role, string, RegExp][] = [
  ["climate", "climate", /heating|_hk1|circuit/],
  ["water_heater", "water_heater", /./],
  ["compressor", "binary_sensor", /compressor$/],
  ["pump", "binary_sensor", /circulation_pump$/],
  ["frost", "binary_sensor", /frost_protection$/],
  ["phase", "sensor", /compressor_phase$/],
  ["outside", "sensor", /outside_temperature$/],
  ["supply", "sensor", /secondary_circuit_supply_temperature$|(?<!primary_circuit_|boiler_)supply_temperature$/],
  ["return", "sensor", /return_temperature$/],
  ["dhw", "sensor", /dhw_storage_temperature$|hot_water_temperature$/],
  ["dhw_mode", "select", /dhw_operating_mode$/],
  ["curve_shift", "number", /heating_curve_shift$/],
  ["curve_slope", "number", /heating_curve_slope$/],
  ["compressor_starts", "sensor", /compressor_starts$/],
  ["compressor_hours", "sensor", /compressor_hours$/],
  ["rod_starts", "sensor", /heating_rod_starts$/],
  ["rod_hours", "sensor", /heating_rod_hours$/],
  ["pressure", "sensor", /supply_pressure$|pressure$/],
  ["flow", "sensor", /volumetric_flow$/],
];

const BLUE = "#0084FF";
const ORANGE = "#ff9500";
const RED = "#ff3b30";
const GREY = "rgba(160, 160, 165, 0.78)";

/* the scheme, in the energy card's proportions */
/* the scheme: one row – outside → pump → heating, the hot water tank on an arc under them */
const W = 300;
const H = 96;
const R = 22;
const Y = 34;
const OUT: [number, number] = [26, Y];
const HP: [number, number] = [110, Y];
const HEAT: [number, number] = [194, Y];
const DHW: [number, number] = [274, Y];
const PATHS = {
  out: `M${OUT[0] + R + 2},${Y} L${HP[0] - R - 2},${Y}`,
  heat: `M${HP[0] + R + 2},${Y} L${HEAT[0] - R - 2},${Y}`,
  dhw: `M${HP[0]},${Y + R + 2} L${HP[0]},${H - 22} Q${HP[0]},${H - 10} ${HP[0] + 12},${H - 10} L${DHW[0] - 12},${H - 10} Q${DHW[0]},${H - 10} ${DHW[0]},${H - 22} L${DHW[0]},${Y + R + 2}`,
};
const LEN = { out: HP[0] - OUT[0] - 2 * R - 4, heat: HEAT[0] - HP[0] - 2 * R - 4, dhw: DHW[0] - HP[0] + 2 * (H - 10 - Y - R) };
/** Beam speed in scheme units per second and the length of its tail. */
const SPEED = 40;
const TAIL = 34;
const N_TAIL = 20;

const PRESETS: Record<string, string> = {
  comfort: "Comfort",
  home: "Home",
  sleep: "Sleep",
  eco: "Eco",
  away: "Away",
};
const DHW_MODES: Record<string, string> = {
  efficient: "Efficient",
  efficientWithMinComfort: "Efficient+",
  efficient_with_min_comfort: "Efficient+",
  comfort: "Comfort",
  off: "Off",
};
const PHASES: Record<string, string> = {
  ready: "ready",
  off: "off",
  heating: "heating",
  cooling: "cooling",
  passive_defrost: "defrosting",
  defrost: "defrosting",
  preparing: "starting",
  pause: "pause",
};

class GlassHeatPump extends GlassElement<HeatPumpConfig> {
  static override parts = HEAT_PUMP_PARTS;
  static getConfigElement() {
    return makeEditor(heatPumpSpec);
  }

  static getStubConfig(hass: HomeAssistant) {
    const reg = (hass as unknown as { entities?: Record<string, { device_id?: string }> }).entities ?? {};
    const comp = Object.keys(reg).find((id) => /^binary_sensor\..*compressor$/.test(id));
    return { device: comp ? reg[comp].device_id : "" };
  }

  private _ids: Partial<Record<Role, string>> = {};
  /** Whether the device's entities were looked up (the registry comes with hass). */
  private _fromDevice = false;
  /** Values typed with − / + that are not sent yet (the pump's cloud API counts calls). */
  private _pending = new Map<string, number>();
  /** the mode just picked, shown until the climate reports it (ViCare's cloud lags a minute or two) */
  private _want?: { on: boolean; preset?: string; at: number };
  private _timers = new Map<string, number>();

  protected override validateConfig(c: HeatPumpConfig) {
    if (!c.device && !c.entities) throw new Error("Set `device` (or `entities`)");
    return c;
  }

  /** The device's entities by role, overridden by `entities:`. */
  private _resolve() {
    const c = this._config;
    const out: Partial<Record<Role, string>> = {};
    const reg = (this._hass as unknown as { entities?: Record<string, { device_id?: string }> } | undefined)?.entities;
    this._fromDevice = !!(c?.device && reg);
    if (c?.device && reg) {
      const mine = Object.keys(reg).filter((id) => reg[id].device_id === c.device);
      for (const [role, domain, re] of FIND) {
        if (out[role]) continue;
        const hit = mine.find((id) => id.startsWith(`${domain}.`) && re.test(id.slice(domain.length + 1)));
        if (hit) out[role] = hit;
      }
    }
    this._ids = { ...out, ...(c?.entities ?? {}) };
  }

  protected watchedEntities() {
    this._resolve();
    return Object.values(this._ids).filter(Boolean) as string[];
  }

  override setConfig(config: HeatPumpConfig) {
    super.setConfig(config);
  }

  protected override hassChanged() {
    // the registry arrives with hass: find the entities once it is there
    if (this._config?.device && !this._fromDevice) {
      this._resolve();
      if (this._fromDevice) this.setConfig(this._rawConfig!);
    }
  }

  private _st(role: Role): HassEntity | undefined {
    const id = this._ids[role];
    return id ? this._hass?.states[id] : undefined;
  }

  private _num(role: Role): number | undefined {
    const v = parseFloat(this._st(role)?.state ?? "");
    return Number.isNaN(v) ? undefined : v;
  }

  /** − / + on a value: shown at once, sent after a short pause. */
  private _nudge(key: string, entity: string | undefined, now: number | undefined, step: number, min: number, max: number, send: (v: number) => void) {
    if (!entity || now === undefined) return;
    haptic("selection");
    const base = this._pending.get(key) ?? now;
    const next = Math.round(Math.min(max, Math.max(min, base + step)) * 100) / 100;
    this._pending.set(key, next);
    this.requestUpdate();
    clearTimeout(this._timers.get(key));
    this._timers.set(
      key,
      window.setTimeout(() => {
        send(next);
        // keep showing it until the pump reports the new value (or give up)
        window.setTimeout(() => (this._pending.delete(key), this.requestUpdate()), 8000);
      }, 1200),
    );
  }

  private _call(domain: string, service: string, data: Record<string, unknown>) {
    this._hass?.callService(domain, service, data);
  }

  /** One beam (head, white core, fading tail) along a pipe, like the energy card's laser. */
  private _beam(path: string, len: number, color: string, filterId: string) {
    const dur = len / SPEED;
    const tailDur = Math.min((TAIL * dur) / len, dur * 0.6);
    const step = tailDur / N_TAIL;
    const op = `offset-path:path('${path}');animation-duration:${dur.toFixed(2)}s;`;
    const delay = (s: number) => `animation-delay:${(-tailDur + s * step).toFixed(3)}s;`;
    return svg`
      <g filter="url(#${filterId}-t)">
        ${Array.from({ length: N_TAIL }, (_, s) => {
          const r = (2.4 - (s * 2.0) / (N_TAIL - 1)).toFixed(2);
          const o = (0.85 * Math.pow(1 - s / N_TAIL, 0.55)).toFixed(3);
          return svg`<ellipse class="beam" rx=${r} ry=${r} fill=${color} fill-opacity=${o} style="${op}${delay(s + 1)}"></ellipse>`;
        })}
      </g>
      <ellipse class="beam" rx="7" ry="2.5" fill=${color} filter="url(#${filterId}-h)" style="${op}${delay(0)}"></ellipse>
      <ellipse class="beam" rx="3.5" ry="1.2" fill="url(#${filterId}-c)" filter="url(#${filterId}-w)" style="${op}${delay(0)}transform:translateX(3.5px);"></ellipse>`;
  }

  private _node(at: [number, number], color: string | undefined, icon: string, value: string, label: string, cls = "") {
    const lit = !!color;
    return html`<div
      class="node ${lit ? "lit" : ""} ${cls}"
      style="left:${(at[0] / W) * 100}%;top:${(at[1] / H) * 100}%;--c:${color ?? `var(--hp-idle, ${GREY})`}"
      title=${label}
    >
      <ha-icon .icon=${icon}></ha-icon>
      ${value ? html`<span class="nval">${value}</span>` : nothing}
    </div>`;
  }

  protected override render() {
    const c = this._config;
    const hass = this._hass;
    if (!c || !hass) return nothing;
    const t = (en: string | undefined, raw: string) => (en ? tr(en) : raw);
    const fmt = (v: number | undefined, d = 1) => (v === undefined ? "–" : v.toLocaleString(locale(), { maximumFractionDigits: d }));
    const id = this._ids;

    const climate = this._st("climate");
    const wh = this._st("water_heater");
    const running = this._st("compressor")?.state === "on";
    const isOn = (r: Role) => ["on", "true", "heating"].includes(String(this._st(r)?.state).toLowerCase());
    const pumpOn = this._st("pump")?.state === "on";
    const toWater = id.dhw_active ? isOn("dhw_active") : false;
    // the pump circulates and the water isn't being heated → it heats the house
    const heating = id.heating_active ? isOn("heating_active") : id.pump ? pumpOn && !toWater : running && climate?.attributes.hvac_action === "heating";
    const frostOn = this._st("frost")?.state === "on";
    const rodOn = isOn("rod");
    const uid = "hp";
    const col = (v: string | undefined, def: string) => (v && v !== "none" ? (cssColor(v) ?? def) : def);
    const OUTC = col(c.outside_color, BLUE);
    const HEATC = col(c.heating_color, ORANGE);
    const DHWC = col(c.dhw_color, ORANGE);
    const RODC = col(c.rod_color, RED);
    const anim = c.show_animation !== false;

    // ── the scheme ──
    const scheme = html`<div class="scheme">
      <svg viewBox="0 0 ${W} ${H}" aria-hidden="true">
        <defs>
          <filter id="${uid}-h" x="-300%" y="-300%" width="700%" height="700%">
            <feGaussianBlur stdDeviation="8" result="b1"></feGaussianBlur>
            <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="b2"></feGaussianBlur>
            <feMerge><feMergeNode in="b1"></feMergeNode><feMergeNode in="b2"></feMergeNode><feMergeNode in="SourceGraphic"></feMergeNode></feMerge>
          </filter>
          <filter id="${uid}-w" x="-300%" y="-300%" width="700%" height="700%">
            <feGaussianBlur stdDeviation="3.5" result="b"></feGaussianBlur>
            <feMerge><feMergeNode in="b"></feMergeNode><feMergeNode in="SourceGraphic"></feMergeNode></feMerge>
          </filter>
          <filter id="${uid}-t" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="1.5"></feGaussianBlur>
          </filter>
          <linearGradient id="${uid}-c" gradientUnits="objectBoundingBox" x1="0" y1="0.5" x2="1" y2="0.5">
            <stop offset="0%" stop-color="white" stop-opacity="0"></stop>
            <stop offset="50%" stop-color="white" stop-opacity="0.35"></stop>
            <stop offset="100%" stop-color="white" stop-opacity="1"></stop>
          </linearGradient>
        </defs>
        <path class="pipe" d=${PATHS.out}></path>
        <path class="pipe" d=${PATHS.heat}></path>
        ${id.dhw || wh ? svg`<path class="pipe" d=${PATHS.dhw}></path>` : nothing}
        ${anim && running ? this._beam(PATHS.out, LEN.out, OUTC, uid) : nothing}
        ${anim && heating ? this._beam(PATHS.heat, LEN.heat, HEATC, uid) : nothing}
        ${anim && toWater && (id.dhw || wh) ? this._beam(PATHS.dhw, LEN.dhw, DHWC, uid) : nothing}
      </svg>
      ${this._node(OUT, running ? OUTC : undefined, "mdi:weather-windy", this._st("outside") ? `${fmt(this._num("outside"))}°` : "", tr("Outside"))}
      ${frostOn
        ? html`<span
            class="badge on frost"
            style="left:${((OUT[0] + R * 0.72) / W) * 100}%;top:${((Y - R * 0.72) / H) * 100}%"
            title=${tr("Frost protection on")}
            ><ha-icon icon="mdi:snowflake"></ha-icon
          ></span>`
        : nothing}

      ${this._node(HEAT, heating ? HEATC : undefined, "mdi:radiator", this._st("supply") ? `${fmt(this._num("supply"))}°` : "", tr("Heating supply"), heating ? "pulse" : "")}
      ${this._node(HP, rodOn ? RODC : running ? HEATC : undefined, "mdi:pump", "", `${tr("Heat pump")}: ${t(PHASES[this._st("phase")?.state ?? ""], this._st("phase")?.state ?? "")}${rodOn ? (tr(" · heating rod")) : ""}`, pumpOn && anim ? "pump spin" : "pump")}
      ${id.dhw || wh
        ? this._node(DHW, toWater ? DHWC : undefined, "mdi:water-boiler", this._st("dhw") || wh?.attributes.current_temperature !== undefined ? `${fmt(this._num("dhw") ?? Number(wh?.attributes.current_temperature))}°` : "", tr("Hot water"), toWater ? "pulse" : "")
        : nothing}

    </div>`;

    // ── status: only what is going on ──
    const chips: unknown[] = [];
    if (this._st("frost")?.state === "on") chips.push(html`<span class="chip warn"><ha-icon icon="mdi:snowflake-alert"></ha-icon>${tr("Frost protection")}</span>`);

    // ── materials: the modes' track, the picked mode, the − / + fields (a colour alone keeps the default glass) ──
    const mat = (m: Material | undefined, color: string | undefined, def: Material | undefined) => {
      const use = m ?? (color ? def : undefined);
      return use ? { cls: `mat mat-${use}`, style: matTint(color) } : { cls: "", style: "" };
    };
    const track = mat(c.modes_glass, c.modes_color, "flat");
    const act = mat(c.active_glass, c.active_color, "dark");
    const btn = mat(c.buttons_glass, c.buttons_color, "dark");

    // ── heating mode ──
    const presets: string[] = climate?.attributes.preset_modes ?? [];
    const climateOn = !!climate && climate.state !== "off";
    const want = this._want;
    if (want && (Date.now() - want.at > 150000 || (want.on === climateOn && (!want.preset || climate?.attributes.preset_mode === want.preset)))) this._want = undefined;
    const on = this._want ? this._want.on : climateOn;
    const preset = this._want?.preset ?? climate?.attributes.preset_mode;
    const pick = (w: { on: boolean; preset?: string }) => {
      this._want = { ...w, at: Date.now() };
      this.requestUpdate();
      window.setTimeout(() => this.requestUpdate(), 151000);
    };
    const mode = climate && c.show_modes !== false
      ? html`<div class="row">
          <div class=${`seg wide ${track.cls}`} style=${track.style}>
            ${(climate.attributes.hvac_modes as string[]).includes("off")
              ? html`<button
                  class="segb power ${on ? "" : `cur ${act.cls}`}"
                  style=${on ? "" : act.style}
                  title=${on ? (tr("Turn heating off")) : tr("Turn heating on")}
                  aria-label=${tr("Heating")}
                  @click=${() => {
                    pick({ on: !on });
                    this._call("climate", "set_hvac_mode", { entity_id: id.climate, hvac_mode: on ? "off" : (climate.attributes.hvac_modes as string[]).find((m) => m !== "off") });
                  }}
                >
                  <ha-icon icon="mdi:power"></ha-icon>
                </button>`
              : nothing}
            ${presets.map(
              (p) => html`<button
                class="segb ${on && preset === p ? `cur ${act.cls}` : ""}"
                style=${on && preset === p ? act.style : ""}
                title=${on ? "" : tr("Turns the heating on with this preset")}
                @click=${async () => {
                  // off: a preset turns the heating on first (its first mode that isn't off)
                  pick({ on: true, preset: p });
                  if (!climateOn) {
                    const mode = (climate.attributes.hvac_modes as string[]).find((m) => m !== "off");
                    await this._hass?.callService("climate", "set_hvac_mode", { entity_id: id.climate, hvac_mode: mode });
                  }
                  this._call("climate", "set_preset_mode", { entity_id: id.climate, preset_mode: p });
                }}
              >
                ${t(PRESETS[p], p)}
              </button>`,
            )}
          </div>
        </div>`
      : nothing;

    // ── hot water ──
    const set = (key: string, entity: string | undefined, now: number | undefined, step: number, min: number, max: number, send: (v: number) => void, digits = 1) => {
      const shown = this._pending.get(key) ?? now;
      return html`<div class=${`set ${btn.cls}`} style=${btn.style}>
        <button aria-label="−" @click=${() => this._nudge(key, entity, now, -step, min, max, send)}><ha-icon icon="mdi:minus"></ha-icon></button>
        <span class="sp ${this._pending.has(key) ? "pending" : ""}">${fmt(shown, digits)}</span>
        <button aria-label="+" @click=${() => this._nudge(key, entity, now, step, min, max, send)}><ha-icon icon="mdi:plus"></ha-icon></button>
      </div>`;
    };
    const dhwMode = this._st("dhw_mode");
    const water = wh && c.show_dhw_setpoint !== false
      ? html`<div class="row">
          <span class="lbl"><ha-icon icon="mdi:water-boiler"></ha-icon>${tr("Hot water")}</span>
          ${set(
            "dhw",
            id.water_heater,
            Number(wh.attributes.temperature),
            1,
            Number(wh.attributes.min_temp ?? 10),
            Number(wh.attributes.max_temp ?? 60),
            (v) => this._call("water_heater", "set_temperature", { entity_id: id.water_heater, temperature: v }),
            0,
          )}
        </div>`
      : nothing;
    // hot water in the settings: its set point (when not shown under the scheme) and its mode
    const dhwModes =
      dhwMode || (wh && c.show_dhw_setpoint === false)
        ? html`<div class="group">
            <span class="gtitle">${tr("Water heating")}</span>
            ${wh && c.show_dhw_setpoint === false
              ? html`<div class="row">
                  <span class="lbl">${tr("Temperature")}</span>
                  ${set(
                    "dhw",
                    id.water_heater,
                    Number(wh.attributes.temperature),
                    1,
                    Number(wh.attributes.min_temp ?? 10),
                    Number(wh.attributes.max_temp ?? 60),
                    (v) => this._call("water_heater", "set_temperature", { entity_id: id.water_heater, temperature: v }),
                    0,
                  )}
                </div>`
              : nothing}
            ${dhwMode
              ? html`<div class=${`seg wide ${track.cls}`} style=${track.style}>
                  ${(dhwMode.attributes.options as string[]).map(
                    (o) => html`<button class="segb ${dhwMode.state === o ? `cur ${act.cls}` : ""}" style=${dhwMode.state === o ? act.style : ""} @click=${() => this._call("select", "select_option", { entity_id: id.dhw_mode, option: o })}>
                      ${t(DHW_MODES[o], o)}
                    </button>`,
                  )}
                </div>`
              : nothing}
          </div>`
        : nothing;

    // ── heating curve ──
    const numRow = (role: Role, label: string, digits: number) => {
      const st = this._st(role);
      if (!st) return nothing;
      const a = st.attributes;
      return html`<div class="row">
        <span class="lbl">${label}</span>
        ${set(
          role,
          id[role],
          this._num(role),
          Number(a.step ?? 1),
          Number(a.min ?? -100),
          Number(a.max ?? 100),
          (v) => this._call("number", "set_value", { entity_id: id[role], value: v }),
          digits,
        )}
      </div>`;
    };
    const curve =
      this._st("curve_shift") || this._st("curve_slope")
        ? html`<div class="group">
            <span class="gtitle">${tr("Heating curve")}</span>
            ${numRow("curve_shift", tr("Shift"), 0)} ${numRow("curve_slope", tr("Slope"), 1)}
          </div>`
        : nothing;

    // ── service ──
    const svc: [Role, string, string][] = [
      ["compressor_starts", tr("Compressor starts"), ""],
      ["compressor_hours", tr("Compressor hours"), "h"],
      ["rod_starts", tr("Heating rod starts"), ""],
      ["rod_hours", tr("Heating rod hours"), "h"],
      ["pressure", tr("Pressure"), "bar"],
      ["flow", tr("Flow"), "m³/h"],
    ];
    const service = svc.filter(([r]) => this._st(r));
    const nodeVars = `${c.idle_color && c.idle_color !== "none" ? `--hp-idle:${cssColor(c.idle_color)};` : ""}`;
    return html`<div class="frame ${anim ? "" : "still"} ${this.tile}" style=${nodeVars}>
      ${c.name ? html`<div class="title">${c.name}</div>` : nothing} ${scheme}
      ${chips.length ? html`<div class="chips">${chips}</div>` : nothing}
      ${mode !== nothing || water !== nothing ? html`<div class="rows">${mode} ${water}</div>` : nothing}
      ${c.show_settings !== false && (curve !== nothing || dhwModes !== nothing || service.length)
        ? html`<div class="service ${this._open ? "open" : ""}">
            <button class="sum" aria-expanded=${this._open ? "true" : "false"} @click=${this._toggle}>
              <ha-icon icon="mdi:tune-variant"></ha-icon>${tr("Settings")}<span class="chev"><ha-icon icon="mdi:chevron-down"></ha-icon></span>
            </button>
            ${this._open
              ? html`<div class="drawer">
                  ${dhwModes} ${curve}
                  <div class="svc">
                    ${service.map(
                      ([r, label, unit]) => html`<span class="k">${label}</span><span class="v">${fmt(this._num(r), 2)}${unit ? html`<small> ${unit}</small>` : nothing}</span>`,
                    )}
                  </div>
                </div>`
              : nothing}
          </div>`
        : nothing}
    </div>`;
  }

  /**
   * The settings open inside the card; while open the card carries [glass-expanded],
   * so the panel around it hides its other cards (the graphs) and keeps its height
   * (a rule in glass-panel for this card only).
   */
  private _open = false;
  private _toggle = (e?: Event) => {
    e?.stopPropagation();
    this._open = !this._open;
    this.toggleAttribute("glass-expanded", this._open);
    this.requestUpdate();
  };

  override disconnectedCallback() {
    super.disconnectedCallback();
    for (const t of this._timers.values()) clearTimeout(t);
  }

  static override styles = [
    GlassElement.styles,
    surface,
    css`
      :host {
        display: block;
      }
      .frame {
        display: flex;
        flex-direction: column;
        gap: 10px;
        color: var(--g-text);
      }
      .title {
        font-size: 15px;
        font-weight: 600;
        padding: 0 4px;
      }
      /* ── the scheme: SVG pipes and beams, HTML nodes on top ── */
      .scheme {
        position: relative;
        width: 100%;
        max-width: var(--glass-heat-pump-scheme, 360px);
        margin: 0 auto;
        aspect-ratio: ${W} / ${H};
      }
      svg {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        overflow: visible;
      }
      .pipe {
        fill: none;
        stroke: color-mix(in srgb, var(--g-text) 14%, transparent);
        stroke-width: 2;
        stroke-linecap: round;
      }
      @keyframes beam {
        0% {
          offset-distance: 0%;
          opacity: 0;
        }
        8% {
          offset-distance: 8%;
          opacity: 1;
        }
        92% {
          offset-distance: 92%;
          opacity: 1;
        }
        100% {
          offset-distance: 100%;
          opacity: 0;
        }
      }
      .beam {
        offset-distance: 0%;
        offset-rotate: auto;
        transform-box: fill-box;
        transform-origin: center;
        animation: beam linear infinite;
      }
      @media (prefers-reduced-motion: reduce) {
        .beam {
          animation: none;
          opacity: 0;
        }
      }
      /* a node: a full colour disc in a soft halo (the energy card's), grey while idle */
      .node {
        position: absolute;
        width: ${((2 * R) / W) * 100}%;
        aspect-ratio: 1;
        transform: translate(-50%, -50%);
        border-radius: 50%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1px;
        background: var(--c);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2);
        color: var(--hp-icon, #fff);
        transition:
          background 0.5s ease,
          box-shadow 0.5s ease;
      }
      /* lit: a soft halo of the node's colour that slowly breathes (the energy card's glow,
         no ring – the ring there shows shares, which this scheme has none of) */
      .node.lit {
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35);
      }
      .node::before {
        content: "";
        position: absolute;
        inset: -32%;
        z-index: -1;
        border-radius: 50%;
        background: radial-gradient(
          circle closest-side,
          color-mix(in srgb, var(--c) 45%, transparent) 55%,
          color-mix(in srgb, var(--c) 18%, transparent) 75%,
          transparent 100%
        );
        filter: blur(2px);
        opacity: 0;
        transition: opacity 0.5s ease;
        pointer-events: none;
      }
      .node.lit::before {
        opacity: 0.85;
        animation: hp-glow 6s ease-in-out infinite;
      }
      @keyframes hp-glow {
        0%,
        100% {
          opacity: 0.75;
        }
        50% {
          opacity: 1;
        }
      }
      /* what the heat goes to right now (heating / hot water): a deeper breath */
      .node.lit.pulse::before {
        animation: hp-glow-strong 4.5s ease-in-out infinite;
      }
      @keyframes hp-glow-strong {
        0%,
        100% {
          opacity: 0.6;
          transform: scale(0.96);
        }
        50% {
          opacity: 1;
          transform: scale(1.03);
        }
      }
      .node.spin ha-icon {
        animation: hp-spin 2.4s linear infinite;
      }
      @keyframes hp-spin {
        to {
          transform: rotate(360deg);
        }
      }
      /* show_animation: false – lit, but still */
      .still .node.lit::before {
        animation: none;
      }
      @media (prefers-reduced-motion: reduce) {
        .node.lit::before,
        .node.spin ha-icon {
          animation: none;
        }
      }
      /* frost protection: a small snowflake on the outside node, only while it is on */
      .badge {
        position: absolute;
        width: 20px;
        height: 20px;
        transform: translate(-50%, -50%);
        border-radius: 50%;
        display: grid;
        place-items: center;
        color: #fff;
      }
      .badge ha-icon {
        --mdc-icon-size: 13px;
        display: flex;
      }
      .badge.frost {
        background: #5ac8fa;
        box-shadow: 0 0 10px 2px rgba(90, 200, 250, 0.45);
      }
      .node ha-icon {
        --mdc-icon-size: 18px;
        display: flex;
        filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.45));
      }
      .nval {
        font-size: 10px;
        font-weight: 600;
        line-height: 1;
        white-space: nowrap;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
      }
      /* ── status chips ── */
      .chips {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 6px;
      }
      .chip {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 4px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 600;
        background: color-mix(in srgb, var(--g-text) 10%, transparent);
      }
      .chip ha-icon {
        --mdc-icon-size: 15px;
        display: flex;
        color: var(--glass-accent-icon, currentColor);
      }
      .chip.warn {
        color: #fff;
        background: #ff3b30;
      }
      .chip.warn ha-icon {
        color: #fff;
      }
      /* ── rows: a label on the left, the control on the right ── */
      .rows,
      .group {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .row {
        flex: none;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        min-height: 34px;
      }
      .row.sub {
        min-height: 0;
        margin-top: -4px;
      }
      .lbl,
      .gtitle {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        font-weight: 600;
        min-width: 0;
      }
      .lbl small {
        font-size: 12px;
        font-weight: 500;
        color: var(--g-text-2);
      }
      .lbl ha-icon,
      .gtitle ha-icon {
        --mdc-icon-size: 18px;
        display: flex;
        color: var(--glass-accent-icon, currentColor);
        filter: var(--g-icon-shadow);
      }
      .group .row .lbl {
        font-weight: 500;
        color: var(--g-text-2);
        padding-left: 26px;
      }
      /* set point: − value + in the dark control glass, like the thermostat */
      .set {
        flex: none;
        display: flex;
        align-items: center;
        box-sizing: border-box;
        height: var(--hp-control-h, 34px);
        padding: 0 3px;
        border-radius: 999px;
      }
      .set:not(.mat) {
        color: var(--glass-home-side-text, #fff);
        background: var(--glass-control-bg);
        box-shadow: var(--glass-control-shadow);
      }
      .set button {
        width: 28px;
        height: 28px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: none;
        color: inherit;
        display: grid;
        place-items: center;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        transition: transform 0.15s ease;
      }
      .set button:active {
        transform: scale(0.88);
        background: rgba(255, 255, 255, 0.24);
      }
      .set ha-icon {
        --mdc-icon-size: 18px;
        display: flex;
      }
      .sp {
        min-width: 38px;
        text-align: center;
        font-size: 14px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      .sp.pending {
        color: var(--glass-thermostat-accent, #ff9f0a);
      }
      /* choices: a recessed track, the current one lifted out of it */
      .seg {
        flex: none;
        display: flex;
        box-sizing: border-box;
        height: var(--hp-control-h, 34px);
        gap: 2px;
        padding: 3px;
        border-radius: 999px;
        min-width: 0;
      }
      .seg:not(.mat) {
        background: var(--glass-seg-bg, color-mix(in srgb, var(--g-text) 8%, transparent));
      }
      .seg.wide {
        flex: 1 0 auto;
      }
      .seg.wide .segb {
        flex: 1;
      }
      .segb {
        border: 0;
        padding: 0 12px;
        border-radius: 999px;
        background: none;
        color: var(--g-text-2);
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        white-space: nowrap;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }
      .segb.power {
        flex: none;
        padding: 6px 9px;
        display: grid;
        place-items: center;
      }
      .segb ha-icon {
        --mdc-icon-size: 16px;
        display: flex;
      }
      .segb:disabled {
        opacity: 0.4;
        cursor: default;
      }
      .segb.cur:not(.mat) {
        color: var(--glass-home-side-text, #fff);
        background: var(--glass-control-bg);
        box-shadow: var(--glass-control-shadow);
      }
      /* ── settings: a button, the drawer floats over what comes after the card ── */
      .service {
        position: relative;
      }
      /* a plain row with a plain arrow at its end */
      .sum {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 2px 0;
        border: 0;
        background: none;
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        color: var(--g-text-2);
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }
      .sum ha-icon {
        --mdc-icon-size: 16px;
        display: flex;
      }
      .sum .chev {
        margin-left: auto;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        --mdc-icon-size: 18px;
        color: var(--g-text-2);
        background: none;
        transition: transform 0.15s ease;
      }
      .sum:active .chev {
        transform: scale(0.9);
      }
      /* only the arrow turns, not the button (its glass is lit from the top) */
      .sum .chev ha-icon {
        transition: transform 0.2s ease;
      }
      .service.open .chev ha-icon {
        transform: rotate(180deg);
      }
      .drawer {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding-top: 8px;
        animation: hp-drop 0.22s ease-out;
      }
      @keyframes hp-drop {
        from {
          opacity: 0;
          transform: translateY(-6px);
        }
      }
      .drawer .group {
        padding: 0;
      }
      .svc {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 6px 12px;
        padding: 8px 0 0 24px;
        font-size: 13px;
      }
      .svc .k {
        color: var(--g-text-2);
      }
      .svc .v {
        text-align: right;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      .svc small {
        font-weight: 500;
        color: var(--g-text-2);
      }
    `,
    // after the card's own rules: a picked material replaces the default glass
    materials,
    css`
      .seg.mat {
        box-shadow: none;
      }
    `,
  ];
}

registerCard("glass-heat-pump", GlassHeatPump, {
  name: "Glass – heat pump",
  description: "Heat pump: the heat flow like the energy card, heating mode, hot water and the heating curve.",
});
