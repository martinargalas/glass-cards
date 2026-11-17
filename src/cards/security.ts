import { tr } from "../i18n";
import { css, html, LitElement, nothing, svg, type CSSResult, type PropertyValues, type TemplateResult } from "lit";
import { GlassElement } from "../core/glass-element";
import { LiquidController, PART_GL } from "../core/liquid";
import { wallpaperElement } from "../core/liquid-gl";
import type { BaseCardConfig, HassEntity, HomeAssistant } from "../core/types";
import { registerCard } from "../core/registry";
import { makeEditor } from "../editor/editor";
import { securitySpec } from "../editor/specs";
import { haptic } from "../core/actions";
import { control, liquidBar, surface } from "../core/styles";
import { materials, matTint, type Material } from "../core/materials";
import { SECURITY_PARTS } from "../core/card-parts";
import { buildChildren, forward, type ChildEl, type Mode } from "../core/container";
import { language, resolveGlass, settings } from "../core/settings";
import "./status-bar";

/**
 * An alarm panel: the alarm's state, its arm modes, the countdown while it arms or waits for
 * the code, and a keypad. It works with any `alarm_control_panel`; with Alarmo
 * (github.com/nielsfaber/alarmo) it also shows which modes can be armed now (open sensors),
 * the exact countdown, a wrong code, and offers "skip the delay" and "arm anyway".
 *
 *   type: custom:glass-security
 *   entity: alarm_control_panel.alarmo
 *   modes: [away, home, night]   # arm buttons: away | home | night | vacation | custom_bypass
 *                                #   (default: the ones the alarm supports)
 *   keypad: ask                  # ask (when an action needs it) | auto (whenever a code is needed) | always | never
 *   keyboard: true               # a physical keypad / keyboard types into it
 *   close_popup: true            # in a pop-up: closes it once the alarm is disarmed or armed
 *   show_sensors: true           # the open / bypassed sensors
 *   sensors: [binary_sensor.front_door, …]   # the drawer's sensors (default: Alarmo's for this alarm)
 *   drawer: true                 # the sensors in a drawer under a bar: what's open at a glance
 *   drawer_style: pill           # pill (default) | bar – a bar with a round button
 *   sensor_items: list           # list (default) | pills
 *   layout: card                 # card (default) | header – only the mode buttons, for a pop-up header
 *                                #   | keypad – only the state and the keypad, for a pop-up of its own
 *   keypad_popup: "#alarm-keypad"   # header: the keypad in that pop-up instead of over the screen
 *
 * For the warning that pops up when someone comes in, put it in a Bubble Card pop-up that
 * opens itself (`trigger`) while the alarm is pending or triggered – see docs/cards/security.md.
 */
type ArmMode = "away" | "home" | "night" | "vacation" | "custom_bypass";

interface SecurityConfig extends BaseCardConfig {
  /** the alarm: an alarm_control_panel entity (Alarmo's, or any other) */
  entity: string;
  /** the name shown (default: the entity's name) */
  name?: string;
  /** arm buttons: away | home | night | vacation | custom_bypass (default: the modes the alarm supports) */
  modes?: ArmMode[];
  /** the keypad: ask – when an action needs the code (a tap on Off or a mode), and while the alarm
   *  waits for it or rings (default); auto – whenever a code is needed; always; never */
  keypad?: "ask" | "auto" | "always" | "never";
  /** a physical keypad or keyboard types into the card (default on) */
  keyboard?: boolean;
  /** in a Bubble Card pop-up: close it once the alarm is disarmed or armed (default on) */
  close_popup?: boolean;
  /** the sensors that are open, triggered it or are bypassed (default on) */
  show_sensors?: boolean;
  /** the drawer's sensors: entities, or { entity, name, icon } (default: Alarmo's sensors of this alarm) */
  sensors?: (string | { entity: string; name?: string; icon?: string })[];
  /** the sensors in a drawer under a bar that says what's open (default on, when there are sensors) */
  drawer?: boolean;
  /** the drawer's bar: pill – a pill with the shield, the summary and an arrow (default); bar – a bar with a round button */
  drawer_style?: "pill" | "bar";
  /** the sensors in the drawer: list – a row each with its state and modes (default); pills – a pill each */
  sensor_items?: "list" | "pills";
  /** card – the whole panel (default); header – only the mode buttons, for a pop-up's header;
   *  keypad – only the state and the keypad, for a pop-up of its own */
  layout?: "card" | "header" | "keypad";
  /** open the keypad in this Bubble Card pop-up (its #hash) instead of over the screen – a pop-up
   *  with a glass-security card in it (layout: keypad) */
  keypad_popup?: string;
  /** the header version: the buttons' names next to their icons (default on; off – round icons, e.g. on a phone) */
  labels?: boolean;
  /** the header version: the buttons at the start of the space they get (default) or at its end */
  align?: "start" | "end" | "stretch";
  /** material of the bar: the state, the shield that disarms, the modes */
  bar_glass?: Material;
  bar_color?: string;
  /** material of the drawer under it */
  tray_glass?: Material;
  tray_color?: string;
  /** material of the sensors' pills in the drawer (sensor_items: pills) */
  sensors_glass?: Material;
  sensors_color?: string;
  /** material of the mode buttons (the header version: the ones not in force) */
  buttons_glass?: Material;
  buttons_color?: string;
  /** the header version: material of the button in force (default: dark) */
  active_glass?: Material;
  active_color?: string;
  /** material of the keypad's keys (and the text field of a text code) */
  keys_glass?: Material;
  keys_color?: string;
  /** material of the round button (the countdown, the keypad) and "Arm anyway" */
  actions_glass?: Material;
  actions_color?: string;
  /** material of the message: a wrong code, why it couldn't arm */
  message_glass?: Material;
  message_color?: string;
}

/** HA's AlarmControlPanelEntityFeature bits */
const FEATURE: Record<ArmMode, number> = { home: 1, away: 2, night: 4, custom_bypass: 16, vacation: 32 };
const ORDER: ArmMode[] = ["away", "home", "night", "vacation", "custom_bypass"];
const MODE: Record<ArmMode, { label: string; icon: string }> = {
  away: { label: "Away", icon: "mdi:shield-lock" },
  home: { label: "Home", icon: "mdi:shield-home" },
  night: { label: "Night", icon: "mdi:shield-moon" },
  vacation: { label: "Vacation", icon: "mdi:shield-airplane" },
  custom_bypass: { label: "Custom", icon: "mdi:security" },
};
const STATE: Record<string, { label: string; icon: string; tone: string }> = {
  disarmed: { label: "Disarmed", icon: "mdi:shield-off-outline", tone: "off" },
  arming: { label: "Arming", icon: "mdi:shield-sync-outline", tone: "wait" },
  armed_away: { label: "Armed – away", icon: "mdi:shield-lock", tone: "on" },
  armed_home: { label: "Armed – home", icon: "mdi:shield-home", tone: "on" },
  armed_night: { label: "Armed – night", icon: "mdi:shield-moon", tone: "on" },
  armed_vacation: { label: "Armed – vacation", icon: "mdi:shield-airplane", tone: "on" },
  armed_custom_bypass: { label: "Armed – custom", icon: "mdi:security", tone: "on" },
  pending: { label: "Enter the code", icon: "mdi:shield-alert-outline", tone: "warn" },
  triggered: { label: "Alarm!", icon: "mdi:alarm-light", tone: "alarm" },
  disarming: { label: "Disarming", icon: "mdi:shield-sync-outline", tone: "wait" },
};
const STABLE = (s?: string) => s === "disarmed" || !!s?.startsWith("armed_");

const has = (v?: string) => !!v && v !== "none";

/** a sensor's icon, closed / open, by Alarmo's type or its device class */
const SENSOR_ICON: Record<string, [string, string]> = {
  door: ["mdi:door-closed", "mdi:door-open"],
  garage_door: ["mdi:garage", "mdi:garage-open"],
  opening: ["mdi:door-closed", "mdi:door-open"],
  lock: ["mdi:lock", "mdi:lock-open-variant"],
  window: ["mdi:window-closed-variant", "mdi:window-open-variant"],
  motion: ["mdi:motion-sensor-off", "mdi:motion-sensor"],
  occupancy: ["mdi:home-outline", "mdi:home-account"],
  presence: ["mdi:home-outline", "mdi:home-account"],
  tamper: ["mdi:shield-check-outline", "mdi:shield-alert-outline"],
  vibration: ["mdi:vibrate-off", "mdi:vibrate"],
  sound: ["mdi:volume-off", "mdi:volume-high"],
  smoke: ["mdi:smoke-detector-variant", "mdi:smoke-detector-variant-alert"],
  gas: ["mdi:smoke-detector-variant", "mdi:smoke-detector-variant-alert"],
  carbon_monoxide: ["mdi:smoke-detector-variant", "mdi:smoke-detector-variant-alert"],
  moisture: ["mdi:water-off", "mdi:water-alert"],
  environmental: ["mdi:smoke-detector-variant", "mdi:smoke-detector-variant-alert"],
};
/** sensors that open (open / closed) and that see someone (detected / clear) */
const OPENING = ["door", "garage_door", "opening", "window"];
const PRESENCE = ["motion", "occupancy", "presence"];
interface Sensor {
  id: string;
  name?: string;
  icon?: string;
  /** Alarmo's sensor type (door, window, motion…) */
  type?: string;
  /** the arm modes it guards (Alarmo) */
  modes?: string[];
}
function matPart(m: Material | undefined, color: string | undefined) {
  return m ? { cls: `mat mat-${m}`, style: has(color) ? matTint(color) : "" } : { cls: "", style: "" };
}

