import { tr } from "../i18n";
import { css, html, nothing } from "lit";
import { GlassElement } from "../core/glass-element";
import type { BaseCardConfig } from "../core/types";
import { registerCard } from "../core/registry";
import { makeEditor } from "../editor/editor";
import { periodBarSpec } from "../editor/specs";
import { control, liquidBar } from "../core/styles";
import { haptic } from "../core/actions";
import { language } from "../core/settings";
import { PERIOD_PARTS } from "../core/card-parts";
import { materials, matTint, type Material } from "../core/materials";
import { onSelected } from "../core/select";
import { kindName, periodGroup, periodLabel, readPeriod, usesHelpers, writePeriod, type PeriodKind, type PeriodSource } from "../core/period";

/**
 * Period navigation for charts, as one liquid glass bar: ‹ › step back and forth,
 * "now" jumps to the current period, and on the right the period kind (day / month /
 * year) as a drop-down next to the period's name.
 *
 * Without helpers it keeps the period itself (per browser tab, core/period) and charts
 * follow it with glass-chart (`period: true`):
 *
 *   type: custom:glass-period-bar
 *   periods: [day, month, year]   # the drop-down: day | week | month | year (default day, month, year)
 *   group: energy                 # optional: several independent bars on one screen
 *
 * With Home Assistant helpers, for automations and templates that follow the period:
 *
 *   type: custom:glass-period-bar
 *   offset_entity: input_number.counter_graph    # 0 = now, −1 = the one before … (‹ −1, › +1)
 *   select_entity: input_select.graph_day_month_year   # the drop-down; options named Day / Month / Year (Den / Měsíc / Rok …)
 *   kinds: { Dny: day }                           # optional: options whose names aren't recognised
 *   label_entity: input_text.period_name          # optional: what is shown; default the period's name
 *                                                 #   ("Pondělí 27.10.", "Říjen"; short "Po 27.10." when compact / narrow)
 *   current_entity: input_boolean.switch_current  # optional: on with "now", off with ‹ ›
 *   now_label: Aktuálně
 *   compact: true          # phones: smaller controls
 *   spread: true           # "now" at the left edge, the kind at the right, ‹ the period › centred between
 *   parts: [now]           # only some of it: now | nav | kind (e.g. "now" in a pop-up header,
 *                          #   ‹ › and the kind in a second bar under it); default all
 */
interface PeriodBarConfig extends BaseCardConfig, PeriodSource {
  /** own materials (core/materials), *_color tints them: the bar, the arrows / drop-down / "now"
   *  while current (buttons_*), "now" otherwise (now_*) */
  bar_glass?: Material;
  bar_color?: string;
  buttons_glass?: Material;
  buttons_color?: string;
  now_glass?: Material;
  now_color?: string;
  periods?: PeriodKind[];
  label_entity?: string;
  current_entity?: string;
  now_label?: string;
  compact?: boolean;
  spread?: boolean;
  parts?: ("now" | "nav" | "kind")[];
}

const hasColor = (v?: string) => !!v && v !== "none";
/** An element's own material (a colour alone tints the default one). */
function part(m: Material | undefined, color: string | undefined, def: Material) {
  const use = m ?? (hasColor(color) ? def : undefined);
  return use ? { cls: `mat mat-${use}`, style: hasColor(color) ? matTint(color) : "--mat-tint:initial;--mat-tinted:initial;--mat-sheen:initial" } : { cls: "", style: "" };
}

class GlassPeriodBar extends GlassElement<PeriodBarConfig> {
  static override wrapTile = true;
  static override parts = PERIOD_PARTS;
  static override properties = { ...GlassElement.properties, _open: { state: true }, _hit: { state: true } };
  declare _open: boolean;
  /** The arrow just pressed, lit for a moment (touch screens show no :active). */
  declare _hit?: 1 | -1;
  private _hitTimer?: number;
  private _btn?: { cls: string; style: string };
  private _unsub?: () => void;

  static getConfigElement() {
    return makeEditor(periodBarSpec);
  }

  static getStubConfig() {
    return { periods: ["day", "month", "year"] };
  }

  constructor() {
    super();
    this._open = false;
  }

  protected override validateConfig(c: PeriodBarConfig) {
    this._unsub?.();
    this._unsub = usesHelpers(c) ? undefined : onSelected(periodGroup(c), () => this.requestUpdate());
    return c;
  }

  override connectedCallback() {
    super.connectedCallback();
    if (this._config && !usesHelpers(this._config) && !this._unsub) this._unsub = onSelected(periodGroup(this._config), () => this.requestUpdate());
  }

  protected override updated(changed: Map<string, unknown>) {
    super.updated(changed);
    this.toggleAttribute("compact", !!this._config?.compact);
  }

