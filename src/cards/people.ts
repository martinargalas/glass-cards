import { css, html, nothing, svg } from "lit";
import { GlassElement } from "../core/glass-element";
import type { ActionConfig, BaseCardConfig, HassEntity, HomeAssistant } from "../core/types";
import { registerCard } from "../core/registry";
import { makeEditor } from "../editor/editor";
import { peopleSpec } from "../editor/specs";
import { isUnavailable } from "../core/format";
import { cssColor } from "../core/colors";
import { control, surface } from "../core/styles";
import { pressHandlers, runAction, type ActionKind } from "../core/actions";
import { LiquidController } from "../core/liquid";
import { wallpaperElement } from "../core/liquid-gl";
import { PEOPLE_PARTS } from "../core/card-parts";

/**
 * People with presence badge and phone battery.
 *
 *   type: custom:glass-people
 *   battery_style: ring        # ring (default: round avatar, battery arc) | text
 *   show_location: away        # always | away | never (ring style: never by default)
 *   people:
 *     - entity: person.martin
 *       battery: sensor.phone_battery_level
 *       battery_state: sensor.phone_battery_state
 *       driving: binary_sensor.martin_driving       # optional
 *       zone_icons: { Práce: mdi:briefcase }         # optional, else zone's own icon
 */
interface PersonConfig {
  entity: string;
  name?: string;
  picture?: string;
  battery?: string;
  battery_state?: string;
  driving?: string;
  zone_icons?: Record<string, string>;
  tap_action?: ActionConfig;
  hold_action?: ActionConfig;
}

interface PeopleConfig extends BaseCardConfig {
  people: PersonConfig[];
  size?: number;
  show_name?: boolean;
  show_location?: "always" | "away" | "never";
  show_battery?: boolean;
  /** `text` – icon + % next to the avatar; `ring` – progress ring around the avatar. */
  battery_style?: "text" | "ring";
  gap?: number;
  align?: "start" | "center" | "end";
  /** Liquid glass (WebGL) around each person even inside a panel – over the wallpaper. */
  liquid?: boolean;
}

function batteryIcon(level: number, charging: boolean): string {
  const r = Math.max(10, Math.min(100, Math.ceil(level / 10) * 10));
  const base = charging ? "mdi:battery-charging" : "mdi:battery";
  return r === 100 ? (charging ? "mdi:battery-charging-100" : "mdi:battery") : `${base}-${r}`;
}

class GlassPeople extends GlassElement<PeopleConfig> {
  static override parts = PEOPLE_PARTS;
  constructor() {
    super();
    new LiquidController(this, ".person");
  }

  private _liquid?: LiquidController;

  override setConfig(config: PeopleConfig) {
    super.setConfig(config);
    // nested in a panel the glass is the panel's; `liquid` gives each person its own lens
    if (config.liquid && !this._liquid) this._liquid = new LiquidController(this, ".person", undefined, undefined, () => wallpaperElement());
  }

  static getConfigElement() {
    return makeEditor(peopleSpec);
  }

  static getStubConfig(hass: HomeAssistant) {
    return { people: Object.keys(hass.states).filter((e) => e.startsWith("person.")).slice(0, 2).map((entity) => ({ entity })) };
  }

  protected override validateConfig(c: PeopleConfig) {
    if (!Array.isArray(c.people) || !c.people.length) throw new Error("`people` must list at least one person");
    return c;
  }

  protected watchedEntities(c: PeopleConfig) {
    return c.people.flatMap((p) => [p.entity, p.battery, p.battery_state, p.driving].filter(Boolean) as string[]);
  }

  private _zone(hass: HomeAssistant, state: string): HassEntity | undefined {
    for (const id in hass.states) {
      if (id.startsWith("zone.") && hass.states[id].attributes.friendly_name === state) return hass.states[id];
    }
    return undefined;
  }

