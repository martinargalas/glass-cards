import { tr } from "../i18n";
import { css, html, nothing } from "lit";
import { GlassElement } from "../core/glass-element";
import type { ActionConfig, BaseCardConfig, HassEntity, HomeAssistant } from "../core/types";
import { registerCard } from "../core/registry";
import { makeEditor } from "../editor/editor";
import { applianceSpec } from "../editor/specs";
import { control, liquidBar, surface } from "../core/styles";
import { cssColor, tint } from "../core/colors";
import { SHEEN, materials, matTint, type Material } from "../core/materials";
import type { FontSpec, IconSpec } from "../core/typography";
import { haptic, pressHandlers, runAction, withDefaults, type ActionKind } from "../core/actions";
import { isDark } from "../core/settings";
import { getSelected, onSelected, setDefault, setSelected } from "../core/select";
import { WASHER_STAGES, stageName, washerEntities, washerPhase, washerState, type WasherPhase } from "../core/washer";

/**
 * An appliance as a light bar: a liquid glass bar (icon, name and state with
 * progress or battery – tapped, it shows the appliance next to the list, lit)
 * and a drawer tucked beneath it with its controls – or, for a washing machine,
 * its cycle's stages, shown always (not only while it runs). One per card:
 * a panel of them is the list.
 *
 *   type: custom:glass-appliance        # vacuum: start / pause / stop / dock
 *   entity: vacuum.roomba
 *   battery: sensor.roomba_battery
 *   progress: sensor.roomba_mission_progress   # its `current_room` shows during a job
 *   room_names: { Living Room: Obývák }       # optional display names of the rooms
 *   charging: sensor.roomba_phase   # a binary sensor, or a phase in charging / recharging / charging_mid_mission
 *   select_group: cleaning          # optional: a tap picks `select` in the group – cards in a panel show for it
 *   select: roomba                  #   (visibility `condition: select`); picked_first: true – picked until one is tapped
 *
 *   type: custom:glass-appliance    # mower: progress, pause / resume, nudge arrows
 *   entity: lawn_mower.luba
 *   progress: sensor.luba_progress
 *   battery: sensor.luba_battery
 *   charging: binary_sensor.luba_charging
 *   resume: { action: perform-action, perform_action: script.luba_unpause }
 *   pause: { action: perform-action, perform_action: script.luba_pause }
 *   nudge: { up: button.f, left: button.l, right: button.r, down: button.b }
 *
 *   type: custom:glass-appliance    # washer: remaining time, the stages of the cycle
 *   kind: washer
 *   entity: sensor.washer_job_state
 *   machine: sensor.washer_machine_state
 *   remaining: sensor.washer_remaining_time
 *   completion: sensor.washer_completion_time   # the bar fills with the cycle's progress
 *   # any other integration: its status sensor (LG ThinQ, Home Connect, Miele, Electrolux… known),
 *   # a binary sensor, or a smart plug's power in W; power: switch.washer_plug (done lasts until off),
 *   # run_states / done_states: states of its own, for an unknown integration
 *
 *   bar_glass: frosted              # own materials (core/materials), *_color tints them: the bar, the picked one
 *   picked_glass: liquid            #   (picked_*), the icon idle / at work (icon_glass / icon_on_glass), the drawer
 *   tray_glass: flat                #   (tray_*), its buttons (buttons_*) and the lit one / current stage (current_*)
 *   fill_style: solid               # the bar's fill: fade | solid | glow | none, fill_strength %
 */
interface Stage {
  state: string | string[];
  name: string;
  en?: string;
  icon?: string;
}

interface ApplianceItem {
  entity: string;
  /** washer: the states that mean each phase, for an integration whose states aren't known (see core/washer) */
  run_states?: string[];
  pause_states?: string[];
  done_states?: string[];
  /** washer: a power sensor as `entity` – running above this many W (default 5) */
  run_above?: number;
  /** default: from the entity's domain (vacuum, lawn_mower, else a washer) */
  kind?: "vacuum" | "mower" | "washer";
  name?: string;
  icon?: string;
  battery?: string;
  progress?: string;
  /** vacuum: display names of the rooms in the progress' `current_room` */
  room_names?: Record<string, string>;
  charging?: string;
  machine?: string;
  remaining?: string;
  /** washer: its power (on until switched off; default `binary_sensor.<name>_power` next to `sensor.<name>_washer_machine_state`) */
  power?: string;
  /** washer: when the cycle ends (a timestamp; default the machine state's `…_completion_time`) */
  completion?: string;
  stages?: Stage[];
  start?: ActionConfig;
  pause?: ActionConfig;
  resume?: ActionConfig;
  /** mower: end the job where it is (default `mammotion.cancel_job`) */
  stop?: ActionConfig;
  nudge?: { up?: string; left?: string; right?: string; down?: string };
  select?: string;
  hold_action?: ActionConfig;
}

