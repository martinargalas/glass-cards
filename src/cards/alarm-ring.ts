import { tr } from "../i18n";
import { css, html, nothing, type PropertyValues } from "lit";
import { GlassElement } from "../core/glass-element";
import type { BaseCardConfig, GlassMode, HomeAssistant } from "../core/types";
import { registerCard } from "../core/registry";
import { makeEditor } from "../editor/editor";
import { alarmRingSpec } from "../editor/specs";
import { haptic } from "../core/actions";
import { surface } from "../core/styles";
import { materials, type Material } from "../core/materials";
import { ALARM_RING_PARTS } from "../core/card-parts";
import { language } from "../core/settings";
import { clockParts, managedAlarms, managedHelpers, snoozeAlarm, stopAlarm, updateBlueprint } from "../core/alarm-model";
import { matPart } from "./alarms";

/**
 * An alarm ringing: the time, its name, Snooze (a tap) and Stop (a slide – never by accident).
 * Invisible until an alarm of the Glass alarms card rings; put it once on the dashboard (an
 * overlay, any section) and it shows itself – over the dashboard, or in a pop-up of yours.
 *
 *   type: custom:glass-alarm-ring
 *   display: modal          # how it shows: modal (default) – over the dashboard, dimmed behind it;
 *                           #   popup – opens a Bubble Card pop-up (`popup`), with this card in it
 *                           #   set to `display: card`; card – right here, in the card itself
 *   popup: "#alarm"         # display: popup – the pop-up's hash
 *   style: photo            # simple: the time and the buttons on glass; photo (default): a morning
 *                           #   photo, the time and the buttons on liquid glass over it
 *   image: /local/morning.jpg  # style photo – a photo of your own
 *   night_image: /local/night.jpg  # style photo – at night (sun.sun below the horizon), under dark
 *                           #   liquid glass; default the cards' night photo, none = the day photo
 *   snooze: 10              # Snooze: minutes (default 10)
 *   glass: dark-liquid      # style simple – its glass (default dark-liquid)
 *   panel_glass: liquid-gl  # style photo – the glass over the photo (default liquid-gl)
 *   night_panel_glass: dark-liquid-gl  # style photo – the glass at night
 *   controls_glass: …       # Snooze and the slider: their material and a tint (controls_color)
 *
 * Swiping the alarm up snoozes it too. It needs the alarms' ringing helpers – the Glass alarms
 * card adds them (an administrator opening a dashboard with either card).
 */
interface RingConfig extends BaseCardConfig {
  /** how it shows: modal (default) – over the dashboard; popup – opens a Bubble Card pop-up (`popup`); card – in the card itself (the one inside the pop-up) */
  display?: "modal" | "popup" | "card";
  /** display: popup – the pop-up's hash (default #alarm) */
  popup?: string;
  /** internal: older name of display: card */
  inline?: boolean;
  /** photo (default): a morning photo under liquid glass; simple: the time and the buttons on the card's glass */
  style?: "simple" | "photo";
  /** style photo – a photo of your own (default the cards' morning photo) */
  image?: string;
  /** style photo – the photo at night, while the sun is below the horizon (sun.sun): default the cards' night photo; none – the day photo all the time */
  night_image?: string;
  /** Snooze: minutes until it rings again (default 10) */
  snooze?: number;
  /** style simple – the card's glass (default dark-liquid) */
  glass?: GlassMode;
  /** style photo – the glass panel over the photo (default liquid-gl, WebGL liquid glass) */
  panel_glass?: Material;
  panel_color?: string;
  /** style photo – the glass panel at night (default dark-liquid-gl, dark WebGL liquid glass) */
  night_panel_glass?: Material;
  night_panel_color?: string;
  /** Snooze and the slider: their material (default plain) */
  controls_glass?: Material;
  controls_color?: string;
  /** display: card – a sample alarm while nothing rings, to see its look */
  preview?: boolean;
  /** internal: the copy over the dashboard */
  overlay?: boolean;
}

/** the photo that comes with the cards, beside the bundle (dist/demo-alarm-morning.jpg) */
function morningPhoto(): string {
  const bundle = import.meta.url;
  // ?v: a browser keeps an older picture of the same name
  return new URL("./demo-alarm-morning.jpg?v=2", bundle).href;
}
/** the night photo that comes with the cards (dist/demo-alarm-night.jpg) */
function nightPhoto(): string {
  return new URL("./demo-alarm-night.jpg?v=1", import.meta.url).href;
}

