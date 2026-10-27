import { tr } from "../i18n";
import { css, html, nothing } from "lit";
import { GlassElement } from "../core/glass-element";
import type { BaseCardConfig, HomeAssistant } from "../core/types";
import { registerCard } from "../core/registry";
import { makeEditor } from "../editor/editor";
import { popupHeaderSpec } from "../editor/specs";
import { control, liquidBar } from "../core/styles";
import { materials, matTint, type Material } from "../core/materials";
import { cssColor } from "../core/colors";
import { buildChildren, forward, type ChildEl, type Mode } from "../core/container";
import { resolveGlass, settings } from "../core/settings";
import { haptic, runAction } from "../core/actions";
import type { ActionConfig } from "../core/types";
import { conditionEntities, evalCondition, type Condition } from "../core/conditions";
import { POPUP_HEADER_PARTS } from "../core/card-parts";

/**
 * Header for a pop-up whose own header is hidden (Bubble Card `show_header: false`):
 * a liquid glass bar with the icon and name, any cards in the middle (e.g. a period
 * bar) and a round close button next to it. Closing removes the pop-up's #hash.
 *
 *   type: custom:glass-popup-header
 *   name: Energie
 *   icon: mdi:solar-power-variant
 *   title_width: 352px     # optional: where the cards start (cqw = % of the header's width),
 *                          #   e.g. in line with the content under a side panel
 *   buttons:               # optional: dark pill buttons on the right (like the period bar's controls)
 *     - name: Zapnout vše
 *       icon: mdi:lightbulb-group
 *       tap_action: { action: perform-action, perform_action: light.turn_on, target: { entity_id: all } }
 *       active: { entity: input_boolean.camera_1, state: "on" }   # optional: a choice – dark while
 *                                                                #   active, light otherwise
 *       align: start          # optional: in the left part, right after the name (default: right)
 *       confirm: true         # optional: ask first – the button turns into ✕ and ✓ for a few seconds
 *   close: false           # optional: no close button (e.g. a second row of buttons on a phone)
 *   bar_glass: frosted     # optional materials (core/materials), each *_color tints it:
 *   icon_glass: liquid     #   the bar, the icon's circle, the chosen / not chosen buttons
 *   buttons_glass: dark    #   (off_glass) and the close button; fonts / icons colour
 *   close_glass: liquid    #   the name and the icon
 *   cards:
 *     - type: custom:glass-period-bar
 *       offset_entity: input_number.counter_graph
 */
interface PopupHeaderConfig extends BaseCardConfig {
  name?: string;
  icon?: string;
  cards?: BaseCardConfig[];
  title_width?: string;
  close?: boolean;
  buttons?: { name?: string; icon?: string; tap_action?: ActionConfig; active?: Condition; align?: "start" | "end"; confirm?: boolean }[];
  bar_glass?: Material;
  bar_color?: string;
  icon_glass?: Material;
  icon_background?: string;
  buttons_glass?: Material;
  buttons_color?: string;
  off_glass?: Material;
  off_color?: string;
  close_glass?: Material;
  close_color?: string;
}

const has = (v?: string) => !!v && v !== "none";
/** class and style of an element with its own material (a colour alone tints the default one) */
const mat = (m: Material | undefined, color: string | undefined, fallback: Material) => {
  const k = m ?? (has(color) ? fallback : undefined);
  return k ? { cls: `mat mat-${k}`, style: matTint(has(color) ? color : undefined) } : { cls: "", style: "" };
};

// the ring of a round ✓ runs out: --left animates (@property doesn't work inside a shadow root)
try {
  CSS.registerProperty({ name: "--left", syntax: "<number>", inherits: false, initialValue: "100" });
} catch {
  /* registered already, or not supported: the ring just stays full */
}

class GlassPopupHeader extends GlassElement<PopupHeaderConfig> {
  static override wrapTile = true;
  static override parts = POPUP_HEADER_PARTS;
  static override properties = { ...GlassElement.properties, _ask: { state: true } };
  /** the button waiting for ✓ (index in `buttons`), -1 none */
  declare _ask: number;
  private _askTimer?: number;

  constructor() {
    super();
    this._ask = -1;
  }

