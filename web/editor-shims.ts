// Home Assistant's editor elements, as far as Dashboard Studio needs them, for the web demo:
// <ha-form> with the selectors the glass cards' settings use, <ha-expansion-panel>,
// <ha-switch>, <ha-yaml-editor> – and a YAML editor where HA would give another card's
// own editor. Plain and light: the studio is real, its form fields are stand-ins.
import { LitElement, css, html, nothing } from "lit";
import { parse, stringify } from "yaml";

type Schema = Record<string, any>;
type Data = Record<string, any>;

const fire = (el: HTMLElement, value: unknown, extra: Record<string, unknown> = {}) =>
  el.dispatchEvent(new CustomEvent("value-changed", { detail: { value, ...extra }, bubbles: true, composed: true }));

const field = css`
  :host { display: block; font: 14px/1.4 Roboto, system-ui, sans-serif; color: var(--primary-text-color, #1c1c1e); }
  label { display: block; }
  .lbl { display: block; font-size: 12px; color: var(--secondary-text-color, #6b6f7a); margin: 0 0 4px 2px; }
  .help { display: block; font-size: 11.5px; color: var(--secondary-text-color, #6b6f7a); margin: 4px 2px 0; line-height: 1.35; }
  input, select, textarea { box-sizing: border-box; width: 100%; font: inherit; color: inherit; padding: 9px 11px; border-radius: 10px;
    border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.14)); background: var(--input-fill-color, rgba(127, 127, 127, 0.08)); outline: none; }
  input:focus, select:focus, textarea:focus { border-color: var(--primary-color, #0a84ff); }
  textarea { font: 12.5px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; min-height: 120px; resize: vertical; }
  .row { display: flex; align-items: center; gap: 10px; min-height: 40px; }
  .row input[type="checkbox"] { width: 18px; height: 18px; accent-color: var(--primary-color, #0a84ff); }
`;

/** One selector: the input that fits it. */
class ShimSelector extends LitElement {
  static properties = { schema: { attribute: false }, value: { attribute: false }, label: {}, helper: {}, hass: { attribute: false } };
  declare schema: Schema;
  declare value: any;
  declare label: string;
  declare helper?: string;
  declare hass: any;
  static styles = field;

  private set(v: unknown) {
    fire(this, v === "" ? undefined : v);
  }