/** photos' shapes (width / height), once loaded: a tablet shows the whole photo */
const ratios = new Map<string, number>();
/** photos' bottom edge colour: the phone shows it under the photo */
const unders = new Map<string, string>();
/** the average colour of a picture's last rows (a picture of another site may not be read: none) */
function bottomColour(img: HTMLImageElement): string | undefined {
  try {
    const c = document.createElement("canvas");
    c.width = 32;
    c.height = 4;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, img.naturalHeight - Math.max(2, img.naturalHeight / 100), img.naturalWidth, Math.max(2, img.naturalHeight / 100), 0, 0, 32, 4);
    const d = ctx.getImageData(0, 0, 32, 4).data;
    const sum = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += d[i + k];
    const n = d.length / 4;
    return `rgb(${sum.map((v) => Math.round(v / n)).join(",")})`;
  } catch {
    return undefined;
  }
}

interface Ringing {
  h: ReturnType<typeof managedHelpers>;
  name: string;
  /** a made-up alarm (a preview, Try it): its buttons only close it */
  sample?: boolean;
}

/** Where the copy over the page goes: an open dialog the card is in (Dashboard Studio, HA's card
 *  editor – they sit in the browser's top layer, over anything in the page), else the page. */
/** the one copy over the page (the card can sit in several views) */
let onPage: Element | undefined;

function layerFor(el: Element): Element {
  let n: Node | null = el;
  for (let i = 0; n && i < 60; i++) {
    if ((n as Element).localName === "dialog" && (n as HTMLDialogElement).open) return n as Element;
    n = (n as Element).parentNode ?? ((n as unknown as ShadowRoot).host ?? null);
  }
  return document.body;
}

/** Inside an editor: HA's card dialog or Glass Dashboard Studio. */
function inEditor(el: Element): boolean {
  let n: Node | null = el;
  for (let i = 0; n && i < 60; i++) {
    const name = (n as Element).localName;
    if (name === "hui-card-preview" || name === "hui-dialog-edit-card" || name === "hui-card-element-editor" || name === "glass-studio" || name === "hui-card-picker") return true;
    n = (n as Element).parentNode ?? ((n as unknown as ShadowRoot).host ?? null);
  }
  return false;
}

class GlassAlarmRing extends GlassElement<RingConfig> {
  static override parts = ALARM_RING_PARTS;
  static override properties = { ...GlassElement.properties, preview: { type: Boolean } };
  /** set by Home Assistant in the card editor and while the dashboard is edited: the card shows
   *  itself there (else invisible until an alarm rings) */
  declare preview: boolean;
  static getConfigElement() {
    return makeEditor(alarmRingSpec);
  }
  static getStubConfig() {
    return { display: "modal" };
  }

  private _key = "";
  private _over?: GlassAlarmRing;
  private _open = false;
  private _tick?: number;
  /** a stop / snooze sent: hidden until HA has it */
  private _done = new Set<string>();

  protected watchedEntities() {
    return ["sun.sun"];
  }

  /** night: the sun below the horizon (and a night photo – none keeps the day's) */
  private _night(): boolean {
    const c = this._config;
    if (c.style === "simple" || c.night_image === "none") return false;
    const sun = this._hass?.states["sun.sun"];
    // no sun entity: Home Assistant's dark mode stands for the night
    return sun ? sun.state === "below_horizon" : !!this._hass?.themes?.darkMode;
  }

  /** the photo's shape for the tablet's layout, once the browser has it */
  private _ratio(url: string): number | undefined {
    const known = ratios.get(url);
    if (known || ratios.has(url)) return known;
    ratios.set(url, 0);
    const img = new Image();
    img.crossOrigin = "anonymous";
    // a picture of another site without CORS: loaded again plainly (its shape only)
    img.onerror = () => {
      if (!img.crossOrigin) return;
      img.removeAttribute("crossorigin");
      img.src = url;
    };
    img.onload = () => {
      if (img.naturalWidth && img.naturalHeight) ratios.set(url, img.naturalWidth / img.naturalHeight);
      const under = bottomColour(img);
      if (under) unders.set(url, under);
      this.requestUpdate();
    };
    img.src = url;
    return undefined;
  }