  static getConfigElement() {
    return makeEditor(popupHeaderSpec);
  }

  static getStubConfig() {
    return { name: "Pop-up", icon: "mdi:home", cards: [] };
  }

  private _children: ChildEl[] = [];
  private _mode: Mode = settings.mode;

  protected watchedEntities(c: PopupHeaderConfig) {
    const out = new Set<string>();
    for (const b of c.buttons ?? []) conditionEntities(b.active, undefined, out);
    return out;
  }

  private _build() {
    this._children = buildChildren(this._config.cards, this._hass, {
      nested: true,
      glass: resolveGlass(settings.tile_glass ?? this._config.glass),
      mode: this._mode,
    });
  }

  override setConfig(config: PopupHeaderConfig) {
    super.setConfig(config);
    this._build();
  }

  setMode(mode: Mode) {
    if (mode === this._mode) return;
    this._mode = mode;
    if (this._config) {
      this._build();
      this.requestUpdate();
    }
  }

  protected override forwardHass(hass: HomeAssistant) {
    forward(this._children, hass);
  }

  /** As Bubble Card closes a pop-up: drop the #hash and tell the frontend the location changed. */
  private _close() {
    haptic();
    if (!location.hash) return;
    history.replaceState(history.state, "", location.href.split("#")[0]);
    window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: true } }));
  }

  private _setAsk(i: number) {
    clearTimeout(this._askTimer);
    this._ask = i;
    // not answered: back to the button after a while
    if (i >= 0) this._askTimer = window.setTimeout(() => (this._ask = -1), 5000);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    clearTimeout(this._askTimer);
    this._ask = -1;
  }

  private _buttons(list?: PopupHeaderConfig["buttons"]) {
    return (list ?? []).map((b) => {
      const i = this._config.buttons!.indexOf(b);
      if (i === this._ask) {
        const yes = (e: Event) => {
          this._setAsk(-1);
          runAction(this, this._hass, { tap_action: b.tap_action }, "tap", e.currentTarget as HTMLElement);
        };
        // same size as the button: its content stays (unseen) underneath, the answer lies on top –
        // a named pill gets ✕ and ✓, a round one is the ✓ itself (tap again; it runs out by itself)
        return html`<span class="act ask ${b.name ? "" : "round"}" aria-label=${b.name ?? ""}>
          <span class="keep" aria-hidden="true">
            ${b.icon ? html`<ha-icon .icon=${b.icon}></ha-icon>` : nothing}${b.name ? html`<span>${b.name}</span>` : nothing}
          </span>
          <span class="answer">
            ${b.name
              ? html`<button class="yn" aria-label=${tr("Cancel")} @click=${() => (haptic(), this._setAsk(-1))}>
                    <ha-icon icon="mdi:close"></ha-icon>
                  </button>
                  <button class="yn yes" aria-label=${tr("Confirm")} @click=${yes}><ha-icon icon="mdi:check"></ha-icon></button>`
              : html`<button class="yn yes whole" aria-label=${tr("Confirm")} @click=${yes}>
                  <ha-icon icon="mdi:check"></ha-icon>
                </button>`}
          </span>
        </span>`;
      }
      const off = b.active !== undefined && !!this._hass && !evalCondition(b.active, this._hass);
      const c = this._config;
      const m = off ? mat(c.off_glass, c.off_color, "home") : mat(c.buttons_glass, c.buttons_color, "dark");
      return html`<button
        class="act ${b.name ? "" : "round"} ${off ? "off" : ""} ${m.cls}"
        style=${m.style}
        aria-label=${b.name ?? b.icon ?? ""}
        @click=${(e: Event) =>
          b.confirm ? (haptic(), this._setAsk(i)) : runAction(this, this._hass, { tap_action: b.tap_action }, "tap", e.currentTarget as HTMLElement)}
      >
        ${b.icon ? html`<ha-icon .icon=${b.icon}></ha-icon>` : nothing}${b.name ? html`<span>${b.name}</span>` : nothing}
      </button>`;
    });
  }

  protected override render() {
    const c = this._config;
    if (!c) return nothing;
    const plain = !c.icon && !c.name;
    const bar = mat(c.bar_glass, c.bar_color, "frosted");
    const ico = mat(c.icon_glass, undefined, "liquid");
    const icoBg = has(c.icon_background) ? (ico.cls ? matTint(c.icon_background, 70) : `background:${cssColor(c.icon_background)};`) : "";
    const close = mat(c.close_glass, c.close_color, "frosted");
    return html`<div class="bar ${bar.cls || "lbar control"} ${plain ? "plain" : ""}" style=${bar.style}>
        ${plain
          ? nothing
          : html`<span class="title" style=${c.title_width ? `width:${c.title_width}` : ""}>
              ${c.icon
                ? html`<span class="ico ${ico.cls} ${icoBg ? "own-bg" : ""}" style=${icoBg}
                    ><ha-icon .icon=${c.icon}></ha-icon
                  ></span>`
                : nothing}
              ${c.name ? html`<span class="name">${c.name}</span>` : nothing}
            </span>`}
        <div class="mid">
          ${this._buttons(c.buttons?.filter((b) => b.align === "start"))}
          ${c.buttons?.some((b) => b.align === "start") ? html`<span class="spacer"></span>` : nothing}
          ${this._children}
          ${this._buttons(c.buttons?.filter((b) => b.align !== "start"))}
        </div>
      </div>
      ${c.close === false
        ? nothing
        : html`<button class="close ${close.cls || "lbar control"}" style=${close.style} aria-label=${tr("Close")} @click=${() => this._close()}>
            <ha-icon icon="mdi:close"></ha-icon>
          </button>`}`;
  }

  override getCardSize() {
    return 1;
  }

  static override styles = [
    GlassElement.styles,
    control,
    liquidBar,
    css`
      /* at night the header bar (and its close button) take the panels' graphite, not white smoke */
      :host([dark]) {
        --glass-bar: var(--glass-panel-bar, linear-gradient(180deg, rgba(36, 39, 47, 0.82), rgba(26, 29, 36, 0.86)));
      }
      :host {
        display: flex;
        align-items: center;
        gap: 12px;
        position: relative;
        z-index: 3;
        --h: 56px;
        /* controls inside: concentric with the bar – 10 px in from its rounded ends */
        --glass-period-btn: calc(var(--h) - 20px);
        --glass-period-inset: 10px;
        /* title_width may use cqw: a share of the header's width, like the panels under it */
        container-type: inline-size;
        /* the content starts where it did under Bubble Card's own header */
        margin-bottom: 4px;
      }
      .title {
        flex: none;
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
        /* too narrow for the buttons: the title is cut, never drawn under them */
        overflow: hidden;
      }
      .bar {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 12px;
        height: var(--h);
        padding: 0 0 0 6px;
        color: var(--glass-home-text, #1c1c1e);
      }
      .ico {
        flex: none;
        width: calc(var(--h) - 12px);
        height: calc(var(--h) - 12px);
        display: grid;
        place-items: center;
      }
      .ico ha-icon {
        --mdc-icon-size: 24px;
        display: flex;
      }
      .name {
        flex: none;
        font-size: 15px;
        font-weight: 600;
        white-space: nowrap;
      }
      /* the cards inside sit on the header's glass (they drop their own) */
      .mid {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        justify-content: flex-end;
      }
      .spacer {
        flex: 1;
      }
      /* no name or icon (a row of buttons only): the buttons share the bar evenly */
      .plain {
        padding: 0 6px;
      }
      .plain .mid {
        gap: 6px;
      }
      .plain .spacer {
        display: none;
      }
      .plain .act {
        flex: 1;
        min-width: 0;
        margin-left: 0;
        padding: 0 8px;
        justify-content: center;
      }
      .mid > :not(.act):not(.spacer) {
        flex: 1;
        min-width: 0;
      }
      /* buttons: the dark liquid glass of the period bar's controls, concentric with the bar */
      .act {
        flex: none;
        display: flex;
        align-items: center;
        gap: 7px;
        height: calc(var(--h) - 20px);
        margin-left: 6px;
        padding: 0 15px 0 12px;
        border: 0;
        border-radius: 999px;
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        color: var(--glass-home-side-text, #fff);
        background: var(--glass-control-bg);
        box-shadow: var(--glass-control-shadow);
        -webkit-backdrop-filter: var(--glass-control-backdrop, none);
        backdrop-filter: var(--glass-control-backdrop, none);
        transition: transform 0.15s ease;
      }
      /* asking first: the same pill, its content kept unseen underneath, ✕ and ✓ on top */
      .act.ask {
        position: relative;
        cursor: default;
      }
      .keep {
        display: contents;
      }
      .keep > * {
        visibility: hidden;
      }
      .answer {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 4px;
      }
      .yn {
        flex: none;
        width: calc(var(--h) - 20px);
        height: calc(var(--h) - 20px);
        padding: 0;
        border: 0;
        border-radius: 50%;
        display: grid;
        place-items: center;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        color: inherit;
        background: rgba(255, 255, 255, 0.12);
        transition: transform 0.15s ease;
      }
      .yn.yes {
        color: #fff;
        background: var(--glass-color-orange, #ff9f0a);
      }
      /* a round button is the ✓ itself, a ring running out the 5 s it waits */
      .yn.whole {
        width: 100%;
        height: 100%;
        background:
          radial-gradient(closest-side, var(--glass-color-orange, #ff9f0a) calc(100% - 3px), transparent calc(100% - 2px)),
          conic-gradient(rgba(255, 255, 255, 0.85) calc(var(--left) * 1%), rgba(255, 255, 255, 0.15) 0);
        animation: ask-left 5s linear forwards;
      }
      @keyframes ask-left {
        to {
          --left: 0;
        }
      }
      .answer:has(.whole) {
        padding: 0;
      }
      .yn:active {
        transform: scale(0.9);
      }
      .yn ha-icon {
        --mdc-icon-size: 20px;
        display: flex;
      }
      /* a choice that isn't selected: the light pill of the period bar's "now" */
      .act.off {
        color: var(--glass-home-text, #1c1c1e);
        background: var(--glass-home-control, rgba(118, 118, 128, 0.16));
        box-shadow: none;
        -webkit-backdrop-filter: none;
        backdrop-filter: none;
      }
      /* by night a choice that isn't selected stays quiet: a faint flat sheen, no edge, dimmer text */
      :host([dark]) .act.off {
        color: var(--glass-home-text-2, rgba(235, 235, 245, 0.62));
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.03));
        box-shadow: none;
      }
      .act.round {
        width: calc(var(--h) - 20px);
        padding: 0;
        justify-content: center;
      }
      .act:active {
        transform: scale(0.94);
      }
      .act ha-icon {
        --mdc-icon-size: 18px;
        display: flex;
      }
      .act:last-child {
        margin-right: 10px;
      }
      /* the left group starts a little after the name */
      .mid > .act:first-child {
        margin-left: 18px;
      }
      /* a plain bar has no name: the row sits evenly, 10 px from both ends (6 px of the bar's padding + 4) */
      .plain .mid > .act:first-child {
        margin-left: 4px;
      }
      .plain .act:last-child {
        margin-right: 10px;
      }
      .close {
        flex: none;
        width: var(--h);
        height: var(--h);
        padding: 0;
        border-radius: 50%;
        display: grid;
        place-items: center;
        cursor: pointer;
        font: inherit;
        color: var(--glass-home-text, #1c1c1e);
        -webkit-tap-highlight-color: transparent;
      }
      .close:active {
        transform: scale(0.92);
      }
      .close ha-icon {
        --mdc-icon-size: 24px;
        display: flex;
      }
      /* own materials: the shape the bar glass would give */
      .bar.mat,
      .act.mat {
        border-radius: 999px;
      }
      .close.mat,
      .ico.mat,
      .ico.own-bg {
        border-radius: 50%;
      }
      .ico.mat,
      .ico.own-bg {
        width: calc(var(--h) - 20px);
        height: calc(var(--h) - 20px);
        margin: 0 4px;
      }
      .close.mat {
        border: 0;
      }
    `,
    // after the header's own rules: a picked material replaces the default glass
    materials,
  ];
}

registerCard("glass-popup-header", GlassPopupHeader, {
  requires: "Bubble Card",
  name: "Glass – pop-up header",
  description: "Header for a pop-up with its own header hidden: icon, name, cards in the middle and a close button.",
});