interface ApplianceConfig extends BaseCardConfig, ApplianceItem {
  select_group?: string;
  /** its `select` is the group's pick until one is tapped */
  picked_first?: boolean;
  active_color?: string;
  bar_glass?: Material;
  bar_color?: string;
  picked_glass?: Material;
  picked_color?: string;
  fill_color?: string;
  fill_style?: "fade" | "solid" | "glow" | "none";
  fill_strength?: number;
  icon_glass?: Material;
  icon_on_glass?: Material;
  icon_background?: string;
  tray_glass?: Material;
  tray_color?: string;
  buttons_glass?: Material;
  buttons_color?: string;
  current_glass?: Material;
  current_color?: string;
  /** text of the parts (core/typography): name / name_on, state / state_on (on = the picked bar), battery */
  fonts?: Record<string, FontSpec>;
  /** icons: bar / bar_on (idle / at work), battery, buttons / buttons_on (the drawer's, the lit one / current stage) */
  icons?: Record<string, IconSpec>;
}

const has = (v?: string) => !!v && v !== "none";
/** An element's own material (a colour alone tints the default one). */
function part(m: Material | undefined, color: string | undefined, def: Material) {
  const use = m ?? (has(color) ? def : undefined);
  return use ? { cls: `mat mat-${use}`, style: has(color) ? matTint(color) : "--mat-tint:initial;--mat-tinted:initial;--mat-sheen:initial" } : undefined;
}

/** A robot's state, as said in the UI (translated in src/i18n). */
const STATES: Record<string, string> = {
  docked: "Docked",
  cleaning: "Cleaning",
  paused: "Paused",
  returning: "Returning",
  idle: "Idle",
  error: "Error",
  mowing: "Mowing",
  unavailable: "Unavailable",
  unknown: "Unknown",
};


const asList = (v: string | string[]) => (Array.isArray(v) ? v : [v]);

/** States while a job is on: its progress fills the bar, the battery shows beside it. */
const JOB: Record<string, string[]> = { vacuum: ["cleaning", "paused", "returning"], mower: ["mowing", "paused", "returning"] };
/** `charging`: a binary sensor (on), or a phase sensor (Roomba+) in one of these. */
const CHARGING = ["on", "charging", "recharging", "charging_mid_mission"];

const batteryIcon = (b: number) => (b >= 95 ? "mdi:battery" : b < 5 ? "mdi:battery-outline" : `mdi:battery-${Math.round(b / 10) * 10}`);

class GlassAppliance extends GlassElement<ApplianceConfig> {
  static override properties = { ...GlassElement.properties, _sel: { state: true } };
  declare _sel?: string;
  private _unsub?: () => void;

  static getConfigElement() {
    return makeEditor(applianceSpec);
  }

  static getStubConfig(hass: HomeAssistant) {
    const v = Object.keys(hass.states).find((e) => e.startsWith("vacuum."));
    return { entity: v ?? "" };
  }

  protected override validateConfig(c: ApplianceConfig) {
    if (!c.entity) throw new Error("`entity` is required");
    return c;
  }

  protected watchedEntities(c: ApplianceConfig) {
    const out = new Set<string>();
    for (const id of [c.entity, c.battery, c.progress, c.charging, c.machine, c.remaining, this._completionId(c)]) if (id) out.add(id);
    if (this._type(c) === "washer") washerEntities(c).forEach((id) => out.add(id));
    return out;
  }

  override connectedCallback() {
    super.connectedCallback();
    const g = this._config?.select_group;
    if (g) {
      if (this._config.picked_first && this._config.select) setDefault(g, this._config.select);
      this._sel = getSelected(g);
      this._unsub = onSelected(g, (id) => (this._sel = id));
    }
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._unsub?.();
  }

  private _type(it: ApplianceItem): "vacuum" | "mower" | "washer" {
    if (it.kind) return it.kind;
    const d = it.entity.split(".")[0];
    return d === "lawn_mower" ? "mower" : d === "vacuum" ? "vacuum" : "washer";
  }

  private _num(id?: string): number {
    const v = id ? parseFloat(this._hass?.states[id]?.state ?? "") : NaN;
    return Number.isFinite(v) ? v : NaN;
  }

  private _completionId(it: ApplianceItem) {
    return it.completion ?? (it.machine?.endsWith("_machine_state") ? it.machine.replace(/_machine_state$/, "_completion_time") : undefined);
  }