/** Alarmo's entities (entity → area): one lookup per Home Assistant */
let alarmoAreas: Promise<Map<string, string> | undefined> | undefined;
let alarmoFor: HomeAssistant | undefined;
function alarmoEntities(hass: HomeAssistant) {
  if (!alarmoAreas || alarmoFor?.connection !== hass.connection) {
    alarmoFor = hass;
    alarmoAreas = hass
      .callWS<{ entity_id: string; area_id: string | number }[]>({ type: "alarmo/entities" })
      .then((l) => new Map(l.map((x) => [x.entity_id, String(x.area_id)])))
      .catch(() => undefined);
  }
  return alarmoAreas;
}

/** The header's keypad over the screen: its own element under <body> (the top layer) – a Lit host,
 *  so the real WebGL glass draws on its sheet, keys and controls as on the card itself. */
class SecurityKeypadLayer extends LitElement {
  static override properties = { content: { attribute: false } };
  declare content: TemplateResult | typeof nothing;
  /** the card's style sheets */
  sheets: CSSStyleSheet[] = [];
  constructor() {
    super();
    this.content = nothing;
    new LiquidController(this, ".frame");
    new LiquidController(this, PART_GL, undefined, undefined, () => wallpaperElement());
    new LiquidController(this, ".control:not(.active)", undefined, undefined, () => wallpaperElement(), () => /^(dark-)?liquid-gl$/.test(this.getAttribute("control-glass") ?? ""));
  }
  override connectedCallback() {
    super.connectedCallback();
    if (this.shadowRoot) this.shadowRoot.adoptedStyleSheets = this.sheets;
  }
  protected override render() {
    return this.content;
  }
}
if (!customElements.get("glass-security-keypad")) customElements.define("glass-security-keypad", SecurityKeypadLayer);

/** the alarm cards on the page (a physical keypad types into one of them) */
const LIVE = new Set<GlassSecurity>();
/** what the header asked a keypad pop-up to do (a pop-up's card made later picks it up) */
const PENDING = new Map<string, { mode?: ArmMode; at: number; code?: string }>();

class GlassSecurity extends GlassElement<SecurityConfig> {
  static override parts = SECURITY_PARTS;
  static override properties = {
    ...GlassElement.properties,
    _code: { state: true },
    _msg: { state: true },
    _ready: { state: true },
    _cd: { state: true },
    _now: { state: true },
    _shake: { state: true },
    _blocked: { state: true },
    _alarmo: { state: true },
    _sensors: { state: true },
    _drawer: { state: true },
    _pad: { state: true },
    _armAfter: { state: true },
  };
  /** the keypad opened by hand (the keypad button, a tap on the shield) */
  declare _pad: boolean;
  /** a mode waiting for the code to arm */
  declare _armAfter?: ArmMode;
  /** the drawer's sensors */
  declare _sensors?: Sensor[];
  /** the drawer is open */
  declare _drawer: boolean;
  /** the sensors' states last drawn (a change re-draws the card) */
  private _sensorKey = "";
  /** the drawer was opened once: its content stays (it slides shut, not away) */
  private _everOpen = false;
  /** the drawer's pills: a status bar of the sensors, built anew when they (or what's bypassed) change */
  private _pills?: ChildEl;
  private _pillsKey = "";
  private _mode: Mode = settings.mode;
  private _ro?: ResizeObserver;
  private _cols = 3;
  /** the card's width (the header version, stretched: do the names fit?) */
  private _width = 0;
  /** the header version, not stretched: 0 every button named, 1 only the one in force, 2 none */
  private _hl = 0;

  setMode(mode: Mode) {
    if (mode === this._mode) return;
    this._mode = mode;
    this._pillsKey = "";
    this.requestUpdate();
  }
  /** the code typed so far (never kept beyond the card) */
  declare _code: string;
  /** a message under the state: a wrong code, why it couldn't arm */
  declare _msg?: { text: string; tone: "warn" | "alarm" };
  /** Alarmo: the modes that can be armed now (no open sensors in the way) */
  declare _ready?: string[];
  /** the countdown: its length and when it ends */
  declare _cd?: { total: number; end: number };
  declare _now: number;
  declare _shake: boolean;
  /** Alarmo couldn't arm: the mode and the sensors in the way – "arm anyway" bypasses them */
  declare _blocked?: { mode: ArmMode; sensors: string[] };
  /** this alarm is Alarmo's: its area (master: "0") */
  declare _alarmo?: string;

  private _last?: string;
  private _alerted = false;
  private _tick?: number;
  private _unsub?: Promise<() => void>;
  private _msgTimer?: number;

  constructor() {
    super();
    // the card's own glass (glass: liquid / dark-liquid): real WebGL liquid glass, as the blinds' tile
    new LiquidController(this, ".frame");
    this._code = "";
    this._now = Date.now();
    this._shake = false;
    this._drawer = false;
    this._pad = false;
  }

  static getConfigElement() {
    return makeEditor(securitySpec);
  }

  static getStubConfig(hass?: HomeAssistant) {
    const ids = Object.keys(hass?.states ?? {}).filter((e) => e.startsWith("alarm_control_panel."));
    return { entity: ids.find((e) => e.includes("alarmo")) ?? ids[0] ?? "alarm_control_panel.alarmo" };
  }

  protected override validateConfig(c: SecurityConfig) {
    if (!c.entity) throw new Error(tr("Pick an alarm (alarm_control_panel)"));
    this._sensors = c.sensors?.length
      ? c.sensors.map((x) => (typeof x === "string" ? { id: x } : { id: x.entity, name: x.name, icon: x.icon })).filter((x) => x.id)
      : undefined;
    return c;
  }

  protected watchedEntities(c: SecurityConfig) {
    return [c.entity];
  }

  override connectedCallback() {
    super.connectedCallback();
    document.addEventListener("keydown", this._onKey);
    LIVE.add(this);
    // the pills: three side by side, two on a narrow card (a phone)
    this._ro = new ResizeObserver(([e]) => {
      const w = e.contentRect.width;
      if (w !== this._width) {
        this._width = w;
        if (this._config?.layout === "header") {
          this._hl = 0;
          this.requestUpdate();
        }
      }
      const cols = w < 300 ? 1 : w < 440 ? 2 : 3;
      if (cols !== this._cols) {
        this._cols = cols;
        this.requestUpdate();
      }
    });
    this._ro.observe(this);
    this._tick = window.setInterval(() => this._cd && (this._now = Date.now()), 250);
    // a keypad pop-up's card, just put in its pop-up: the header's request
    requestAnimationFrame(() => this._takeRequest());
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("keydown", this._onKey);
    LIVE.delete(this);
    this._ro?.disconnect();
    clearInterval(this._tick);
    clearTimeout(this._msgTimer);
    this._unsub?.then((u) => u()).catch(() => {});
    this._unsub = undefined;
    this._portalRender(nothing);
  }

  get _st(): HassEntity | undefined {
    return this._hass?.states[this._config?.entity];
  }

  /* ---------- Alarmo ---------- */

  protected override hassChanged(hass: HomeAssistant) {
    const st = this._st?.state;
    if (this._alarmo === undefined && this._config) {
      alarmoEntities(hass).then((m) => {
        const area = m?.get(this._config.entity);
        if (area === undefined) return;
        this._alarmo = area;
        this._subscribe();
        this._fetchReady();
        this._fetchCountdown();
        this._fetchSensors();
      });
    }
    if (PENDING.size) this._takeRequest();
    if (st === this._last) return;
    const prev = this._last;
    // the header's request is done (disarmed, or arming / armed): its pop-up closes
    if (this._requested && prev) {
      this._requested = false;
      // back where the header was (its own pop-up stays open)
      if (this._inPopup() && location.hash) window.setTimeout(() => history.back(), 900);
    }
    this._last = st;
    // a new state: the code and what was asked start over (not on the very first one – a keypad
    // pop-up's card may have just taken the header's request)
    if (prev !== undefined) {
      this._code = "";
      this._blocked = undefined;
      this._pad = false;
      this._armAfter = undefined;
    }
    // someone came in (pending / ringing): the pop-up that opened for it closes once it's over;
    // arming from a pop-up doesn't close it
    if (st === "pending" || st === "triggered") this._alerted = true;
    // the countdown: Alarmo's exact one; else none (other alarms don't say)
    if (st === "arming" || st === "pending") {
      // right away from the alarm's own attributes (Alarmo's delay, from when it changed);
      // Alarmo's countdown then makes it exact
      const e = this._st!;
      const delay = Number(e.attributes.delay);
      const from = Date.parse(e.last_changed);
      if (delay > 0 && from) this._cd = { total: delay, end: from + delay * 1000 };
      this._now = Date.now();
      this._fetchCountdown();
    } else this._cd = undefined;
    if (this._alarmo !== undefined) this._fetchReady();
    // the pop-up that opened for it closes once it's over
    if (prev && STABLE(st) && this._alerted) {
      this._alerted = false;
      if (this._config.close_popup !== false && this._config.layout !== "header") this._closePopup();
    }
  }