  render() {
    const sel = this.schema.selector ?? {};
    const type = Object.keys(sel)[0] ?? "text";
    const opts = sel[type] ?? {};
    // the glass cards' own selectors (colours) are real elements
    const own = customElements.get(`ha-selector-${type}`) && type !== "text";
    if (own) {
      return html`${this.ownSelector(type)}`;
    }
    const lbl = html`<span class="lbl">${this.label}</span>`;
    const help = this.helper ? html`<span class="help">${this.helper}</span>` : nothing;
    const v = this.value;
    switch (type) {
      case "boolean":
        return html`<label class="row"><input type="checkbox" .checked=${!!v} @change=${(e: Event) => this.set((e.target as HTMLInputElement).checked)} />${this.label}</label>${help}`;
      case "number":
        return html`<label>${lbl}<input type="number" min=${opts.min ?? nothing} max=${opts.max ?? nothing} step=${opts.step ?? "any"} .value=${v ?? ""}
          @change=${(e: Event) => {
            const s = (e.target as HTMLInputElement).value;
            this.set(s === "" ? undefined : Number(s));
          }} /></label>${help}`;
      case "select": {
        const list: { value: string; label: string }[] = (opts.options ?? []).map((o: any) => (typeof o === "string" ? { value: o, label: o } : o));
        return html`<label>${lbl}<select @change=${(e: Event) => this.set((e.target as HTMLSelectElement).value)}>
          ${list.some((o) => o.value === (v ?? "")) ? nothing : html`<option value="" ?selected=${v === undefined}>—</option>`}
          ${list.map((o) => html`<option value=${o.value} ?selected=${o.value === v}>${o.label}</option>`)}
        </select></label>${help}`;
      }
      case "entity": {
        const ids = Object.keys(this.hass?.states ?? {}).filter((id) => !opts.domain || [opts.domain].flat().includes(id.split(".")[0])).sort();
        const list = `ents-${(this.schema.name ?? "x").replace(/\W/g, "")}`;
        return html`<label>${lbl}<input list=${list} .value=${v ?? ""} @change=${(e: Event) => this.set((e.target as HTMLInputElement).value)} /></label>
          <datalist id=${list}>${ids.slice(0, 400).map((id) => html`<option value=${id}>${this.hass.states[id].attributes.friendly_name ?? ""}</option>`)}</datalist>${help}`;
      }
      case "icon":
        return html`<label>${lbl}<div class="row"><ha-icon .icon=${v || "mdi:help-circle-outline"}></ha-icon><input .value=${v ?? ""} placeholder="mdi:…" @change=${(e: Event) => this.set((e.target as HTMLInputElement).value)} /></div></label>${help}`;
      case "color_rgb":
        return html`<label>${lbl}<input type="color" .value=${Array.isArray(v) ? `#${v.map((n: number) => n.toString(16).padStart(2, "0")).join("")}` : "#ffffff"}
          @change=${(e: Event) => {
            const h = (e.target as HTMLInputElement).value;
            this.set([1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
          }} /></label>${help}`;
      case "ui_action":
        return html`<label>${lbl}<select @change=${(e: Event) => this.set({ action: (e.target as HTMLSelectElement).value })}>
          ${["", "toggle", "more-info", "navigate", "perform-action", "url", "none"].map((a) => html`<option value=${a} ?selected=${(v?.action ?? "") === a}>${a || "Default"}</option>`)}
        </select></label>${help}`;
      case "object":
        return html`<label>${lbl}<textarea .value=${v ? stringify(v) : ""} @change=${(e: Event) => {
          try {
            this.set(parse((e.target as HTMLTextAreaElement).value));
          } catch {
            /* not valid yet */
          }
        }}></textarea></label>${help}`;
      default:
        return html`<label>${lbl}<input .value=${v ?? ""} @change=${(e: Event) => this.set((e.target as HTMLInputElement).value)} /></label>${help}`;
    }
  }

  private ownSelector(type: string) {
    const el = document.createElement(`ha-selector-${type}`) as HTMLElement & Record<string, any>;
    Object.assign(el, { hass: this.hass, selector: this.schema.selector, value: this.value, label: this.label, helper: this.helper });
    return el;
  }
}
customElements.define("shim-selector", ShimSelector);

/** <ha-form>: a schema of fields, grids and expandable groups over one data object. */
class HaForm extends LitElement {
  static properties = { hass: { attribute: false }, data: { attribute: false }, schema: { attribute: false }, computeLabel: { attribute: false }, computeHelper: { attribute: false } };
  declare hass: any;
  declare data: Data;
  declare schema: Schema[];
  declare computeLabel?: (s: Schema) => string;
  declare computeHelper?: (s: Schema) => string | undefined;
  static styles = css`
    :host { display: block; }
    .list { display: flex; flex-direction: column; gap: 14px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; align-items: start; }
    details { border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12)); border-radius: 12px; padding: 0 12px; }
    summary { cursor: pointer; padding: 11px 0; font-weight: 500; }
    details[open] { padding-bottom: 12px; }
  `;

  private change(name: string | undefined, value: unknown) {
    const next = { ...(this.data ?? {}) };
    if (!name) Object.assign(next, value as Data);
    else if (value === undefined) delete next[name];
    else next[name] = value;
    fire(this, next);
  }

  private items(schema: Schema[], data: Data, set: (name: string | undefined, v: unknown) => void): unknown[] {
    return schema.map((s) => {
      if (s.type === "grid" || s.type === "expandable") {
        const inner = s.name ? (data?.[s.name] ?? {}) : data;
        const setInner = (n: string | undefined, v: unknown) => {
          const obj = { ...(inner ?? {}) };
          if (!n) Object.assign(obj, v as Data);
          else if (v === undefined) delete obj[n];
          else obj[n] = v;
          set(s.name || undefined, s.name ? obj : obj);
        };
        const body = this.items(s.schema ?? [], inner, setInner);
        if (s.type === "grid") return html`<div class="grid">${body}</div>`;
        return html`<details ?open=${s.expanded}><summary>${s.title ?? this.computeLabel?.(s) ?? s.name}</summary><div class="list">${body}</div></details>`;
      }
      return html`<shim-selector .hass=${this.hass} .schema=${s} .value=${data?.[s.name]} .label=${this.computeLabel?.(s) ?? s.label ?? s.name} .helper=${this.computeHelper?.(s)}
        @value-changed=${(e: CustomEvent) => {
          e.stopPropagation();
          set(s.name, e.detail.value);
        }}></shim-selector>`;
    });
  }

  render() {
    return html`<div class="list">${this.items(this.schema ?? [], this.data ?? {}, (n, v) => this.change(n, v))}</div>`;
  }
}
customElements.define("ha-form", HaForm);

class HaExpansionPanel extends LitElement {
  static properties = { header: {}, secondary: {}, expanded: { type: Boolean, reflect: true }, outlined: { type: Boolean } };
  declare header: string;
  declare secondary?: string;
  declare expanded: boolean;
  static styles = css`
    :host { display: block; border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12)); border-radius: 12px; margin: 8px 0; }
    .head { display: flex; align-items: center; gap: 8px; padding: 12px 14px; cursor: pointer; user-select: none; }
    .t { flex: 1; } .h { font-weight: 500; } .s { font-size: 12px; color: var(--secondary-text-color, #6b6f7a); }
    .chev { transition: transform 0.2s; opacity: 0.6; } :host([expanded]) .chev { transform: rotate(180deg); }
    .body { padding: 0 14px 14px; } :host(:not([expanded])) .body { display: none; }
  `;
  render() {
    return html`<div class="head" @click=${() => {
        this.expanded = !this.expanded;
        this.dispatchEvent(new CustomEvent("expanded-changed", { detail: { expanded: this.expanded } }));
      }}>
        <slot name="leading-icon"></slot>
        <div class="t"><div class="h">${this.header}<slot name="header"></slot></div>${this.secondary ? html`<div class="s">${this.secondary}</div>` : nothing}</div>
        <ha-icon class="chev" icon="mdi:chevron-down"></ha-icon>
      </div>
      <div class="body"><slot></slot></div>`;
  }
}
customElements.define("ha-expansion-panel", HaExpansionPanel);

class HaSwitch extends HTMLElement {
  private input = document.createElement("input");
  constructor() {
    super();
    this.input.type = "checkbox";
    this.input.style.cssText = "width:36px;height:20px;accent-color:var(--primary-color,#0a84ff);margin:0";
    this.input.addEventListener("change", () => this.dispatchEvent(new Event("change", { bubbles: true, composed: true })));
    this.attachShadow({ mode: "open" }).appendChild(this.input);
  }
  get checked() {
    return this.input.checked;
  }
  set checked(v: boolean) {
    this.input.checked = !!v;
  }
}
customElements.define("ha-switch", HaSwitch);

/** <ha-yaml-editor>: YAML in a text area; value-changed with isValid, as HA's. */
class HaYamlEditor extends LitElement {
  static properties = { defaultValue: { attribute: false }, hass: { attribute: false } };
  declare defaultValue: unknown;
  static styles = [field, css`textarea { min-height: 60vh; }`];
  render() {
    return html`<textarea spellcheck="false" .value=${this.defaultValue === undefined ? "" : stringify(this.defaultValue)}
      @input=${(e: Event) => {
        try {
          fire(this, parse((e.target as HTMLTextAreaElement).value), { isValid: true });
        } catch {
          fire(this, undefined, { isValid: false });
        }
      }}></textarea>`;
  }
}
customElements.define("ha-yaml-editor", HaYamlEditor);

/**
 * Another card's own editor, as HA's: the card's visual editor (`getConfigElement()`) when it
 * has one – every glass card does – else its YAML; toggleMode() switches, GUImode-changed tells.
 */
type EditorEl = HTMLElement & { setConfig(c: Data): void; hass?: unknown; lovelace?: unknown };
class CardElementEditor extends LitElement {
  static properties = { value: { attribute: false }, hass: { attribute: false }, lovelace: { attribute: false }, _gui: { state: true }, _el: { state: true } };
  declare value: Data;
  declare hass: unknown;
  declare lovelace: unknown;
  declare _gui: boolean;
  declare _el?: EditorEl;
  private _tag = "";
  private _own?: Data; // the config the editor itself just reported: not set back into it
  static styles = field;
  constructor() {
    super();
    this._gui = true;
  }
  toggleMode() {
    this._gui = !this._gui;
    if (this._gui) this._el?.setConfig(this.value);
    this._mode();
  }
  private _mode() {
    this.dispatchEvent(new CustomEvent("GUImode-changed", { detail: { guiMode: this._gui && !!this._el, guiModeAvailable: !!this._el }, bubbles: true, composed: true }));
  }
  private _changed(config: Data) {
    this._own = config;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
  }
  protected willUpdate(changed: Map<string, unknown>) {
    const type = String((this.value as { type?: string })?.type ?? "");
    const tag = type.startsWith("custom:") ? type.slice(7) : "";
    if (tag !== this._tag) {
      this._tag = tag;
      this._el = undefined;
      const cls = customElements.get(tag) as unknown as { getConfigElement?: () => EditorEl | Promise<EditorEl> } | undefined;
      if (cls?.getConfigElement)
        void Promise.resolve(cls.getConfigElement()).then((el) => {
          if (this._tag !== tag) return;
          el.addEventListener("config-changed", (e) => {
            e.stopPropagation();
            this._changed((e as CustomEvent).detail.config);
          });
          el.hass = this.hass;
          el.lovelace = this.lovelace;
          el.setConfig(this.value);
          this._el = el;
          this._mode();
        });
      else this._mode();
    } else if (this._el) {
      if (changed.has("hass")) this._el.hass = this.hass;
      if (changed.has("value") && this.value !== this._own) this._el.setConfig(this.value);
    }
  }
  render() {
    if (this._gui && this._el) return html`${this._el}`;
    return html`<ha-yaml-editor .defaultValue=${this.value} @value-changed=${(e: CustomEvent) => {
        e.stopPropagation();
        if (e.detail.isValid !== false) this._changed(e.detail.value);
      }}></ha-yaml-editor>`;
  }
}
customElements.define("hui-card-element-editor", CardElementEditor);

class ConditionsEditor extends LitElement {
  static properties = { conditions: { attribute: false } };
  declare conditions: unknown[];
  render() {
    return html`<ha-yaml-editor .defaultValue=${this.conditions ?? []} @value-changed=${(e: CustomEvent) => {
      e.stopPropagation();
      if (e.detail.isValid !== false) fire(this, e.detail.value);
    }}></ha-yaml-editor>`;
  }
}
customElements.define("ha-card-conditions-editor", ConditionsEditor);
