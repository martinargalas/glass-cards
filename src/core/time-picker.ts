import { tr } from "../i18n";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { openSheet } from "./sheet";
import type { GlassMode } from "./types";

/**
 * Wheels for the hours and minutes (and AM / PM in the 12-hour format), as on a phone: scroll,
 * drag, tap a number or use the arrow keys. `change` tells the time (detail: { hours, minutes }).
 *
 *   <glass-time-wheels .hours=${6} .minutes=${30} .hour12=${false} .step=${5} @change=${…}>
 *
 * Its colours come from the modal it sits in (core/sheet: --text, --text-2, --band, --accent).
 * openTimePicker() puts it in a modal of its own.
 */

/** A wheel's row height and how many rows show (odd: the picked one in the middle). */
const ROW = 40;
const ROWS = 5;

export class GlassTimeWheels extends LitElement {
  static override properties = { hours: { type: Number }, minutes: { type: Number }, hour12: { type: Boolean }, step: { type: Number } };
  declare hours: number;
  declare minutes: number;
  declare hour12: boolean;
  declare step: number;
  private _timers = new Map<string, number>();

  constructor() {
    super();
    this.hours = 7;
    this.minutes = 0;
    this.hour12 = false;
    this.step = 1;
  }

  private get _step() {
    return Math.max(1, Math.min(30, Math.round(this.step || 1)));
  }

  private _wheels(): { key: string; items: string[]; index: number }[] {
    const pad = (n: number) => String(n).padStart(2, "0");
    const mins = Array.from({ length: Math.ceil(60 / this._step) }, (_, i) => i * this._step);
    // a minute off the step (set elsewhere): the nearest one on it
    const mi = Math.min(mins.length - 1, Math.round(this.minutes / this._step));
    if (!this.hour12)
      return [
        { key: "h", items: Array.from({ length: 24 }, (_, i) => pad(i)), index: this.hours },
        { key: "m", items: mins.map(pad), index: mi },
      ];
    const h12 = this.hours % 12 === 0 ? 12 : this.hours % 12;
    return [
      // 12, 1, 2 … 11
      { key: "h", items: Array.from({ length: 12 }, (_, i) => String(i === 0 ? 12 : i)), index: h12 % 12 },
      { key: "m", items: mins.map(pad), index: mi },
      { key: "ap", items: [tr("AM"), tr("PM")], index: this.hours >= 12 ? 1 : 0 },
    ];
  }

  /** A wheel stopped at a row: the time it says. */
  private _pick(key: string, i: number) {
    let h = this.hours;
    let m = this.minutes;
    if (key === "m") m = i * this._step;
    else if (key === "ap") h = (h % 12) + (i === 1 ? 12 : 0);
    else if (this.hour12) h = (i % 12) + (h >= 12 ? 12 : 0);
    else h = i;
    if (h === this.hours && m === this.minutes) return;
    this.hours = h;
    this.minutes = m;
    this.dispatchEvent(new CustomEvent("change", { detail: { hours: h, minutes: m } }));
  }

  protected override firstUpdated(_: PropertyValues) {
    // each wheel at its value, without the scroll animation
    for (const w of this._wheels()) {
      const el = this.renderRoot.querySelector<HTMLElement>(`.wheel[data-k="${w.key}"]`);
      if (el) el.scrollTop = w.index * ROW;
    }
  }

  override focus() {
    this.renderRoot.querySelector<HTMLElement>(".wheel")?.focus({ preventScroll: true });
  }

  /** Scrolling: once it settles, the row in the middle is the value. */
  private _onScroll(key: string, e: Event) {
    const el = e.currentTarget as HTMLElement;
    clearTimeout(this._timers.get(key));
    this._timers.set(
      key,
      window.setTimeout(() => {
        const n = el.querySelectorAll(".item").length;
        this._pick(key, Math.max(0, Math.min(n - 1, Math.round(el.scrollTop / ROW))));
      }, 90),
    );
  }

  private _scrollTo(key: string, i: number) {
    this.renderRoot.querySelector<HTMLElement>(`.wheel[data-k="${key}"]`)?.scrollTo({ top: i * ROW, behavior: "smooth" });
  }

  private _wheelKey(key: string, index: number, n: number, e: KeyboardEvent) {
    const d = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    const i = (index + d + n) % n;
    this._pick(key, i);
    this._scrollTo(key, i);
  }

