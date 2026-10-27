import { tr } from "../i18n";
import { LitElement, css, html, nothing } from "lit";
import type { ActionConfig, HomeAssistant } from "./types";
import { evalCondition } from "./conditions";
import { cssColor, tint } from "./colors";
import { runAction } from "./actions";

/**
 * Radial action menu (built-in replacement for honeycomb-menu).
 *
 *   tap_action:
 *     action: menu
 *     items:
 *       - icon: mdi:window-shutter-open
 *         name: Otevřít
 *         tap_action: { action: perform-action, perform_action: script.open_blinds_office }
 *         active: { state: open }        # optional highlight condition
 *       - icon: mdi:numeric-1-box
 *         perform_action: script.tilt_blinds_office_min     # shorthand
 *       - icon: mdi:timer-pause-outline                       # a pause: a ring shows the time left
 *         perform_action: switch.toggle
 *         target: { entity_id: switch.office_blinds_user_switch }
 *         countdown: { entity: switch.office_blinds_user_switch, duration: 3600 }   # s, from its last change
 */
export interface MenuItem {
  icon: string;
  name?: string;
  entity?: string;
  color?: string;
  active?: Record<string, any>;
  /** shown only while this holds – e.g. "turn all off" while something is on, "turn all on" otherwise */
  visible?: Record<string, any>;
  tap_action?: ActionConfig;
  perform_action?: string;
  data?: Record<string, unknown>;
  target?: Record<string, unknown>;
  /** while `entity` is in `state` (default "on"): a ring around the icon empties over `duration` s from its last change */
  countdown?: { entity: string; state?: string; duration: number };
}

class GlassActionMenu extends LitElement {
  static override properties = { _open: { state: true }, _ready: { state: true } };
  declare _open: boolean;
  /** False while the click that opened the menu is still being delivered. */
  declare _ready: boolean;
  host?: HTMLElement;
  hass?: HomeAssistant;
  entity?: string;
  items: MenuItem[] = [];
  cx = 0;
  cy = 0;
  radius = 0;
  /** the items' names under their icons (`labels: true` on the menu action) */
  labels = false;
  /** The pressed button, mirrored in the centre so the menu grows out of it. */
  center?: { icon?: string; size: number; bg?: string };

  constructor() {
    super();
    this._open = false;
    this._ready = false;
  }

  override connectedCallback() {
    super.connectedCallback();
    requestAnimationFrame(() => (this._open = true));
    // The opening tap still produces a `click` right after pointerup; it would land
    // on the centre button (closing the menu) or on an item. Ignore input briefly.
    setTimeout(() => (this._ready = true), 350);
    window.addEventListener("keydown", this._onKey);
    if (this.items.some((i) => i.countdown)) this._tick = window.setInterval(() => this.requestUpdate(), 1000);
  }

  private _tick?: number;

