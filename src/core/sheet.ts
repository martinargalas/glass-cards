import { tr } from "../i18n";
import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { materials } from "./materials";
import { surface, tokens } from "./styles";
import { LiquidController, PART_GL } from "./liquid";
import { GLASS_DEFAULTS, wallpaperElement } from "./liquid-gl";
import type { GlassMode } from "./types";

/**
 * A modal over the dashboard: on a phone a sheet from the bottom edge, on a tablet or a
 * desktop a dialog in the middle. Its content comes from the card (`render`), drawn anew
 * with `update()` – e.g. when the card's states change; the card's own handlers work in it.
 *
 *   const sheet = openSheet({ title: "Days", dark: true, accent: "#0a84ff", render: () => html`…` });
 *   sheet.update(); sheet.close();
 *
 * It lives in the page's body, in a modal <dialog> – the browser's top layer, over everything:
 * a dock or a tab bar at the bottom edge, a pop-up, whatever their z-index – so it brings its own look – dark or light glass, the card's accent – and the styles of the
 * controls the cards put in it: .chips / .chip, .days / .day, .row with .sw (a switch),
 * .field (a text box or a list), .list / .opt (choices), .primary, .secondary, .danger.
 */
export interface SheetOptions {
  title?: string;
  dark?: boolean;
  accent?: string;
  render: () => TemplateResult | typeof nothing;
  /** the buttons at the bottom; none = one Done that closes it */
  actions?: () => TemplateResult | typeof nothing;
  onClose?: () => void;
  /** Enter (outside a text box): what it does – e.g. save */
  onEnter?: () => void;
  /** the card it opens from: its look's colours, materials and liquid glass settings carry over */
  host?: HTMLElement;
  /** its own glass, as a card's background (liquid – the WebGL glass, dark-liquid, frosted, light,
   *  flat, solid, home, none); empty = its own dark or light glass */
  glass?: GlassMode | "";
  /** a colour over its glass */
  tint?: string;
}

/** The card's look the materials and texts draw from: copied onto the modal, which lives outside the card. */
/** (not the card's text colours: the window's own material and day / night decide those) */
const LOOK_VARS = [
  // the dashboard's liquid glass settings (the shader reads them from the element it draws)
  ...Object.keys(GLASS_DEFAULTS).map((k) => `--glass-liquid-${k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())}`),
  "--glass-corner-shape",
  "--glass-control-bg", "--glass-control-shadow", "--mat-dark-text", "--mat-liquid-bg", "--mat-home-text", "--mat-home-bg", "--glass-blur-scale", "--glass-font"];

/** A phone: the sheet comes from the bottom edge. */
const PHONE = 600;

export class GlassSheet extends LitElement {
  static override properties = { _open: { state: true } };
  declare _open: boolean;
  opts!: SheetOptions;

  /** the WebGL glass (liquid, dark-liquid) and the light glass, as on a card */
  private _liquid = new LiquidController(this, ".sheet.surface");
  /** its controls in a WebGL material (controls_glass: liquid-gl / dark-liquid-gl) */
  private _parts = new LiquidController(this, PART_GL, undefined, undefined, () => wallpaperElement());

  constructor() {
    super();
    this._open = false;
  }

  /** The host carries the glass as a card does: the surface styles and LiquidController read it. */
  protected override willUpdate() {
    const g = this.opts.glass;
    if (g) this.setAttribute("glass", g);
    else this.removeAttribute("glass");
    // not inside a dashboard: its own day / night colours
    this.setAttribute("standalone", "");
    this.toggleAttribute("dark", this.opts.dark !== false);
  }