  override render() {
    const wheels = this._wheels();
    return html`<div class="wheels" style="--row:${ROW}px;--rows:${ROWS}">
      <div class="band"></div>
      ${wheels.map(
        (w, wi) => html`${wi === 1 ? html`<span class="colon">:</span>` : nothing}
          <div
            class="wheel ${w.key}"
            data-k=${w.key}
            tabindex="0"
            role="listbox"
            aria-label=${w.key === "h" ? tr("Hours") : w.key === "m" ? tr("Minutes") : tr("AM / PM")}
            @scroll=${(e: Event) => this._onScroll(w.key, e)}
            @keydown=${(e: KeyboardEvent) => this._wheelKey(w.key, w.index, w.items.length, e)}
          >
            ${w.items.map((t, i) => html`<div class="item ${i === w.index ? "cur" : ""}" role="option" aria-selected=${i === w.index} @click=${() => this._scrollTo(w.key, i)}>${t}</div>`)}
          </div>`,
      )}
    </div>`;
  }

  static override styles = css`
    :host {
      display: block;
    }
    .wheels {
      position: relative;
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 4px;
      height: calc(var(--row) * var(--rows));
      /* the rows fade out towards the top and the bottom */
      -webkit-mask: linear-gradient(transparent, #000 30%, #000 70%, transparent);
      mask: linear-gradient(transparent, #000 30%, #000 70%, transparent);
    }
    /* the picked row: a band across the wheels */
    .band {
      position: absolute;
      left: 0;
      right: 0;
      top: calc(50% - var(--row) / 2);
      height: var(--row);
      border-radius: 12px;
      background: var(--band, rgba(255, 255, 255, 0.12));
      pointer-events: none;
    }
    .wheel {
      position: relative;
      height: 100%;
      width: 76px;
      overflow-y: auto;
      scroll-snap-type: y mandatory;
      scrollbar-width: none;
      overscroll-behavior: contain;
      outline: none;
      padding: calc(var(--row) * (var(--rows) - 1) / 2) 0;
      box-sizing: border-box;
    }
    .wheel::-webkit-scrollbar {
      display: none;
    }
    .wheel.ap {
      width: 64px;
    }
    .wheel:focus-visible {
      border-radius: 12px;
      box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--accent, #0a84ff) 60%, transparent);
    }
    .item {
      height: var(--row);
      line-height: var(--row);
      text-align: center;
      scroll-snap-align: center;
      font-size: 26px;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
      color: var(--text-2, rgba(255, 255, 255, 0.55));
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;
      transition: color 0.15s ease;
    }
    .wheel.ap .item {
      font-size: 18px;
      font-weight: 600;
    }
    .item.cur {
      color: var(--text, #fff);
    }
    .colon {
      font-size: 26px;
      font-weight: 600;
      margin-top: -3px;
    }
  `;
}

if (!customElements.get("glass-time-wheels")) customElements.define("glass-time-wheels", GlassTimeWheels);

export interface TimePickerOptions {
  hours: number;
  minutes: number;
  hour12: boolean;
  /** the minutes' step (1, 5, 10, 15…) */
  step?: number;
  title?: string;
  dark?: boolean;
  accent?: string;
  /** the card it opens from (its look carries over) and the window's own material */
  host?: HTMLElement;
  glass?: GlassMode | "";
  tint?: string;
  onSet: (hours: number, minutes: number) => void;
}

/** The wheels in a modal of their own: Done sets the time, Cancel / Escape / a tap outside leaves it. */
export function openTimePicker(o: TimePickerOptions) {
  let h = o.hours;
  let m = o.minutes;
  const set = () => {
    o.onSet(h, m);
    sheet.close();
  };
  const sheet = openSheet({
    title: o.title ?? tr("Time"),
    dark: o.dark,
    accent: o.accent,
    host: o.host,
    glass: o.glass,
    tint: o.tint,
    onEnter: set,
    render: () =>
      html`<glass-time-wheels
        .hours=${o.hours}
        .minutes=${o.minutes}
        .hour12=${o.hour12}
        .step=${o.step ?? 1}
        @change=${(e: CustomEvent) => ((h = e.detail.hours), (m = e.detail.minutes))}
      ></glass-time-wheels>`,
    actions: () => html`<button class="secondary" @click=${() => sheet.close()}>${tr("Cancel")}</button><button class="primary" @click=${set}>${tr("Done")}</button>`,
  });
}