  /** 0–1 of a countdown still to go, undefined when it isn't running */
  private _left(item: MenuItem): number | undefined {
    const c = item.countdown;
    const st = c && this.hass?.states[c.entity];
    if (!c || !st || st.state !== (c.state ?? "on") || !(c.duration > 0)) return undefined;
    const gone = (Date.now() - new Date(st.last_changed).getTime()) / 1000;
    return Math.min(1, Math.max(0, 1 - gone / c.duration));
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this._onKey);
    clearInterval(this._tick);
  }

  private _onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") this.close();
  };

  close() {
    this._open = false;
    setTimeout(() => this.remove(), 220);
  }

  private _run(item: MenuItem) {
    const tap: ActionConfig = item.tap_action ?? {
      action: "perform-action",
      perform_action: item.perform_action,
      data: item.data,
      target: item.target,
    };
    if (this.host) runAction(this.host, this.hass, { entity: item.entity ?? this.entity, tap_action: tap }, "tap");
    this.close();
  }

  /**
   * Item angles: the same half ring above the anchor (left → over the top → right)
   * wherever it fits. Near a screen edge the ring turns away from it – a quarter
   * turn at a side edge, upside down at the top – so no item ends up off screen.
   * More than 5 items widen the arc.
   */
  private _angles(n: number, r: number): number[] {
    const span = n === 1 ? 0 : Math.min(300, 180 + Math.max(0, n - 5) * 30);
    const ring = (mid: number) => Array.from({ length: n }, (_, i) => (n === 1 ? mid : mid - span / 2 + (span / (n - 1)) * i));
    const m = 34; // half an item + a little air
    const W = window.innerWidth;
    const H = window.innerHeight;
    const fits = (angles: number[]) =>
      angles.every((deg) => {
        const a = (deg * Math.PI) / 180;
        const x = this.cx + Math.cos(a) * r;
        const y = this.cy + Math.sin(a) * r;
        return x - m >= 0 && x + m <= W && y - m >= 0 && y + m <= H;
      });
    // up, then turned away from a side edge (up-right / up-left, right / left), then down
    const tries = [-90, this.cx < W / 2 ? -45 : -135, this.cx < W / 2 ? 0 : 180, this.cx < W / 2 ? 45 : 135, 90];
    for (const mid of tries) {
      const angles = ring(mid);
      if (fits(angles)) return angles;
    }
    return ring(this.cy < H / 2 ? 90 : -90);
  }

  /** the items whose `visible` holds now */
  private get _shown(): MenuItem[] {
    return this.items.filter((it) => !it.visible || !this.hass || evalCondition(it.visible, this.hass, it.entity ?? this.entity));
  }

  override render() {
    const shown = this._shown;
    const n = shown.length;
    const size = this.center?.size ?? 52;
    const r = this.radius || Math.max(size + 26, 80 + Math.max(0, n - 5) * 7);
    const angles = this._angles(n, r);
    return html`
      <div class="scrim ${this._open ? "open" : ""} ${this._ready ? "ready" : ""}" @pointerdown=${() => this._ready && this.close()}></div>
      <div class="center ${this._open ? "open" : ""} ${this._ready ? "ready" : ""}" style="left:${this.cx}px;top:${this.cy}px;--size:${size}px">
        ${this.center
          ? html`<button class="ghost" style=${this.center.bg ? `--bg:${this.center.bg}` : ""} aria-label=${tr("Close")} @click=${() => this.close()}>
              ${this.center.icon ? html`<ha-icon .icon=${this.center.icon}></ha-icon>` : nothing}
            </button>`
          : nothing}
        ${shown.map((item, i) => {
          const a = (angles[i] * Math.PI) / 180;
          const x = Math.cos(a) * r;
          const y = Math.sin(a) * r;
          const active = item.active && this.hass ? evalCondition(item.active, this.hass, item.entity ?? this.entity) : false;
          const col = item.color ?? "blue";
          const left = this._left(item);
          return html`<button
            class="item ${active ? "active" : ""}"
            style="--x:${x}px;--y:${y}px;--d:${i * 25}ms;${active ? `--bg:${tint(col)};--glow:${cssColor(col)}` : ""}"
            title=${item.name ?? nothing}
            aria-label=${item.name ?? item.icon}
            @click=${() => this._run(item)}
          >
            <ha-icon .icon=${item.icon}></ha-icon>
            ${this.labels && item.name ? html`<span class="cap">${item.name}</span>` : nothing}
            ${left !== undefined
              ? html`<svg class="ring" viewBox="0 0 36 36" aria-hidden="true">
                  <circle cx="18" cy="18" r="16.5" pathLength="100"></circle>
                  <circle class="left" cx="18" cy="18" r="16.5" pathLength="100" style="stroke-dasharray:${left * 100} 100"></circle>
                </svg>`
              : nothing}
          </button>`;
        })}
      </div>
    `;
  }

  static override styles = css`
    :host {
      position: fixed;
      inset: 0;
      z-index: 9999;
    }
    .scrim {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0);
      transition: background 0.2s ease;
    }
    .scrim.open {
      background: rgba(0, 0, 0, 0.2);
    }
    .center {
      position: absolute;
      width: 0;
      height: 0;
    }
    .center:not(.ready) {
      pointer-events: none;
    }
    .ghost,
    .item {
      position: absolute;
      left: calc(var(--size) / -2);
      top: calc(var(--size) / -2);
      width: var(--size);
      height: var(--size);
      border-radius: 50%;
      border: 1px solid var(--glass-border, rgba(255, 255, 255, 0.35));
      background: var(--bg, var(--glass-menu-surface, rgba(255, 255, 255, 0.34)));
      -webkit-backdrop-filter: blur(calc(18px * var(--glass-blur-scale, 1))) saturate(170%);
      backdrop-filter: blur(calc(18px * var(--glass-blur-scale, 1))) saturate(170%);
      box-shadow:
        0 10px 24px rgba(0, 0, 0, 0.18),
        inset 0 1px 1px rgba(255, 255, 255, 0.45);
      color: var(--glass-text, #fff);
      display: grid;
      place-items: center;
      cursor: pointer;
      transform: translate(0, 0) scale(0.3);
      opacity: 0;
      transition:
        transform 0.32s cubic-bezier(0.2, 1.4, 0.4, 1) var(--d),
        opacity 0.18s ease var(--d);
      -webkit-tap-highlight-color: transparent;
    }
    /* labels: the name under the icon */
    .cap {
      position: absolute;
      top: calc(100% + 4px);
      left: 50%;
      transform: translateX(-50%);
      font-size: 11.5px;
      font-weight: 600;
      white-space: nowrap;
      color: #fff;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
      pointer-events: none;
    }
    /* a pause's time left: a ring along the edge, emptying clockwise from the top */
    .ring {
      position: absolute;
      inset: 1px;
      width: calc(100% - 2px);
      height: calc(100% - 2px);
      transform: rotate(-90deg);
      pointer-events: none;
      fill: none;
      stroke-width: 2.5;
    }
    .ring circle {
      stroke: rgba(255, 255, 255, 0.18);
    }
    .ring .left {
      stroke: var(--glass-color-orange, #ff9f0a);
      stroke-linecap: round;
      transition: stroke-dasharray 1s linear;
    }
    .ghost {
      opacity: 1;
      transform: scale(1.08);
      transition: transform 0.25s ease;
      box-shadow:
        0 10px 28px rgba(0, 0, 0, 0.25),
        0 0 0 4px rgba(255, 255, 255, 0.25),
        inset 0 1px 1px rgba(255, 255, 255, 0.45);
    }
    .open .item {
      transform: translate(var(--x), var(--y)) scale(1);
      opacity: 1;
    }
    .item:active {
      transform: translate(var(--x), var(--y)) scale(0.92);
    }
    .item.active {
      box-shadow:
        0 6px 18px color-mix(in srgb, var(--glow) 45%, transparent),
        inset 0 1px 1px rgba(255, 255, 255, 0.45);
    }
    ha-icon {
      --mdc-icon-size: 26px;
      filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.35));
    }
  `;
}

if (!customElements.get("glass-action-menu")) customElements.define("glass-action-menu", GlassActionMenu);

export function openMenu(host: HTMLElement, hass: HomeAssistant, action: ActionConfig, entity?: string, anchor?: HTMLElement) {
  document.querySelectorAll("glass-action-menu").forEach((m) => (m as GlassActionMenu).close());
  const el = anchor ?? host;
  const r = el.getBoundingClientRect();
  const menu = document.createElement("glass-action-menu") as GlassActionMenu;
  menu.host = host;
  menu.hass = hass;
  menu.entity = entity;
  menu.items = (action.items ?? []) as MenuItem[];
  if (action.radius) menu.radius = Number(action.radius);
  menu.labels = !!action.labels;
  if (anchor) {
    const icon = (anchor.querySelector("ha-icon") as (HTMLElement & { icon?: string }) | null)?.icon;
    const bg = anchor.style.getPropertyValue("--bg") || undefined;
    // the items take the button's size – but never smaller than a finger (small strip buttons)
    menu.center = { icon, size: Math.max(52, Math.round(r.width)), bg };
  }
  menu.cx = r.left + r.width / 2;
  menu.cy = r.top + r.height / 2;
  document.body.appendChild(menu);
}