  protected watchedEntities(c: PeriodBarConfig) {
    return [c.offset_entity, c.select_entity, c.label_entity, c.current_entity].filter(Boolean) as string[];
  }

  /** The drop-down closes on a press anywhere else. */
  private _outside = (e: Event) => {
    if (!e.composedPath().includes(this)) this._toggle(false);
  };

  private _toggle(open = !this._open) {
    this._open = open;
    if (open) document.addEventListener("pointerdown", this._outside, true);
    else document.removeEventListener("pointerdown", this._outside, true);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._unsub?.();
    this._unsub = undefined;
    this._toggle(false);
    clearTimeout(this._hitTimer);
  }

  private _call(domain: string, service: string, data: Record<string, unknown>) {
    return this._hass!.callService(domain, service, data);
  }

  private _step(dir: 1 | -1) {
    const c = this._config;
    haptic();
    this._hit = dir;
    clearTimeout(this._hitTimer);
    this._hitTimer = window.setTimeout(() => (this._hit = undefined), 260);
    if (!usesHelpers(c)) {
      const p = readPeriod(this._hass, c, this._periods);
      return writePeriod(c, { ...p, offset: p.offset + dir });
    }
    this._call("input_number", dir > 0 ? "increment" : "decrement", { entity_id: c.offset_entity });
    if (c.current_entity) this._call("input_boolean", "turn_off", { entity_id: c.current_entity });
  }

  private _now() {
    const c = this._config;
    haptic();
    if (!usesHelpers(c)) return writePeriod(c, { ...readPeriod(this._hass, c, this._periods), offset: 0 });
    const st = this._hass!.states[c.offset_entity!];
    this._call("input_number", "set_value", { entity_id: c.offset_entity, value: Number(st?.attributes.max ?? 0) });
    if (c.current_entity) this._call("input_boolean", "turn_on", { entity_id: c.current_entity });
  }

  private _pick(option: string) {
    haptic("selection");
    this._toggle(false);
    if (!usesHelpers(this._config)) return writePeriod(this._config, { kind: option as PeriodKind, offset: 0 });
    this._call("input_select", "select_option", { entity_id: this._config.select_entity, option });
  }

  /** Without helpers: the kinds in the drop-down. */
  private get _periods(): PeriodKind[] {
    return this._config.periods?.length ? this._config.periods : ["day", "month", "year"];
  }

  protected override render() {
    const c = this._config;
    const hass = this._hass;
    if (!c || !hass) return nothing;
    const lang = language(hass);
    const cs = lang.startsWith("cs");
    const helpers = usesHelpers(c);
    const period = readPeriod(hass, c, this._periods);
    const off = helpers ? hass.states[c.offset_entity!] : undefined;
    const value = helpers ? Number(off?.state) : period.offset;
    const min = Number(off?.attributes.min ?? -Infinity);
    const max = Number(off?.attributes.max ?? 0);
    const atNow = value >= max;
    // the drop-down: the input_select's options, or the kinds by name
    const sel = c.select_entity ? hass.states[c.select_entity] : undefined;
    const options: [string, string][] = helpers
      ? ((sel?.attributes.options as string[] | undefined) ?? []).map((o) => [o, o])
      : this._periods.map((k) => [k, kindName(k, lang)]);
    const current = helpers ? sel?.state : period.kind;
    // own name: a long and a short one, the bar shows the one that fits (CSS below)
    const own = c.label_entity ? hass.states[c.label_entity]?.state : undefined;
    const label = own ?? html`<span class="long">${periodLabel(period, lang)}</span><span class="short">${periodLabel(period, lang, true)}</span>`;
    const parts = c.parts?.length ? c.parts : ["now", "nav", "kind"];
    const has = (p: "now" | "nav" | "kind") => parts.includes(p);
    // a calendar's navigator: now, ‹ the period ›, and its kind as a drop-down – right-aligned
    const gap = html`<span class="gap"></span>`;
    const bar = part(c.bar_glass, c.bar_color, "frosted");
    const btn = part(c.buttons_glass, c.buttons_color, "dark");
    const nowMat = atNow ? btn : part(c.now_glass, c.now_color, "home");
    this._btn = btn;
    return html`<div class="bar lbar ${bar.cls || "control"} ${c.spread ? "spread" : ""}" style=${bar.style}>
        ${c.spread ? nothing : gap}
        ${has("now")
          ? html`<button class="now ${atNow ? "on" : ""} ${nowMat.cls}" style=${nowMat.style} aria-label=${c.now_label ?? (tr("Now"))} @click=${() => this._now()}>
              <span class="now-text">${c.now_label ?? (tr("Now"))}</span><ha-icon class="now-icon" icon="mdi:calendar-today"></ha-icon>
            </button>`
          : nothing}
        ${c.spread ? gap : nothing}
        ${has("nav") ? this._nav(value, min, atNow, label, cs) : nothing}
        ${c.spread ? gap : nothing}
        ${options.length > 1 && has("kind")
          ? html`<button
              class="drop ${this._open ? "open" : ""} ${btn.cls}"
              style=${btn.style}
              aria-label=${tr("Choose period")}
              aria-haspopup="listbox"
              aria-expanded=${this._open ? "true" : "false"}
              @click=${() => this._toggle()}
            >
              <span>${options.find(([id]) => id === current)?.[1] ?? current}</span><ha-icon icon="mdi:chevron-down"></ha-icon>
            </button>`
          : nothing}
      </div>
      ${this._menu(options, current)}`;
  }