  private async _fetchCountdown() {
    const hass = this._hass;
    if (!hass || this._alarmo === undefined) return;
    try {
      const r = await hass.callWS<{ delay: number | null; remaining: number }>({ type: "alarmo/countdown", entity_id: this._config.entity });
      if (r.remaining > 0) this._cd = { total: r.delay || r.remaining, end: Date.now() + r.remaining * 1000 };
      else this._cd = undefined;
      this._now = Date.now();
    } catch {
      /* not Alarmo after all */
    }
  }

  /** Alarmo's sensors of this alarm (enabled ones; the master: all of them) */
  private async _fetchSensors() {
    const hass = this._hass;
    if (!hass || this._alarmo === undefined || this._config.sensors?.length) return;
    try {
      const all = await hass.callWS<Record<string, { entity_id: string; type?: string; modes?: string[]; area?: string; enabled?: boolean }>>({ type: "alarmo/sensors" });
      this._sensors = Object.values(all)
        .filter((x) => x.enabled !== false && (this._alarmo === "0" || String(x.area) === this._alarmo))
        .map((x) => ({ id: x.entity_id, type: x.type, modes: x.modes }));
    } catch {
      /* an older Alarmo: no drawer unless sensors are listed */
    }
  }

  /** the sensors' states changed: draw again (they aren't the card's watched entity) */
  protected override forwardHass(hass: HomeAssistant) {
    if (this._pills) forward([this._pills], hass);
    if (!this._sensors?.length) return;
    const key = this._sensors.map((x) => hass.states[x.id]?.state ?? "").join("|");
    if (key !== this._sensorKey) {
      this._sensorKey = key;
      this.requestUpdate();
    }
  }

  private async _fetchReady() {
    const hass = this._hass;
    if (!hass || this._alarmo === undefined) return;
    try {
      const r = await hass.callWS<{ modes: string[] | null }>({ type: "alarmo/ready_to_arm_modes", entity_id: this._config.entity });
      this._ready = r.modes ?? undefined;
    } catch {
      this._ready = undefined;
    }
  }

  /** Alarmo's events: a wrong code, a failed arming (and why), readiness */
  private _subscribe() {
    if (this._unsub || !this._hass) return;
    const mine = (area: unknown) => this._alarmo === "0" || String(area) === this._alarmo;
    this._unsub = this._hass.connection.subscribeMessage<{ event?: { data?: Record<string, any> } } & Record<string, any>>(
      (m) => {
        // the websocket library hands over the message's `event`: { data }
        const d = (m.event?.data ?? m.data ?? m) as Record<string, any>;
        if (!mine(d.area_id)) return;
        switch (d.event) {
          case "invalid_code_provided":
            this._wrong();
            break;
          case "no_code_provided":
            this._say(tr("Enter the code"), "warn");
            break;
          case "failed_to_arm": {
            const sensors = Object.keys(d.open_sensors ?? {});
            const mode = String(d.command ?? "").replace(/^arm_/, "") as ArmMode;
            this._blocked = sensors.length && ORDER.includes(mode) ? { mode, sensors } : undefined;
            if (sensors.length && this._sensors?.length) this._drawer = true;
            this._say(sensors.length ? tr("Can't arm: {sensors}", { sensors: this._names(sensors) }) : tr("Can't arm now"), "warn", 8000);
            break;
          }
          case "ready_to_arm_modes_changed":
            this._ready = d.modes ?? undefined;
            break;
          case "arm":
          case "trigger":
            this._fetchCountdown();
            break;
        }
      },
      { type: "alarmo_updated" },
    );
    this._unsub.catch(() => (this._unsub = undefined));
  }

  /* ---------- actions ---------- */

  private _say(text: string, tone: "warn" | "alarm", ms = 4000) {
    this._msg = { text, tone };
    clearTimeout(this._msgTimer);
    this._msgTimer = window.setTimeout(() => (this._msg = undefined), ms);
  }

  private _wrong() {
    haptic("medium");
    this._code = "";
    this._shake = true;
    window.setTimeout(() => (this._shake = false), 450);
    this._say(tr("Wrong code"), "alarm");
  }

  private _names(ids: string[]) {
    return ids.map((id) => this._hass?.states[id]?.attributes.friendly_name ?? id).join(", ");
  }

  private _call(domain: string, service: string, data: Record<string, unknown>) {
    return this._hass!.callService(domain, service, { entity_id: this._config.entity, ...data }).catch((e: { message?: string }) => {
      // a wrong code (most alarms say so by an error), else what went wrong
      if (/code/i.test(e?.message ?? "")) this._wrong();
      else this._say(e?.message ?? tr("It didn't work"), "warn");
    });
  }

  private _arm(mode: ArmMode, force = false) {
    haptic("selection");
    const code = this._code || undefined;
    this._code = "";
    this._blocked = undefined;
    if (force) return this._call("alarmo", "arm", { mode, force: true, ...(code ? { code } : {}) });
    return this._call("alarm_control_panel", `alarm_arm_${mode}`, code ? { code } : {});
  }

  private _disarm() {
    haptic("selection");
    const code = this._code;
    this._code = "";
    return this._call("alarm_control_panel", "alarm_disarm", code ? { code } : {});
  }

  private _skip() {
    haptic("selection");
    this._call("alarmo", "skip_delay", {});
  }

  /** the code is done: disarm (it's armed, arming, waiting or ringing) */
  private _enter() {
    const st = this._st?.state;
    if (!st || !this._code) return;
    if (this._armAfter) {
      const m = this._armAfter;
      this._armAfter = undefined;
      this._arm(m);
      return;
    }
    if (st !== "disarmed") this._disarm();
  }

  _press(k: string) {
    if (k === "back") this._code = this._code.slice(0, -1);
    else if (k === "clear") this._code = "";
    else if (k === "ok") return this._enter();
    else if (this._code.length < 16) this._code += k;
    haptic();
  }

