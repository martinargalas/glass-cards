import { LitElement, css, html, nothing } from "lit";
import { NAMED_COLORS } from "../core/colors";
import { t } from "./i18n";

/**
 * The colour field of every glass card's editor: the named colours as swatches plus a full RGB
 * picker (and a hex field) for any other. HA's form shows it for `selector: { glass_color: {} }`
 * – it renders `ha-selector-<type>` – and the editor puts it in place of `ui_color` /
 * `color_rgb` (GlassCardEditor._form).
 *
 *   glass_color: {}              → "blue" or "#3a7bd5"
 *   glass_color: { rgb: true }   → [58, 123, 213] (the glass tints)
 */
const PRESETS = ["primary", "accent", "red", "pink", "purple", "deep-purple", "indigo", "blue", "light-blue", "cyan", "teal", "mint", "green", "light-green", "lime", "yellow", "amber", "orange", "deep-orange", "brown", "grey", "blue-grey", "black", "white"];

const toHex = (rgb: number[]) => `#${rgb.map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("")}`;
const toRgb = (hex: string) => {
  const h = hex.replace("#", "");
  return h.length === 6 ? [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) : undefined;
};

class GlassColorSelector extends LitElement {
  static override properties = {
    hass: { attribute: false },
    selector: { attribute: false },
    value: { attribute: false },
    label: {},
    helper: {},
    disabled: { type: Boolean },
    _open: { state: true },
  };
  declare hass?: unknown;
  declare selector?: { glass_color?: { rgb?: boolean } };
  declare value?: string | number[];
  declare label?: string;
  declare helper?: string;
  declare disabled?: boolean;
  declare _open: boolean;

  constructor() {
    super();
    this._open = false;
  }

  private get _rgb() {
    return !!this.selector?.glass_color?.rgb;
  }