  private _person(p: PersonConfig) {
    const hass = this._hass!;
    const st = hass.states[p.entity];
    if (!st) return html`<div class="person control missing">${p.entity}</div>`;
    const c = this._config;
    const home = st.state === "home";
    const unknown = isUnavailable(st);
    const driving = p.driving && hass.states[p.driving]?.state === "on";
    const zone = !home && st.state !== "not_home" ? this._zone(hass, st.state) : undefined;
    const badgeIcon = driving
      ? "mdi:car"
      : unknown
        ? "mdi:help"
        : home
        ? "mdi:home-variant"
        : (p.zone_icons?.[st.state] ?? zone?.attributes.icon ?? (st.state === "not_home" ? "mdi:home-export-outline" : "mdi:map-marker"));
    const badgeColor = driving ? "red" : unknown ? "gray" : home ? "blue" : "green";
    const location = hass.formatEntityState ? hass.formatEntityState(st) : st.state;
    const ringStyle = (c.battery_style ?? "ring") === "ring";
    const locMode = c.show_location ?? (ringStyle ? "never" : "away");
    const showLoc = !unknown && (locMode === "always" || (locMode === "away" && !home));

    const bat = p.battery ? hass.states[p.battery] : undefined;
    const level = bat && !isUnavailable(bat) ? Number(bat.state) : NaN;
    const chargingState = p.battery_state ? hass.states[p.battery_state]?.state?.toLowerCase() : "";
    const charging = chargingState === "charging" || chargingState === "full" || chargingState === "on";
    const batColor = level <= 20 ? "red" : level <= 40 ? "yellow" : "green";

    const picture = p.picture ?? st.attributes.entity_picture;
    const name = p.name ?? st.attributes.friendly_name ?? p.entity;
    const target = { entity: p.entity, tap_action: p.tap_action ?? { action: "more-info" }, hold_action: p.hold_action };
    const h = pressHandlers(
      () => target,
      (kind: ActionKind) => runAction(this, hass, target, kind),
    );
    const hasBattery = (c.show_battery ?? true) && !Number.isNaN(level);
    const ring = hasBattery && ringStyle;
    const showBattery = hasBattery && !ringStyle;
    const round = !(c.show_name || showLoc || showBattery);
    const size = c.size ?? 44;
    const pct = Math.max(0, Math.min(100, level));
    const tip = [name, location, hasBattery ? `${Math.round(level)} %${charging ? " ⚡" : ""}` : ""].filter(Boolean).join(" · ");

    return html`<div
      class="person control glass ${round ? "round" : ""}"
      role="button"
      title=${tip}
      tabindex="0"
      aria-label=${name}
      @pointerdown=${h.down}
      @pointermove=${h.move}
      @pointerup=${h.up}
      @pointercancel=${h.cancel}
      @keydown=${h.key}
      @contextmenu=${h.context}
    >
      <div class="avatar ${ring ? "ring" : ""} ${ring && charging ? "charging" : ""}" style=${ring ? `--ring:${cssColor(batColor)}` : ""}>
        ${ring ? (round ? this._ring(size + 7, pct, 2.5) : this._ring(size, pct)) : nothing}
        ${picture ? html`<img src=${picture} alt="" loading="lazy" />` : html`<span class="initials">${name.slice(0, 1)}</span>`}
        <span class="badge" style="--badge:${cssColor(badgeColor)}"><ha-icon .icon=${badgeIcon}></ha-icon></span>
      </div>
      ${c.show_name || showLoc || showBattery
        ? html`<div class="info">
            ${c.show_name ? html`<span class="name">${name}</span>` : nothing}
            ${showBattery
              ? html`<span class="battery"
                  ><ha-icon .icon=${batteryIcon(level, charging)} style="color:${cssColor(batColor)}"></ha-icon>${Math.round(level)}%</span
                >`
              : nothing}
            ${showLoc ? html`<span class="loc">${location}</span>` : nothing}
          </div>`
        : nothing}
    </div>`;
  }

  /**
   * Battery arc around the photo: a faint full track and a coloured arc from 12
   * o'clock, clockwise, with rounded ends – like the Apple Watch / iOS battery widget.
   */
  private _ring(size: number, pct: number, stroke?: number) {
    const sw = stroke ?? Math.max(2, Math.round(size * 0.065 * 2) / 2);
    const r = (size - sw) / 2;
    const C = 2 * Math.PI * r;
    const len = (C * pct) / 100;
    return html`<svg class="arc" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle class="track" cx=${size / 2} cy=${size / 2} r=${r} stroke-width=${sw}></circle>
      ${pct > 0
        ? svg`<circle
            class="level"
            cx=${size / 2}
            cy=${size / 2}
            r=${r}
            stroke-width=${sw}
            stroke-dasharray="${len} ${C}"
            transform="rotate(-90 ${size / 2} ${size / 2})"
          ></circle>`
        : nothing}
      ${pct > 0
        ? svg`<circle
            class="spark"
            cx=${size / 2}
            cy=${size / 2}
            r=${r}
            stroke-width=${sw}
            stroke-dasharray="${Math.min(len, C * 0.12)} ${C * 2}"
            style="--len:${len}px"
            transform="rotate(-90 ${size / 2} ${size / 2})"
          ></circle>`
        : nothing}
    </svg>`;
  }

  protected override render() {
    if (!this._config || !this._hass) return nothing;
    const c = this._config;
    return html`<div class="row ${this.tile}" style="--avatar:${c.size ?? 44}px;gap:${c.gap ?? 12}px;justify-content:${c.align ?? "end"}">
      ${c.people.map((p) => this._person(p))}
    </div>`;
  }

