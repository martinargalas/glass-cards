import { tr } from "../i18n";
import { css, html, nothing } from "lit";
import { GlassElement } from "../core/glass-element";
import type { ActionConfig, BaseCardConfig, HassEntity, HomeAssistant } from "../core/types";
import { registerCard } from "../core/registry";
import { makeEditor } from "../editor/editor";
import { roomSpec } from "../editor/specs";
import { applyRules, conditionEntities, evalCondition, ruleEntities, type Condition, type Rule } from "../core/conditions";
import { displayText, type ValueOptions } from "../core/format";
import { cssColor, tint } from "../core/colors";
import { animations, animationOf, control, surface } from "../core/styles";
import { pressHandlers, runAction, withDefaults, type ActionKind, type ActionTarget } from "../core/actions";
import { LiquidController } from "../core/liquid";
import { assetUrl, wallpaperElement } from "../core/liquid-gl";
import { previewNight, settings } from "../core/settings";
import { isSmartThingsJob, washerEntities, washerPhase, type WasherSource } from "../core/washer";
import { ROOM_PARTS } from "../core/card-parts";

/**
 * Room tile: room icon + a row of entity buttons.
 *
 *   type: custom:glass-room-card
 *   name: Obývací pokoj
 *   icon: mdi:sofa
 *   layout: image-right                     # stacked (default) | image-bottom | image-left | image-right
 *                                           # | image-background (photo fills the tile, buttons in a row – phones)
 *                                           # | image-full (photo edge to edge, name, status and buttons in a strip below)
 *                                           # | compact (a low strip: photo thumbnail, name, status, buttons)
 *   bar: split                              # image-full / compact: one glass bar (default) | split: name and buttons
 *                                           #   on capsules of their own (wide tiles)
 *   status: auto                            # image-full / compact: `info` values plus what is on ("2 lights · TV");
 *                                           #   info: the values only; false: none
 *   button_gap: 12                         # optional; default spaces the buttons evenly to the edges
 *   image: /local/rooms/living.jpg          # instead of the icon; or an image./camera. entity
 *   image_position: center                  # CSS background-position
 *   image_opacity: 1
 *   image_fade: 50                          # 0 = almost hard edge … 100 = long fade
 *   image_color: active                     # always (default) | active: in colour only while
 *                                           #   something in the room is on, greyscale otherwise
 *   image_entities: [light.ceiling, media_player.tv]   # with `active`: colour while any of
 *                                           #   these is on (default: the card's buttons)
 *   image_on: { or: [{ entity: light.a, state: "on" }, …] }   # or any condition of your own
 *   tap_action: { action: navigate, navigation_path: "#lights" }
 *   info:                                   # small values in the corner (optional)
 *     - entity: sensor.living_room_temperature
 *       precision: 1
 *   entities:
 *     - entity: light.living_room
 *       icon: mdi:lightbulb-outline
 *       active_color: yellow
 *     - entity: cover.office
 *       active_states: [closed]
 *       state_icons: { closed: mdi:blinds-horizontal-closed }
 *       tap_action: { action: menu, items: [...] }
 *     - entity: sensor.washer_status     # a washer: lit while it runs, as in glass-appliance
 *       washer: true                     #   (SmartThings' job state: found by itself)
 *       # washer: { power: switch.washer_plug, run_states: [cotton] }   # see glass-appliance
 *     - entity: sensor.portainer_status
 *       rules:
 *         - { state: running, color: blue }
 *         - { state: unhealthy, color: orange, animation: pulse }
 */
export interface RoomEntityConfig extends ActionTarget {
  entity: string;
  name?: string;
  icon?: string;
  icon_active?: string;
  state_icons?: Record<string, string>;
  active_states?: string[];
  active?: Condition;
  /** a washer (or dryer): lit while it runs – true, or its machine / power / states as in glass-appliance */
  washer?: boolean | Omit<WasherSource, "entity">;
  active_color?: string;
  color?: string;
  animation?: string | Record<string, string>;
  badge?: string;
  badge_color?: string;
  label?: string;
  rules?: Rule[];
  visible?: Condition;
  /** a media player's cover art instead of its icon while it plays (default for `contextual` players) */
  artwork?: boolean;
  /** one button for several lights: the status counts those of them that are on */
  count?: string[];
}

interface RoomConfig extends BaseCardConfig {
  name?: string;
  icon?: string;
  show_name?: boolean;
  /** Classic layouts: the room icon (default on). */
  show_icon?: boolean;
  entities?: RoomEntityConfig[];
  max_entities?: number;
  columns?: number;
  rows?: number;
  layout?: "stacked" | "image-bottom" | "image-left" | "image-right" | "image-background" | "image-full" | "compact";
  /** image-full / compact: the line under the name – `info` plus what is on (auto), `info` only, or none. */
  status?: "auto" | "info" | "none" | false;
  /** image-full: the status on a second line under the name (narrow tiles, phones) */
  status_below?: boolean;
  /** image-full: the buttons' capsule on the photo's top edge instead of in the bar (narrow tiles, phones) */
  buttons?: "bar" | "top-center" | "top-end";
  /** image-full / compact: one glass bar across the tile with name, status and buttons (default), or
   *  split – a capsule as wide as the name and status, the buttons on a capsule of their own (wide tiles). */
  bar?: "full" | "split";
  /** image-full / compact: the bar's material – liquid glass (default), frosted, or none. */
  bar_glass?: "liquid" | "frosted" | "solid" | "none";
  /** image-full / compact: the bar's colour, as glass_tint: { color, strength }. */
  bar_tint?: { color: number[] | string; strength?: number };
  /** One colour for every button that is on (unless the button sets its own) – e.g. amber for a calm grid. */
  active_color?: string;
  button_gap?: number;
  image?: string;
  image_position?: string;
  image_opacity?: number;
  /** How far the photo fades out, 0–100 (default 50). */
  image_fade?: number;
  image_on?: Condition;
  image_color?: "always" | "active";
  image_entities?: string[];
  /** image-background: spread over the full width (default), or packed left / centred / right. */
  button_align?: "spread" | "start" | "center" | "end";
  button_size?: number;
  info?: (ValueOptions & { icon?: string; visible?: Condition })[];
  /** image-full / compact: up to two buttons left of the others, only while they are on (or `visible`) – music, a player. */
  contextual?: RoomEntityConfig[];
  rules?: Rule[];
  animation?: string;
  tap_action?: ActionConfig;
  hold_action?: ActionConfig;
  double_tap_action?: ActionConfig;
}

const ON = ["on"];
const DEFAULT_ACTIVE: Record<string, string[]> = {
  light: ON,
  switch: ON,
  input_boolean: ON,
  fan: ON,
  binary_sensor: ON,
  siren: ON,
  humidifier: ON,
  remote: ON,
  automation: ON,
  media_player: ["playing", "paused", "on", "buffering"],
  cover: ["open", "opening", "closing"],
  lock: ["unlocked", "open"],
  vacuum: ["cleaning", "returning"],
  lawn_mower: ["mowing"],
  person: ["home"],
  device_tracker: ["home"],
  alarm_control_panel: ["armed_home", "armed_away", "armed_night", "triggered"],
};

const DEFAULT_COLOR: Record<string, string> = { light: "yellow", binary_sensor: "red", lock: "red", alarm_control_panel: "red" };

/** a washer's source, if this button is one */
function washerOf(e: RoomEntityConfig): WasherSource | undefined {
  if (e.washer === false || (!e.washer && !isSmartThingsJob(e.entity))) return undefined;
  return { ...(typeof e.washer === "object" ? e.washer : {}), entity: e.entity };
}

function isActive(e: RoomEntityConfig, st: HassEntity | undefined, hass: HomeAssistant): boolean {
  if (!st) return false;
  if (e.active) return evalCondition(e.active, hass, e.entity);
  // a SmartThings washer: lit while it runs, as in the appliance card
  const washer = washerOf(e);
  if (washer) return washerPhase(hass, washer) === "run";
  const domain = e.entity.split(".")[0];
  if (e.active_states) return e.active_states.includes(st.state);
  if (domain === "climate") return st.state !== "off";
  return (DEFAULT_ACTIVE[domain] ?? []).includes(st.state);
}