  /** The washer's cycle as a share done: from when it started running (kept across a pause) to when it will end. */
  private _cycle(it: ApplianceItem): number {
    const hass = this._hass!;
    const m = hass.states[it.machine ?? it.entity];
    const key = `glass-washer-start:${it.machine ?? it.entity}`;
    const store = (v?: number) => {
      try {
        v === undefined ? localStorage.removeItem(key) : localStorage.setItem(key, String(v));
      } catch {
        /* private mode: the machine's own last change will do */
      }
    };
    const offKey = `glass-washer-off:${it.machine ?? it.entity}`;
    const phase = this._washer(it);
    if (!m || (phase !== "run" && phase !== "pause")) {
      store();
      // the last time it was seen not washing: the next cycle can't have started before
      try {
        localStorage.setItem(offKey, String(Date.now()));
      } catch {
        /* see below */
      }
      return NaN;
    }
    let start = NaN;
    try {
      start = Number(localStorage.getItem(key) ?? NaN);
    } catch {
      /* see above */
    }
    // SmartThings keeps "run" between two loads: the cycle began after the last end seen
    let off = NaN;
    try {
      off = Number(localStorage.getItem(offKey) ?? NaN);
    } catch {
      /* private mode */
    }
    const changed = Math.max(Date.parse(m.last_changed), Number.isFinite(off) ? off : 0);
    // none kept, or left over from an earlier cycle (none runs 6 h): the machine's last change
    if (!Number.isFinite(start) || start < changed - 6 * 3600_000) start = changed;
    if (!Number.isFinite(start) || start > Date.now()) return NaN;
    store(start);
    let end = Date.parse(hass.states[this._completionId(it) ?? ""]?.state ?? "");
    if (!Number.isFinite(end)) {
      const rem = parseFloat(hass.states[it.remaining ?? ""]?.state ?? "");
      if (Number.isFinite(rem)) end = Date.now() + rem * 60_000;
    }
    if (!Number.isFinite(end) || end <= start) return NaN;
    return Math.min(100, Math.max(0, ((Date.now() - start) / (end - start)) * 100));
  }

  private _washer(it: ApplianceItem): WasherPhase {
    return washerPhase(this._hass, it);
  }

  private _charging(it: ApplianceItem) {
    return CHARGING.includes(this._hass?.states[it.charging ?? ""]?.state ?? "");
  }

  private _call(domain: string, service: string, entity: string) {
    haptic();
    this._hass?.callService(domain, service, { entity_id: entity });
  }

  private _act(a: ActionConfig | undefined, entity: string) {
    if (!a) return;
    runAction(this, this._hass, { entity, tap_action: a }, "tap");
  }

  /** The icon: the obvious next step – start, pause or resume. */
  private _primary(it: ApplianceItem, st?: HassEntity) {
    const type = this._type(it);
    const s = st?.state;
    if (type === "vacuum") {
      if (s === "cleaning") this._call("vacuum", "pause", it.entity);
      else if (it.start) this._act(it.start, it.entity);
      else this._call("vacuum", "start", it.entity);
    } else if (type === "mower") {
      if (s === "mowing") it.pause ? this._act(it.pause, it.entity) : this._call("lawn_mower", "pause", it.entity);
      else if (s === "paused" && it.resume) this._act(it.resume, it.entity);
      else it.start ? this._act(it.start, it.entity) : this._call("lawn_mower", "start_mowing", it.entity);
    }
  }

  private _select(it: ApplianceItem) {
    const g = this._config.select_group;
    if (!g || !it.select || this._sel === it.select) return;
    haptic("selection");
    setSelected(g, it.select);
  }