  static override styles = [
    GlassElement.styles,
    surface,
    control,
    css`
      :host {
        display: block;
      }
      .row {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
      }
      .person {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 5px 14px 5px 5px;
        border-radius: 999px;
      }
      /* macOS-style pill, same as the status chips */
      :host([control-glass="liquid"]) .person {
        background: var(--glass-liquid-pill, linear-gradient(180deg, rgba(255, 255, 255, 0.26), rgba(255, 255, 255, 0.1)));
        --g-base-shadow: inset 0 0.5px 0 rgba(255, 255, 255, calc(0.55 * var(--glass-edge-k, 1))), inset 0 -0.5px 0 rgba(255, 255, 255, calc(0.15 * var(--glass-edge-k, 1))), 0 1px 2px rgba(0, 0, 0, 0.08),
          0 4px 12px rgba(0, 0, 0, 0.06);
        box-shadow: var(--g-base-shadow);
      }
      @media (hover: hover) {
        :host([control-glass="liquid"]) .person:hover {
          background: var(--glass-liquid-pill-hover, linear-gradient(180deg, rgba(255, 255, 255, 0.34), rgba(255, 255, 255, 0.14)));
        }
      }
      /* own liquid lens: the canvas is the glass */
      .person {
        position: relative;
        isolation: isolate;
      }
      canvas.lg {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        border-radius: inherit;
        z-index: -1;
        pointer-events: none;
      }
      .person.lg-on {
        background: none !important;
        -webkit-backdrop-filter: none !important;
        backdrop-filter: none !important;
        border-color: transparent !important;
      }
      .person.missing {
        padding: 10px 14px;
        font-size: 12px;
      }
      /* round: just the avatar in a glass circle */
      .person.round {
        padding: 4px;
      }
      /* the presence badge sits on the ring and may stick out of the pill */
      .person {
        overflow: visible;
      }
      .avatar.ring .badge {
        right: auto;
        top: calc(14.6% - 9px);
        left: calc(85.4% - 9px);
      }
      /* round bubble: the battery arc runs just inside the bubble's own edge
         (its hairline border stays visible), the photo fills the avatar */
      .person.round .arc {
        inset: -3.5px;
        width: calc(100% + 7px);
        height: calc(100% + 7px);
      }
      .person.round .avatar.ring img,
      .person.round .avatar.ring .initials {
        --inset: 0px;
      }
      .person.round .avatar.ring .badge {
        top: calc(50% - 0.7071 * (50% + 4px) - 9px);
        left: calc(50% + 0.7071 * (50% + 4px) - 9px);
      }
      .arc {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        overflow: visible;
        pointer-events: none;
      }
      .arc circle {
        fill: none;
      }
      .arc .track {
        stroke: rgba(255, 255, 255, 0.2);
      }
      .arc .level {
        stroke: var(--ring);
        stroke-linecap: round;
        filter: drop-shadow(0 0 2px color-mix(in srgb, var(--ring) 60%, transparent));
        transition: stroke-dasharray 0.6s ease;
      }
      /* photo sits inside the arc with a thin clear gap */
      .avatar.ring img,
      .avatar.ring .initials {
        --inset: calc(var(--avatar) * 0.065 + 2.5px);
        position: absolute;
        left: var(--inset);
        top: var(--inset);
        width: calc(100% - 2 * var(--inset));
        height: calc(100% - 2 * var(--inset));
      }
      /* charging: a short bright glint travels along the filled arc, again and
         again, like current flowing into the battery */
      .arc .spark {
        display: none;
        fill: none;
        stroke: #fff;
        stroke-linecap: round;
        filter: drop-shadow(0 0 3px var(--ring)) drop-shadow(0 0 1px #fff);
      }
      .avatar.ring.charging .spark {
        display: block;
        animation: g-charge 1.8s cubic-bezier(0.45, 0, 0.25, 1) infinite;
      }
      @keyframes g-charge {
        0% {
          stroke-dashoffset: 0;
          opacity: 0;
        }
        15% {
          opacity: 0.95;
        }
        80% {
          opacity: 0.95;
        }
        100% {
          stroke-dashoffset: calc(-1 * var(--len));
          opacity: 0;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .avatar.ring.charging .spark {
          animation: none;
          display: none;
        }
      }
      .avatar {
        position: relative;
        width: var(--avatar);
        height: var(--avatar);
        flex: none;
      }
      .avatar img,
      .initials {
        width: 100%;
        height: 100%;
        border-radius: 50%;
        object-fit: cover;
        display: grid;
        place-items: center;
        box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);
      }
      .initials {
        background: rgba(255, 255, 255, 0.25);
        font-weight: 600;
        font-size: calc(var(--avatar) * 0.42);
      }
      .badge {
        position: absolute;
        right: -3px;
        top: -3px;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: var(--badge);
        display: grid;
        place-items: center;
        box-shadow:
          0 0 0 2px rgba(255, 255, 255, 0.85),
          0 2px 6px rgba(0, 0, 0, 0.25);
      }
      .badge ha-icon {
        --mdc-icon-size: 11px;
        color: #fff;
        filter: none;
        display: flex;
      }
      .info {
        display: flex;
        flex-direction: column;
        gap: 1px;
        font-size: 12.5px;
        font-weight: 600;
        text-shadow: var(--g-text-shadow);
        white-space: nowrap;
      }
      .name {
        font-size: 13px;
      }
      .battery {
        display: inline-flex;
        align-items: center;
        gap: 2px;
      }
      .battery ha-icon {
        --mdc-icon-size: 16px;
        display: flex;
      }
      .loc {
        font-weight: 500;
        color: var(--g-text-2);
        max-width: 120px;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    `,
  ];
}

registerCard("glass-people", GlassPeople, {
  name: "Glass – people",
  description: "Avatar, location and phone battery for each person.",
});