  /** A colour as "r, g, b" (the shader's tint). */
  private _rgb(c: string): string | undefined {
    const el = document.createElement("i");
    el.style.color = c;
    document.body.appendChild(el);
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(el).color);
    el.remove();
    return m ? `${m[1]}, ${m[2]}, ${m[3]}` : undefined;
  }

  override connectedCallback() {
    super.connectedCallback();
    requestAnimationFrame(() => (this._open = true));
    window.addEventListener("keydown", this._onKey);
    window.addEventListener("resize", this._onResize);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this._onKey);
    window.removeEventListener("resize", this._onResize);
  }

  private _onResize = () => this.requestUpdate();

  /** The card's look, as the card has it now. */
  private _look(): string {
    const h = this.opts.host;
    if (!h) return "";
    const cs = getComputedStyle(h);
    return LOOK_VARS.map((v) => [v, cs.getPropertyValue(v).trim()])
      .filter(([, x]) => x)
      .map(([v, x]) => `${v}:${x}`)
      .join(";");
  }

  protected override firstUpdated() {
    // the glass drawn where the window comes to rest (it slides / grows in)
    this.renderRoot.querySelector(".sheet")?.addEventListener("transitionend", () => (this._liquid.refresh(), this._parts.refresh()));
    // the top layer: nothing on the page – a dock at the bottom edge either – can cover it
    const d = this.renderRoot.querySelector("dialog");
    try {
      d?.showModal();
    } catch {
      d?.setAttribute("open", "");
    }
  }

  private _onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && this.opts.onEnter && !(e.composedPath()[0] instanceof HTMLInputElement)) this.opts.onEnter();
  };


  close() {
    if (!this.isConnected) return;
    this._open = false;
    this.opts.onClose?.();
    setTimeout(() => this.remove(), 240);
  }

  override render() {
    const o = this.opts;
    const phone = window.innerWidth < PHONE;
    // Escape: the dialog's cancel – closed with the animation
    // its own glass (as a card's): see-through ones (no blur, none) get a deeper scrim
    const g = o.glass || "";
    const day = o.dark === false;
    const deep = g === "flat" || g === "none";
    const tint = o.tint ? this._rgb(o.tint) : undefined;
    const tintStyle = tint ? `--glass-panel-tint:${tint};--glass-panel-tint-a:0.35;--sheet-tint:rgba(${tint}, 0.3);` : "";
    return html`<dialog class="top" aria-label=${o.title ?? ""} @cancel=${(e: Event) => (e.preventDefault(), this.close())}>
      <div class="scrim ${this._open ? "open" : ""} ${deep ? "deep" : ""} ${g === "none" ? "none" : ""}" @click=${() => this.close()}></div>
      <div
        class="sheet ${phone ? "phone" : "dialog"} ${this._open ? "open" : ""} ${g ? `surface glass-${g}` : day ? "light" : ""} ${tint ? "tinted" : ""}"
        style="${this._look()};${o.accent ? `--accent:${o.accent};` : ""}${tintStyle}"
        tabindex="-1"
        autofocus
      >
        ${phone ? html`<i class="grip"></i>` : nothing}
        ${o.title ? html`<div class="title">${o.title}</div>` : nothing}
        <div class="body" @scroll=${() => this._parts.refresh()}>${o.render()}</div>
        <div class="actions">${o.actions ? o.actions() : html`<button class="primary" @click=${() => this.close()}>${tr("Done")}</button>`}</div>
      </div>
    </dialog>`;
  }

  static override styles = [
    tokens,
    surface,
    css`
    :host {
      font-family: var(--glass-font, var(--paper-font-body1_-_font-family, Roboto, system-ui, sans-serif));
    }
    /* the whole screen, in the top layer; the scrim does the dimming */
    dialog.top {
      position: fixed;
      inset: 0;
      width: 100%;
      height: 100%;
      max-width: none;
      max-height: none;
      margin: 0;
      padding: 0;
      border: 0;
      background: transparent;
      overflow: hidden;
      display: grid;
      place-items: center;
      font: inherit;
      color: inherit;
    }
    dialog.top::backdrop {
      background: transparent;
    }
    .sheet:focus {
      outline: none;
    }
    .scrim {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0);
      transition: background 0.22s ease;
    }
    .scrim.open {
      background: rgba(0, 0, 0, 0.32);
    }
    .sheet {
      --text: #fff;
      --text-2: rgba(255, 255, 255, 0.58);
      --band: rgba(255, 255, 255, 0.12);
      --line: rgba(255, 255, 255, 0.1);
      --accent: #0a84ff;
      position: relative;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      color: var(--text);
    }
    /* its own glass (no glass picked): dark, light by day */
    .sheet:not(.surface) {
      background: rgba(36, 36, 40, 0.74);
      border: 1px solid rgba(255, 255, 255, 0.16);
      -webkit-backdrop-filter: blur(30px) saturate(170%);
      backdrop-filter: blur(30px) saturate(170%);
      box-shadow:
        0 24px 60px rgba(0, 0, 0, 0.35),
        inset 0 1px 1px rgba(255, 255, 255, 0.18);
    }
    .sheet.light {
      --text: #1c1c1e;
      --text-2: rgba(28, 28, 30, 0.55);
      --band: rgba(28, 28, 30, 0.07);
      --line: rgba(28, 28, 30, 0.08);
    }
    /* its own glass by day (no material picked): light */
    .sheet.light:not(.surface) {
      background: rgba(255, 255, 255, 0.8);
      border-color: rgba(255, 255, 255, 0.7);
    }
    /* a tablet: a dialog in the middle */
    .sheet.dialog {
      width: min(440px, calc(100vw - 48px));
      max-height: calc(100vh - 64px);
      padding: 20px 20px 18px;
      border-radius: 30px;
      transform: scale(0.94);
      opacity: 0;
      transition:
        transform 0.28s cubic-bezier(0.2, 1.3, 0.4, 1),
        opacity 0.18s ease;
    }
    /* a phone: a sheet from the bottom edge */
    .sheet.phone {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      max-height: calc(100vh - 48px);
      padding: 8px 18px calc(18px + env(safe-area-inset-bottom));
      border-radius: 28px 28px 0 0;
      border-bottom: 0;
      transform: translateY(100%);
      transition: transform 0.3s cubic-bezier(0.2, 0.9, 0.3, 1);
    }
    .sheet.open {
      transform: none;
      opacity: 1;
    }
    .grip {
      align-self: center;
      width: 38px;
      height: 5px;
      border-radius: 3px;
      background: var(--band);
      margin-bottom: 8px;
    }
    .title {
      text-align: center;
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 14px;
    }
    .body {
      display: flex;
      flex-direction: column;
      gap: 14px;
      overflow-y: auto;
      overscroll-behavior: contain;
      margin: 0 -4px;
      padding: 0 4px 2px;
    }
    /* the content scrolls; its parts keep their height */
    .body > * {
      flex: none;
    }
    .actions {
      display: flex;
      gap: 10px;
      margin-top: 16px;
    }
    button {
      font: inherit;
      color: inherit;
      -webkit-tap-highlight-color: transparent;
    }
    .actions button,
    .body .primary,
    .body .secondary,
    .body .danger {
      min-height: 44px;
      padding: 0 16px;
      border: 0;
      border-radius: 999px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.15s ease;
    }
    .actions button {
      flex: 1;
    }
    .actions button:active {
      transform: scale(0.96);
    }
    .primary {
      color: #fff;
      background: var(--accent);
    }
    .primary[disabled] {
      opacity: 0.5;
      cursor: default;
    }
    .secondary {
      background: var(--band);
    }
    .danger {
      color: #ff453a;
      background: var(--band);
    }
    .danger.sure {
      color: #fff;
      background: #ff453a;
      font-size: 13px;
    }
    .label {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-2);
      text-transform: uppercase;
      letter-spacing: 0.4px;
      margin: 0 4px -6px;
    }
    /* quick choices: four in a row, two by two on a phone */
    .chips {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 6px;
    }
    .sheet.phone .chips {
      grid-template-columns: repeat(2, 1fr);
    }
    .chip {
      min-width: 0;
      height: 36px;
      padding: 0 8px;
      border: 0;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--text-2);
      background: var(--band);
      cursor: pointer;
    }
    .days {
      display: flex;
      justify-content: space-between;
      gap: 4px;
    }
    .day {
      flex: 0 1 42px;
      aspect-ratio: 1;
      max-width: 42px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      font-size: 14px;
      font-weight: 700;
      color: var(--text-2);
      background: var(--band);
      cursor: pointer;
      transition: transform 0.15s ease;
    }
    .day:active,
    .chip:active {
      transform: scale(0.94);
    }
    .chip.cur,
    .day.cur {
      color: #fff;
      background: var(--accent);
    }
    /* a line with a switch, or a choice with a tick */
    .row,
    .opt {
      display: flex;
      align-items: center;
      gap: 12px;
      min-height: 48px;
      padding: 0 14px;
      border: 0;
      border-radius: 16px;
      background: var(--band);
      font-size: 14px;
      font-weight: 600;
      text-align: left;
      cursor: pointer;
    }
    .row ha-icon,
    .opt ha-icon {
      --mdc-icon-size: 20px;
      display: flex;
      color: var(--text-2);
    }
    .row span,
    .opt span {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .opt small,
    .row small {
      display: block;
      font-size: 12px;
      font-weight: 500;
      color: var(--text-2);
    }
    .list {
      display: flex;
      flex-direction: column;
      border-radius: 16px;
      overflow: hidden;
      background: var(--band);
    }
    .list .opt {
      border-radius: 0;
      background: none;
    }
    .list .opt + .opt {
      box-shadow: 0 -1px 0 var(--line);
    }
    .opt .tick {
      color: var(--accent);
      visibility: hidden;
    }
    .opt.cur .tick {
      visibility: visible;
    }
    .sw {
      position: relative;
      flex: none;
      width: 44px;
      height: 26px;
      border-radius: 999px;
      background: rgba(120, 120, 128, 0.36);
      transition: background 0.2s ease;
    }
    .sw::after {
      content: "";
      position: absolute;
      top: 2px;
      left: 2px;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
      transition: transform 0.2s ease;
    }
    .sw.on {
      background: var(--accent);
    }
    .sw.on::after {
      transform: translateX(18px);
    }
    .field {
      box-sizing: border-box;
      width: 100%;
      height: 48px;
      padding: 0 14px;
      border: 0;
      border-radius: 16px;
      outline: none;
      font: inherit;
      font-size: 15px;
      color: var(--text);
      background: var(--band);
    }
    input.field:focus,
    .field.select:focus-visible {
      box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--accent) 70%, transparent);
    }
    .field::placeholder {
      color: var(--text-2);
    }
    /* a dropdown with a checklist: the picked ones in the field, the list opens under it */
    .field.select {
      display: flex;
      align-items: center;
      gap: 10px;
      border: 0;
      text-align: left;
      cursor: pointer;
    }
    .field.select ha-icon {
      --mdc-icon-size: 20px;
      display: flex;
      flex: none;
      color: var(--text-2);
    }
    .field.select span {
      flex: 1;
      min-width: 0;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .field.select .placeholder {
      color: var(--text-2);
      font-weight: 500;
    }
    .field.select .count {
      flex: none;
      min-width: 20px;
      height: 20px;
      padding: 0 6px;
      box-sizing: border-box;
      border-radius: 10px;
      font-size: 12px;
      line-height: 20px;
      text-align: center;
      color: #fff;
      background: var(--accent);
    }
    .field.select .chev {
      transition: transform 0.2s ease;
    }
    .dropdown.open .field.select {
      border-radius: 16px 16px 0 0;
    }
    .dropdown.open .chev {
      transform: rotate(180deg);
    }
    .dropdown .checklist {
      border-radius: 0 0 16px 16px;
      box-shadow: 0 -1px 0 var(--line);
      max-height: 240px;
      overflow-y: auto;
    }
    .opt.check .box {
      flex: none;
      width: 22px;
      height: 22px;
      box-sizing: border-box;
      border-radius: 7px;
      border: 2px solid var(--text-2);
      display: grid;
      place-items: center;
    }
    .opt.check.cur .box {
      border-color: var(--accent);
      background: var(--accent);
    }
    .opt.check .box ha-icon {
      --mdc-icon-size: 16px;
      color: #fff;
    }
    .note {
      font-size: 12px;
      color: var(--text-2);
      margin: -6px 4px 0;
    }
    @media (prefers-reduced-motion: reduce) {
      .sheet {
        transition: opacity 0.15s ease !important;
        transform: none !important;
      }
    }
    /* its own glass: the window, not a card – the texts its surface sets (--g-text), white on the see-through ones */
    .sheet:not(.surface) {
      --g-text: var(--text);
      --g-text-2: var(--text-2);
    }
    .sheet.surface {
      --text: var(--g-text, #fff);
      --text-2: var(--g-text-2, rgba(255, 255, 255, 0.6));
      --band: color-mix(in srgb, var(--text) 10%, transparent);
      --line: color-mix(in srgb, var(--text) 9%, transparent);
      color: var(--text);
      padding-left: 18px;
      padding-right: 18px;
    }
    .sheet.surface.glass-flat,
    .sheet.surface.glass-none {
      --g-text: #fff;
      --g-text-2: rgba(255, 255, 255, 0.62);
    }
    /* a colour over the CSS glass (the WebGL glass takes it in its shader) */
    .sheet.surface.tinted:not(.lg-on) {
      background-image: linear-gradient(var(--sheet-tint), var(--sheet-tint)) !important;
    }
    /* no blur / none: the page behind dimmed more, so the window reads */
    .scrim.deep.open {
      background: rgba(0, 0, 0, 0.6);
    }
    /* none: no window at all – the controls on the page, dimmed well */
    .scrim.deep.none.open {
      background: rgba(0, 0, 0, 0.74);
    }
    .sheet.dialog.surface {
      border-radius: 30px;
    }
    .sheet.phone.surface {
      border-radius: 28px 28px 0 0;
    }
    /* own materials on the controls: their shapes stay */
    .chip.mat,
    .field.mat {
      border-radius: 999px;
    }
    .field.mat,
    .row.mat,
    .list.mat {
      border-radius: 16px;
    }
    .day.mat {
      border-radius: 50%;
    }
    .dropdown.open .field.select.mat {
      border-radius: 16px 16px 0 0;
    }
    .dropdown .checklist.mat {
      border-radius: 0 0 16px 16px;
    }
  `,
    // last: an element's material wins over its rules above
    materials,
  ];
}

if (!customElements.get("glass-sheet")) customElements.define("glass-sheet", GlassSheet);

export interface SheetHandle {
  update(): void;
  close(): void;
  readonly open: boolean;
}

export function openSheet(opts: SheetOptions): SheetHandle {
  document.querySelectorAll("glass-sheet").forEach((s) => (s as GlassSheet).close());
  const el = document.createElement("glass-sheet") as GlassSheet;
  el.opts = opts;
  document.body.appendChild(el);
  return {
    update: () => el.requestUpdate(),
    close: () => el.close(),
    get open() {
      return el.isConnected;
    },
  };
}