/** Things that move get a hint of motion unless the user says otherwise. */
function autoAnimation(st: HassEntity | undefined): string | undefined {
  if (!st) return undefined;
  if (st.state === "opening" || st.state === "closing") return "blink";
  return undefined;
}

/**
 * Soft mask for the room photo: opaque inside, fading to transparent over `fade`
 * px towards the tile's outline, with contours that follow the tile's corner
 * radius. A blurred rounded rectangle, rendered once per size (half resolution)
 * and cached. Returns undefined where canvas filters are unsupported – the CSS
 * mask in the stylesheet is the fallback.
 */
const photoMasks = new Map<string, string>();
const canvasFilter = (() => {
  try {
    const ctx = document.createElement("canvas").getContext("2d");
    return !!ctx && "filter" in ctx;
  } catch {
    return false;
  }
})();
export function photoMask(w: number, h: number, r: number, fade: number): string | undefined {
  if (!canvasFilter || !w || !h) return undefined;
  const key = `${w}x${h}r${r}f${fade}`;
  const hit = photoMasks.get(key);
  if (hit) return hit;
  const k = 0.5;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const ctx = c.getContext("2d")!;
  ctx.scale(k, k);
  // a rounded rect inset by half the fade, blurred by about a third of it: alpha
  // ≈ 0 on the outline, ≈ 1 at `fade` px inside, corners concentric with the tile
  const inset = fade / 2;
  ctx.filter = `blur(${(fade / 3) * k}px)`;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.roundRect(inset, inset, w - 2 * inset, h - 2 * inset, Math.max(0, r - inset));
  ctx.fill();
  const url = c.toDataURL("image/png");
  photoMasks.set(key, url);
  return url;
}

class GlassRoomCard extends GlassElement<RoomConfig> {
  static override parts = ROOM_PARTS;
  private _photoRo?: ResizeObserver;
  /** image-background: how many button rows fit the tile (when it can't grow) and the page shown. */
  private _fitRows = 0;
  /** image-background: buttons per row – three on a phone tile, more on a wider tablet tile. */
  private _bgCols = 3;
  private _page = 0;
  private _pageTimer?: number;
  private _fitRo?: ResizeObserver;
  private _swipeX?: number;

  /** Rows of buttons that fit under the name; 0 = no limit (the tile grows instead). */
  private _measureFit() {
    const room = this.shadowRoot?.querySelector<HTMLElement>(".room.pos-bg");
    if (!room) return;
    const grows = getComputedStyle(this).getPropertyValue("--room-grow").trim() !== "0";
    let fit = 0;
    const btn = parseFloat(getComputedStyle(room.querySelector(".entities") ?? room).getPropertyValue("--btn")) || 46;
    // three per row on a phone tile, four on a wider tablet tile
    const cols = Math.min(4, Math.max(3, Math.floor((room.clientWidth - 12 + 8) / (btn + 8))));
    if (cols !== this._bgCols) {
      this._bgCols = cols;
      this.requestUpdate();
    }
    if (!grows) {
      // name strip on top, 8px padding below, 6px between rows
      fit = Math.max(1, Math.floor((room.clientHeight - 40 - 8 + 6) / (btn + 6)));
    }
    if (fit !== this._fitRows) {
      this._fitRows = fit;
      this.requestUpdate();
    }
  }

  private _goPage(p: number, pages: number) {
    this._page = Math.max(0, Math.min(pages - 1, p));
    clearTimeout(this._pageTimer);
    // back to the first page after a while – the kiosk always shows the main devices
    if (this._page) this._pageTimer = window.setTimeout(() => ((this._page = 0), this.requestUpdate()), 15000);
    this.requestUpdate();
  }

  /** Glass capsules' widths before a render – they then grow or shrink to the new one (FLIP). */
  private _widths = new Map<HTMLElement, number>();
  /** Contextual buttons per capsule before a render – one more buds off as a drop. */
  private _ctxCount = new Map<HTMLElement, number>();
  private _btnsGlass!: LiquidController;

  override willUpdate(changed: Map<string, unknown>) {
    super.willUpdate?.(changed);
    this._widths.clear();
    this.shadowRoot?.querySelectorAll<HTMLElement>(".bar.split .strip, .btns").forEach((el) => this._widths.set(el, el.offsetWidth));
    this._ctxCount.clear();
    this.shadowRoot?.querySelectorAll<HTMLElement>(".btns").forEach((el) => this._ctxCount.set(el, el.querySelectorAll(".slot.ctx").length));
  }

  /**
   * A contextual button appeared: the capsule is already as wide as it will be, but its
   * glass first keeps the old outline, a drop swells out of its left end and travels to
   * the new button, still joined by a thinning neck – then the body flows over to it.
   */
  private _bud(el: HTMLElement) {
    const slot = el.querySelector<HTMLElement>(".slot.ctx");
    if (!slot || !el.classList.contains("lg-on")) return;
    const box = el.getBoundingClientRect();
    const s = slot.getBoundingClientRect();
    const H = box.height;
    const R = H / 2;
    const left = s.right - box.left + 3; // the old capsule's left edge (one gap right of the new button)
    const toX = s.left - box.left + s.width / 2;
    const fromX = left + R * 0.35;
    const drop = s.width / 2 + 5;
    const T = 760;
    const t0 = performance.now();
    const back = (x: number) => 1 + 2.2 * (x - 1) ** 3 + 1.2 * (x - 1) ** 2; // ease out, a little overshoot
    const inOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
    const set = (k: string, v: number) => el.style.setProperty(`--glass-liquid-${k}`, String(v));
    el.style.boxShadow = "none";
    const frame = (now: number) => {
      if (!el.isConnected) return;
      const t = Math.min(1, (now - t0) / T);
      const a = back(Math.min(1, t / 0.55));
      const b = inOut(Math.max(0, (t - 0.5) / 0.5));
      set("shape-left", left * (1 - b));
      set("blob-x", fromX + (toX - fromX) * a);
      set("blob-y", H / 2);
      // a drop just bigger than the button while it travels (so the neck shows), the
      // capsule's full height once the body has flowed over to it
      set("blob-r", (drop * (0.35 + 0.65 * Math.min(1, a))) * (1 - b) + R * b);
      set("blob-k", 14);
      this._btnsGlass.refresh();
      if (t < 1) return requestAnimationFrame(frame);
      for (const k of ["shape-left", "blob-x", "blob-y", "blob-r", "blob-k"]) el.style.removeProperty(`--glass-liquid-${k}`);
      el.style.boxShadow = "";
      this._btnsGlass.refresh();
    };
    requestAnimationFrame(frame);
  }

  /**
   * The reverse: a contextual button went off. The capsule keeps its old width for a moment,
   * its body pulls back to the right, the drop left behind hangs on by a neck – then it is
   * drawn back in and the capsule takes its new width.
   */
  private _unbud(el: HTMLElement, from: number) {
    if (!el.classList.contains("lg-on")) return;
    el.style.width = "";
    const to = el.offsetWidth;
    const L = from - to;
    if (L < 6) return;
    el.style.width = `${from}px`;
    const H = el.offsetHeight;
    const R = H / 2;
    const drop = R * 0.78;
    const T = 700;
    const t0 = performance.now();
    const inOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
    const set = (k: string, v: number) => el.style.setProperty(`--glass-liquid-${k}`, String(v));
    el.style.boxShadow = "none";
    const frame = (now: number) => {
      if (!el.isConnected) return;
      const t = Math.min(1, (now - t0) / T);
      const a = inOut(Math.min(1, t / 0.5));
      const b = inOut(Math.max(0, (t - 0.45) / 0.55));
      set("shape-left", L * a);
      set("blob-x", L / 2 + (L + R * 0.35 - L / 2) * b);
      set("blob-y", H / 2);
      set("blob-r", drop * (1 - b));
      set("blob-k", 14);
      this._btnsGlass.refresh();
      if (t < 1) return requestAnimationFrame(frame);
      for (const k of ["shape-left", "blob-x", "blob-y", "blob-r", "blob-k"]) el.style.removeProperty(`--glass-liquid-${k}`);
      el.style.width = "";
      el.style.boxShadow = "";
      this._btnsGlass.refresh();
    };
    requestAnimationFrame(frame);
  }