  /** A physical keypad / keyboard: digits, Backspace, Enter, Esc – while the card is on screen
   *  and nothing else (a text field) has the keys. */
  private _onKey = (e: KeyboardEvent) => {
    const st = this._st;
    if (this._config?.keyboard === false || e.ctrlKey || e.metaKey || e.altKey || !st || this._config.keypad === "never") return;
    if (!this._keypadShown() && !this._needsCode(st)) return;
    const t = e.composedPath()[0] as HTMLElement | undefined;
    if (t && t !== document.body && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    // the header's keypad over the screen comes first, then one in a pop-up, then the card under it
    // (the keypad over the screen counts as seen even when its header has slid away)
    // the keypad open over the screen, then the alarm's pop-up when someone came in, then any pop-up,
    // then a card on the page
    const busyNow = (o: GlassSecurity) => ["pending", "triggered"].includes(o._st?.state ?? "");
    const rank = (o: GlassSecurity) => (o._onDemand() ? 3 : o._inPopup() && busyNow(o) && o._config?.layout !== "header" ? 2 : o._inPopup() ? 1 : 0);
    const seen = (o: GlassSecurity) => rank(o) === 3 || o._onScreen();
    // one card takes the keys: the highest rank on screen that can use them (the first one on a tie)
    const can = (o: GlassSecurity) => {
      const e = o._st;
      return !!e && o._config?.keyboard !== false && o._config?.keypad !== "never" && (o._keypadShown() || o._needsCode(e)) && seen(o);
    };
    const best = [...LIVE].filter(can).sort((x, y) => rank(y) - rank(x))[0];
    if (best !== this) return;
    const text = this._st?.attributes.code_format === "text";
    let k: string | undefined;
    if (/^[0-9]$/.test(e.key) || (text && e.key.length === 1 && /\S/.test(e.key))) k = e.key;
    else if (e.key === "Backspace") k = "back";
    else if (e.key === "Escape") k = "clear";
    else if (e.key === "Enter" || e.key === "NumpadEnter") k = "ok";
    if (!k) return;
    e.preventDefault();
    // its keypad is a pop-up of its own (keypad_popup): open it, the keys go there
    const hash = this._config.keypad_popup?.trim();
    if (hash && !this._keypadShown()) {
      const want = hash.startsWith("#") ? hash : `#${hash}`;
      const entity = this._config.entity;
      if (location.hash !== want) this._askCode(this._armAfter);
      const target = [...LIVE].find((o) => o !== this && o._config?.entity === entity && o._config.layout === "keypad");
      if (target) {
        target._takeRequest();
        target._press(k);
      } else {
        const p = PENDING.get(entity);
        if (p && /^[0-9a-z]$/i.test(k)) p.code = (p.code ?? "") + k;
      }
      return;
    }
    if (!this._keypadShown()) this._pad = true;
    this._press(k);
  };

  _onScreen(): boolean {
    const r = this.getBoundingClientRect();
    return !!r.width && !!r.height && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  }

  /** in a Bubble Card pop-up */
  _inPopup(): boolean {
    let el: Node | null = this;
    while (el) {
      if (el instanceof HTMLElement && el.classList.contains("bubble-pop-up")) return true;
      el = el.parentNode ?? (el as ShadowRoot).host ?? null;
    }
    return false;
  }

  /** Bubble Card's pop-up the card is in, if any: closed by leaving its #hash. */
  private _closePopup() {
    if (!this._inPopup() || !location.hash) return;
    window.setTimeout(() => {
      history.pushState(history.state, "", location.pathname + location.search);
      window.dispatchEvent(new Event("location-changed"));
    }, 1200);
  }

  /* ---------- drawing ---------- */

  private _modes(st: HassEntity): ArmMode[] {
    const f = Number(st.attributes.supported_features ?? 0);
    const supported = ORDER.filter((m) => f & FEATURE[m]);
    // the modes asked for keep their order (as listed); else the alarm's own, in the usual order
    if (this._config.modes?.length) return this._config.modes.filter((m) => ORDER.includes(m) && (!f || supported.includes(m)));
    return supported;
  }

  /** a code is needed for what can be done now */
  _needsCode(st: HassEntity): boolean {
    return !!st.attributes.code_format || (st.state === "disarmed" && !!st.attributes.code_arm_required);
  }

  /** The keypad: whenever a code is needed (or a mode waits for its code to arm). */
  _keypadShown(): boolean {
    const st = this._st;
    const k = this._config?.keypad ?? "ask";
    if (!st || k === "never" || st.state === "unavailable") return false;
    // the header version: only when asked for (the alarm's own pop-up takes pending / triggered)
    if (this._config.layout === "header") return this._pad || !!this._armAfter;
    if (this._config.layout === "keypad" || k === "always") return true;
    if (this._pad || this._armAfter) return true;
    if (st.state === "pending" || st.state === "triggered") return this._needsCode(st);
    return k === "auto" && this._needsCode(st);
  }

  /** The keypad asked for by a tap opens over the screen (or in keypad_popup), not in the card –
   *  the card keeps its size: the header version, and the card with keypad: ask. */
  _onDemand(): boolean {
    const st = this._st;
    if (!st || !(this._pad || this._armAfter)) return false;
    if (this._config.layout === "header") return true;
    if (this._config.layout === "keypad") return false;
    return (this._config.keypad ?? "ask") === "ask" && st.state !== "pending" && st.state !== "triggered";
  }

  private _secsLeft(): number {
    return this._cd ? Math.max(0, (this._cd.end - this._now) / 1000) : 0;
  }

  private _ring(tone: string, icon: string) {
    const cd = this._cd;
    const left = this._secsLeft();
    const p = cd && cd.total ? left / cd.total : 0;
    const R = 46;
    const C = 2 * Math.PI * R;
    return html`<div class="ring ${tone} ${cd ? "counting" : ""}">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle class="track" cx="50" cy="50" r=${R}></circle>
        ${cd ? svg`<circle class="left" cx="50" cy="50" r=${R} style="stroke-dasharray:${C};stroke-dashoffset:${C * (1 - p)}"></circle>` : nothing}
      </svg>
      ${cd ? html`<span class="secs">${Math.ceil(left)}</span>` : html`<ha-icon .icon=${icon}></ha-icon>`}
    </div>`;
  }

  private _keypad(st: HassEntity) {
    const text = st.attributes.code_format === "text";
    const disarming = st.state !== "disarmed" && !this._armAfter;
    const dots = html`<div class="code ${this._shake ? "shake" : ""}" aria-live="polite">
      ${this._code
        ? [...this._code].map(() => html`<i></i>`)
        : html`<span class="hint"
            >${this._armAfter ? tr("Code to arm – {mode}", { mode: tr(MODE[this._armAfter].label) }) : tr("Enter the code")}</span
          >`}
    </div>`;
    const k = matPart(this._config.keys_glass, this._config.keys_color);
    if (text)
      return html`<div class="keypad text">
        ${dots}
        <input
          class=${k.cls}
          style=${k.style}
          type="password"
          autocomplete="off"
          .value=${this._code}
          @input=${(e: Event) => (this._code = (e.target as HTMLInputElement).value)}
          @keydown=${(e: KeyboardEvent) => e.key === "Enter" && this._enter()}
          placeholder=${tr("Code")}
        />
      </div>`;
    const key = (v: string, label: unknown, cls = "") =>
      html`<button class="key ${k.cls || "control"} ${cls}" style=${cls.includes("ok") && k.cls && !has(this._config.keys_color) ? matTint("#30a46c", 70) : k.style} @click=${() => this._press(v)}>${label}</button>`;
    const st2 = st.state;
    const cancel =
      (this._pad || this._armAfter) && st2 !== "pending" && st2 !== "triggered" && this._config.layout !== "keypad" && !this._onDemand()
        ? html`<button
            class="cancel"
            @click=${() => {
              this._pad = false;
              this._armAfter = undefined;
              this._code = "";
            }}
          >
            ${tr("Cancel")}
          </button>`
        : nothing;
    return html`<div class="keypad">
      ${dots}
      <div class="keys">
        ${["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => key(d, d))}
        ${key("back", html`<ha-icon .icon=${"mdi:backspace-outline"}></ha-icon>`, "fn")} ${key("0", "0")}
        ${key("ok", html`<ha-icon .icon=${disarming ? "mdi:lock-open-variant-outline" : "mdi:lock-outline"}></ha-icon>`, "fn ok")}
      </div>
      ${cancel}
    </div>`;
  }

  /** a sensor is open / sees something now */
  private _isOpen(id: string) {
    const v = this._hass?.states[id]?.state;
    return v === "on" || v === "open" || v === "unlocked";
  }

  /** The drawer under the bar (as the blinds' slats): a thin bar that says what's open; a tap
   *  slides out every sensor as the status bar's pills. */
  private _drawerEl(st: HassEntity) {
    const c = this._config;
    const list = this._sensors;
    if (c.drawer === false || !list?.length) return nothing;
    const hass = this._hass!;
    const open = list.filter((x) => this._isOpen(x.id));
    const gone = list.filter((x) => ["unavailable", "unknown"].includes(hass.states[x.id]?.state ?? "unavailable"));
    const bypassed = Object.keys((st.attributes.bypassed_sensors as Record<string, string> | null) ?? {});
    const tray = matPart(c.tray_glass, c.tray_color);
    const nameOf = (x: Sensor) => x.name ?? hass.states[x.id]?.attributes.friendly_name ?? x.id;
    // open doors and windows, motion, vibration…: "active" covers them all
    const summary = open.length
      ? open.length === 1
        ? tr("Active: {sensors}", { sensors: nameOf(open[0]) })
        : tr("Active: {n}", { n: open.length })
      : gone.length
        ? tr("Unavailable: {sensors}", { sensors: gone.map(nameOf).join(", ") })
        : tr("All quiet");
    const kind = (x: Sensor) => x.type ?? (hass.states[x.id]?.attributes.device_class as string | undefined) ?? "";
    const bar = matPart(c.bar_glass, c.bar_color);
    const warn = open.length || gone.length;
    const toggle = () => {
      haptic();
      this._drawer = !this._drawer;
      this._everOpen = true;
    };
    const style = c.drawer_style ?? "pill";
    const head =
      style === "bar"
        ? html`<div
            class="bar lbar ${bar.cls || "control"} ${warn ? "warn" : ""}"
            style=${bar.style}
            role="button"
            tabindex="0"
            aria-expanded=${this._drawer ? "true" : "false"}
            @click=${toggle}
            @keydown=${(e: KeyboardEvent) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggle())}
          >
            <span class="btn control ${warn ? "active" : ""}"><ha-icon .icon=${warn ? "mdi:shield-alert-outline" : "mdi:shield-check-outline"}></ha-icon></span>
            <span class="blabel">${tr("Sensors")}</span>
            <span class="bval">${summary}</span>
            <span class="chev"><ha-icon .icon=${"mdi:chevron-down"}></ha-icon></span>
          </div>`
        : html`<button class="sbar ${bar.cls || "control"} ${warn ? "has-open" : ""}" style=${bar.style} aria-expanded=${this._drawer ? "true" : "false"} @click=${toggle}>
            <span class="sico"><ha-icon .icon=${warn ? "mdi:shield-alert-outline" : "mdi:shield-check-outline"}></ha-icon></span>
            <span class="stxt"><span class="sname">${tr("Sensors")}</span><span class="ssum">${summary}</span></span>
            <span class="chev"><ha-icon .icon=${"mdi:chevron-down"}></ha-icon></span>
          </button>`;
    const items = (c.sensor_items ?? "list") === "pills" ? this._pillsEl(list, bypassed, kind) : this._rows(list, bypassed, kind);
    return html`<div class="drawer ds-${style} ${this._drawer ? "open" : ""}">
      ${head}
      <div class="slide" aria-hidden=${this._drawer ? "false" : "true"}>
        <div class="slide-in">${this._drawer || this._everOpen ? html`<div class="tray ${tray.cls}" style=${tray.style}>${items}</div>` : nothing}</div>
      </div>
    </div>`;
  }

  /** The sensors as rows: the icon, the name, the modes it guards and its state; active ones orange. */
  private _rows(list: Sensor[], bypassed: string[], kind: (x: Sensor) => string) {
    const hass = this._hass!;
    const modeName = (m: string) => {
      const k = m.replace(/^armed_/, "") as ArmMode;
      return MODE[k] ? tr(MODE[k].label) : m;
    };
    return list.map((x) => {
      const st = hass.states[x.id];
      const on = this._isOpen(x.id);
      const k = kind(x);
      const icons = SENSOR_ICON[k] ?? ["mdi:checkbox-blank-circle-outline", "mdi:alert-circle-outline"];
      const gone = !st || st.state === "unavailable" || st.state === "unknown";
      const state = gone ? tr("Unavailable") : OPENING.includes(k) ? tr(on ? "Open" : "Closed") : PRESENCE.includes(k) ? tr(on ? "Detected" : "Clear") : (hass.formatEntityState?.(st) ?? st.state);
      return html`<div class="sensor ${on ? "on" : ""} ${gone ? "gone" : ""}">
        <ha-icon .icon=${x.icon ?? icons[on ? 1 : 0]}></ha-icon>
        <span class="sn">${x.name ?? st?.attributes.friendly_name ?? x.id}</span>
        ${bypassed.includes(x.id) ? html`<span class="tag">${tr("Bypassed")}</span>` : nothing}
        ${x.modes?.length ? html`<span class="sm">${x.modes.map(modeName).join(" · ")}</span>` : nothing}
        <span class="sv">${state}</span>
      </div>`;
    });
  }

  /** The sensors as the status bar's pills: the icon, the name over its state; open ones orange. */
  private _pillsEl(list: Sensor[], bypassed: string[], kind: (x: Sensor) => string) {
    const c = this._config;
    this._everOpen = true;
    const cols = Math.min(list.length, this._cols);
    const key = JSON.stringify([list, bypassed, cols, c.sensors_glass, c.sensors_color, language(this._hass), this._mode]);
    if (key !== this._pillsKey || !this._pills) {
      this._pillsKey = key;
      const OPEN = ["on", "open", "unlocked"];
      const items = list.map((x) => {
        const k = kind(x);
        const icons = SENSOR_ICON[k] ?? ["mdi:checkbox-blank-circle-outline", "mdi:alert-circle-outline"];
        const words = OPENING.includes(k) ? [tr("Closed"), tr("Open")] : PRESENCE.includes(k) ? [tr("Clear"), tr("Detected")] : undefined;
        const by = bypassed.includes(x.id) ? ` · ${tr("Bypassed")}` : "";
        return {
          entity: x.id,
          name: x.name ?? this._hass?.states[x.id]?.attributes.friendly_name ?? x.id,
          icon: x.icon ?? icons[0],
          ...(words ? { text: words[0] + by } : by ? { text: `{state}${by}` } : {}),
          rules: [
            { state: OPEN, icon: x.icon ?? icons[1], icon_color: "orange", ...(words ? { text: words[1] + by } : {}) },
            { state: ["unavailable", "unknown"], text: tr("Unavailable") },
          ],
        };
      });
      const cfg: Record<string, unknown> = {
        type: "custom:glass-status-bar",
        layout: "pills",
        columns: cols,
        items,
        ...(c.sensors_glass ? { pill_glass: c.sensors_glass } : {}),
        ...(c.sensors_color ? { pill_color: c.sensors_color } : {}),
      };
      this._pills = buildChildren(cfg as BaseCardConfig, this._hass, { nested: true, glass: resolveGlass(settings.tile_glass ?? c.glass), mode: this._mode })[0];
    }
    return this._pills;
  }

  /** a mode on the bar: arm it (a code first, when the alarm asks for one) */
  private _modeTap(m: ArmMode, st: HassEntity) {
    if (st.state === `armed_${m}`) return;
    const codeFirst = st.attributes.code_arm_required || (st.state !== "disarmed" && !!st.attributes.code_format);
    if (codeFirst && !this._code && (this._config.keypad ?? "ask") !== "never") {
      if (this._config.layout === "header" || (this._config.keypad ?? "ask") === "ask") return this._askCode(m);
      haptic();
      this._armAfter = m;
      this._pad = true;
      return;
    }
    this._armAfter = undefined;
    this._pad = false;
    this._arm(m);
  }

  /** The header version: the modes and Off as the pop-up header's buttons – the one in force dark,
   *  the others light; a countdown in it; a code opens the keypad over the screen. */
  private _header(st: HassEntity) {
    const s = st.state;
    const modes = this._modes(st);
    const target = (s === "arming" || s === "pending" || s === "triggered" ? String(st.attributes.arm_mode ?? "") : s).replace(/^armed_/, "");
    const b = matPart(this._config.buttons_glass, this._config.buttons_color);
    const act = matPart(this._config.active_glass, this._config.active_color);
    // stretched across: every button with its name when they fit (about 92 px each), else the one
    // in force grows with its name and the others stay round
    const stretch = this._config.align === "stretch";
    const fits = stretch && this._width >= (modes.length + 1) * 92;
    const namedFor = (on: boolean) => (stretch ? fits || on : this._config.labels !== false && (this._hl === 0 || (this._hl === 1 && on)));
    const pill = (key: string, icon: string, label: string, on: boolean, tap: () => void, extra = "") => {
      const named = namedFor(on);
      // the one in force: "sel" (not "on" – WebGL glass skips lit parts), in its own material
      const m = on ? act : b;
      return html`<button class="hb ${named ? "" : "round"} ${on ? "sel" : "off"} ${stretch && (fits || on) ? "grow" : ""} ${extra} ${m.cls}" style=${m.style} title=${label} aria-label=${label} @click=${tap}>
        ${on && !named && this._cd ? html`<span class="hs">${Math.ceil(this._secsLeft())}</span>` : html`<ha-icon .icon=${icon}></ha-icon>`}${named ? html`<span>${on && this._cd ? `${Math.ceil(this._secsLeft())} s` : label}</span>` : nothing}${extra.includes("not-ready") ? html`<i class="dot"></i>` : nothing}
      </button>`;
    };
    const off = s === "disarmed";
    return html`<div class="hdr ${this._config.align === "end" ? "end" : stretch ? "stretch" : ""} tone-${(STATE[s] ?? STATE.disarmed).tone} state-${s}">
        ${modes.map((m) =>
          pill(m, MODE[m].icon, tr(MODE[m].label), target === m, () => this._modeTap(m, st), off && this._ready && !this._ready.includes(`armed_${m}`) ? "not-ready" : ""),
        )}
        ${pill("off", "mdi:shield-off-outline", tr("Off"), off, () => this._offTap(st))}
      </div>
`;
  }

  /** The header's keypad goes over the whole screen: a pop-up header's glass (backdrop-filter) would
   *  hold a fixed element inside it. So it is drawn into its own element under <body>, with the
   *  card's styles, its look's attributes and its custom properties (the dashboard's colours). */
  private _portal?: SecurityKeypadLayer;
  private _portalRender(content: TemplateResult | typeof nothing) {
    if (content === nothing) {
      if (this._portal) {
        this._portal.remove();
        this._portal = undefined;
      }
      return;
    }
    if (!this._portal) {
      const el = document.createElement("glass-security-keypad") as SecurityKeypadLayer;
      // its own layer above the page – the top layer (popover) where it can: Bubble Card's pop-ups
      // live there too, and no z-index reaches above them; shown last, it lies on top of them
      el.style.cssText =
        "position:fixed;inset:0;z-index:2147483000;display:block;margin:0;padding:0;border:0;background:transparent;width:100vw;height:100dvh;max-width:none;max-height:none;overflow:visible;pointer-events:auto";
      if ("showPopover" in el) el.setAttribute("popover", "manual");
      // taps on the keypad stay the keypad's: Bubble Card closes its pop-up on a tap outside it
      for (const t of ["click", "pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend"]) el.addEventListener(t, (e) => e.stopPropagation());
      el.sheets = (this.constructor as typeof LitElement).elementStyles
        .map((x) => (x instanceof CSSStyleSheet ? x : (x as CSSResult).styleSheet))
        .filter((x): x is CSSStyleSheet => !!x);
      document.body.append(el);
      try {
        (el as HTMLElement & { showPopover?: () => void }).showPopover?.();
      } catch {
        /* no popover: the z-index has to do */
      }
      this._portal = el;
    }
    const el = this._portal;
    for (const a of ["dark", "control-glass", "glass", "standalone"]) {
      const v = this.getAttribute(a);
      if (v === null) el.removeAttribute(a);
      else el.setAttribute(a, v);
    }
    const cs = getComputedStyle(this);
    for (let i = 0; i < cs.length; i++) {
      const prop = cs[i];
      if (prop.startsWith("--")) el.style.setProperty(prop, cs.getPropertyValue(prop));
    }
    el.content = content;
  }

  /** The header asks for the code: in its keypad pop-up (keypad_popup) when set, else over the screen. */
  private _askCode(mode?: ArmMode) {
    haptic();
    const hash = this._config.keypad_popup?.trim();
    if (!hash) {
      this._armAfter = mode;
      this._pad = true;
      return;
    }
    const entity = this._config.entity;
    PENDING.set(entity, { mode, at: Date.now() });
    for (const o of LIVE) if (o !== this && o._config?.entity === entity && o._inPopup()) o._takeRequest();
    history.pushState(history.state, "", `${location.pathname}${location.search}${hash.startsWith("#") ? hash : `#${hash}`}`);
    window.dispatchEvent(new Event("location-changed"));
  }

  /** A keypad pop-up's card: the header's request (disarm, or arm a mode) – fresh ones only. */
  _takeRequest() {
    const r = PENDING.get(this._config?.entity);
    if (!r || Date.now() - r.at > 60_000 || !this._inPopup()) return;
    PENDING.delete(this._config.entity);
    this._armAfter = r.mode;
    this._pad = true;
    this._code = r.code ?? "";
    this._requested = true;
  }
  /** this card answers a request from the header: the pop-up closes once the alarm changes */
  private _requested = false;

  /** Off in the header: disarm – the keypad first when a code is needed */
  private _offTap(st: HassEntity) {
    if (st.state === "disarmed") return;
    if (this._needsCode(st) && !this._code && (this._config.keypad ?? "ask") !== "never") return this._askCode();
    this._disarm();
  }

  /** The keypad over the screen (the header version): the state, a message, the keys; ✕ shuts it. */
  private _overlay(st: HassEntity) {
    const meta = STATE[st.state] ?? STATE.disarmed;
    const shut = () => {
      this._pad = false;
      this._armAfter = undefined;
      this._code = "";
    };
    const busy = false;
    return html`<div class="scrim" @click=${(e: Event) => e.target === e.currentTarget && !busy && shut()}>
      <div class="sheet frame surface tone-${meta.tone} state-${st.state}">
        <div class="head">
          ${this._ring(meta.tone, meta.icon)}
          <div class="txt">
            <div class="name">${this._config.name ?? st.attributes.friendly_name ?? this._config.entity}</div>
            <div class="state">${this._armAfter ? tr("Arm – {mode}", { mode: tr(MODE[this._armAfter].label) }) : tr(meta.label)}</div>
          </div>
          ${busy ? nothing : html`<button class="x" title=${tr("Close")} @click=${shut}><ha-icon .icon=${"mdi:close"}></ha-icon></button>`}
        </div>
        ${this._msg ? html`<div class="msg ${this._msg.tone}">${this._msg.text}</div>` : nothing}
        ${this._keypad(st)}
      </div>
    </div>`;
  }

  protected override render() {
    const c = this._config;
    const hass = this._hass;
    if (!c || !hass) return nothing;
    const st = this._st;
    if (st && c.layout === "header") return this._header(st);
    if (st && c.layout === "keypad") {
      const meta = STATE[st.state] ?? STATE.disarmed;
      return html`<div class="frame surface keypad-only tone-${meta.tone} state-${st.state}">
        <div class="head">
          ${this._ring(meta.tone, meta.icon)}
          <div class="txt">
            <div class="name">${c.name ?? st.attributes.friendly_name ?? c.entity}</div>
            <div class="state">${this._armAfter ? tr("Arm – {mode}", { mode: tr(MODE[this._armAfter].label) }) : tr(meta.label)}</div>
          </div>
        </div>
        ${this._msg ? html`<div class="msg ${this._msg.tone}">${this._msg.text}</div>` : nothing}
        ${this._keypad(st)}
      </div>`;
    }
    if (!st) return html`<div class="frame surface"><div class="hint">${tr("Entity not found: {entity}", { entity: c.entity })}</div></div>`;
    const s = st.state;
    const meta = STATE[s] ?? { label: s, icon: "mdi:shield-outline", tone: "off" };
    const name = c.name ?? st.attributes.friendly_name ?? c.entity;
    const a = st.attributes;
    const open = Object.keys((a.open_sensors as Record<string, string> | null) ?? {});
    const bypassed = Object.keys((a.bypassed_sensors as Record<string, string> | null) ?? {});
    const modes = this._modes(st);
    const b = matPart(c.buttons_glass, c.buttons_color);
    const w = matPart(c.actions_glass, c.actions_color);
    const mm = matPart(c.message_glass, c.message_color);
    const showSensors = c.show_sensors !== false;
    // under the state: what's going on
    let detail: unknown = nothing;
    if (s === "pending" || s === "triggered")
      detail = open.length && showSensors ? tr("{sensors} – enter the code", { sensors: this._names(open) }) : s === "pending" ? tr("Disarm before the time runs out") : tr("Enter the code to stop it");
    else if (s === "arming") detail = tr("Leave now – it arms when the time runs out");
    else if (s.startsWith("armed_") && bypassed.length && showSensors) detail = tr("Without {sensors}", { sensors: this._names(bypassed) });
    else if (a.changed_by) detail = tr("By {name}", { name: a.changed_by });
    const keypad = this._keypadShown() && !this._onDemand() ? this._keypad(st) : nothing;
    const busy = s === "pending" || s === "triggered";
    // the mode in force: armed, or the one it arms into; disarmed – Off
    const target = s === "disarmed" ? "off" : String(a.arm_mode ?? s).replace(/^armed_/, "");
    const skip = s === "arming" && this._alarmo !== undefined;
    // under the state – one line, always there (the card keeps its height): a message, else what's going on
    const line = this._msg
      ? html`<div class="detail msg-line ${this._msg.tone} ${mm.cls}" style=${mm.style}>
          <span>${this._msg.text}</span>
          ${this._blocked
            ? html`<button class="link ${w.cls}" style=${w.style} @click=${() => this._arm(this._blocked!.mode, true)}>${tr("Arm anyway")}</button>`
            : nothing}
        </div>`
      : html`<div class="detail">${detail === nothing ? "\u00a0" : detail}</div>`;
    const btn = (key: string, icon: string, label: string, tap: () => void, extra = "") =>
      html`<button class="mode ${b.cls || "control"} ${target === key ? "now" : ""} ${extra}" style=${b.style} title=${label} aria-label=${label} @click=${tap}>
        <ha-icon .icon=${icon}></ha-icon><span>${label}</span>${extra.includes("not-ready") ? html`<i class="dot"></i>` : nothing}
      </button>`;
    return html`<div class="frame surface tone-${meta.tone} state-${s}">
      <div class="head">
        ${this._ring(meta.tone, meta.icon)}
        <div class="txt">
          <div class="name">${name}</div>
          <div class="state" title=${tr(meta.label)}>${tr(meta.label)}</div>
          ${line}
        </div>
      </div>
      ${busy || s === "unavailable"
        ? nothing
        : html`<div class="modes" style="--n:${modes.length + 1}">
            ${modes.map((m) => {
              const notReady = s === "disarmed" && this._ready && !this._ready.includes(`armed_${m}`);
              // arming into it: a tap arms now (Alarmo)
              if (skip && target === m) return btn(m, "mdi:fast-forward", tr("Arm now"), () => this._skip(), "skip");
              return btn(m, MODE[m].icon, tr(MODE[m].label), () => this._modeTap(m, st), `${notReady ? "not-ready" : ""} ${this._armAfter === m ? "pick" : ""}`);
            })}
            ${btn("off", "mdi:shield-off-outline", tr("Off"), () => this._offTap(st))}
          </div>`}
      ${keypad}
      ${busy ? nothing : this._drawerEl(st)}
    </div>`;
  }

  protected override updated(changed: PropertyValues) {
    super.updated(changed);
    if (PENDING.size && !this._requested) this._takeRequest();
    // in a pop-up header's middle (flex: 1, min-width: 0) the buttons need their own width
    // the buttons that don't fit with their names lose them: first all but the one in force, then all
    const hdr = this._config?.layout === "header" && this._config.align !== "stretch" ? this.shadowRoot?.querySelector<HTMLElement>(".hdr") : null;
    const kids = hdr ? [...hdr.children] as HTMLElement[] : [];
    this.style.minWidth = hdr ? `${kids.length * 42}px` : "";
    const need = kids.reduce((w, k) => w + k.offsetWidth, 0) + Math.max(0, kids.length - 1) * 6;
    if (hdr && this._hl < 2 && need > this.clientWidth + 1) {
      this._hl++;
      this.requestUpdate();
    }
    const st = this._st;
    this._portalRender(st && this._onDemand() && !this._config.keypad_popup ? this._overlay(st) : nothing);
    // the countdown ran out: the state follows from HA, the ring just stops
    if (this._cd && this._now > this._cd.end + 1500) this._cd = undefined;
  }

  static override styles = [
    GlassElement.styles,
    surface,
    control,
    liquidBar,
    materials,
    css`
      :host {
        display: block;
        --sec-off: rgba(142, 142, 147, 1);
        --sec-on: #30a46c;
        --sec-wait: #f5a524;
        --sec-warn: #ff9f0a;
        --sec-alarm: #ff3b30;
      }
      .frame {
        --btn: var(--glass-light-button-size, 42px);
        display: flex;
        flex-direction: column;
        gap: 14px;
        padding: 18px;
        color: var(--g-text);
      }
      button {
        font: inherit;
        color: inherit;
      }
      .head {
        display: flex;
        align-items: center;
        gap: 16px;
        min-width: 0;
      }
      .ring {
        position: relative;
        flex: none;
        width: 72px;
        height: 72px;
        display: grid;
        place-items: center;
        --c: var(--sec-off);
      }
      .ring.on {
        --c: var(--sec-on);
      }
      .ring.wait {
        --c: var(--sec-wait);
      }
      .ring.warn {
        --c: var(--sec-warn);
      }
      .ring.alarm {
        --c: var(--sec-alarm);
      }
      .ring svg {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        transform: rotate(-90deg);
      }
      .ring circle {
        fill: none;
        stroke-width: 6;
        stroke-linecap: round;
      }
      .ring .track {
        stroke: color-mix(in srgb, currentColor 14%, transparent);
        fill: color-mix(in srgb, var(--c) 14%, transparent);
      }
      .ring .left {
        stroke: var(--c);
        transition: stroke-dashoffset 0.25s linear;
      }
      .ring ha-icon {
        --mdc-icon-size: 34px;
        color: var(--c);
      }
      .ring .secs {
        font-size: 26px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        color: var(--c);
      }
      .state-triggered .ring {
        animation: pulse 1s ease-in-out infinite;
      }
      @keyframes pulse {
        50% {
          transform: scale(1.08);
          filter: drop-shadow(0 0 12px var(--sec-alarm));
        }
      }
      .txt {
        min-width: 0;
      }
      .name {
        font-size: 13px;
        font-weight: 600;
        color: var(--g-text-2);
      }
      /* one line each, whatever the state's name: the card never changes its height with it */
      .state,
      .name {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .state {
        font-size: 24px;
        font-weight: 700;
        line-height: 1.15;
      }
      .frame {
        container-type: inline-size;
      }
      .tone-alarm .state {
        color: var(--sec-alarm);
      }
      .detail {
        margin-top: 2px;
        font-size: 13px;
        color: var(--g-text-2);
      }
      .msg {
        font-size: 13px;
        font-weight: 600;
        padding: 8px 12px;
        border-radius: 999px;
        text-align: center;
      }
      .msg:not(.mat) {
        background: color-mix(in srgb, var(--sec-warn) 18%, transparent);
      }
      .msg.alarm:not(.mat) {
        background: color-mix(in srgb, var(--sec-alarm) 20%, transparent);
      }
      .modes {
        display: grid;
        grid-template-columns: repeat(var(--n), minmax(0, 1fr));
        gap: 10px;
      }
      .mode,
      .wide,
      .key {
        border-radius: 999px;
        cursor: pointer;
      }
      .mode,
      .wide {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        height: 52px;
        padding: 0 14px;
        font-size: 14px;
        font-weight: 600;
        min-width: 0;
      }
      .mode span,
      .wide span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .mode {
        position: relative;
        flex-direction: column;
        gap: 2px;
        height: 64px;
        font-size: 13px;
      }
      /* no material of their own: the status bar's pills' white glass by day, a faint sheen by
         night – the wallpaper doesn't run through them */
      :host(:not([dark])[control-glass]) .mode.control,
      :host(:not([dark])[control-glass]) .wide.control,
      :host(:not([dark])[control-glass]) .key.control {
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.34), rgba(255, 255, 255, 0.12) 55%, rgba(255, 255, 255, 0.2)) !important;
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.55),
          0 1px 2px rgba(0, 0, 0, 0.04),
          0 4px 12px rgba(0, 0, 0, 0.06) !important;
        border: 0 !important;
        color: var(--glass-home-text, #1c1c1e);
      }
      :host([dark][control-glass]) .mode.control,
      :host([dark][control-glass]) .wide.control,
      :host([dark][control-glass]) .key.control {
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.13), rgba(255, 255, 255, 0.04) 55%, rgba(255, 255, 255, 0.07)) !important;
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.16),
          0 1px 2px rgba(0, 0, 0, 0.1),
          0 4px 12px rgba(0, 0, 0, 0.12) !important;
        border: 0 !important;
      }
      /* on a glass of its own: the same green, as a tint of that glass */
      .keys .key.ok.mat {
        color: #fff;
      }
      :host([control-glass]) .keys .key.ok.control,
      .keys .key.ok.control {
        background: color-mix(in srgb, var(--sec-on) 82%, transparent) !important;
        color: #fff;
      }
      /* waiting for its code: outlined ("pick", not "cur" – WebGL glass skips current parts) */
      .mode.pick {
        outline: 2px solid var(--sec-on);
        outline-offset: -2px;
      }
      /* the mode in force */
      :host([control-glass]) .mode.control.now,
      .mode.mat.now {
        outline: 2px solid color-mix(in srgb, var(--sec-on) 80%, transparent);
        outline-offset: -2px;
      }
      .tone-wait .mode.now,
      .tone-warn .mode.now {
        outline-color: var(--sec-wait);
      }
      .mode.now ha-icon {
        color: var(--sec-on);
      }
      .tone-wait .mode.now ha-icon {
        color: var(--sec-wait);
      }
      .detail {
        min-height: 1.3em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .msg-line {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 600;
        color: var(--sec-warn);
      }
      .msg-line.alarm {
        color: var(--sec-alarm);
      }
      .msg-line span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .msg-line.mat {
        padding: 0 10px;
        border-radius: 999px;
      }
      .msg-line .link {
        flex: none;
        border: 0;
        padding: 2px 10px;
        border-radius: 999px;
        font: inherit;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        color: inherit;
      }
      .msg-line .link:not(.mat) {
        background: color-mix(in srgb, currentColor 18%, transparent);
      }
      .cancel {
        border: 0;
        background: none;
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        color: var(--g-text-2);
        padding: 4px 12px;
        cursor: pointer;
      }
      .mode .dot {
        position: absolute;
        top: 8px;
        right: 14px;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--sec-warn);
      }
      .mode.not-ready ha-icon {
        opacity: 0.6;
      }
      .keypad {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 14px;
      }
      .code {
        height: 22px;
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .code i {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: currentColor;
      }
      .code .hint {
        font-size: 13px;
        color: var(--g-text-2);
      }
      .code.shake {
        animation: shake 0.42s ease;
      }
      @keyframes shake {
        20%,
        60% {
          transform: translateX(-8px);
        }
        40%,
        80% {
          transform: translateX(8px);
        }
      }
      .keys {
        display: grid;
        grid-template-columns: repeat(3, 64px);
        gap: 12px 18px;
      }
      .key {
        width: 64px;
        height: 64px;
        padding: 0;
        border: 0;
        display: grid;
        place-items: center;
        font-size: 24px;
        font-weight: 500;
        font-variant-numeric: tabular-nums;
      }
      .key.fn ha-icon {
        --mdc-icon-size: 24px;
      }
      .keypad.text input {
        width: min(260px, 100%);
        height: 48px;
        padding: 0 18px;
        border-radius: 999px;
        border: 1px solid var(--g-control-border, rgba(255, 255, 255, 0.3));
        background: var(--g-control, rgba(255, 255, 255, 0.12));
        color: inherit;
        font: inherit;
        font-size: 18px;
        text-align: center;
        outline: none;
      }
      .hint {
        padding: 8px;
        color: var(--g-text-2);
      }
      /* the drawer's bar, pill style: the shield in a circle, the name over the summary, an arrow */
      .sbar {
        position: relative;
        z-index: 1;
        display: flex;
        align-items: center;
        gap: 10px;
        height: var(--btn, 52px);
        min-height: 52px;
        padding: 0 10px 0 6px;
        border: 0;
        border-radius: 999px;
        cursor: pointer;
        text-align: start;
      }
      .sbar.control:active,
      :host([control-glass]) .sbar.control:active {
        transform: translateZ(0);
      }
      .sico {
        flex: none;
        width: 40px;
        height: 40px;
        display: grid;
        place-items: center;
        border-radius: 50%;
        background: color-mix(in srgb, var(--sec-on) 22%, transparent);
        color: var(--sec-on);
      }
      .has-open .sico {
        background: color-mix(in srgb, var(--sec-warn) 24%, transparent);
        color: var(--sec-warn);
      }
      .stxt {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        line-height: 1.2;
      }
      .sname {
        font-size: 14px;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .ssum {
        font-size: 12px;
        opacity: 0.7;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .has-open .ssum {
        color: var(--sec-warn);
        opacity: 1;
      }
      .drawer.ds-pill .slide {
        --btn: 52px;
      }
      .drawer.ds-pill.open .slide {
        margin-top: -26px;
      }
      .drawer.ds-pill .tray {
        padding-top: 34px;
        --r: 26px;
      }
      /* the drawer's sensors as rows */
      .sensor {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 40px;
        padding: 0 10px;
        font-size: 14px;
      }
      .sensor ha-icon {
        flex: none;
        --mdc-icon-size: 20px;
        opacity: 0.75;
      }
      .sensor.on ha-icon,
      .sensor.on .sv {
        color: var(--sec-warn);
        opacity: 1;
      }
      .sensor.gone {
        opacity: 0.5;
      }
      .sn {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .sm {
        flex: none;
        font-size: 11px;
        opacity: 0.55;
      }
      .sv {
        flex: none;
        font-size: 13px;
        font-weight: 600;
        opacity: 0.8;
      }
      .tag {
        flex: none;
        font-size: 11px;
        font-weight: 600;
        padding: 2px 8px;
        border-radius: 999px;
        background: color-mix(in srgb, var(--sec-warn) 22%, transparent);
      }
      @media (max-width: 420px) {
        .sm {
          display: none;
        }
      }
      /* the header version: the pop-up header's buttons – dark while in force, light otherwise */
      .hdr {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        height: 100%;
      }
      .hdr.end {
        justify-content: flex-end;
      }
      /* stretched: the row fills the space it gets; growing buttons share what the round ones leave */
      .hdr.stretch {
        width: 100%;
      }
      .hb.grow {
        flex: 1 1 0;
        min-width: 0;
        justify-content: center;
      }
      .hb.grow span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .hb {
        position: relative;
        flex: none;
        display: flex;
        align-items: center;
        gap: 7px;
        height: calc(var(--h, 56px) - 20px);
        padding: 0 15px 0 12px;
        border: 0;
        border-radius: 999px;
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        transition: transform 0.15s ease;
      }
      .hb:not(.mat).sel {
        color: var(--glass-home-side-text, #fff);
        background: var(--glass-control-bg);
        box-shadow: var(--glass-control-shadow);
      }
      .hb:not(.mat).off {
        color: var(--glass-home-text, #1c1c1e);
        background: var(--glass-home-control, rgba(118, 118, 128, 0.16));
      }
      :host([dark]) .hb:not(.mat).off {
        color: var(--glass-home-text-2, rgba(235, 235, 245, 0.62));
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.03));
      }
      .hb:active {
        transform: scale(0.94);
      }
      .hb.round {
        width: calc(var(--h, 56px) - 20px);
        padding: 0;
        justify-content: center;
      }
      .hs {
        font-size: 13px;
        font-weight: 700;
      }
      .hb ha-icon {
        --mdc-icon-size: 18px;
        display: flex;
      }
      .hb .dot {
        position: absolute;
        top: 4px;
        right: 6px;
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--sec-warn);
      }
      /* counting down / ringing: the button in force in the state's colour */
      .hdr.tone-wait .hb.sel,
      .hdr.tone-warn .hb.sel {
        background: color-mix(in srgb, var(--sec-warn) 85%, transparent);
        color: #fff;
      }
      .hdr.tone-alarm .hb.sel {
        background: var(--sec-alarm);
        color: #fff;
        animation: hb-pulse 1s ease-in-out infinite;
      }
      @keyframes hb-pulse {
        50% {
          box-shadow: 0 0 14px 2px var(--sec-alarm);
        }
      }
      /* the keypad over the screen */
      /* over everything, Bubble Card's pop-ups too (they sit high): the taps are the keypad's */
      .scrim {
        position: fixed;
        inset: 0;
        z-index: 2147483000;
        touch-action: manipulation;
        display: grid;
        place-items: center;
        padding: 16px;
        background: rgba(0, 0, 0, 0.35);
        -webkit-backdrop-filter: blur(10px);
        backdrop-filter: blur(10px);
        animation: fade-in 0.2s ease;
      }
      @keyframes fade-in {
        from {
          opacity: 0;
        }
      }
      .sheet {
        width: min(360px, 100%);
        box-sizing: border-box;
        border-radius: var(--g-radius-lg, 28px);
      }
      .sheet .head {
        position: relative;
      }
      .x {
        position: absolute;
        top: -6px;
        right: -6px;
        width: 36px;
        height: 36px;
        border: 0;
        border-radius: 50%;
        display: grid;
        place-items: center;
        cursor: pointer;
        background: color-mix(in srgb, var(--g-text) 12%, transparent);
      }
      /* the sensors: as the blinds' bar and drawer – a liquid glass bar with its round button,
         the name and the value, and the drawer of pills tucked under it */
      .drawer {
        display: flex;
        flex-direction: column;
      }
      .bar {
        position: relative;
        z-index: 1;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 4px;
        border-radius: 999px;
        isolation: isolate;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        user-select: none;
        -webkit-user-select: none;
      }
      /* a bar, not a button that sinks: only the drawer moves */
      .bar.control:active,
      :host([control-glass]) .bar.control:active {
        transform: translateZ(0);
      }
      .bar.mat {
        border-radius: 999px;
      }
      .btn {
        flex: none;
        width: var(--btn);
        height: var(--btn);
        display: grid;
        place-items: center;
        border-radius: 50%;
        color: var(--sec-on);
      }
      .btn ha-icon {
        --mdc-icon-size: 22px;
        display: flex;
      }
      .btn.control.active {
        --bg: color-mix(in srgb, var(--sec-warn) 85%, transparent);
        --accent: var(--sec-warn);
        color: #fff;
      }
      .blabel {
        flex: 0 1 auto;
        min-width: 0;
        font-size: 14px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .bval {
        flex: 1;
        min-width: 0;
        text-align: end;
        font-size: 13px;
        font-weight: 600;
        color: var(--g-text-2);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .bar.warn .bval {
        color: var(--sec-warn);
      }
      .chev {
        flex: none;
        width: 32px;
        height: 32px;
        display: grid;
        place-items: center;
        margin-right: 4px;
        color: var(--g-text-2);
      }
      .chev ha-icon {
        --mdc-icon-size: 20px;
        display: flex;
        transition: transform 0.25s ease;
      }
      .drawer.open .chev ha-icon {
        transform: rotate(180deg);
      }
      /* the drawer slides out from under the bar and back (its height animated) */
      .slide {
        display: grid;
        grid-template-rows: 0fr;
        margin-top: 0;
        transition:
          grid-template-rows 0.3s cubic-bezier(0.2, 0.8, 0.2, 1),
          margin-top 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
      }
      .drawer.open .slide {
        grid-template-rows: 1fr;
        margin-top: calc(-1 * var(--btn) / 2 - 4px);
      }
      .slide-in {
        min-height: 0;
        overflow: hidden;
      }
      .tray {
        position: relative;
        z-index: 0;
        padding: calc(var(--btn) / 2 + 4px + 10px) 8px 10px;
        border-radius: 0 0 22px 22px;
        --glass-pill-height: 48px;
      }
      .tray:not(.mat) {
        background: var(--glass-seg-bg, color-mix(in srgb, var(--g-text) 7%, transparent));
        box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.07);
        --r: calc(var(--btn) / 2 + 4px);
        -webkit-mask:
          linear-gradient(transparent var(--r), #000 var(--r)),
          radial-gradient(circle var(--r) at 100% 0, transparent 98%, #000) 0 0 / var(--r) var(--r) no-repeat,
          radial-gradient(circle var(--r) at 0 0, transparent 98%, #000) 100% 0 / var(--r) var(--r) no-repeat;
        mask:
          linear-gradient(transparent var(--r), #000 var(--r)),
          radial-gradient(circle var(--r) at 100% 0, transparent 98%, #000) 0 0 / var(--r) var(--r) no-repeat,
          radial-gradient(circle var(--r) at 0 0, transparent 98%, #000) 100% 0 / var(--r) var(--r) no-repeat;
      }
      .tray.mat {
        border-radius: 0 0 22px 22px;
      }
      /* narrow cards: last, so they win over the rules above */
      @container (max-width: 340px) {
        .state {
          font-size: 19px;
        }
        .ring {
          width: 60px;
          height: 60px;
        }
        .ring .secs {
          font-size: 22px;
        }
      }
      /* a narrow card (a phone, two side by side): the modes as icons, their names as tooltips */
      @container (max-width: 400px) {
        .modes {
          gap: 8px;
        }
        .mode {
          height: 52px;
          padding: 0;
        }
        .mode span {
          display: none;
        }
        .mode .dot {
          top: 6px;
          right: 6px;
        }
      }
      /* very narrow: the sensors' bar keeps its shield (orange when something's active) and arrow */
      @container (max-width: 280px) {
        .head {
          gap: 10px;
        }
        .ring {
          width: 48px;
          height: 48px;
        }
        .ring ha-icon {
          --mdc-icon-size: 24px;
        }
        .ring .secs {
          font-size: 18px;
        }
        .state {
          font-size: 17px;
        }
        .modes {
          gap: 6px;
        }
        .mode {
          height: 44px;
        }
        .ssum,
        .drawer .bar .bval {
          display: none;
        }
        /* the 36 px shield in the 52 px bar: 8 px around it on every side */
        .sbar {
          padding-left: 8px;
          padding-right: 4px;
        }
        .sico,
        .drawer .bar .btn {
          width: 36px;
          height: 36px;
        }
        .sbar,
        .bar {
          gap: 6px;
        }
        .chev {
          width: 24px;
          margin-right: 2px;
        }
      }
      /* two cards side by side on a phone: the modes two by two, wide enough to tap */
      @container (max-width: 240px) {
        .modes {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .mode {
          height: 40px;
        }
        .ring {
          width: 40px;
          height: 40px;
        }
        .ring ha-icon {
          --mdc-icon-size: 20px;
        }
        .ring .secs {
          font-size: 15px;
        }
        .state {
          font-size: 15px;
        }
        .sbar .chev,
        .drawer .bar .chev {
          display: none;
        }
        .tray {
          padding-left: 4px;
          padding-right: 4px;
          --glass-pill-height: 40px;
        }
      }
    `,
  ];
}

registerCard("glass-security", GlassSecurity, {
  name: "Glass – security",
  description: "An alarm panel for any alarm_control_panel: its state, arm modes, the countdown and a keypad; with Alarmo also readiness, a wrong code, skip delay and arm anyway.",
});