  protected override validateConfig(c: RingConfig): RingConfig {
    // display: card – the alarm in the card itself (inline, its older name)
    const inline = c.inline || c.display === "card";
    return { ...c, inline, glass: c.glass ?? (c.style === "simple" ? "dark-liquid" : "none") };
  }

  /** The alarms ringing now (the cards' own: glass_alarm_<n>_ringing on). */
  private _ringing(): Ringing[] {
    const hass = this._hass;
    if (!hass) return [];
    return managedAlarms(hass)
      .map((n) => managedHelpers(n))
      .filter((h) => hass.states[h.ringing]?.state === "on" && !this._done.has(h.ringing))
      .map((h) => ({ h, name: hass.states[h.name]?.state || tr("Alarm") }));
  }

  protected override forwardHass(hass: HomeAssistant) {
    for (const id of [...this._done]) if (hass.states[id]?.state !== "on") this._done.delete(id);
    const key = this._ringing()
      .map((r) => r.h.ringing)
      .join("|");
    if (key !== this._key) {
      this._key = key;
      this.requestUpdate();
      if (!this._config?.inline) this._show(!!key);
    }
    if (this._over) this._over.hass = hass;
    if (!this._config?.overlay) void updateBlueprint(hass);
  }

  /** Not inline: the alarm over the dashboard (a copy of this card in the page) or its pop-up. */
  private _show(on: boolean) {
    const c = this._config;
    if (!c || !this.isConnected || on === this._open) return;
    this._open = on;
    if (c.display === "popup") {
      const hash = c.popup?.startsWith("#") ? c.popup : `#${c.popup ?? "alarm"}`;
      if (on && location.hash !== hash) history.pushState(null, "", `${location.pathname}${location.search}${hash}`);
      else if (!on && location.hash === hash) history.pushState(null, "", `${location.pathname}${location.search}`);
      window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
      return;
    }
    if (on) {
      // one over the page at a time (the card can sit in several views)
      onPage?.remove();
      const el = document.createElement("glass-alarm-ring") as GlassAlarmRing;
      el.setConfig({ ...(this._rawConfig as RingConfig), inline: true, overlay: true });
      if (this._hass) el.hass = this._hass;
      layerFor(this).append(el);
      onPage = el;
      this._over = el;
    } else {
      this._over?.remove();
      this._over = undefined;
    }
  }

  /** wide (700 px and more – a tablet): the whole photo, the alarm in the middle of it */
  private _ro = new ResizeObserver(([e]) => this.toggleAttribute("wide", e.contentRect.width >= 700));

  /** the address changed (a pop-up opened or closed): a sample in it shows or goes */
  private _onLoc = () => {
    if (this._config?.inline) this.requestUpdate();
    if (this._sample && !location.hash) {
      this._sample = false;
      document.documentElement.removeAttribute("glass-ring-sample");
    }
  };

  private _stop = (e: Event) => {
    if (this.hasAttribute("overlay")) e.stopPropagation();
  };

  /** in Glass Dashboard Studio or HA's card editor (which don't all set `preview`) */
  private _inEditor = false;
  private get _editing() {
    return !!this.preview || this._inEditor;
  }

  override connectedCallback() {
    super.connectedCallback();
    this._ro.observe(this);
    this._inEditor = inEditor(this);
    // over the page: a tap on it is not one outside an open pop-up (Bubble Card closes it then)
    for (const t of ["click", "pointerdown", "touchstart"]) this.addEventListener(t, this._stop);
    window.addEventListener("location-changed", this._onLoc);
    window.addEventListener("hashchange", this._onLoc);
    this._tick = window.setInterval(() => this.requestUpdate(), 15000);
    if (this._key && !this._config?.inline) queueMicrotask(() => this._show(true));
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._ro.disconnect();
    window.removeEventListener("location-changed", this._onLoc);
    window.removeEventListener("hashchange", this._onLoc);
    clearInterval(this._tick);
    this._over?.remove();
    this._over = undefined;
    this._open = false;
  }

  protected override willUpdate(changed: PropertyValues) {
    super.willUpdate(changed);
    this.toggleAttribute("overlay", !!this._config?.overlay);
    this.toggleAttribute("inline", !!this._config?.inline);
    this.toggleAttribute("editing", this._editing && !this._config?.inline);
  }