  private _item(it: ApplianceItem, hass: HomeAssistant) {
    const st = hass.states[it.entity];
    const type = this._type(it);
    const name = it.name ?? st?.attributes.friendly_name ?? it.entity;
    const color = this._config.active_color ?? "orange";
    const s = st?.state ?? "unavailable";
    // at work – its icon lit, as the washer's while it runs (paused / charging: not)
    const running =
      type === "vacuum" ? ["cleaning", "returning"].includes(s) : type === "mower" ? ["mowing", "returning"].includes(s) : this._washer(it) === "run";
    // the appliance shown on the right: its whole bar turns to the light glass of the panel there
    const selectable = !!(this._config.select_group && it.select);
    const sel = selectable && this._sel === it.select;
    // the bar fills: while charging with the battery, during a job with its progress – else not at all
    const battery = this._num(it.battery);
    const progress = this._num(it.progress);
    const charging = this._charging(it) && !(battery >= 100);
    const job = !charging && (JOB[type] ?? []).includes(s);
    const pct = charging ? battery : job ? progress : type === "washer" ? this._cycle(it) : NaN;
    let state = STATES[s] ? tr(STATES[s]) : s;
    if (charging) state = `${tr("Charging")}${Number.isFinite(battery) ? ` · ${Math.round(battery)} %` : ""}`;
    else if (type === "mower" && s === "paused" && Number.isFinite(progress)) state = `${tr("Resume")} · ${Math.round(progress)} %`;
    else if (job) {
      // the room it is cleaning now (Roomba+ knows it only once it has found its place on the map)
      const room = type === "vacuum" ? (hass.states[it.progress ?? ""]?.attributes.current_room as string | undefined) : undefined;
      if (room) state += ` · ${it.room_names?.[room] ?? room}`;
      if (Number.isFinite(progress)) state += ` · ${Math.round(progress)} %`;
    }
    else if (!job && Number.isFinite(battery)) state += ` · ${Math.round(battery)} %`;
    if (type === "washer") {
      const machine = this._washer(it);
      const rem = hass.states[it.remaining ?? ""];
      const remText = rem && !["unavailable", "unknown"].includes(rem.state) ? `${rem.state}${rem.attributes.unit_of_measurement ? ` ${rem.attributes.unit_of_measurement}` : ""}` : "";
      state =
        machine === "run"
          ? `${tr("Running")}${remText ? ` · ${tr("left")} ${remText}` : ""}`
          : machine === "pause"
            ? tr("Paused")
            : machine === "done"
              ? tr("Washing done")
              : tr("Off");
    }
    const target = withDefaults({ entity: it.entity, tap_action: { action: "none" }, hold_action: it.hold_action ?? { action: "more-info" } });
    const c = this._config;
    const bar = sel ? part(c.picked_glass, c.picked_color, "liquid") : part(c.bar_glass, c.bar_color, "frosted");
    const icon = this._icon(running, color);
    const tray = part(c.tray_glass, c.tray_color, "flat");
    const h = pressHandlers(
      () => target,
      // the icon shows, it doesn't start anything – the drawer's buttons do; hold for details
      (kind: ActionKind) => runAction(this, hass, target, kind),
    );
    return html`<div class="item">
      <div
        class="lbar ${bar ? bar.cls : "control"} ${running ? "on" : ""} ${charging && Number.isFinite(pct) ? "charging" : ""} ${selectable ? "pick" : ""} ${sel ? "sel" : ""} fill-${c.fill_style ?? "fade"}"
        role=${selectable ? "button" : nothing}
        aria-pressed=${selectable ? (sel ? "true" : "false") : nothing}
        @click=${() => this._select(it)}
        style="${bar ? `${bar.style};` : ""}--fill:${cssColor(has(c.fill_color) ? c.fill_color! : color)};--fill-a:${c.fill_strength ?? 34};--pct:${Number.isFinite(pct) ? Math.min(100, Math.max(0, Math.round(pct))) : 0}">
        ${Number.isFinite(pct) ? html`<i class="fill"></i>` : nothing}
        <div
          class="btn ${icon.cls}"
          role="button"
          style=${icon.style}
          @pointerdown=${h.down}
          @pointermove=${h.move}
          @pointerup=${h.up}
          @pointercancel=${h.cancel}
          @contextmenu=${h.context}
        >
          ${it.icon ? html`<ha-icon .icon=${it.icon}></ha-icon>` : st ? html`<ha-state-icon .hass=${hass} .stateObj=${st}></ha-state-icon>` : nothing}
        </div>
        <div class="words">
          <span class="lname">${name}</span>
          <span class="lstate">${state}</span>
        </div>
        ${job && Number.isFinite(battery)
          ? html`<span class="batt" title=${`${tr("Battery")} ${Math.round(battery)} %`}>
              <ha-icon .icon=${batteryIcon(battery)}></ha-icon>${Math.round(battery)} %
            </span>`
          : nothing}
      </div>
      <div class="tray ${tray?.cls ?? ""}" style=${tray?.style ?? ""}>${this._tray(it, st, type)}</div>
    </div>`;
  }

  /** The button on the bar: own material / backing / symbol colours (icon_*), else the control glass lit while at work. */
  private _icon(on: boolean, color: string) {
    const c = this._config;
    const fill = on ? tint(color) : undefined;
    const accent = cssColor(color);
    const ownBg = !!c.icon_background;
    const lit = !!fill && !ownBg;
    const onColor = c.icons?.bar_on?.color;
    const offColor = c.icons?.bar?.color;
    const sym = on ? (has(onColor) ? cssColor(onColor) : ownBg ? accent : undefined) : has(offColor) ? cssColor(offColor) : undefined;
    const bg = c.icon_background === "none" ? "transparent" : ownBg ? tint(c.icon_background) : undefined;
    const m = on ? c.icon_on_glass : c.icon_glass;
    if (m)
      return {
        cls: `mat mat-${m} ${lit ? "on" : ""} ${on ? "glow" : ""}`,
        style: `${ownBg ? (bg === "transparent" ? "" : `${matTint(c.icon_background)};`) : lit ? `${matTint(color, 70)};` : ""}${sym ? `color:${sym};` : ""}--glow:${accent}`,
      };
    return {
      cls: `control ${lit ? "active glow" : ""} ${ownBg ? "own-bg" : ""} ${sym ? "own-fg" : ""}`,
      style: `${ownBg ? `--bg:${bg};${bg === "transparent" ? "" : `--sheen:${SHEEN};`}` : lit ? `--bg:${fill};--accent:${accent};` : ""}${sym ? `--fg:${sym};` : ""}--glow:${accent}`,
    };
  }

  /** A drawer button's / stage's own material: the lit one (current_*) or the others (buttons_*). */
  private _seg(cur: boolean) {
    const c = this._config;
    return cur ? part(c.current_glass, c.current_color, "liquid") : part(c.buttons_glass, c.buttons_color, "flat");
  }

  private _repeat?: number;