  /** What the value draws as, and its name when it is a preset. */
  private _shown(): { css?: string; name?: string; hex?: string } {
    const v = this.value;
    if (v === undefined || v === null || v === "" || v === "none") return {};
    if (Array.isArray(v)) {
      const hex = toHex(v);
      const name = PRESETS.find((n) => NAMED_COLORS[n]?.toLowerCase() === hex);
      return { css: hex, hex, name };
    }
    if (v === "primary" || v === "accent") return { css: `var(--${v}-color)`, name: v };
    if (NAMED_COLORS[v]) return { css: NAMED_COLORS[v], hex: NAMED_COLORS[v], name: v };
    return { css: v, hex: /^#[0-9a-f]{6}$/i.test(v) ? v : undefined };
  }

  private _set(v: string | undefined) {
    let value: string | number[] | undefined = v;
    if (v && this._rgb) {
      // the tints want numbers: theme colours have none, a name is its macOS-like default
      const hex = v.startsWith("#") ? v : NAMED_COLORS[v];
      value = hex ? toRgb(hex) : undefined;
    }
    this.value = value;
    this.dispatchEvent(new CustomEvent("value-changed", { detail: { value }, bubbles: true, composed: true }));
  }

  protected override render() {
    const cur = this._shown();
    // theme colours (primary / accent) have no RGB of their own
    const presets = this._rgb ? PRESETS.filter((n) => NAMED_COLORS[n]) : PRESETS;
    const name = cur.name ? t(colorName(cur.name)) : cur.hex ? cur.hex.toUpperCase() : t("Default");
    return html`<div class="field ${this.disabled ? "off" : ""}">
      <button class="trigger" ?disabled=${this.disabled} @click=${() => (this._open = !this._open)} aria-expanded=${this._open ? "true" : "false"}>
        <span class="lbl">${this.label ?? ""}</span>
        <span class="val"><i class="sw ${cur.css ? "" : "empty"}" style=${cur.css ? `background:${cur.css}` : ""}></i>${name}</span>
        <ha-icon .icon=${this._open ? "mdi:menu-up" : "mdi:menu-down"}></ha-icon>
      </button>
      ${this._open
        ? html`<div class="pop">
            <div class="grid">
              <button class="sw empty ${cur.css ? "" : "on"}" title=${t("Default")} @click=${() => this._set(undefined)}></button>
              ${presets.map(
                (n) => html`<button
                  class="sw ${cur.name === n ? "on" : ""}"
                  title=${t(colorName(n))}
                  style="background:${n === "primary" || n === "accent" ? `var(--${n}-color)` : NAMED_COLORS[n]}"
                  @click=${() => this._set(n)}
                ></button>`,
              )}
            </div>
            <div class="custom">
              <label class="pick ${cur.hex && !cur.name ? "on" : ""}" title=${t("Any colour")}>
                <input type="color" .value=${cur.hex ?? "#808080"} @input=${(e: Event) => this._set((e.target as HTMLInputElement).value)} />
              </label>
              <span>${t("Any colour")}</span>
              <input
                class="hex"
                placeholder="#RRGGBB"
                .value=${cur.hex && !cur.name ? cur.hex.toUpperCase() : ""}
                @change=${(e: Event) => {
                  const v = (e.target as HTMLInputElement).value.trim();
                  const hex = v.startsWith("#") ? v : `#${v}`;
                  if (!v) this._set(undefined);
                  else if (/^#[0-9a-f]{6}$/i.test(hex)) this._set(hex.toLowerCase());
                }}
              />
            </div>
          </div>`
        : nothing}
      ${this.helper ? html`<div class="helper">${this.helper}</div>` : nothing}
    </div>`;
  }

  static override styles = css`
    :host {
      display: block;
    }
    .field.off {
      opacity: 0.5;
    }
    .trigger {
      width: 100%;
      min-height: 56px;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-rows: auto auto;
      align-items: center;
      column-gap: 8px;
      padding: 6px 12px 6px 16px;
      box-sizing: border-box;
      border: 0;
      border-bottom: 1px solid var(--secondary-text-color);
      border-radius: 4px 4px 0 0;
      background: var(--mdc-text-field-fill-color, rgba(127, 127, 127, 0.08));
      color: var(--primary-text-color);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .lbl {
      grid-column: 1;
      font-size: 12px;
      color: var(--secondary-text-color);
    }
    .val {
      grid-column: 1;
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .trigger ha-icon {
      grid-column: 2;
      grid-row: 1 / span 2;
      color: var(--secondary-text-color);
    }
    .sw {
      flex: none;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.18);
      display: inline-block;
    }
    /* "default": a slashed ring */
    .sw.empty {
      background: linear-gradient(135deg, transparent 45%, var(--error-color, #db4437) 45% 55%, transparent 55%);
      box-shadow: inset 0 0 0 1px var(--divider-color, rgba(0, 0, 0, 0.3));
    }
    .pop {
      padding: 10px 4px 4px;
    }
    .grid {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .grid .sw {
      width: 26px;
      height: 26px;
      border: 0;
      padding: 0;
      cursor: pointer;
    }
    .grid .sw.on,
    .pick.on {
      outline: 2px solid var(--primary-color);
      outline-offset: 2px;
    }
    .custom {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 10px;
      font-size: 14px;
      color: var(--secondary-text-color);
    }
    /* the full picker: a rainbow ring around the browser's colour input */
    .pick {
      position: relative;
      width: 30px;
      height: 30px;
      flex: none;
      border-radius: 50%;
      background: conic-gradient(red, yellow, lime, cyan, blue, magenta, red);
      cursor: pointer;
    }
    .pick input {
      position: absolute;
      inset: 0;
      opacity: 0;
      width: 100%;
      height: 100%;
      cursor: pointer;
    }
    .hex {
      width: 90px;
      margin-left: auto;
      padding: 6px 8px;
      border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.2));
      border-radius: 6px;
      background: none;
      color: var(--primary-text-color);
      font: 13px monospace;
    }
    .helper {
      padding: 4px 16px 0;
      font-size: 12px;
      color: var(--secondary-text-color);
    }
  `;
}

/** A preset's name as the editor shows it. */
function colorName(n: string): string {
  return n.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}

if (!customElements.get("ha-selector-glass_color")) customElements.define("ha-selector-glass_color", GlassColorSelector);
