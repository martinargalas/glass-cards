import { tr } from "../i18n";
import { css, html, nothing, render as litRender, type CSSResult, type TemplateResult } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { GlassElement } from "../core/glass-element";
import type { BaseCardConfig } from "../core/types";
import { registerCard } from "../core/registry";
import { conditionEntities, evalCondition, type Condition } from "../core/conditions";
import { control } from "../core/styles";
import { haptic } from "../core/actions";
import { makeEditor } from "../editor/editor";
import { notificationsSpec } from "../editor/specs";
import { NOTIFICATIONS_PARTS } from "../core/card-parts";

/**
 * Notifications: one pill with the most important message, the others counted
 * (+2); a tap opens the list. A new message drops in from the top.
 *
 * Two kinds:
 *  - kept in `sensor.glass_notifications` (a trigger-based template sensor): sent by
 *    automations through `script.glass_notify` (id, level, title, message, icon, ttl),
 *    dismissed everywhere through `script.glass_notify_dismiss`
 *  - alerts defined here, shown while their condition holds; dismissing one hides it
 *    everywhere for an hour (a "snooze" note in the sensor)
 *
 *   type: custom:glass-notifications
 *   entity: sensor.glass_notifications
 *   place: between          # between: in a row next to the status chips – into the gap
 *                           #   after them, over the next card (portraits) when it's short;
 *                           # block: a full-width line of its own;
 *                           # overlay: over the panel it sits in, its other cards hidden meanwhile (phones)
 *   size: 36
 *   alerts:
 *     - id: mower_stuck
 *       level: alert        # info / warning / alert
 *       icon: mdi:robot-mower
 *       title: Sekačka se zasekla
 *       message: Potřebuje pomoc   # {state}: the condition entity's state
 *       condition: { entity: lawn_mower.luba, state: error }
 */
type Level = "info" | "warning" | "alert";

interface Note {
  id: string;
  level: Level | "snooze";
  title?: string;
  message?: string;
  icon?: string;
  time?: number;
  expires?: number;
  /** defined in the card: dismissing snoozes it */
  local?: boolean;
}

interface AlertConfig {
  id: string;
  level?: Level;
  icon?: string;
  title?: string;
  message?: string;
  condition: Condition;
}

interface NotificationsConfig extends BaseCardConfig {
  entity?: string;
  place?: "between" | "block" | "overlay";
  size?: number;
  alerts?: AlertConfig[];
  snooze?: number;
}

const RANK: Record<string, number> = { alert: 3, warning: 2, info: 1 };
const ICON: Record<Level, string> = { info: "mdi:information-outline", warning: "mdi:alert-outline", alert: "mdi:alert-octagon-outline" };

class GlassNotifications extends GlassElement<NotificationsConfig> {
  static override wrapTile = true;
  static override parts = NOTIFICATIONS_PARTS;
  static override properties = { ...GlassElement.properties, _open: { state: true }, _shift: { state: true }, _maxw: { state: true }, _leaving: { state: true } };
  /** dismissed, sliding up and away (then hidden here until the sensor drops it) */
  declare _leaving: string[];
  private _gone = new Set<string>();
  /** which side the next message comes from – below and above in turn */
  private _fromAbove = false;
  private _topId?: string;
  private _shownTop?: Note;
  /** the front one went away by itself (expired, dismissed elsewhere): shown leaving for a moment */
  private _exiting?: Note;
  /** between: the widest the pill may get – up to the row's inner right edge */
  declare _maxw: number | undefined;
  declare _open: boolean;
  /** between: px the pill moves left from the slot's right edge to start just after the chips (negative: over the next card) */
  declare _shift: number | undefined;
  private _ro?: ResizeObserver;
  private _known = new Set<string>();
  private _fresh?: string;
  private _tick?: number;

  constructor() {
    super();
    this._open = false;
    this._leaving = [];
  }

  static getConfigElement() {
    return makeEditor(notificationsSpec);
  }

  static getStubConfig() {
    return { entity: "sensor.glass_notifications" };
  }

  private get _entity() {
    return this._config?.entity ?? "sensor.glass_notifications";
  }