  /** A nudge: pressed once on touch, and again and again while held; let go and it stops. */
  private _holdBtn(icon: string, label: string, id?: string) {
    const press = () => id && this._call("button", "press", id);
    const stop = () => {
      clearTimeout(this._repeat);
      clearInterval(this._repeat);
      this._repeat = undefined;
    };
    const m = this._seg(false);
    return html`<button
      class="segb hold ${m?.cls ?? ""}"
      style=${m?.style ?? ""}
      title=${label}
      aria-label=${label}
      ?disabled=${!id}
      @pointerdown=${(e: PointerEvent) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        stop();
        haptic("selection");
        press();
        this._repeat = window.setTimeout(() => (this._repeat = window.setInterval(press, 300)), 300);
      }}
      @pointerup=${stop}
      @pointercancel=${stop}
      @lostpointercapture=${stop}
      @contextmenu=${(e: Event) => e.preventDefault()}
    >
      <ha-icon .icon=${icon}></ha-icon>
    </button>`;
  }

  private _btn(icon: string, label: string, fn: () => void, cur = false) {
    const m = this._seg(cur);
    return html`<button class="segb ${cur ? "cur" : ""} ${m?.cls ?? ""}" style=${m?.style ?? ""} title=${label} aria-label=${label} @click=${fn}><ha-icon .icon=${icon}></ha-icon></button>`;
  }

  private _tray(it: ApplianceItem, st: HassEntity | undefined, type: string) {
    const s = st?.state;
    if (type === "vacuum")
      return html`<div class="seg">
        ${this._btn("mdi:play", tr("Clean"), () => (it.start ? this._act(it.start, it.entity) : this._call("vacuum", "start", it.entity)), s === "cleaning")}
        ${this._btn("mdi:pause", tr("Pause"), () => this._call("vacuum", "pause", it.entity), s === "paused")}
        ${this._btn("mdi:stop", tr("Stop"), () => this._call("vacuum", "stop", it.entity))}
        ${this._btn("mdi:home-import-outline", tr("Go home"), () => this._call("vacuum", "return_to_base", it.entity), s === "returning" || s === "docked")}
      </div>`;
    if (type === "mower") {
      const n = it.nudge ?? {};
      const s2 = st?.state;
      // as on the robots: mow, pause, end the job, home – and, while it stands out on the lawn (not charging), the nudges
      const stuck = (s2 === "paused" || s2 === "error") && !this._charging(it) && (n.up || n.left || n.right || n.down);
      return html`<div class="seg">
          ${this._btn("mdi:play", tr("Mow"), () => s2 !== "mowing" && this._primary(it, st), s2 === "mowing")}
          ${this._btn("mdi:pause", tr("Pause"), () => (it.pause ? this._act(it.pause, it.entity) : this._call("lawn_mower", "pause", it.entity)), s2 === "paused")}
          ${this._btn("mdi:stop", tr("End the job"), () =>
            it.stop ? this._act(it.stop, it.entity) : this._hass?.callService("mammotion", "cancel_job", {}, { entity_id: it.entity }),
          )}
          ${this._btn("mdi:home-import-outline", tr("Go home"), () => this._call("lawn_mower", "dock", it.entity), s2 === "returning" || s2 === "docked")}
        </div>
        ${stuck
          ? html`<div class="seg nudges">
              ${this._holdBtn("mdi:chevron-up", tr("Forward"), n.up)}
              ${this._holdBtn("mdi:chevron-left", tr("Left"), n.left)}
              ${this._holdBtn("mdi:chevron-right", tr("Right"), n.right)}
              ${this._holdBtn("mdi:chevron-down", tr("Back"), n.down)}
            </div>`
          : nothing}`;
    }
    // washer: the stages, always – done ones marked, the current one lit, the rest waiting
    const stages = it.stages ?? WASHER_STAGES;
    const job = washerState(s);
    const phase = this._washer(it);
    const running = phase === "run" || phase === "pause";
    const at = phase === "off" ? -1 : stages.findIndex((g) => asList(g.state).map(washerState).includes(job));
    return html`<div class="stages">
      ${stages.map((g, i) => {
        const cls = at < 0 ? "" : i < at ? "done" : i === at && (running || phase === "done") ? "cur" : "";
        // just the icons, as the buttons of the other drawers; the name as a tooltip
        const nm = stageName(g);
        const m = this._seg(cls === "cur");
        return html`<div class="stage ${cls}" title=${nm} aria-label=${nm}>
          <span class="sdot ${m?.cls ?? ""}" style=${m?.style ?? ""}><ha-icon .icon=${g.icon ?? "mdi:circle-small"}></ha-icon></span>
        </div>`;
      })}
    </div>`;
  }

  protected override render() {
    const c = this._config;
    const hass = this._hass;
    if (!c || !hass) return nothing;
    this.toggleAttribute("dark", isDark(this._hass, this));
    return html`<div class="list ${this.tile}">${this._item(c, hass)}</div>`;
  }

  override getCardSize() {
    return 2;
  }