  /** ‹ the period's name › */
  private _nav(value: number, min: number, atNow: boolean, label: unknown, cs: boolean) {
    const btn = this._btn ?? { cls: "", style: "" };
    return html`<button class="nav ${this._hit === -1 ? "hit" : ""} ${btn.cls}" style=${btn.style} aria-label=${tr("Previous")} ?disabled=${!(value > min)} @click=${() => this._step(-1)}>
          <ha-icon icon="mdi:chevron-left"></ha-icon>
        </button>
        ${label ? html`<span class="label">${label}</span>` : nothing}
        <button class="nav ${this._hit === 1 ? "hit" : ""} ${btn.cls}" style=${btn.style} aria-label=${tr("Next")} ?disabled=${atNow} @click=${() => this._step(1)}>
          <ha-icon icon="mdi:chevron-right"></ha-icon>
        </button>`;
  }

  private _menu(options: [string, string][], current: string | undefined) {
    return html`${this._open && options.length
        ? html`<div class="menu" role="listbox">
            ${options.map(
              ([o, name]) =>
                html`<button role="option" aria-selected=${o === current ? "true" : "false"} class=${o === current ? "cur" : ""} @click=${() => this._pick(o)}>
                  <span>${name}</span>${o === current ? html`<ha-icon icon="mdi:check"></ha-icon>` : nothing}
                </button>`,
            )}
          </div>`
        : nothing}`;
  }

  override getCardSize() {
    return 1;
  }