  protected watchedEntities(c: NotificationsConfig) {
    const out = new Set<string>([c.entity ?? "sensor.glass_notifications"]);
    for (const a of c.alerts ?? []) conditionEntities(a.condition, undefined, out);
    return out;
  }

  /** What's on now: the sensor's notes (unexpired, not snoozes) and the alerts whose condition holds, not snoozed. */
  private _notes(): Note[] {
    const hass = this._hass;
    if (!hass) return [];
    const now = Date.now() / 1000;
    const kept = ((hass.states[this._entity]?.attributes.notes as Note[] | undefined) ?? []).filter((n) => !n.expires || n.expires > now);
    const snoozed = new Set(kept.filter((n) => n.level === "snooze").map((n) => n.id.replace(/^snooze:/, "")));
    const local: Note[] = (this._config.alerts ?? [])
      .filter((a) => !snoozed.has(a.id) && evalCondition(a.condition, hass))
      .map((a) => {
        // {state}: the condition entity's state, e.g. the error a robot reports
        const ent = (a.condition as { entity?: string } | undefined)?.entity;
        const fill = (t?: string) => t?.replace("{state}", ent ? (hass.states[ent]?.state ?? "") : "");
        return { id: a.id, level: a.level ?? "warning", title: fill(a.title), message: fill(a.message), icon: a.icon, local: true };
      });
    return [...local, ...kept.filter((n) => n.level !== "snooze")].sort(
      (a, b) => (RANK[b.level] ?? 0) - (RANK[a.level] ?? 0) || (b.time ?? Infinity) - (a.time ?? Infinity),
    );
  }

  private _dismiss(n: Note, e?: Event) {
    e?.stopPropagation();
    if (this._leaving.includes(n.id)) return;
    haptic();
    // up and away first, then the sensor forgets it (everywhere)
    this._leaving = [...this._leaving, n.id];
    const wasTop = n.id === this._topId;
    setTimeout(() => {
      if (wasTop) this._fromAbove = !this._fromAbove;
      this._gone.add(n.id);
      this._leaving = this._leaving.filter((x) => x !== n.id);
      this._send(n);
    }, 380);
  }

  private _send(n: Note) {
    if (n.local)
      this._hass?.callService("script", "glass_notify", { id: `snooze:${n.id}`, level: "snooze", ttl: this._config.snooze ?? 3600 });
    else this._hass?.callService("script", "glass_notify_dismiss", { id: n.id });
  }

  private _ago(t?: number) {
    if (!t) return "";
    const m = Math.round((Date.now() / 1000 - t) / 60);
    if (m < 1) return tr("now");
    if (m < 60) return tr("{n} min ago", { n: m });
    return tr("{n} h ago", { n: Math.round(m / 60) });
  }

  override connectedCallback() {
    super.connectedCallback();
    // ages and expiries move on without a state change
    this._tick = window.setInterval(() => this.requestUpdate(), 60_000);
    document.addEventListener("pointerdown", this._outside, true);
    window.addEventListener("scroll", this._shut, { capture: true, passive: true });
    window.addEventListener("resize", this._float);
  }

  /** the page scrolls: the list would hang where the pill was – shut it (its own scrolling aside) */
  private _shut = (e: Event) => {
    const path = e.composedPath();
    if (this._open && !path.includes(this) && !(this._floatHost && path.includes(this._floatHost))) this._open = false;
    this._float();
  };