  /* ---------- stop / snooze ---------- */
  private async _act(r: Ringing | undefined, snooze: boolean) {
    if (!r || !this._hass) return;
    haptic(snooze ? "selection" : "medium");
    if (r.sample) {
      if (this._config.overlay) this.remove();
      else if (document.documentElement.hasAttribute("glass-ring-sample")) {
        // a sample in a pop-up: closed
        document.documentElement.removeAttribute("glass-ring-sample");
        history.pushState(null, "", `${location.pathname}${location.search}`);
        window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
      }
      return;
    }
    this._done.add(r.h.ringing);
    this.requestUpdate();
    if (this._config.overlay) this.remove();
    try {
      if (snooze) await snoozeAlarm(this._hass, r.h, this._config.snooze ?? 10);
      else await stopAlarm(this._hass, r.h);
    } catch (e) {
      console.warn("glass-alarm-ring:", e);
      this._done.delete(r.h.ringing);
      this.requestUpdate();
    }
  }

  /* the slider: the knob dragged to the end stops it; let go before, it springs back */
  private _slide?: { id: number; x: number; w: number };
  private _sx = 0;
  private _onKnobDown = (e: PointerEvent) => {
    const track = (e.currentTarget as HTMLElement).parentElement!;
    const knob = e.currentTarget as HTMLElement;
    this._slide = { id: e.pointerId, x: e.clientX, w: track.clientWidth - knob.offsetWidth - 8 };
    knob.setPointerCapture(e.pointerId);
    track.classList.add("dragging");
    e.stopPropagation();
  };
  private _onKnobMove = (e: PointerEvent) => {
    const s = this._slide;
    if (!s || s.id !== e.pointerId) return;
    this._sx = Math.max(0, Math.min(s.w, e.clientX - s.x));
    (e.currentTarget as HTMLElement).parentElement!.style.setProperty("--x", `${this._sx}px`);
    (e.currentTarget as HTMLElement).parentElement!.style.setProperty("--k", String(this._sx / Math.max(1, s.w)));
  };
  private _onKnobUp = (e: PointerEvent, r: Ringing | undefined) => {
    const s = this._slide;
    if (!s || s.id !== e.pointerId) return;
    this._slide = undefined;
    const track = (e.currentTarget as HTMLElement).parentElement!;
    track.classList.remove("dragging");
    const done = this._sx >= s.w * 0.85;
    this._sx = 0;
    track.style.setProperty("--x", done ? `${s.w}px` : "0px");
    track.style.setProperty("--k", done ? "1" : "0");
    if (done) void this._act(r, false);
  };