  private _animateWidths() {
    if (!this._widths.size || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (const [el, n] of this._ctxCount) {
      if (!el.isConnected) continue;
      const now = el.querySelectorAll(".slot.ctx").length;
      if (now === n) continue;
      const from = this._widths.get(el);
      this._widths.delete(el);
      if (now > n) this._bud(el);
      else if (from) this._unbud(el, from);
    }
    for (const [el, from] of this._widths) {
      if (!el.isConnected) continue;
      el.style.transition = "none";
      el.style.width = "";
      const to = el.offsetWidth;
      // a tenth of a degree is no reason to move – only a word or a button more or less
      if (Math.abs(to - from) < 6) continue;
      el.style.width = `${from}px`;
      el.style.overflow = "hidden";
      void el.offsetWidth;
      el.style.transition = "width 460ms cubic-bezier(0.34, 1.3, 0.64, 1)";
      el.style.width = `${to}px`;
      const done = (ev: TransitionEvent) => {
        if (ev.target !== el || ev.propertyName !== "width") return;
        el.removeEventListener("transitionend", done);
        el.style.transition = "";
        el.style.width = "";
        el.style.overflow = "";
      };
      el.addEventListener("transitionend", done);
    }
  }

  override updated(changed: Map<string, unknown>) {
    super.updated?.(changed);
    this._animateWidths();
    // a compact strip is only as tall as its content
    this.toggleAttribute("compact", this._config?.layout === "compact");
    const room = this.shadowRoot?.querySelector<HTMLElement>(".room.pos-bg");
    if (room) {
      this._fitRo ??= new ResizeObserver(() => this._measureFit());
      this._fitRo.disconnect();
      this._fitRo.observe(room);
    }
    const wrap = this.shadowRoot?.querySelector<HTMLElement>(".photo-wrap");
    if (!wrap) {
      this._photoRo?.disconnect();
      return;
    }
    this._photoRo ??= new ResizeObserver(() => this._applyPhotoMask());
    this._photoRo.disconnect();
    this._photoRo.observe(wrap);
    this._applyPhotoMask();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._photoRo?.disconnect();
    this._fitRo?.disconnect();
    clearTimeout(this._pageTimer);
  }

  private _applyPhotoMask() {
    const wrap = this.shadowRoot?.querySelector<HTMLElement>(".photo-wrap");
    if (!wrap) return;
    const r = parseFloat(getComputedStyle(wrap).borderTopLeftRadius) || 26;
    const f = Math.min(100, Math.max(0, this._config?.image_fade ?? 50)) / 50; // 0…2, 1 = default
    const url = photoMask(Math.round(wrap.offsetWidth), Math.round(wrap.offsetHeight), r, Math.max(2, r * 2 * f));
    if (!url) return;
    const m = `url(${url}) 0 0 / 100% 100% no-repeat`;
    wrap.style.setProperty("-webkit-mask", m);
    wrap.style.setProperty("mask", m);
  }

  static getConfigElement() {
    return makeEditor(roomSpec);
  }

  constructor() {
    super();
    new LiquidController(this);
    // image-full: the bar over the photo is liquid glass over the photo itself
    new LiquidController(this, ".full .strip.liq", undefined, undefined, (el) => el.closest(".tile")?.querySelector(".pic"));
    // compact: the capsule itself is glass on the wallpaper, as a dashboard panel
    new LiquidController(this, ".tile.cmp.liq", undefined, undefined, () => wallpaperElement());
    // …and the buttons share one glass capsule of their own
    this._btnsGlass = new LiquidController(this, ".full .btns.liq", undefined, undefined, (el) => el.closest(".tile")?.querySelector(".pic"));
  }

  /** A setting of the nearest panel / dashboard above that has it (their per-device config). */
  private _inherited(key: string): any {
    for (let n: Node | null = this.parentNode; n; n = n instanceof ShadowRoot ? n.host : n.parentNode) {
      const cfg = (n as { styleConfig?: () => Record<string, any> | undefined }).styleConfig?.();
      if (cfg?.[key] !== undefined) return cfg[key];
    }
    return undefined;
  }

  static getStubConfig(hass: HomeAssistant) {
    const lights = Object.keys(hass.states).filter((e) => e.startsWith("light.")).slice(0, 3);
    return { name: "Living room", icon: "mdi:sofa", entities: lights.map((entity) => ({ entity })) };
  }

  protected override validateConfig(c: RoomConfig) {
    if (c.entities && !Array.isArray(c.entities)) throw new Error("`entities` must be a list");
    const entities = (c.entities ?? []).map((e) => (typeof e === "string" ? { entity: e } : e));
    if (entities.some((e) => !e.entity)) throw new Error("Every item in `entities` needs `entity`");
    return { ...c, entities };
  }

  protected watchedEntities(c: RoomConfig) {
    const out = new Set<string>();
    for (const e of [...(c.entities ?? []), ...(c.contextual ?? [])]) {
      out.add(e.entity);
      e.count?.forEach((id) => out.add(id));
      const washer = washerOf(e);
      if (washer) washerEntities(washer).forEach((id) => out.add(id));
      conditionEntities(e.active, e.entity, out);
      conditionEntities(e.visible, e.entity, out);
      ruleEntities(e.rules, e.entity, out);
    }
    for (const i of c.info ?? []) {
      if (i.entity) out.add(i.entity);
      i.entities?.forEach((x) => out.add(x));
      conditionEntities(i.visible, i.entity, out);
    }
    ruleEntities(c.rules, undefined, out);
    if (c.image && /^(image|camera)\./.test(c.image)) out.add(c.image);
    conditionEntities(c.image_on, undefined, out);
    c.image_entities?.forEach((e) => out.add(e));
    if (c.layout === "image-full" || c.layout === "compact") out.add("sun.sun");
    return out;
  }

  override getCardSize() {
    return 3;
  }

  getGridOptions() {
    return { columns: 4, rows: 3, min_rows: 2 };
  }

  private _button(cfg: RoomEntityConfig, index: number, slot = "") {
    const hass = this._hass!;
    if (!evalCondition(cfg.visible, hass, cfg.entity)) return nothing;
    const st = hass.states[cfg.entity];
    const domain = cfg.entity.split(".")[0];
    const active = isActive(cfg, st, hass);
    const base: RoomEntityConfig = {
      ...cfg,
      color: cfg.color ?? (active ? (cfg.active_color ?? this._config?.active_color ?? DEFAULT_COLOR[domain] ?? "blue") : undefined),
      icon: (active && cfg.icon_active) || (st && cfg.state_icons?.[st.state]) || cfg.icon,
      animation: cfg.animation ?? autoAnimation(st),
    };
    const e = applyRules(base, cfg.rules, hass, cfg.entity);
    const anim = animationOf(e.animation);
    const fill = tint(e.color);
    const accent = cssColor(e.color);
    const target = withDefaults(e);
    const h = pressHandlers(
      () => target,
      (kind: ActionKind, el: HTMLElement) => runAction(this, hass, target, kind, el),
    );
    const name = e.name ?? st?.attributes.friendly_name ?? e.entity;
    const label = e.label ? displayText(hass, { entity: e.entity, text: e.label }).text : "";
    const art = (e.artwork ?? false) && active && domain === "media_player" ? (st?.attributes.entity_picture as string | undefined) : undefined;
    return html`<div class="slot ${slot}">
      <div
        class="btn control ${fill ? "active" : ""} ${anim.cls} ${st ? "" : "missing"}"
        role="button"
        tabindex="0"
        title=${name}
        aria-label=${name}
        aria-pressed=${active ? "true" : "false"}
        data-i=${index}
        style="${fill ? `--bg:${fill};--accent:${accent};` : ""}${anim.glow ? `--glow:${cssColor(anim.glow)};` : `--glow:${accent ?? "#fff"};`}"
        @pointerdown=${h.down}
        @pointermove=${h.move}
        @pointerup=${h.up}
        @pointercancel=${h.cancel}
        @keydown=${h.key}
        @contextmenu=${h.context}
      >
        ${art
          ? html`<img class="art" src=${art} alt="" />`
          : e.icon
          ? html`<ha-icon .icon=${e.icon}></ha-icon>`
          : st
            ? html`<ha-state-icon .hass=${hass} .stateObj=${st}></ha-state-icon>`
            : html`<ha-icon icon="mdi:help-circle-outline"></ha-icon>`}
        ${e.badge
          ? html`<span class="badge" style="--badge:${cssColor(e.badge_color ?? "red")}"
              >${e.badge.startsWith("mdi:") ? html`<ha-icon .icon=${e.badge}></ha-icon>` : e.badge}</span
            >`
          : nothing}
      </div>
      ${label ? html`<span class="label">${label}</span>` : nothing}
    </div>`;
  }

  /** `image:` is a URL, or an image./camera. entity whose picture is used. */
  private _imageUrl(src?: string): string | undefined {
    if (!src) return undefined;
    if (/^(image|camera)\./.test(src)) return this._hass?.states[src]?.attributes.entity_picture as string | undefined;
    return assetUrl(src);
  }

  /** image-full / compact: "22,1 °C · 2 světla · TV" – the info values, then what is on. */
  private _status(c: RoomConfig, entities: RoomEntityConfig[], shown: RoomEntityConfig[] = []): string {
    const hass = this._hass!;
    if (c.status === false || c.status === "none") return "";
    const parts = (c.info ?? [])
      .filter((i) => evalCondition(i.visible, hass, i.entity))
      .map((i) => displayText(hass, i))
      .filter((t) => t.available && t.text)
      .map((t) => t.text);
    if (c.status !== "info") {
      const on = entities.filter((e) => evalCondition(e.visible, hass, e.entity) && isActive(e, hass.states[e.entity], hass));
      // lights (and light switches) are counted, everything else is named
      const isLight = (e: RoomEntityConfig) => e.entity.startsWith("light.") || /lightbulb|ceiling-light|wall-sconce|lamp/.test(e.icon ?? "");
      const lights = on
        .filter(isLight)
        .reduce((n, e) => {
          // a light group (or `count:`) is as many lights as its members that are on
          const members = e.count ?? (e.entity.startsWith("light.") ? (hass.states[e.entity]?.attributes.entity_id as string[] | undefined) : undefined);
          return n + (Array.isArray(members) ? members.filter((id) => hass.states[id]?.state === "on").length || 1 : 1);
        }, 0);
      if (lights) parts.push(tr("{n} lights", { n: lights }));
      for (const e of on.filter((x) => !isLight(x))) {
        const washer = washerOf(e);
        if (washer) parts.push(tr("washing"));
        // a lit button already says it is on – name only what has no button on the tile
        else if (e.name && !shown.some((x) => x.entity === e.entity)) parts.push(e.name);
      }
    }
    return parts.join(" · ");
  }

  /** image-full and compact: photo, then a strip with name, status and up to three (two) buttons. */
  private _renderTile(c: RoomConfig, imgOn: boolean, h: ReturnType<typeof pressHandlers>, own: (fn: (ev: any) => void) => (ev: Event) => void) {
    const hass = this._hass!;
    const compact = c.layout === "compact";
    const all = c.entities ?? [];
    const entities = all.filter((e) => evalCondition(e.visible, hass, e.entity)).slice(0, c.max_entities ?? (compact ? 2 : 3));
    const img = this._imageUrl(c.image);
    // photos dim after sunset; the editor preview's day / night switch overrides it
    const night = previewNight(this) ?? hass.states["sun.sun"]?.state === "below_horizon";
    const status = this._status(c, all, [...entities, ...(c.contextual ?? [])]);
    const split = c.bar === "split";
    // the bar's material: liquid (WebGL, class liq), frosted (CSS) or none – own, else the panel's /
    // dashboard's; its colour likewise (the CSS variable comes down from whoever set it)
    const mat = c.bar_glass ?? this._inherited("bar_glass") ?? settings.bar_glass ?? "liquid";
    const tinted = !!(c.bar_tint ?? this._inherited("bar_tint"));
    const barCls = `${mat === "liquid" ? "liq" : ""} mat-${mat} ${tinted ? "bar-tinted" : ""}`;
    const top = c.buttons === "top-center" || c.buttons === "top-end";
    // contextual buttons: there only while on – they grow out of the capsule, left of the others
    const ctx = (c.contextual ?? [])
      .filter((e) => (e.visible ? evalCondition(e.visible, hass, e.entity) : isActive(e, hass.states[e.entity], hass)))
      .slice(0, 2)
      .map((e) => ({ ...e, visible: undefined, artwork: e.artwork ?? e.entity.startsWith("media_player.") }));
    const buttons =
      entities.length || ctx.length
        ? html`<div class="entities">${ctx.map((e, i) => this._button(e, 100 + i, "ctx"))}${entities.map((e, i) => this._button(e, i))}</div>`
        : undefined;
    const pic = img
      ? html`<div class="pic ${imgOn ? "" : "off"}" style="background-image:url('${img}');background-position:${c.image_position ?? "center"}"></div>`
      : html`<div class="pic none"><ha-icon .icon=${c.icon ?? "mdi:home"}></ha-icon></div>`;
    // compact: one glass capsule on the wallpaper – a round photo, name, status, buttons (as Control Center's rows)
    if (compact)
      return html`<div
        class="surface tile cmp ${barCls} ${imgOn ? "lit" : ""} ${night ? "night" : ""} ${c.tap_action ? "clickable" : ""}"
        style="${c.button_size ? `--btn-fixed:${c.button_size}px;` : ""}"
        @pointerdown=${own(h.down)}
        @pointermove=${own(h.move)}
        @pointerup=${own(h.up)}
        @pointercancel=${h.cancel}
        @contextmenu=${h.context}
      >
        ${pic}
        <div class="txt">
          <span class="nm">${c.name ?? ""}${c.tap_action ? html`<i class="chev"></i>` : nothing}</span>
          ${status ? html`<span class="st">${status}</span>` : nothing}
        </div>
        ${buttons ?? nothing}
      </div>`;
    return html`<div
      class="surface tile full ${imgOn ? "lit" : ""} ${night ? "night" : ""} ${c.tap_action ? "clickable" : ""}"
      style="${c.button_size ? `--btn-fixed:${c.button_size}px;` : ""}"
      @pointerdown=${own(h.down)}
      @pointermove=${own(h.move)}
      @pointerup=${own(h.up)}
      @pointercancel=${h.cancel}
      @contextmenu=${h.context}
    >
      ${pic}
      ${top && buttons ? html`<div class="topbtns ${c.buttons === "top-end" ? "end" : ""}"><div class="btns ${barCls}">${buttons}</div></div>` : nothing}
      <div class="bar ${split ? "split" : ""}">
        <div class="strip ${barCls}">
          <div class="txt ${c.status_below ? "stack" : ""}">
            <span class="nm">${c.name ?? ""}${c.tap_action ? html`<i class="chev"></i>` : nothing}</span>
            ${status ? html`<span class="st">${status}</span>` : nothing}
          </div>
          ${!split && !top && buttons ? buttons : nothing}
        </div>
        ${split && !top && buttons ? html`<div class="btns ${barCls}">${buttons}</div>` : nothing}
      </div>
    </div>`;
  }

  protected override render() {
    if (!this._config || !this._hass) return nothing;
    const hass = this._hass;
    const c = applyRules(this._config, this._config.rules, hass);
    if (c.layout === "image-full" || c.layout === "compact") {
      const tgt: ActionTarget = { tap_action: c.tap_action, hold_action: c.hold_action, double_tap_action: c.double_tap_action };
      const th = pressHandlers(
        () => tgt,
        (kind: ActionKind) => runAction(this, hass, tgt, kind),
      );
      const mine = (fn: (ev: any) => void) => (ev: Event) => {
        if (!ev.composedPath().some((n) => (n as Element).classList?.contains("btn"))) fn(ev);
      };
      const all = c.entities ?? [];
      const on =
        c.image_on !== undefined
          ? evalCondition(c.image_on, hass)
          : c.image_color === "always"
            ? true
            : c.image_entities?.length
              ? c.image_entities.some((id) => isActive({ entity: id }, hass.states[id], hass))
              : all.some((e) => isActive(e, hass.states[e.entity], hass));
      return this._renderTile(c, on, th, mine);
    }
    const entities = (c.entities ?? []).slice(0, c.max_entities ?? 6);
    const cols = c.columns ?? Math.max(1, Math.min(entities.length, 4));
    const target: ActionTarget = { tap_action: c.tap_action, hold_action: c.hold_action, double_tap_action: c.double_tap_action };
    const h = pressHandlers(
      () => target,
      (kind: ActionKind) => runAction(this, hass, target, kind),
    );
    // Entity buttons handle their own presses; ignore them at room level.
    const own = (fn: (ev: any) => void) => (ev: Event) => {
      if (!ev.composedPath().some((n) => (n as Element).classList?.contains("btn"))) fn(ev);
    };
    const anim = animationOf(c.animation);
    const info = (c.info ?? []).map((i) => ({ i, t: displayText(hass, i) })).filter(({ t }) => t.available && t.text);
    const iconColor = cssColor(c.icons?.icon?.color);
    // where the picture / icon sits; the buttons take the other half
    const pos = ({ stacked: "top", "image-bottom": "bottom", "image-left": "left", "image-right": "right", "image-background": "bg" } as Record<string, string>)[
      c.layout ?? "stacked"
    ] ?? "top";
    const side = pos === "left" || pos === "right";
    const bg = pos === "bg";
    const titled = (side || bg) && !!c.show_name && !!c.name;
    const img = this._imageUrl(c.image);
    // photo in colour: own condition, else "something in the room is on", else always
    const imgOn =
      c.image_on !== undefined
        ? evalCondition(c.image_on, hass)
        : c.image_color === "active"
          ? c.image_entities?.length
            ? c.image_entities.some((id) => isActive({ entity: id }, hass.states[id], hass))
            : entities.some((e) => isActive(e, hass.states[e.entity], hass))
          : true;
    // side: at most two rows (4 buttons → 2×2, 6 → 3×2); one or two stack in a column
    const rows = c.rows ?? Math.max(1, Math.min(entities.length, 2));
    const sideCols = Math.ceil(entities.length / rows);
    const gap = c.button_gap;
    const grid = side
      ? `--cols:${sideCols};--rows:${rows};grid-auto-flow:column${gap !== undefined ? `;--bgap:${gap}px` : ""}`
      : bg
        ? ""
        : `grid-template-columns:repeat(${cols}, 1fr)${gap !== undefined ? `;gap:${gap}px` : ""}`;
    // image-background: three buttons per row; every extra row takes its height from the photo.
    // A tile that can't grow (same-height rows) pages through the buttons instead.
    const perRow = this._bgCols;
    const perPage = bg && this._fitRows ? this._fitRows * perRow : entities.length;
    const pages = Math.max(1, Math.ceil(entities.length / Math.max(1, perPage)));
    if (this._page >= pages) this._page = 0;
    const shown = pages > 1 ? entities.slice(this._page * perPage, this._page * perPage + perPage) : entities;
    const offset = pages > 1 ? this._page * perPage : 0;
    const bgRows = Math.max(1, Math.ceil(shown.length / perRow));
    const pageOn = (p: number) =>
      entities.slice(p * perPage, p * perPage + perPage).some((e) => isActive(e, hass.states[e.entity], hass));

    return html`<div
      class="surface room pos-${pos} ${side ? "side" : ""} ${side && titled ? "named" : ""} ${gap !== undefined && side ? "fixed-gap" : ""} ${img ? "has-image" : ""} ${c.tap_action ? "clickable" : ""}"
      style="--btn-max:52px;${c.button_size ? `--btn-fixed:${c.button_size}px;` : ""}${bg ? `--bg-rows:${bgRows};--bg-cols:${Math.max(1, Math.min(perRow, shown.length))};--bg-align:${({ spread: "space-between", start: "start", center: "center", end: "end" } as Record<string, string>)[c.button_align ?? "spread"] ?? "space-between"};--bg-pad:${perRow > 3 ? "7px" : "0px"};` : ""}"
      @pointerdown=${own(h.down)}
      @pointermove=${own(h.move)}
      @pointerup=${own(h.up)}
      @pointercancel=${h.cancel}
      @contextmenu=${h.context}
    >
      ${info.length
        ? html`<div class="info">
            ${info.map(({ i, t }) => html`<span>${i.icon ? html`<ha-icon .icon=${i.icon}></ha-icon>` : nothing}${t.text}</span>`)}
          </div>`
        : nothing}
      ${img
        ? html`<div class="photo-wrap">
            <div
              class="photo ${imgOn ? "" : "off"}"
              style="background-image:url('${img}');background-position:${c.image_position ?? "center"};--img-op:${c.image_opacity ?? 1};--fade-k:${Math.min(100, Math.max(0, c.image_fade ?? 50)) / 50}"
            ></div>
          </div>`
        : nothing}
      ${titled ? html`<span class="name title">${c.name}<i class="chev"></i></span>` : nothing}
      <div class="head ${anim.cls}">
        ${c.icon && c.show_icon !== false && (!img || (bg && !titled)) ? html`<ha-icon class="room-icon" .icon=${c.icon} style=${iconColor ? `color:${iconColor}` : ""}></ha-icon>` : nothing}
        ${!side && !bg && c.show_name && c.name ? html`<span class="name">${c.name}</span>` : nothing}
      </div>
      ${pages > 1
        ? html`<div class="pages" role="tablist">
            ${Array.from(
              { length: pages },
              (_, p) => html`<button
                role="tab"
                aria-selected=${p === this._page ? "true" : "false"}
                aria-label=${`${p + 1} / ${pages}`}
                class="${p === this._page ? "cur" : ""} ${p !== this._page && pageOn(p) ? "on" : ""}"
                @pointerdown=${(e: Event) => e.stopPropagation()}
                @pointerup=${(e: Event) => e.stopPropagation()}
                @click=${(e: Event) => {
                  e.stopPropagation();
                  this._goPage(p, pages);
                }}
              ><i></i></button>`,
            )}
          </div>`
        : nothing}
      ${entities.length
        ? html`<div
            class="entities"
            style=${grid}
            @pointerdown=${(e: PointerEvent) => (this._swipeX = e.clientX)}
            @pointerup=${(e: PointerEvent) => {
              const dx = this._swipeX === undefined ? 0 : e.clientX - this._swipeX;
              this._swipeX = undefined;
              if (pages > 1 && Math.abs(dx) > 40) this._goPage(this._page + (dx < 0 ? 1 : -1), pages);
            }}
          >
            ${shown.map((e, i) => this._button(e, i + offset))}
          </div>`
        : nothing}
    </div>`;
  }

  static override styles = [
    GlassElement.styles,
    surface,
    control,
    animations,
    css`
      :host {
        display: block;
        height: 100%;
        min-height: var(--glass-room-min-height, 110px);
      }
      /* The tile is a size container: buttons and icon scale with its width, so the
         same card fits a 1280px tablet grid and a 2-column phone grid. */
      .room {
        container-type: inline-size;
        height: 100%;
        padding: 18px 14px;
        display: flex;
        flex-direction: column;
        justify-content: space-evenly;
        gap: 10px;
        overflow: hidden;
        transition: transform 0.25s ease;
      }
      /* side layouts: buttons on one half, room icon / photo on the other. The
         button block is as tall as the tile and spaced evenly, so the gaps to the
         edges equal the gaps between buttons – horizontally and vertically. */
      .room.side {
        /* size container: buttons are sized from the tile's height as well */
        container-type: size;
        flex-direction: row-reverse;
        justify-content: space-between;
        align-items: stretch;
        padding: 0;
        gap: 0;
      }
      .room.pos-left {
        flex-direction: row;
      }
      /* Buttons keep the size they have in every other room tile. They own at most
         half of the tile; the gap – between buttons and to the edges, equal both
         ways – is the largest that fits that half and the tile's height. */
      .room.side .entities {
        /* same auto size as the stacked tile (whose 14px side padding the
           container width includes there) */
        --btn: var(--btn-fixed, var(--glass-room-button-size, clamp(32px, calc((100cqw - 28px) * 0.19), var(--btn-max))));
        --g: max(4px, min((50cqw - var(--cols) * var(--btn)) / (var(--cols) + 1), (100cqh - var(--rows) * var(--btn)) / (var(--rows) + 1)));
        flex: none;
        align-self: center;
        grid-template-columns: repeat(var(--cols), var(--btn));
        grid-template-rows: repeat(var(--rows), var(--btn));
        gap: var(--g);
        padding: var(--g);
      }
      /* explicit button_gap: that gap between buttons and to the edges */
      .room.side.fixed-gap .entities {
        --g: var(--bgap);
      }
      .room.side .head {
        flex: 1;
        justify-content: center;
        padding: 14px;
      }
      .room.pos-bottom {
        flex-direction: column-reverse;
      }
      .room.has-image .head {
        flex: 1;
        justify-content: start;
      }
      .room.has-image.pos-right .head {
        align-items: end;
      }
      .room.has-image.pos-left .head {
        align-items: start;
      }
      .room.has-image.pos-bottom .head {
        justify-content: end;
      }
      /* room photo: always fades out. The wrapper fades the whole tile's outline
         inwards, following the tile's corner radius (rounded-rect fade built from
         corner circles, edge strips and a solid centre); the photo inside covers
         only the half without buttons and fades out towards them. */
      .photo-wrap {
        /* fade width: twice the corner radius, so the rounded fade is clearly visible */
        --r: calc(var(--g-radius, 26px) * 2);
        position: absolute;
        inset: 0;
        z-index: -1;
        border-radius: inherit;
        pointer-events: none;
        -webkit-mask:
          radial-gradient(circle at 100% 100%, #000, transparent var(--r)) top left / var(--r) var(--r) no-repeat,
          radial-gradient(circle at 0 100%, #000, transparent var(--r)) top right / var(--r) var(--r) no-repeat,
          radial-gradient(circle at 100% 0, #000, transparent var(--r)) bottom left / var(--r) var(--r) no-repeat,
          radial-gradient(circle at 0 0, #000, transparent var(--r)) bottom right / var(--r) var(--r) no-repeat,
          linear-gradient(180deg, transparent, #000) top / calc(100% - 2 * var(--r)) var(--r) no-repeat,
          linear-gradient(0deg, transparent, #000) bottom / calc(100% - 2 * var(--r)) var(--r) no-repeat,
          linear-gradient(90deg, transparent, #000) left / var(--r) calc(100% - 2 * var(--r)) no-repeat,
          linear-gradient(270deg, transparent, #000) right / var(--r) calc(100% - 2 * var(--r)) no-repeat,
          linear-gradient(#000, #000) center / calc(100% - 2 * var(--r)) calc(100% - 2 * var(--r)) no-repeat;
        mask:
          radial-gradient(circle at 100% 100%, #000, transparent var(--r)) top left / var(--r) var(--r) no-repeat,
          radial-gradient(circle at 0 100%, #000, transparent var(--r)) top right / var(--r) var(--r) no-repeat,
          radial-gradient(circle at 100% 0, #000, transparent var(--r)) bottom left / var(--r) var(--r) no-repeat,
          radial-gradient(circle at 0 0, #000, transparent var(--r)) bottom right / var(--r) var(--r) no-repeat,
          linear-gradient(180deg, transparent, #000) top / calc(100% - 2 * var(--r)) var(--r) no-repeat,
          linear-gradient(0deg, transparent, #000) bottom / calc(100% - 2 * var(--r)) var(--r) no-repeat,
          linear-gradient(90deg, transparent, #000) left / var(--r) calc(100% - 2 * var(--r)) no-repeat,
          linear-gradient(270deg, transparent, #000) right / var(--r) calc(100% - 2 * var(--r)) no-repeat,
          linear-gradient(#000, #000) center / calc(100% - 2 * var(--r)) calc(100% - 2 * var(--r)) no-repeat;
      }
      /* image-background (phones): a taller tile – the photo fills the top half and
         fades into the tile, the buttons sit in the bottom half */
      .pos-bg .photo-wrap {
        -webkit-mask: none;
        mask: none;
      }
      .pos-bg .photo {
        inset: 0 0 auto 0;
        /* the photo ends where the button rows begin (plus a little overlap for the fade) */
        height: var(--glass-room-bg-photo, calc(100% - var(--bg-rows, 1) * (var(--glass-room-button-size, 46px) + 6px) + 14px));
        opacity: var(--glass-image-k, 1);
        -webkit-mask-image: linear-gradient(180deg, #000 55%, transparent);
        mask-image: linear-gradient(180deg, #000 55%, transparent);
      }
      .pos-bg .photo.off {
        opacity: calc(var(--glass-image-k, 1) * 0.9 * var(--glass-image-off, 1));
      }
      /* the tile's colour under the name, so it stays readable on any photo */
      .pos-bg .photo-wrap::after {
        content: "";
        position: absolute;
        inset: 0 0 auto 0;
        height: 34%;
        background: linear-gradient(180deg, var(--glass-home-surface, rgba(246, 246, 248, 0.8)), transparent);
      }
      .room.pos-bg {
        /* at least the usual height; with many button rows, room for the name above them */
        /* phones: a set height; tablets: the grid cell decides (--room-min / --room-max from the panel) */
        min-height: max(var(--room-min, var(--glass-room-bg-height, 176px)), calc((40px + var(--bg-rows, 1) * (var(--glass-room-button-size, 46px) + 6px) + 8px) * var(--room-grow, 1)));
        /* same-height rows (--room-grow: 0): the tile keeps its height and pages instead */
        max-height: calc(var(--room-max, var(--glass-room-bg-height, 176px)) + 10000px * var(--room-grow, 1));
        justify-content: space-between;
        align-items: stretch;
        padding: 8px 6px;
        gap: 6px;
      }
      .room.pos-bg .name.title {
        top: 10px;
        left: 12px;
      }
      .room.pos-bg .head {
        align-items: start;
        flex: 1;
      }
      .room.pos-bg .room-icon {
        --mdc-icon-size: 24px;
      }
      /* the same button size as everywhere else; three fit a phone tile, the gap
         shrinks to make them fit */
      .room.pos-bg .entities {
        --btn: var(--btn-fixed, var(--glass-room-button-size, 46px));
        display: grid;
        grid-template-columns: repeat(var(--bg-cols, 3), var(--btn));
        column-gap: clamp(2px, calc((100% - var(--bg-cols, 3) * var(--btn)) / (var(--bg-cols, 3) - 1)), 8px);
        row-gap: 6px;
        /* button_align: the grid sits left (in line with the name), in the middle or
           right; a shorter row starts at the same edge as a full one */
        justify-content: var(--bg-align, center);
        /* in line with the name when the tile has room to spare (wider than three buttons) */
        padding-inline: var(--bg-pad, 0px);
      }
      .photo {
        position: absolute;
        inset: 0;
        background-size: cover;
        opacity: calc(var(--img-op) * var(--glass-image-k, 1));
        -webkit-mask-image: var(--fade);
        mask-image: var(--fade);
        transition:
          opacity 0.4s ease,
          filter 0.4s ease;
      }
      .pos-top .photo {
        bottom: 42%;
        --fade: linear-gradient(0deg, transparent 0, #000 calc(60% * var(--fade-k, 1)));
      }
      .pos-bottom .photo {
        top: 42%;
        --fade: linear-gradient(180deg, transparent 0, #000 calc(60% * var(--fade-k, 1)));
      }
      .pos-right .photo {
        left: 45%;
        --fade: linear-gradient(90deg, transparent 0, #000 calc(60% * var(--fade-k, 1)));
      }
      .pos-left .photo {
        right: 45%;
        --fade: linear-gradient(270deg, transparent 0, #000 calc(60% * var(--fade-k, 1)));
      }
      .photo {
        transition:
          filter 0.6s ease,
          opacity 0.6s ease;
      }
      /* nothing on: shades of grey, a touch dimmer – colour comes back when a light goes on */
      .photo.off {
        filter: grayscale(var(--glass-image-grey, 1)) brightness(var(--glass-image-off-brightness, 0.9));
        opacity: calc(var(--img-op) * var(--glass-image-k, 1) * 0.85 * var(--glass-image-off, 1));
      }
      .room.clickable {
        cursor: pointer;
      }
      .room.clickable:active {
        transform: scale(0.985);
      }
      .head {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
      }
      .room-icon {
        --mdc-icon-size: var(--glass-room-icon-size, clamp(26px, 14cqi, 40px));
        display: flex;
      }
      .name {
        font-size: 15px;
        font-weight: 600;
        text-shadow: var(--g-text-shadow);
      }
      /* side layouts: the room name as an Apple Home header – top left, semibold,
         with a chevron; the buttons share the rest of the height */
      .room.side.named {
        padding-top: var(--glass-room-title-space, 30px);
      }
      .name.title {
        position: absolute;
        top: 12px;
        left: 16px;
        right: 16px;
        z-index: 1;
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: var(--glass-room-title-size, 15px);
        font-weight: 600;
        /* same colour as the buttons' icons, on every device */
        color: var(--glass-room-title-color, var(--glass-home-icon, var(--g-text)));
        letter-spacing: -0.01em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        pointer-events: none;
      }
      .room.pos-left .name.title {
        justify-content: flex-end;
      }
      /* page dots (image-background tiles with more buttons than fit): top right,
         a big invisible target around a small dot; a dot glows when that page has
         something switched on */
      .pages {
        position: absolute;
        top: 6px;
        right: 4px;
        z-index: 2;
        display: flex;
      }
      .pages button {
        width: 22px;
        height: 28px;
        padding: 0;
        border: 0;
        background: none;
        cursor: pointer;
        display: grid;
        place-items: center;
      }
      .pages i {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--glass-room-title-color, var(--glass-home-icon, var(--g-text)));
        opacity: 0.3;
        transition: opacity 0.2s ease;
      }
      .pages .cur i {
        opacity: 0.9;
      }
      .pages .on i {
        opacity: 0.9;
        background: #febc2e;
      }
      .chev {
        flex: none;
        width: 6px;
        height: 6px;
        margin-top: 1px;
        border: solid var(--g-text-2);
        border-width: 1.8px 1.8px 0 0;
        transform: rotate(45deg);
      }
      .info {
        position: absolute;
        top: 12px;
        right: 16px;
        display: flex;
        flex-direction: column;
        align-items: end;
        gap: 2px;
        font-size: 12px;
        font-weight: 600;
        color: var(--g-text-2);
        text-shadow: var(--g-text-shadow);
      }
      .info span {
        display: inline-flex;
        align-items: center;
        gap: 3px;
      }
      .info ha-icon {
        --mdc-icon-size: 14px;
      }
      .entities {
        /* auto size from the tile width, or the configured button_size */
        --btn: var(--btn-fixed, var(--glass-room-button-size, clamp(32px, 19cqi, var(--btn-max))));
        display: grid;
        justify-items: center;
        align-items: start;
        gap: 8px;
      }
      .slot {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        min-width: 0;
      }
      .btns .slot {
        flex: none;
      }
      .btn {
        width: var(--btn);
        height: var(--btn);
        /* round whatever squeezes it */
        flex: none;
        min-width: var(--btn);
        aspect-ratio: 1;
        display: grid;
        place-items: center;
        overflow: visible;
      }
      .btn ha-icon,
      .btn ha-state-icon {
        --mdc-icon-size: calc(var(--btn) * 0.52);
        display: flex;
        filter: var(--g-icon-shadow);
      }
      .btn:not(.active) {
        --fg: var(--glass-icon-inactive, var(--g-text));
      }
      .btn.missing {
        opacity: 0.4;
      }
      .badge {
        position: absolute;
        top: -4px;
        right: -4px;
        min-width: 18px;
        height: 18px;
        padding: 0 4px;
        box-sizing: border-box;
        border-radius: 9px;
        background: var(--badge);
        color: #fff;
        font-size: 11px;
        font-weight: 700;
        display: grid;
        place-items: center;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
      }
      .badge ha-icon {
        --mdc-icon-size: 12px;
        filter: none;
      }
      .label {
        font-size: 11px;
        font-weight: 600;
        color: var(--g-text-2);
        text-shadow: var(--g-text-shadow);
        white-space: nowrap;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      /* image-full / compact: the photo edge to edge, a glass bar over it with name,
         status and buttons. Off: muted and a touch darker; at night every photo is dimmer. */
      :host([compact]) {
        height: auto;
        min-height: 0;
      }
      .tile {
        position: relative;
        height: 100%;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        transition: transform 0.25s ease;
      }
      .tile.clickable {
        cursor: pointer;
      }
      .tile.clickable:active {
        transform: scale(0.985);
      }
      /* something on: the photo in colour (an edge only if --glass-room-lit is set) */
      .tile::after {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        box-shadow: inset 0 0 0 2px var(--glass-room-lit, transparent);
        opacity: 0;
        transition: opacity 0.4s ease;
        pointer-events: none;
      }
      .tile.lit::after {
        opacity: 1;
      }
      .pic {
        background-size: cover;
        transition: filter 0.6s ease;
        filter: var(--pic-filter, none);
      }
      .pic.off {
        --pic-filter: grayscale(1) brightness(0.9);
      }
      /* night: a lit room glows warm (a little dimmed, no glare); the dark ones sink
         into the night – much darker, a cool blue-grey */
      .night .pic {
        --pic-filter: var(--glass-room-night-filter, brightness(0.82) sepia(0.14) saturate(1.08));
      }
      .night .pic.off {
        --pic-filter: var(--glass-room-night-off-filter, grayscale(1) sepia(0.3) hue-rotate(185deg) saturate(1.2) brightness(0.58));
      }
      /* and the glass on the photo goes dark too, as the side panel's */
      .night .strip,
      .night .btns {
        --glass-liquid-dark: var(--glass-room-night-glass, 0.8);
        --glass-room-strip: linear-gradient(180deg, rgba(40, 44, 56, 0.55), rgba(30, 34, 46, 0.45));
      }
      /* in a dark room the light rim (top and bottom) and the highlight would glow;
         a lit one keeps them */
      .night:not(.lit) .strip,
      .night:not(.lit) .btns {
        --glass-liquid-rim-light: var(--glass-room-night-rim, 0.12);
        --glass-liquid-specular: 0.06;
      }
      .pic.none {
        display: grid;
        place-items: center;
        color: var(--g-text-2);
        --mdc-icon-size: 30px;
      }
      .full .pic {
        position: absolute;
        inset: 0;
      }
      /* along the bottom: the glass capsule with name and status (as wide as its text),
         the buttons on their own at the right, the photo between them */
      .bar {
        position: relative;
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 8px;
      }
      .strip {
        position: relative;
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 1 1 auto;
        min-width: 0;
        /* one height for every bar and capsule, so the tile's corner can be concentric with it:
           tile radius = bar height / 2 + the 8px margin (--glass-radius: 32px) */
        height: var(--glass-room-bar-height, 48px);
        box-sizing: border-box;
        padding: 6px 6px 6px 14px;
      }
      /* split: the capsule only as wide as its text */
      .bar.split .strip {
        flex: 0 1 auto;
        padding: 6px 16px;
      }
      /* buttons: top-…: their capsule floats on the photo's top edge, the bar keeps the text */
      .topbtns {
        position: absolute;
        top: 8px;
        left: 8px;
        right: 8px;
        z-index: 1;
        display: flex;
        justify-content: center;
        pointer-events: none;
      }
      .topbtns.end {
        justify-content: flex-end;
      }
      .topbtns .btns {
        pointer-events: auto;
        /* as tall as the buttons are wide: round ends, no extra height */
        height: auto;
        padding: 4px;
      }
      .bar .btns {
        margin-left: auto;
      }
      /* the buttons, as on every room tile, on one glass capsule of their own */
      .btns {
        position: relative;
        isolation: isolate;
        flex: none;
        /* never narrower than tall: in a narrow tile the name's capsule gives way, not this one */
        min-width: var(--glass-room-bar-height, 48px);
        height: var(--glass-room-bar-height, 48px);
        box-sizing: border-box;
        display: flex;
        align-items: center;
        /* the buttons stay put on the right; a new one appears on the left */
        justify-content: flex-end;
        padding: 6px;
        border-radius: 999px;
        --glass-liquid-squircle: 0;
        --glass-icon-inactive: #fff;
        background: var(--glass-room-strip, linear-gradient(180deg, rgba(255, 255, 255, 0.5), rgba(255, 255, 255, 0.34)));
        -webkit-backdrop-filter: blur(calc(16px * var(--glass-blur-scale, 1))) saturate(170%);
        backdrop-filter: blur(calc(16px * var(--glass-blur-scale, 1))) saturate(170%);
      }
      .btns.lg-on {
        background: none;
        -webkit-backdrop-filter: none !important;
        backdrop-filter: none !important;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
      }
      /* a liquid glass bar floating over the bottom of the photo: blurred, a light
         rim on top, a softer one below */
      .full .strip {
        /* concentric with the tile by default; 999px = a capsule */
        border-radius: var(--glass-room-strip-radius, calc(var(--g-radius, 26px) - 8px));
        /* round ends, as Apple's capsules – the glass (WebGL) follows */
        corner-shape: var(--glass-room-strip-corner, round);
        --glass-liquid-squircle: var(--glass-room-strip-squircle, 0);
        background: var(--glass-room-strip, linear-gradient(180deg, rgba(255, 255, 255, 0.5), rgba(255, 255, 255, 0.34)));
        /* the WebGL glass (LiquidController) replaces this where it runs; text needs more blur than a panel */
        isolation: isolate;
        /* the same glass as the liquid dashboard's panels (defaults), only over the photo;
           white text as on liquid glass, its shadow from the glass (--glass-text-shadow) */
        --g-text: #fff;
        --g-text-2: rgba(255, 255, 255, 0.78);
        --glass-room-title-color: #fff;
        --glass-icon-inactive: #fff;
        -webkit-backdrop-filter: blur(calc(16px * var(--glass-blur-scale, 1))) saturate(170%);
        backdrop-filter: blur(calc(16px * var(--glass-blur-scale, 1))) saturate(170%);
        /* the rim as on the liquid panels: light from the top left, a hairline all round */
        box-shadow:
          inset 0 0 0 0.5px rgba(255, 255, 255, 0.5),
          inset 1.5px 2px 1px -1px rgba(255, 255, 255, 0.95),
          inset -1.5px -2px 1px -1px rgba(255, 255, 255, 0.5),
          inset 0 0 14px rgba(255, 255, 255, 0.22),
          0 4px 14px rgba(0, 0, 0, 0.12);
      }
      /* WebGL glass: the canvas paints lens, tint and rim – CSS keeps only the lift */
      .full .strip.lg-on {
        background: none;
        -webkit-backdrop-filter: none !important;
        backdrop-filter: none !important;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
      }
      .tile {
        corner-shape: var(--glass-corner-shape, round);
      }
      /* name and status on one line: "Obývací pokoj  23,1 °C · 1 světlo · TV" */
      .txt {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: baseline;
        gap: 8px;
      }
      /* status_below: name, and under it the status */
      .txt.stack {
        flex-direction: column;
        align-items: stretch;
        gap: 0;
      }
      .txt.stack .nm {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        display: block;
      }
      .txt.stack .st {
        flex: none;
        font-size: 12px;
        line-height: 1.2;
      }
      /* the name stays whole; the status gives way (…) */
      .txt .nm {
        flex: 0 1 auto;
        min-width: min-content;
      }
      .txt .st {
        flex: 1 1 0;
        min-width: 0;
      }
      .tile .nm {
        text-shadow: var(--glass-text-shadow, none);
        display: flex;
        align-items: center;
        gap: 5px;
        font-size: var(--glass-room-title-size, 15px);
        font-weight: 600;
        letter-spacing: -0.01em;
        color: var(--glass-room-title-color, var(--glass-home-icon, var(--g-text)));
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .tile .st {
        text-shadow: var(--glass-text-shadow, none);
        font-size: 13px;
        font-weight: 500;
        color: var(--g-text-2);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .tile.lit .st {
        color: var(--glass-room-lit-text, var(--g-text-2));
      }
      /* a contextual button grows out of the capsule; the capsule widens with it */
      .tile .slot.ctx {
        animation: ctx-in 460ms cubic-bezier(0.34, 1.45, 0.64, 1) both;
      }
      @keyframes ctx-in {
        from {
          transform: scale(0.2);
          opacity: 0;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .tile .slot.ctx {
          animation: none;
        }
      }
      .btn img.art {
        width: 100%;
        height: 100%;
        border-radius: 50%;
        object-fit: cover;
      }
      .tile .entities {
        --btn: var(--btn-fixed, var(--glass-room-strip-button, 36px));
        display: flex;
        gap: 6px;
        flex: none;
      }
      /* bar_tint: the bar's own colour – the WebGL glass reads it as its tint, the CSS glass layers it */
      .bar-tinted {
        --glass-panel-tint: var(--glass-bar-tint);
        --glass-panel-tint-a: var(--glass-bar-tint-a);
      }
      .strip.bar-tinted:not(.lg-on),
      .btns.bar-tinted:not(.lg-on) {
        background:
          linear-gradient(rgba(var(--glass-bar-tint), var(--glass-bar-tint-a)), rgba(var(--glass-bar-tint), var(--glass-bar-tint-a))),
          var(--glass-room-strip, linear-gradient(180deg, rgba(255, 255, 255, 0.5), rgba(255, 255, 255, 0.34)));
      }
      /* bar_glass: none – name and buttons straight on the photo, a shadow keeps them legible */
      .strip.mat-none,
      .btns.mat-none,
      .tile.cmp.mat-none {
        background: none !important;
        -webkit-backdrop-filter: none !important;
        backdrop-filter: none !important;
        box-shadow: none !important;
        border-color: transparent !important;
        --g-text-shadow: 0 1px 3px rgba(0, 0, 0, 0.55);
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.55);
      }
      /* bar_glass: solid – a smoky bar, nothing blurred behind it */
      .strip.mat-solid,
      .btns.mat-solid,
      .tile.cmp.mat-solid {
        background: var(--glass-bar-solid, rgba(28, 32, 42, 0.62)) !important;
        -webkit-backdrop-filter: none !important;
        backdrop-filter: none !important;
        box-shadow: none !important;
        border-color: transparent !important;
      }
      .strip.mat-solid.bar-tinted,
      .btns.mat-solid.bar-tinted,
      .tile.cmp.mat-solid.bar-tinted {
        background: rgba(var(--glass-bar-tint), max(var(--glass-bar-tint-a), 0.55)) !important;
      }
      /* compact on frosted glass: the capsule as the photo bars' CSS glass */
      .tile.cmp.mat-frosted {
        background: var(--glass-room-strip, linear-gradient(180deg, rgba(255, 255, 255, 0.5), rgba(255, 255, 255, 0.34))) !important;
        -webkit-backdrop-filter: blur(calc(16px * var(--glass-blur-scale, 1))) saturate(170%) !important;
        backdrop-filter: blur(calc(16px * var(--glass-blur-scale, 1))) saturate(170%) !important;
      }
      .tile.cmp.mat-frosted.bar-tinted {
        background:
          linear-gradient(rgba(var(--glass-bar-tint), var(--glass-bar-tint-a)), rgba(var(--glass-bar-tint), var(--glass-bar-tint-a))),
          var(--glass-room-strip, linear-gradient(180deg, rgba(255, 255, 255, 0.5), rgba(255, 255, 255, 0.34))) !important;
      }
      /* compact: a low tile – the photo across it, the glass bar over all but its left third */
      .tile.cmp {
        flex-direction: row;
        align-items: center;
        gap: 10px;
        height: var(--glass-room-bar-height, 48px);
        box-sizing: border-box;
        padding: 0 6px;
        border-radius: 999px;
        corner-shape: round;
        --glass-liquid-squircle: 0;
      }
      /* a narrow cell: the strip narrows with it – the name gives way (…), never spills over */
      .tile.cmp {
        min-width: 0;
        max-width: 100%;
      }
      .cmp .txt .nm {
        min-width: 0;
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .cmp .entities {
        flex: none;
      }
      .cmp .pic {
        flex: none;
        width: 36px;
        height: 36px;
        border-radius: 50%;
      }
      /* on liquid glass (WebGL): white text, as on the photo bars */
      .cmp.lg-on {
        --g-text: #fff;
        --g-text-2: rgba(255, 255, 255, 0.78);
        --glass-room-title-color: #fff;
        --glass-icon-inactive: #fff;
      }
    `,
  ];
}

registerCard("glass-room-card", GlassRoomCard, {
  name: "Glass – room",
  description: "Room icon or photo with entity buttons, custom colors, icons and animations.",
});