  static override styles = [
    GlassElement.styles,
    control,
    liquidBar,
    css`
      :host {
        display: block;
        position: relative;
        z-index: 3;
        /* a header around the bar may size the controls to its own height */
        --btn: var(--glass-period-btn, 40px);
      }
      /* phones: smaller controls */
      /* "now" is text; only where the bar is too narrow for it (small phones) a calendar icon */
      :host {
        container-type: inline-size;
      }
      .now-icon {
        display: none;
        --mdc-icon-size: 20px;
      }
      @container (max-width: 379px) {
        .bar .now.now {
          width: var(--btn);
          padding: 0;
          display: grid;
          place-items: center;
        }
        .now-text {
          display: none;
        }
        .now-icon {
          display: flex;
        }
      }
      :host([compact]) {
        --btn: var(--glass-period-btn, 36px);
        --glass-period-label-width: 98px;
        --glass-period-kind-width: 84px;
      }
      :host([compact]) .bar {
        gap: 3px;
      }
      :host([compact]) .drop {
        margin-left: 3px;
      }
      .bar {
        display: flex;
        align-items: center;
        gap: 4px;
        height: calc(var(--btn) + 12px);
        padding: 0 var(--glass-period-inset, 6px);
        color: var(--glass-home-text, #1c1c1e);
      }
      /* inside a glass panel: the panel is the bar's glass – only the controls on it */
      /* own materials: the bar's / buttons' shapes */
      .bar.mat,
      .now.mat,
      .drop.mat {
        border-radius: 999px;
      }
      .nav.mat {
        border-radius: 50%;
      }
      :host([control-glass][nested]:not([on-bare])) .bar.lbar.control {
        border: 0 !important;
        background: none !important;
        box-shadow: none !important;
        -webkit-backdrop-filter: none;
        backdrop-filter: none;
      }
      button {
        font: inherit;
        color: inherit;
        border: 0;
        padding: 0;
        background: none;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        transition:
          transform 0.15s ease,
          background 0.2s ease,
          opacity 0.2s ease;
      }
      button:active {
        transform: scale(0.92);
      }
      ha-icon {
        display: flex;
        --mdc-icon-size: 22px;
      }
      /* the arrows and the drop-down: dark liquid glass, like the thermostat's − / + */
      .nav:not(.mat),
      .drop:not(.mat) {
        color: var(--glass-home-side-text, #fff);
        background: var(--glass-control-bg);
        box-shadow: var(--glass-control-shadow);
        -webkit-backdrop-filter: var(--glass-control-backdrop, none);
        backdrop-filter: var(--glass-control-backdrop, none);
      }
      .nav {
        /* round at any width: on a narrow phone the label gives way, not the arrows */
        flex: none;
        width: var(--btn);
        height: var(--btn);
        border-radius: 50%;
        display: grid;
        place-items: center;
      }
      /* pressed: lighter and a small bump, held a moment so a tap is seen */
      .nav.hit,
      .nav:not(:disabled):active {
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.3), rgba(255, 255, 255, 0.1) 60%),
          rgba(var(--glass-home-side-rgb, 22, 30, 46), 0.5);
        transform: scale(0.88);
      }
      .nav:disabled {
        opacity: 0.3;
        cursor: default;
        transform: none;
      }
      /* "now": a quiet pill, dark while the current period is shown */
      .now {
        height: var(--btn);
        margin-right: 6px;
        padding: 0 16px;
        border-radius: 999px;
        font-size: 14px;
        font-weight: 600;
      }
      .now:not(.mat) {
        background: var(--glass-home-control, rgba(118, 118, 128, 0.16));
      }
      /* the current period: the dark glass of the arrows and the drop-down */
      .now.on:not(.mat) {
        color: var(--glass-home-side-text, #fff);
        background: var(--glass-control-bg);
        box-shadow: var(--glass-control-shadow);
        -webkit-backdrop-filter: var(--glass-control-backdrop, none);
        backdrop-filter: var(--glass-control-backdrop, none);
      }
      .gap {
        flex: 1;
      }
      /* spread: the margins are the gaps' job; "now" as wide as the kind, so it is symmetric */
      .bar.spread .now {
        margin-right: 0;
        width: var(--glass-period-kind-width, 104px);
        padding: 0;
      }
      .bar.spread .drop {
        margin-left: 0;
      }
      /* the period's name between the arrows, wide enough that they don't jump */
      .label .short {
        display: none;
      }
      :host([compact]) .label .long {
        display: none;
      }
      :host([compact]) .label .short {
        display: inline;
      }
      @container (max-width: 379px) {
        .label .long {
          display: none;
        }
        .label .short {
          display: inline;
        }
      }
      .label {
        flex: 0 1 var(--glass-period-label-width, 132px);
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        padding: 0 4px;
        text-align: center;
        font-size: 14px;
        font-weight: 600;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      /* the kind of period, as a drop-down pill */
      /* fixed widths: switching day / month / year never moves the other controls */
      .drop {
        flex: none;
        width: var(--glass-period-kind-width, 104px);
        box-sizing: border-box;
        justify-content: center;
        display: flex;
        align-items: center;
        gap: 4px;
        height: var(--btn);
        margin-left: 6px;
        padding: 0 8px 0 12px;
        border-radius: 999px;
        font-size: 14px;
        font-weight: 600;
      }
      .drop ha-icon {
        --mdc-icon-size: 20px;
      }
      .drop ha-icon {
        transition: transform 0.25s ease;
      }
      .drop.open ha-icon {
        transform: rotate(180deg);
      }
      .menu {
        position: absolute;
        top: calc(100% + 8px);
        right: 0;
        min-width: 180px;
        padding: 6px;
        border-radius: 22px;
        display: flex;
        flex-direction: column;
        gap: 2px;
        color: var(--glass-home-text, #1c1c1e);
        background: var(--glass-home-fill, linear-gradient(var(--glass-home-surface, rgba(246, 246, 248, 0.86)), var(--glass-home-surface, rgba(246, 246, 248, 0.86))));
        border: 0.5px solid var(--glass-home-border, rgba(255, 255, 255, 0.35));
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
        -webkit-backdrop-filter: blur(calc(24px * var(--glass-blur-scale, 1))) saturate(160%);
        backdrop-filter: blur(calc(24px * var(--glass-blur-scale, 1))) saturate(160%);
        animation: pb-in 0.18s ease-out;
        transform-origin: top right;
      }
      @keyframes pb-in {
        from {
          opacity: 0;
          transform: scale(0.94) translateY(-4px);
        }
      }
      .menu button {
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: 40px;
        padding: 0 14px;
        border-radius: 16px;
        font-size: 14px;
        font-weight: 500;
        text-align: left;
      }
      .menu button:hover {
        background: var(--glass-home-control, rgba(118, 118, 128, 0.12));
      }
      .menu button.cur {
        font-weight: 600;
        color: var(--glass-color-blue, #0a84ff);
      }
      .menu ha-icon {
        --mdc-icon-size: 18px;
      }
    `,
    materials,
  ];
}

registerCard("glass-period-bar", GlassPeriodBar, {
  name: "Glass – period bar",
  description: "Back / forward / now and a day–month–year drop-down for charts, in one liquid glass bar.",
});