  static override styles = [
    GlassElement.styles,
    surface,
    control,
    liquidBar,
    css`
      :host {
        display: block;
        --btn: var(--glass-appliance-button-size, 42px);
      }
      .list {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .item {
        display: flex;
        flex-direction: column;
      }
      .lbar {
        position: relative;
        z-index: 1;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 4px;
        isolation: isolate;
        cursor: default;
      }
      .btn {
        flex: none;
        width: var(--btn);
        height: var(--btn);
        display: grid;
        place-items: center;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }
      .btn ha-icon,
      .btn ha-state-icon {
        --mdc-icon-size: var(--gi-bar-size, calc(var(--btn) * 0.52));
        display: flex;
      }
      .lbar.on .btn ha-icon,
      .lbar.on .btn ha-state-icon {
        --mdc-icon-size: var(--gi-bar_on-size, var(--gi-bar-size, calc(var(--btn) * 0.52)));
      }
      .btn:not(.active) {
        --fg: var(--glass-icon-inactive, var(--g-text));
      }
      :host([control-glass]) .btn.control.active.glow,
      .btn.control.active.glow {
        overflow: visible;
        box-shadow:
          0 0 10px 1px color-mix(in srgb, var(--glow) 55%, transparent),
          0 0 22px 5px color-mix(in srgb, var(--glow) 25%, transparent),
          inset 0 1px 0 rgba(255, 255, 255, 0.5) !important;
      }
      /* charging: the battery; a job: its progress – filled from the left, as the lights' brightness */
      .fill {
        position: absolute;
        inset: 0;
        z-index: -1;
        border-radius: inherit;
        pointer-events: none;
        background: linear-gradient(
          90deg,
          color-mix(in srgb, var(--fill) calc(var(--fill-a, 34) * 1%), transparent),
          color-mix(in srgb, var(--fill) calc(var(--fill-a, 34) * 0.65%), transparent)
        );
        clip-path: inset(0 calc(100% - (var(--btn) + 8px) - (100% - var(--btn) - 8px) * var(--pct) / 100) 0 0 round 999px);
        transition: clip-path 0.25s ease;
      }
      /* fill_style: one even colour, a glow towards the value, or none */
      .lbar.fill-solid .fill {
        background: color-mix(in srgb, var(--fill) calc(var(--fill-a, 34) * 1%), transparent);
      }
      .lbar.fill-glow .fill {
        background: linear-gradient(
          90deg,
          color-mix(in srgb, var(--fill) calc(var(--fill-a, 34) * 0.4%), transparent),
          color-mix(in srgb, var(--fill) calc(var(--fill-a, 34) * 1.6%), transparent)
        );
      }
      .lbar.fill-none .fill {
        display: none;
      }
      /* own materials: the shape the control glass would give */
      .lbar.mat,
      .btn.mat {
        border-radius: 999px;
      }
      .btn.mat.glow {
        overflow: visible;
        box-shadow:
          0 0 10px 1px color-mix(in srgb, var(--glow) 55%, transparent),
          0 0 22px 5px color-mix(in srgb, var(--glow) 25%, transparent);
      }
      .btn.mat.on {
        color: #fff;
      }
      .segb.mat,
      .sdot.mat {
        border-radius: 50%;
      }
      /* icon_background / icon colours on the control glass: they beat every look's (Apple Home's grey too) */
      :host([control-glass]) .btn.control.own-bg {
        background: var(--sheen, linear-gradient(transparent, transparent)), linear-gradient(var(--bg), var(--bg)) !important;
      }
      :host([control-glass]) .btn.control.own-bg::before {
        display: none;
      }
      :host([control-glass]) .btn.control.own-fg {
        color: var(--fg) !important;
      }
      /* charging: waves run from empty up to the charge, inside the fill */
      .fill::after {
        content: "";
        position: absolute;
        inset: 0;
        opacity: 0;
      }
      .lbar.charging .fill::after {
        opacity: 1;
        background: linear-gradient(
          90deg,
          transparent 0%,
          color-mix(in srgb, var(--fill) 30%, transparent) 40%,
          color-mix(in srgb, var(--fill) 45%, rgba(255, 255, 255, 0.35)) 50%,
          color-mix(in srgb, var(--fill) 30%, transparent) 60%,
          transparent 100%
        );
        background-size: 40% 100%;
        background-repeat: no-repeat;
        animation: charge 2.4s ease-in-out infinite;
      }
      @keyframes charge {
        from {
          background-position: -70% 0;
        }
        to {
          background-position: calc(var(--pct) * 1% + 70%) 0;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .lbar.charging .fill::after {
          animation: none;
          opacity: 0;
        }
      }
      .batt {
        flex: none;
        display: flex;
        align-items: center;
        gap: 2px;
        padding-right: 10px;
        font-size: var(--gt-battery-size, 11px);
        font-weight: var(--gt-battery-weight, 600);
        font-variant-numeric: tabular-nums;
        color: var(--gt-battery-color, var(--g-text-2));
      }
      .batt ha-icon {
        --mdc-icon-size: var(--gi-battery-size, 16px);
        color: var(--gi-battery-color, inherit);
        display: flex;
      }
      .words {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        padding-right: 6px;
      }
      /* a bar that picks what the right side shows: tap anywhere on it */
      .lbar.pick {
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        transition:
          background 0.3s ease,
          box-shadow 0.3s ease,
          transform 0.15s ease;
      }
      .lbar.pick:active {
        transform: scale(0.98);
      }
      /* the picked one: the light liquid glass of the panel on the right, with its dark text */
      :host .lbar.control.sel {
        /* fixed dark text: in the dark sidebar the home text tokens are light */
        --g-text: #1c1c1e;
        --g-text-2: rgba(60, 60, 67, 0.68);
        --glass-icon-inactive: #1c1c1e;
        color: var(--g-text);
        border: 0 !important;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.62), rgba(255, 255, 255, 0.22) 55%, rgba(255, 255, 255, 0.34)) !important;
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.95),
          inset 0 -1px 0 rgba(255, 255, 255, 0.45),
          inset 0 0 14px rgba(255, 255, 255, 0.35),
          0 1px 2px rgba(0, 0, 0, 0.06),
          0 6px 18px rgba(0, 0, 0, 0.08) !important;
        -webkit-backdrop-filter: blur(calc(10px * var(--glass-blur-scale, 1))) saturate(170%) brightness(1.04);
        backdrop-filter: blur(calc(10px * var(--glass-blur-scale, 1))) saturate(170%) brightness(1.04);
      }
      /* by night the panel on the right is smoky glass: the picked bar (and a lit button) follow it, light text */
      :host([dark]) .lbar.control.sel,
      :host([dark]) .segb.cur:not(.mat),
      :host([dark]) .stage.cur .sdot:not(.mat) {
        --g-text: #fff;
        --g-text-2: rgba(235, 235, 245, 0.6);
        --glass-icon-inactive: #fff;
        color: #fff;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.24), rgba(255, 255, 255, 0.08) 55%, rgba(255, 255, 255, 0.12)) !important;
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.35),
          inset 0 -1px 0 rgba(255, 255, 255, 0.1),
          0 1px 2px rgba(0, 0, 0, 0.12),
          0 6px 18px rgba(0, 0, 0, 0.18) !important;
        -webkit-backdrop-filter: blur(calc(10px * var(--glass-blur-scale, 1))) saturate(150%);
        backdrop-filter: blur(calc(10px * var(--glass-blur-scale, 1))) saturate(150%);
      }
      /* by day the same pill in white glass: a top-down sheen, a bright top edge */
      :host(:not([dark])) .lbar.control:not(.sel) {
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.34), rgba(255, 255, 255, 0.12) 55%, rgba(255, 255, 255, 0.2)) !important;
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.55),
          0 1px 2px rgba(0, 0, 0, 0.04),
          0 4px 12px rgba(0, 0, 0, 0.06) !important;
      }
      /* by night the others get a faint top-down sheen too – much quieter than the picked one, no tint
         (the status bar's pills use the same) */
      :host([dark]) .lbar.control:not(.sel) {
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.13), rgba(255, 255, 255, 0.04) 55%, rgba(255, 255, 255, 0.07)) !important;
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.16),
          0 1px 2px rgba(0, 0, 0, 0.1),
          0 4px 12px rgba(0, 0, 0, 0.12) !important;
      }
      /* by night the lit button / current stage must stand out from the dim others: brighter glass */
      :host([dark]) .segb.cur:not(.mat),
      :host([dark]) .stage.cur .sdot:not(.mat) {
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.5), rgba(255, 255, 255, 0.28) 55%, rgba(255, 255, 255, 0.36)) !important;
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.7),
          0 0 0 1px rgba(255, 255, 255, 0.18),
          0 4px 14px rgba(0, 0, 0, 0.3) !important;
      }
      .lname {
        color: var(--gt-name-color, inherit);
        font-size: var(--gt-name-size, 14px);
        font-weight: var(--gt-name-weight, 600);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .lstate {
        font-size: var(--gt-state-size, 12px);
        font-weight: var(--gt-state-weight, 400);
        color: var(--gt-state-color, var(--g-text-2));
      }
      /* the picked bar: name_on / state_on */
      .lbar.sel .lname {
        color: var(--gt-name_on-color, var(--gt-name-color, inherit));
        font-size: var(--gt-name_on-size, var(--gt-name-size, 14px));
        font-weight: var(--gt-name_on-weight, var(--gt-name-weight, 600));
      }
      .lbar.sel .lstate {
        color: var(--gt-state_on-color, var(--gt-state-color, var(--g-text-2)));
        font-size: var(--gt-state_on-size, var(--gt-state-size, 12px));
        font-weight: var(--gt-state_on-weight, var(--gt-state-weight, 400));
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      /* the drawer under the bar, as on the lights: tucked beneath from the bar's middle */
      .tray {
        position: relative;
        z-index: 0;
        margin-top: calc(-4px - var(--btn) / 2);
        padding: calc(var(--btn) / 2 + 4px + 10px) 4px 8px;
        border-radius: 0 0 22px 22px;
        /* the part tucked under the bar is cut away, so a see-through bar never shows the
           drawer through it – only the corners beside the bar's rounded ends stay */
        --r: calc(var(--btn) / 2 + 4px);
        -webkit-mask:
          radial-gradient(circle at var(--r) 0, transparent calc(var(--r) - 0.5px), #000 var(--r)) top left / var(--r) var(--r) no-repeat,
          radial-gradient(circle at 0 0, transparent calc(var(--r) - 0.5px), #000 var(--r)) top right / var(--r) var(--r) no-repeat,
          linear-gradient(#000 0 0) 0 var(--r) / 100% calc(100% - var(--r)) no-repeat;
        mask:
          radial-gradient(circle at var(--r) 0, transparent calc(var(--r) - 0.5px), #000 var(--r)) top left / var(--r) var(--r) no-repeat,
          radial-gradient(circle at 0 0, transparent calc(var(--r) - 0.5px), #000 var(--r)) top right / var(--r) var(--r) no-repeat,
          linear-gradient(#000 0 0) 0 var(--r) / 100% calc(100% - var(--r)) no-repeat;
      }
      .tray:not(.mat) {
        background: var(--glass-seg-bg, color-mix(in srgb, var(--g-text) 7%, transparent));
        box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.07);
      }
      /* the buttons under a bar: each in the middle of an equal share, as the washer's stages */
      .seg {
        display: grid;
        grid-auto-flow: column;
        grid-auto-columns: minmax(0, 1fr);
        justify-items: center;
        gap: 4px;
        padding: 0 4px;
      }
      .seg.nudges {
        margin-top: 8px;
      }
      .segb {
        flex: none;
        width: 36px;
        height: 36px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        color: var(--g-text-2);
        display: grid;
        place-items: center;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        transition:
          background 0.25s ease,
          color 0.25s ease,
          transform 0.15s ease;
      }
      .segb:not(.mat) {
        background: color-mix(in srgb, var(--g-text) 8%, transparent);
      }
      .segb:active {
        transform: scale(0.88);
        background: color-mix(in srgb, var(--g-text) 22%, transparent);
      }
      /* held down: no text selection, no long-press menu */
      .segb.hold {
        touch-action: none;
        user-select: none;
        -webkit-user-select: none;
        -webkit-touch-callout: none;
      }
      .segb ha-icon {
        --mdc-icon-size: var(--gi-buttons-size, 18px);
        color: var(--gi-buttons-color, inherit);
      }
      .segb.cur ha-icon,
      .stage.cur .sdot ha-icon {
        --mdc-icon-size: var(--gi-buttons_on-size, var(--gi-buttons-size, 18px));
        color: var(--gi-buttons_on-color, var(--gi-buttons-color, inherit));
      }
      /* what the appliance is doing now: the light liquid glass of the picked bar */
      /* the lit button – and the washer's current stage, in the same glass */
      .segb.cur:not(.mat),
      .stage.cur .sdot:not(.mat) {
        color: #1c1c1e;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.62), rgba(255, 255, 255, 0.22) 55%, rgba(255, 255, 255, 0.34));
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.95),
          inset 0 -1px 0 rgba(255, 255, 255, 0.45),
          inset 0 0 14px rgba(255, 255, 255, 0.35),
          0 1px 2px rgba(0, 0, 0, 0.06),
          0 6px 18px rgba(0, 0, 0, 0.08);
        -webkit-backdrop-filter: blur(calc(10px * var(--glass-blur-scale, 1))) saturate(170%) brightness(1.04);
        backdrop-filter: blur(calc(10px * var(--glass-blur-scale, 1))) saturate(170%) brightness(1.04);
      }
      /* washer stages: done ticked, the current one lit, the rest waiting */
      .stages {
        display: flex;
        justify-content: space-between;
        gap: 4px;
        padding: 0 4px;
      }
      .stage {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        color: var(--g-text-2);
        opacity: 0.6;
      }
      .sdot {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        display: grid;
        place-items: center;
      }
      .sdot:not(.mat) {
        background: color-mix(in srgb, var(--g-text) 8%, transparent);
      }
      .sdot ha-icon {
        --mdc-icon-size: var(--gi-buttons-size, 16px);
        color: var(--gi-buttons-color, inherit);
        display: flex;
      }
      .slabel {
        font-size: 11px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100%;
      }
      .stage.done {
        opacity: 1;
      }
      .stage.cur {
        opacity: 1;
        color: var(--g-text);
      }
    `,
    materials,
  ];
}

registerCard("glass-appliance", GlassAppliance, {
  name: "Glass – appliances",
  description: "Vacuums, mowers and washers as liquid glass bars with a drawer of controls or the washing cycle's stages.",
});