  override disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this._tick);
    this._ro?.disconnect();
    this._ro = undefined;
    document.removeEventListener("pointerdown", this._outside, true);
    window.removeEventListener("scroll", this._shut, { capture: true });
    window.removeEventListener("resize", this._float);
    this._floatHost?.remove();
    this._floatHost = undefined;
    this._cover(false);
  }

  private _outside = (e: Event) => {
    const path = e.composedPath();
    if (this._open && !path.includes(this) && !(this._floatHost && path.includes(this._floatHost))) this._open = false;
  };

  /** overlay: the panel's other cards step aside while a message lies over them */
  private _covered = false;
  private _cover(on: boolean) {
    if (on === this._covered) return;
    this._covered = on;
    for (const el of Array.from(this.parentElement?.children ?? []))
      if (el !== this) (el as HTMLElement).style.visibility = on ? "hidden" : "";
  }

  /** The status chips next to this card (same container) – the pill starts after their last chip. */
  private _chips(): HTMLElement | undefined {
    const root = this.getRootNode() as ParentNode;
    return (root.querySelector?.("glass-status-bar") as HTMLElement | null) ?? undefined;
  }

  private _measure = () => {
    if (this._config?.place === "block" || this._config?.place === "overlay") return;
    const pill = this.renderRoot.querySelector(".pill") as HTMLElement | null;
    if (!pill) {
      this._shift = undefined;
      return;
    }
    const bar = this._chips();
    const panel = (this.getRootNode() as ParentNode).querySelector?.(".panel") as HTMLElement | null;
    const box = panel?.getBoundingClientRect();
    const pad = panel ? getComputedStyle(panel) : undefined;
    const chips = bar?.shadowRoot?.querySelectorAll(".chip");
    // from just after the status chips; with none in the row (a date, a title…), from the row's inner left edge
    const start = bar
      ? (chips?.length ? (chips[chips.length - 1] as HTMLElement).getBoundingClientRect().right : bar.getBoundingClientRect().left) + 12
      : box
        ? box.left + (parseFloat(pad!.paddingLeft) || 0)
        : 12;
    const slot = this.getBoundingClientRect().right;
    // the row's inner right edge (the panel's padding stays clear): never past it; with no chips
    // to start after, never over the next card either – a long message is cut short instead
    const end = !bar ? slot : box ? box.right - (parseFloat(pad!.paddingRight) || 0) : window.innerWidth - 12;
    const maxw = Math.max(120, Math.floor(end - start));
    if (maxw !== this._maxw) this._maxw = maxw;
    const w = Math.min(pill.offsetWidth, maxw);
    // fits in the gap: right-aligned in the slot; else from just after the chips, over the next card
    const shift = slot - start >= w ? 0 : Math.round(slot - start - w);
    if (shift !== this._shift) this._shift = shift;
  };

  /** The list sits on the page's body (see _floatRoot), over every card around – the
   *  panels contain their own stacking, so a z-index alone would end under the next one. */
  private _place() {
    const list = this._floatHost?.shadowRoot?.querySelector(".list.float") as HTMLElement | null;
    const pill = this.renderRoot.querySelector(".pill") as HTMLElement | null;
    if (!list || !pill) return;
    const r = pill.getBoundingClientRect();
    const block = this._config.place === "block" || this._config.place === "overlay";
    list.style.top = `${Math.round(r.bottom + 8)}px`;
    if (block) {
      list.style.left = `${Math.round(r.left)}px`;
      list.style.width = `${Math.round(r.width)}px`;
    } else list.style.right = `${Math.round(window.innerWidth - r.right)}px`;
  }

  /** overlay: the window is drawn into an element of its own on the page's body (like the
   *  radial menu) – over everything, in every browser, from the first frame of its arrival */
  private _floatHost?: HTMLElement;
  private _floatTpl?: TemplateResult;
  private _floatRoot(): ShadowRoot {
    if (!this._floatHost) {
      const h = document.createElement("div");
      h.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:9998;display:block";
      const root = h.attachShadow({ mode: "open" });
      root.adoptedStyleSheets = (this.constructor as typeof GlassNotifications).elementStyles
        .map((st) => (st as CSSResult).styleSheet)
        .filter((st): st is CSSStyleSheet => !!st);
      document.body.appendChild(h);
      this._floatHost = h;
    }
    return this._floatHost.shadowRoot!;
  }

  /** (was: the window lives in the top layer too (over everything from the first frame of
   *  its arrival), laid over the panel this card sits in */
  private _float = () => {
    if (this._config?.place !== "overlay" || !this._floatHost) return;
    const wrap = this._floatHost.shadowRoot!.querySelector(".wrap.overlay") as HTMLElement | null;
    if (!wrap) return;
    const r = this.getBoundingClientRect();
    wrap.style.left = `${Math.round(r.left + 6)}px`;
    wrap.style.width = `${Math.round(r.width - 12)}px`;
    wrap.style.top = `${Math.round(r.top + 6)}px`;
  };

  protected override updated(changed: Map<PropertyKey, unknown>) {
    super.updated(changed);
    if (this._floatTpl || this._floatHost) {
      const root = this._floatRoot();
      this._floatHost!.toggleAttribute("dark", this.hasAttribute("dark"));
      litRender(this._floatTpl ?? nothing, root);
    }
    this._float();
    if (this._open) this._place();
    if (this._config?.place !== "block" && this._config?.place !== "overlay") {
      if (!this._ro) {
        this._ro = new ResizeObserver(() => this._measure());
        this._ro.observe(this);
        const bar = this._chips();
        if (bar) this._ro.observe(bar);
        const pill = this.renderRoot.querySelector(".pill");
        if (pill) this._ro.observe(pill);
      }
      requestAnimationFrame(this._measure);
    }
  }

  private _row(n: Note, top: boolean) {
    const level = n.level as Level;
    return html`<span class="note ${level}">
      <ha-icon class="lvl" .icon=${n.icon || ICON[level] || ICON.info}></ha-icon>
      <span class="txt">
        <span class="title">${n.title || n.message}</span>
        ${n.title && n.message ? html`<span class="msg">${n.message}</span>` : nothing}
      </span>
      ${(!top || this._config.place === "overlay") && n.time ? html`<span class="ago">${this._ago(n.time)}</span>` : nothing}
    </span>`;
  }

  protected override render() {
    const c = this._config;
    if (!c || !this._hass) return nothing;
    const all = this._notes();
    // the dismissed stay hidden until the sensor (or the snooze) takes them away
    for (const id of this._gone) if (!all.some((n) => n.id === id)) this._gone.delete(id);
    let notes = all.filter((n) => !this._gone.has(n.id));
    // the front one went away by itself: bounce and up, like a dismissed one
    const was = this._shownTop;
    if (was && !this._exiting && !this._gone.has(was.id) && !this._leaving.includes(was.id) && !notes.some((n) => n.id === was.id)) {
      this._exiting = was;
      setTimeout(() => {
        if (this._exiting?.id === was.id) {
          if (was.id === this._topId) this._fromAbove = !this._fromAbove;
          this._exiting = undefined;
          this._shownTop = undefined;
          this.requestUpdate();
        }
      }, 380);
    }
    if (this._exiting) notes = [this._exiting, ...notes.filter((n) => n.id !== this._exiting!.id)];
    this._shownTop = this._exiting ? this._shownTop : notes[0];
    this.toggleAttribute("empty", !notes.length);
    this.toggleAttribute("block", c.place === "block");
    this.toggleAttribute("overlay", c.place === "overlay");

    if (!notes.length) {
      this._floatTpl = undefined;
      return nothing;
    }
    const top = notes[0];
    // a message not seen before drops in from the top – keyed by id and time, so one sent
    // again under the same id (replacing the old one) arrives anew too
    const key = (n: Note) => `${n.id}@${n.time ?? ""}`;
    const fresh = new Set(notes.filter((n) => !this._known.has(key(n))).map(key));
    if (!this._known.has(key(top))) this._fresh = key(top);
    const leavingTop = this._leaving.includes(top.id) || this._exiting?.id === top.id;
    for (const n of notes) this._known.add(key(n));
    const more = notes.length - 1;
    const block = c.place === "block" || c.place === "overlay";
    const pos = block || this._shift === undefined ? "" : this._shift === 0 ? "right:0" : `right:${this._shift}px`;
    const maxw = !block && this._maxw ? `;--maxw:${this._maxw}px` : "";
    // the chips' glass – except the phone's floating window, which has the list's own
    const glass = "control glass";
    // the others wait behind it, one peeking out below and one above; the next one (in turn
    // from below and from above) moves to the middle when the front one leaves
    this._topId = top.id;
    const next = this._fromAbove ? "up" : "down";
    const other = next === "up" ? "down" : "up";
    const backs = notes.length > 2 ? [next, other] : notes.length > 1 ? [next] : [];
    const row = (n: Note) => html`<div
      class="item ${n.level} ${this._leaving.includes(n.id) || this._exiting?.id === n.id ? "lift" : ""} ${fresh.has(key(n)) ? "drop" : ""}"
    >
      <button class="x" aria-label=${tr("Dismiss")} @click=${(e: Event) => this._dismiss(n, e)}>
        <ha-icon icon="mdi:close"></ha-icon>
      </button>
      ${this._row(n, false)}
    </div>`;
    // on a phone: no pill – the window with every message drops in straight away, floating
    // over the panel; a new message drops into it from the top, a dismissed one goes up
    if (c.place === "overlay") {
      this._floatTpl = html`<div class="wrap overlay ${leavingTop && notes.length === 1 ? "leave" : ""}">
        <div class="list sheet">${repeat(notes, (n) => key(n), row)}</div>
      </div>`;
      return nothing;
    }
    // the list: drawn on the page's body as well, over every card around
    this._floatTpl = this._open
      ? html`<div class="list float" style="--maxw:${this._maxw ?? 420}px">${repeat(notes, (n) => key(n), row)}</div>`
      : undefined;
    return html`<div class="wrap ${block ? "block" : "between"} ${leavingTop ? (notes.length === 1 ? "leave" : "advance") : ""}" style="--h:${c.size ?? 36}px;${pos}${maxw}">
      ${backs.map((side, i) => html`<span class="back ${glass} ${side} ${i === 0 ? "next" : ""}" aria-hidden="true"></span>`)}
      <button class="pill ${glass} ${top.level}" @click=${() => (haptic("selection"), (this._open = !this._open))} aria-expanded=${this._open}>
        <span class="x" role="button" aria-label=${tr("Dismiss")} @click=${(e: Event) => this._dismiss(top, e)}>
          <ha-icon icon="mdi:close"></ha-icon>
        </span>
        ${repeat(
          [top],
          (n) => key(n),
          (n) => html`<span class="cur ${this._fresh === key(n) ? "drop" : ""}" @animationend=${() => (this._fresh = undefined)}>${this._row(n, true)}</span>`,
        )}
        ${more ? html`<span class="more">+${more}</span>` : nothing}
      </button>

    </div>`;
  }

  static override styles = [
    GlassElement.styles,
    control,
    css`
      :host {
        display: block;
        position: relative;
        z-index: 4;
        --n-info: var(--g-text);
        --n-warning: var(--glass-color-orange, #ff9f0a);
        --n-alert: var(--glass-color-red, #ff453a);
      }
      /* between the chips and the portraits: takes no room of its own, the pill hangs from its right edge */
      :host(:not([empty])) {
        align-self: stretch;
        width: 0;
        min-width: 0;
        flex: none !important;
      }
      :host([empty]) {
        display: none;
      }
      .wrap.between {
        position: absolute;
        top: 50%;
        right: 0;
        transform: translateY(-50%);
      }
      .wrap.block {
        position: relative;
      }
      :host([block]:not([empty])) {
        width: auto;
        flex: 1 1 100% !important;
      }
      .pill {
        display: flex;
        align-items: center;
        gap: 8px;
        height: var(--h);
        max-width: min(420px, 70vw, var(--maxw, 420px));
        box-sizing: border-box;
        padding: 0 12px 0 4px;
        border-radius: 999px;
        font: inherit;
        text-align: left;
        color: var(--g-text);
        cursor: pointer;
        overflow: hidden;
        -webkit-tap-highlight-color: transparent;
      }
      .pill {
        position: relative;
        z-index: 1;
      }
      /* the waiting ones peek out above and below the front one, fainter */
      .back {
        position: absolute;
        inset: 0;
        z-index: 0;
        border-radius: 999px;
        pointer-events: none;
        opacity: 0.6;
        transition:
          transform 0.4s cubic-bezier(0.2, 1.2, 0.4, 1),
          opacity 0.4s ease;
      }
      /* offset only up and down – the same width and left edge as the front one */
      .back.up {
        transform: translateY(-8px);
      }
      .back.down {
        transform: translateY(8px);
      }
      /* the front one leaves: the next one moves to the middle */
      .advance .back.next {
        transform: none;
        opacity: 1;
      }
      .advance .pill {
        animation: lift-pill 0.38s cubic-bezier(0.5, 0, 0.75, 0) forwards;
      }
      /* overlay: the message covers the whole panel it sits in */
      /* overlay: only marks out the panel (the window floats in the top layer) – taps go through */
      :host([overlay]:not([empty])) {
        position: absolute !important;
        inset: 0;
        width: auto;
        flex: none !important;
        z-index: 5;
        pointer-events: none;
      }
      /* a pill across the panel, centred in its height (the panel's own cards hidden meanwhile) */
      .wrap.overlay {
        position: fixed;
        inset: auto;
        margin: 0;
        padding: 0;
        border: 0;
        background: none;
        color: inherit;
        overflow: visible;
        pointer-events: auto;
      }
      /* the window itself: the list's look, in place – fuller, so the panel under it can't be
         read even before the blur is there */
      .list.sheet {
        position: relative;
        width: auto;
        animation: none;
        background-color: rgba(28, 32, 56, 0.88);
      }
      /* arriving: by position only – fading it would switch the blur off until the end */
      :host(:not([empty])) .wrap.overlay {
        animation: arrive 0.7s ease-out;
      }
      @keyframes arrive {
        0% {
          translate: 0 -110%;
        }
        45% {
          translate: 0 8px;
        }
        70% {
          translate: 0 -3px;
        }
        88% {
          translate: 0 1px;
        }
        100% {
          translate: 0 0;
        }
      }
      .item.drop {
        animation: drop 0.7s ease-out;
      }
      /* on a phone: a floating window, like the list's – dark glass, a deep shadow, white text;
         the panel under it shows through, blurred */
      .overlay .pill,
      .overlay .back {
        border-radius: 22px;
        background: var(--glass-control-bg) !important;
        box-shadow: var(--glass-control-shadow), 0 12px 32px rgba(0, 0, 0, 0.3) !important;
        -webkit-backdrop-filter: blur(calc(24px * var(--glass-blur-scale, 1))) saturate(160%);
        backdrop-filter: blur(calc(24px * var(--glass-blur-scale, 1))) saturate(160%);
        border: 0 !important;
      }
      .overlay .pill {
        padding: 0 6px 0 14px;
        gap: 10px;
        color: var(--glass-home-side-text, #fff);
        --g-text: var(--glass-home-side-text, #fff);
        --g-text-2: var(--glass-home-side-text-2, rgba(235, 235, 245, 0.6));
        --n-info: #fff;
      }
      .overlay .pill.alert {
        box-shadow:
          inset 0 0 0 1.5px color-mix(in srgb, var(--n-alert) 70%, transparent),
          0 12px 32px rgba(0, 0, 0, 0.3) !important;
      }
      .overlay .back {
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2) !important;
      }
      .overlay .txt {
        flex: 1;
        flex-direction: column;
        align-items: stretch;
        gap: 2px;
      }
      .overlay .title,
      .overlay .msg {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .overlay .title {
        font-size: 15px;
      }
      .overlay .msg {
        font-size: 13px;
      }
      .overlay .lvl {
        --mdc-icon-size: 24px;
      }
      .block .pill {
        width: 100%;
        max-width: none;
      }
      .pill.alert {
        box-shadow:
          inset 0 0 0 1.5px color-mix(in srgb, var(--n-alert) 70%, transparent),
          0 4px 12px rgba(0, 0, 0, 0.1);
      }
      .cur {
        flex: 1;
        min-width: 0;
        display: flex;
      }
      /* a new message drops in from above */
      /* arriving: down from above, a little past its place, a bounce back – then still */
      .cur.drop {
        animation: drop 0.7s ease-out;
      }
      @keyframes drop {
        0% {
          transform: translateY(-120%);
          opacity: 0;
        }
        45% {
          transform: translateY(14%);
          opacity: 1;
        }
        70% {
          transform: translateY(-6%);
        }
        88% {
          transform: translateY(2%);
        }
        100% {
          transform: none;
        }
      }
      @keyframes open {
        from {
          opacity: 0;
          translate: 0 -8px;
        }
      }
      /* dismissed: up and away – the message alone, or the whole pill with the last one */
      .lift {
        animation: lift 0.38s cubic-bezier(0.5, 0, 0.75, 0) forwards;
      }
      .wrap.leave {
        animation: lift-pill 0.38s cubic-bezier(0.5, 0, 0.75, 0) forwards !important;
      }
      @keyframes lift {
        to {
          transform: translateY(-120%);
          opacity: 0;
        }
      }
      @keyframes lift-pill {
        to {
          translate: 0 -32px;
          opacity: 0;
        }
      }
      :host(:not([empty])) .wrap {
        animation: appear 0.7s ease-out;
      }
      @keyframes appear {
        0% {
          opacity: 0;
          translate: 0 -32px;
        }
        45% {
          opacity: 1;
          translate: 0 6px;
        }
        70% {
          translate: 0 -3px;
        }
        88% {
          translate: 0 1px;
        }
        100% {
          translate: 0 0;
        }
      }
      .note {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .lvl {
        flex: none;
        --mdc-icon-size: 18px;
        display: flex;
        color: var(--n-info);
      }
      .warning .lvl {
        color: var(--n-warning);
      }
      .alert .lvl {
        color: var(--n-alert);
      }
      .pill.alert .lvl {
        animation: pulse 1.8s ease-in-out infinite;
      }
      @keyframes pulse {
        50% {
          opacity: 0.45;
        }
      }
      .txt {
        min-width: 0;
        display: flex;
        align-items: baseline;
        gap: 6px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .title {
        font-size: 12.5px;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .msg {
        font-size: 12px;
        color: var(--g-text-2);
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .more {
        flex: none;
        font-size: 11.5px;
        font-weight: 700;
        padding: 2px 7px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.18);
      }
      .x {
        flex: none;
        width: calc(var(--h) - 10px);
        height: calc(var(--h) - 10px);
        padding: 0;
        border: 0;
        border-radius: 50%;
        display: grid;
        place-items: center;
        background: none;
        color: var(--g-text-2);
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }
      .x ha-icon {
        --mdc-icon-size: 16px;
        display: flex;
      }
      /* the list: under the pill (placed there in the top layer), every message with its age and ✕ */
      .list.float {
        pointer-events: auto;
      }
      .list {
        position: fixed;
        inset: auto;
        margin: 0;
        border: 0;
        width: min(420px, 86vw, max(var(--maxw, 420px), 280px));
        max-height: 60vh;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 6px;
        border-radius: 22px;
        background: var(--glass-control-bg);
        box-shadow: var(--glass-control-shadow), 0 12px 32px rgba(0, 0, 0, 0.25);
        -webkit-backdrop-filter: blur(calc(24px * var(--glass-blur-scale, 1))) saturate(160%);
        backdrop-filter: blur(calc(24px * var(--glass-blur-scale, 1))) saturate(160%);
        color: var(--glass-home-side-text, #fff);
        --g-text: var(--glass-home-side-text, #fff);
        --g-text-2: var(--glass-home-side-text-2, rgba(235, 235, 245, 0.6));
        --n-info: #fff;
        animation: open 0.25s ease;
      }
      .item {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 10px 8px 4px;
        border-radius: 16px;
      }
      .item + .item {
        border-top: 0.5px solid rgba(255, 255, 255, 0.1);
      }
      /* in the list the whole message, wrapped */
      .item .txt {
        flex: 1;
        flex-direction: column;
        align-items: flex-start;
        gap: 2px;
        white-space: normal;
      }
      .item .title,
      .item .msg {
        overflow: visible;
        white-space: normal;
        overflow-wrap: anywhere;
      }
      .ago {
        flex: none;
        font-size: 11px;
        color: var(--g-text-2);
      }
      @media (prefers-reduced-motion: reduce) {
        .cur.drop,
        .lift,
        .wrap,
        .list,
        .pill.alert .lvl {
          animation: none !important;
        }
      }
    `,
  ];
}

registerCard("glass-notifications", GlassNotifications, {
  name: "Glass – notifications",
  description: "Messages from automations and alerts from conditions, in one pill that drops in from the top.",
});