  /* swiping the alarm up: snooze */
  private _up?: { id: number; y: number; x: number };
  private _onUpDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest("button, .slide")) return;
    this._up = { id: e.pointerId, y: e.clientY, x: e.clientX };
  };
  private _onUpEnd = (e: PointerEvent, r: Ringing | undefined) => {
    const u = this._up;
    this._up = undefined;
    if (!u || u.id !== e.pointerId) return;
    const dy = u.y - e.clientY;
    if (dy > 80 && dy > Math.abs(e.clientX - u.x) * 1.5) void this._act(r, true);
  };

  /** In the editor / a dashboard being edited: where the card is and how it shows, and a sample. */
  private _placeholder() {
    const c = this._config;
    const popup = c.display === "popup";
    const hash = c.popup || "#alarm";
    const how = popup ? tr("Opens the pop-up {hash} when an alarm rings", { hash }) : tr("Shows over the dashboard when an alarm rings");
    return html`<div class="placeholder">
      <ha-icon .icon=${"mdi:alarm-bell"}></ha-icon>
      <span><b>${tr("Alarm ringing")}</b><small>${how} · ${tr("invisible until then")}</small></span>
      <button @click=${() => this._trySample(true)}>${tr("Try it")}</button>
    </div>`;
  }

  /** A sample of the alarm over the dashboard (modal) or its pop-up opened with a sample in it. */
  private _sample = false;
  private _trySample(on: boolean) {
    const c = this._config;
    if (c.display === "popup") {
      this._sample = on;
      const hash = c.popup?.startsWith("#") ? c.popup : `#${c.popup ?? "alarm"}`;
      // the card in the pop-up shows a sample while it's open (its own preview flag)
      document.documentElement.toggleAttribute("glass-ring-sample", on);
      if (on) history.pushState(null, "", `${location.pathname}${location.search}${hash}`);
      window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
      return;
    }
    if (!on) return;
    onPage?.remove();
    const el = document.createElement("glass-alarm-ring") as GlassAlarmRing;
    el.setConfig({ ...(this._rawConfig as RingConfig), inline: true, overlay: true, preview: true });
    if (this._hass) el.hass = this._hass;
    layerFor(this).append(el);
    onPage = el;
  }

  protected override glassUnder(el: HTMLElement): Element | undefined {
    return el.closest(".frame")?.querySelector(".photo") ?? undefined;
  }

  override render() {
    const c = this._config;
    if (!c) return nothing;
    if (!c.inline) return this._editing ? this._placeholder() : nothing;
    const list = this._ringing();
    const sample = c.preview || this._sample || (!c.overlay && document.documentElement.hasAttribute("glass-ring-sample"));
    const r = list[0] ?? (sample ? ({ h: managedHelpers(1), name: tr("Alarm"), sample: true } as Ringing) : undefined);
    if (!r) return nothing;
    const photo = c.style !== "simple";
    const now = new Date();
    const clock = clockParts(this._hass, now.getHours(), now.getMinutes());
    const date = new Intl.DateTimeFormat(language(this._hass), { weekday: "long", day: "numeric", month: "long" }).format(now);
    const night = photo && this._night();
    const panel = !photo
      ? undefined
      : night
        ? matPart(c.night_panel_glass ?? "dark-liquid-gl", c.night_panel_color, "dark-liquid-gl")
        : matPart(c.panel_glass ?? "liquid-gl", c.panel_color, "liquid-gl");
    const image = night ? c.night_image || nightPhoto() : c.image || morningPhoto();
    const ratio = photo ? this._ratio(image) : undefined;
    // Snooze and the slider: plain (no glass) unless controls_glass names one
    const ctl = matPart(c.controls_glass, c.controls_color, "dark");
    const minutes = c.snooze ?? 10;
    const more = list.length > 1 ? html`<span class="more">+${list.length - 1}</span>` : nothing;
    return html`<div
      class="frame ${this.tile} ${photo ? "photo-style" : "simple"} ${night ? "night" : ""}"
      style=${[ratio ? `--ring-photo-ratio:${ratio}` : "", unders.has(image) ? `--ring-under:${unders.get(image)}` : ""].join(";")}
      @pointerdown=${this._onUpDown}
      @pointerup=${(e: PointerEvent) => this._onUpEnd(e, r)}
      @pointercancel=${() => (this._up = undefined)}
    >
      ${photo ? html`<div class="photo" style="background-image:url('${image}')"></div>` : nothing}
      <div class="panel ${panel?.cls ?? ""}" style=${panel?.style ?? ""}>
        <div class="label"><ha-icon .icon=${"mdi:alarm"}></ha-icon><span class="aname">${r.name}</span>${more}</div>
        <div class="now">${clock.time}${clock.ap ? html`<small>${clock.ap}</small>` : nothing}</div>
        <div class="date">${date}</div>
        <button class="snooze ${ctl?.cls ?? ""}" style=${ctl?.style ?? ""} @click=${() => this._act(r, true)}>
          <ha-icon .icon=${"mdi:alarm-snooze"}></ha-icon><span>${tr("Snooze")}</span><small>${tr("{n} min", { n: minutes })}</small>
        </button>
        <div class="slide ${ctl?.cls ?? ""}" style=${ctl?.style ?? ""}>
          <span class="hint">${tr("Slide to stop")}</span>
          <button
            class="knob"
            aria-label=${tr("Stop the alarm")}
            @pointerdown=${this._onKnobDown}
            @pointermove=${this._onKnobMove}
            @pointerup=${(e: PointerEvent) => this._onKnobUp(e, r)}
            @pointercancel=${(e: PointerEvent) => this._onKnobUp(e, r)}
            @keydown=${(e: KeyboardEvent) => (e.key === "Enter" || e.key === "ArrowRight") && this._act(r, false)}
          >
            <ha-icon .icon=${"mdi:chevron-double-right"}></ha-icon>
          </button>
        </div>
      </div>
    </div>`;
  }

  static override styles = [
    GlassElement.styles,
    surface,
    css`
      :host {
        display: block;
      }
      :host(:not([inline]):not([editing])) {
        display: none;
      }
      .placeholder {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 14px;
        border-radius: 16px;
        border: 1px dashed color-mix(in srgb, currentColor 35%, transparent);
        color: var(--primary-text-color, inherit);
        background: color-mix(in srgb, var(--card-background-color, #fff) 70%, transparent);
      }
      .placeholder ha-icon {
        --mdc-icon-size: 26px;
        flex: none;
      }
      .placeholder span {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
        font-size: 14px;
      }
      .placeholder small {
        font-size: 12px;
        opacity: 0.7;
      }
      .placeholder button {
        flex: none;
        border: 0;
        border-radius: 999px;
        padding: 8px 14px;
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        color: #fff;
        background: var(--primary-color, #03a9f4);
      }
      /* over the dashboard: the page dimmed and blurred behind it */
      :host([overlay]) {
        position: fixed;
        inset: 0;
        z-index: 10;
        display: grid;
        place-items: center;
        padding: 16px;
        box-sizing: border-box;
        /* the photo as tall as the screen allows: only this padding around it */
        --ring-space: 32px;
        background: rgba(0, 0, 0, 0.35);
        -webkit-backdrop-filter: blur(24px);
        backdrop-filter: blur(24px);
        animation: fade 0.3s ease;
      }
      :host([overlay]) .frame {
        width: min(460px, 100%);
      }
      :host([overlay]) .photo-style {
        min-height: min(680px, calc(100vh - 32px));
      }
      /* narrow (a phone): the photo above the glass, whole across (a wide photo in a tall frame),
         under it the photo's own bottom colour – the WebGL glass carries the photo's last row on
         beyond its edge, so the page and the glass meet without a seam */
      :host(:not([wide])) .photo-style {
        background: var(--ring-under, #d9d6d2);
      }
      :host(:not([wide])) .photo-style .photo {
        bottom: 34%;
        background-size: cover;
        background-position: 50% 100%;
      }
      /* wide (a tablet): the whole photo, the alarm's card in the middle of it */
      :host([wide]) .photo-style {
        align-items: center;
        justify-content: center;
        /* as tall as the photo allows (3:2, the cards' own) – never taller than the screen */
        max-height: calc(100dvh - var(--ring-space, 120px));
        width: 100%;
        box-sizing: border-box;
        aspect-ratio: var(--ring-photo-ratio, 3 / 2);
        min-height: 0;
        padding: 24px;
      }
      :host([wide]) .photo-style .panel {
        width: min(420px, 100%);
      }
      :host([wide][overlay]) .frame {
        width: 100%;
        height: 100%;
        aspect-ratio: auto;
      }
      @keyframes fade {
        from {
          opacity: 0;
        }
      }
      .frame {
        position: relative;
        overflow: hidden;
        border-radius: var(--glass-radius, 28px);
        color: #fff;
        touch-action: pan-x;
        user-select: none;
      }
      .frame.simple {
        padding: 24px 20px 20px;
        color: var(--g-text, inherit);
      }
      .photo {
        position: absolute;
        inset: 0;
        background-size: cover;
        background-position: center;
      }
      .photo-style {
        min-height: 520px;
        display: flex;
        align-items: flex-end;
        padding: 14px;
        box-sizing: border-box;
      }
      .panel {
        position: relative;
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        text-align: center;
      }
      .photo-style .panel {
        padding: 18px 16px 16px;
        border-radius: calc(var(--glass-radius, 28px) - 10px);
        box-sizing: border-box;
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
      }
      .label {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 15px;
        font-weight: 600;
        opacity: 0.92;
      }
      .label ha-icon {
        --mdc-icon-size: 18px;
        animation: ring 1.2s ease-in-out infinite;
      }
      @keyframes ring {
        0%,
        60%,
        100% {
          transform: rotate(0);
        }
        10%,
        30%,
        50% {
          transform: rotate(-14deg);
        }
        20%,
        40% {
          transform: rotate(14deg);
        }
      }
      .more {
        font-size: 12px;
        padding: 1px 7px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.2);
      }
      .now {
        font-size: clamp(56px, 18vw, 84px);
        font-weight: 600;
        line-height: 1;
        letter-spacing: -0.02em;
        font-variant-numeric: tabular-nums;
      }
      .now small {
        font-size: 0.32em;
        margin-left: 6px;
      }
      .date {
        font-size: 15px;
        opacity: 0.85;
        margin-bottom: 12px;
        text-transform: capitalize;
      }
      .snooze {
        width: 100%;
        height: 58px;
        border-radius: 999px;
        border: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        font: inherit;
        font-size: 18px;
        font-weight: 600;
        color: inherit;
        background: rgba(255, 255, 255, 0.22);
        cursor: pointer;
      }
      .snooze small {
        font-size: 14px;
        font-weight: 500;
        opacity: 0.8;
      }
      .slide {
        --x: 0px;
        --k: 0;
        position: relative;
        width: 100%;
        height: 58px;
        border-radius: 999px;
        background: rgba(0, 0, 0, 0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        margin-top: 4px;
      }
      .hint {
        font-size: 15px;
        font-weight: 500;
        opacity: calc(0.85 - var(--k) * 0.85);
        padding-left: 40px;
        background: linear-gradient(90deg, rgba(255, 255, 255, 0.55) 0%, #fff 50%, rgba(255, 255, 255, 0.55) 100%);
        background-size: 200% 100%;
        -webkit-background-clip: text;
        background-clip: text;
        -webkit-text-fill-color: transparent;
        animation: shine 2.4s linear infinite;
      }
      @keyframes shine {
        from {
          background-position: 100% 0;
        }
        to {
          background-position: -100% 0;
        }
      }
      .knob {
        position: absolute;
        left: 4px;
        top: 4px;
        width: 50px;
        height: 50px;
        border-radius: 50%;
        border: 0;
        background: #fff;
        color: #1c1c1e;
        display: grid;
        place-items: center;
        cursor: grab;
        touch-action: none;
        transform: translateX(var(--x));
        transition: transform 0.3s cubic-bezier(0.3, 1.4, 0.5, 1);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
      }
      .slide.dragging .knob {
        transition: none;
        cursor: grabbing;
      }
      .knob ha-icon {
        --mdc-icon-size: 26px;
      }
      /* the photo: the light liquid glass (WebGL) over it, the photo bent and clear through it –
         dark text on it, as on any light glass (a colour of its own: its text colour) */
      .photo-style .panel {
        color: var(--ring-text, #1d1d1f);
        text-shadow: 0 1px 2px rgba(255, 255, 255, 0.45);
        /* dark text: no darkening behind it (the shader's legibility is for white text), and
           little blur – the clock under the glass stays clear, only bent */
        --glass-liquid-contrast: 0;
        --glass-liquid-tint: 0.06;
        --glass-liquid-blur: 3;
      }
      /* the controls from the text's colour: on light glass and on dark */
      .frame .slide {
        background: color-mix(in srgb, currentColor 12%, transparent);
      }
      .frame .snooze:not(.mat) {
        background: color-mix(in srgb, currentColor 10%, transparent);
      }
      /* on the photo's light glass: a white button, a darker track – solid, not glass */
      .photo-style .snooze:not(.mat) {
        background: rgba(255, 255, 255, 0.85);
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
      }
      .photo-style .slide:not(.mat) {
        background: rgba(0, 0, 0, 0.14);
      }
      /* night: the dark liquid glass (WebGL), white text on it */
      .photo-style.night .panel {
        color: var(--ring-night-text, #fff);
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
        --glass-liquid-contrast: initial;
        --glass-liquid-tint: initial;
        --glass-liquid-blur: initial;
      }
      .photo-style.night .snooze:not(.mat) {
        background: rgba(255, 255, 255, 0.16);
        box-shadow: none;
      }
      .photo-style.night .slide:not(.mat) {
        background: rgba(255, 255, 255, 0.14);
      }
      .frame .hint {
        background: none;
        -webkit-text-fill-color: currentColor;
        animation: none;
        opacity: calc(0.75 - var(--k) * 0.75);
      }
      .frame .knob {
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
      }
    `,
    materials,
  ];
}

registerCard("glass-alarm-ring", GlassAlarmRing, {
  name: "Glass – alarm ringing",
  description: "An alarm of the Glass alarms card ringing: Snooze and slide to stop, over the dashboard or in a pop-up; a morning photo under liquid glass, or simple.",
});
