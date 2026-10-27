import { css, html, nothing, type PropertyValues } from "lit";
import { GlassElement } from "../core/glass-element";
import type { ActionConfig, BaseCardConfig } from "../core/types";
import { registerCard } from "../core/registry";
import { makeEditor } from "../editor/editor";
import { dockSpec } from "../editor/specs";
import { LiquidController } from "../core/liquid";
import { wallpaperElement } from "../core/liquid-gl";
import { runAction } from "../core/actions";
import { DOCK_PARTS } from "../core/card-parts";
import { getSelected, onAnySelected, setDefault, setSelected } from "../core/select";

/**
 * Navigation dock: one liquid glass capsule floating at the bottom, the
 * buttons inside it (instead of Bubble Card's horizontal-buttons-stack).
 *
 *   type: custom:glass-dock
 *   items:
 *     - icon: mdi:lightbulb-group
 *       link: "#lights"          # a pop-up hash or a path
 *     - icon: mdi:radiator
 *       tap_action: { action: navigate, navigation_path: "#heating" }
 *
 * The button of the open pop-up (its hash) is highlighted.
 *
 *   inline: true     # in a panel (the side column) instead of floating at the bottom
 *   columns: 5       # inline: buttons per row; more rows make one rounded panel
 *   align: main      # floating: centred under this dashboard area instead of the screen
 *   bare: true       # icons only, no glass capsule
 *   scroll: true     # the full width, swiped sideways when the buttons don't fit (phones)
 *   items: [{ icon: mdi:home, home: true }, …]   # home: closes any pop-up, lit while none is open
 *   fade: true       # what scrolls under the dock fades into the wallpaper above it (or the fade's height, px)
 *   indicator: dot   # the open pop-up: pill (dark segment, default) or dot (a white dot below, as macOS's Dock)
 *
 * Pages without pop-ups: with `group`, a button with an `id` picks it in that group
 * (as glass-tabs does) and is lit while picked; cards show for it with the visibility
 * condition `{ condition: select, group: page, id: lights }`.
 *
 *   group: page
 *   items:
 *     - { icon: mdi:home, id: home }       # the first one is picked until another is
 *     - { icon: mdi:lightbulb-group, id: lights }
 */
interface DockItem {
  /** the dashboard itself: no pop-up open */
  home?: boolean;
  /** with the dock's `group`: what this button picks in it */
  id?: string;
  icon: string;
  link?: string;
  name?: string;
  tap_action?: ActionConfig;
}

interface DockConfig extends BaseCardConfig {
  items?: DockItem[];
  /** the select group the buttons' `id`s pick in (core/select) */
  group?: string;
  inline?: boolean;
  columns?: number;
  indicator?: "pill" | "dot";
  align?: string;
  bare?: boolean;
  scroll?: boolean;
  fade?: boolean | number;
}

class GlassDock extends GlassElement<DockConfig> {
  static override parts = DOCK_PARTS;
  static override properties = { ...GlassElement.properties, _hash: { state: true }, _picked: { state: true } };
  declare _hash: string;
  declare _picked?: string;
  private _unsel?: () => void;

  constructor() {
    super();
    this._hash = location.hash;
    new LiquidController(this, ".dock:not(.bare)", undefined, undefined, () => wallpaperElement());
  }

  static getConfigElement() {
    return makeEditor(dockSpec);
  }

  static getStubConfig() {
    return { items: [{ icon: "mdi:lightbulb-group", link: "#lights" }] };
  }

  protected override validateConfig(c: DockConfig) {
    if (!Array.isArray(c.items) || !c.items.length) throw new Error("`items` must list at least one button");
    const first = c.group ? c.items.find((it) => it.id)?.id : undefined;
    if (c.group && first) setDefault(c.group, first);
    this._picked = c.group ? getSelected(c.group) : undefined;
    return c;
  }

  protected watchedEntities() {
    return [];
  }

  protected override updated(changed: PropertyValues) {
    super.updated(changed);
    this.toggleAttribute("inline", !!this._config?.inline);
    this.toggleAttribute("dot", this._config?.indicator === "dot");
    this.toggleAttribute("scroll", !!this._config?.scroll && !this._config?.inline);
    this.toggleAttribute("fade", !!this._config?.fade && !this._config?.inline);
    this._copyWallpaper();
    // the open one in view
    if ((changed.has("_hash" as any) || changed.has("_picked" as any)) && this._config?.scroll)
      this.shadowRoot?.querySelector<HTMLElement>(".btn.on")?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    if (changed.has("_config" as any) || !this._ro) this._align();
    this._movePill();
  }

  private _pillAt?: number;

  /**
   * The highlight under the open pop-up's button: a drop of glass that, when another
   * one opens, first stretches over to it and then lets go of the old one.
   */
  private _movePill() {
    const root = this.shadowRoot;
    const pill = root?.querySelector<HTMLElement>(".pill");
    if (!pill) return;
    const btns = [...root!.querySelectorAll<HTMLElement>(".btn")];
    const i = btns.findIndex((b) => b.classList.contains("on"));
    if (i === this._pillAt) return;
    const prev = this._pillAt;
    this._pillAt = i;
    if (i < 0) {
      pill.classList.remove("show");
      return;
    }
    const to = btns[i];
    const place = (b: HTMLElement) => ({ left: `${b.offsetLeft}px`, top: `${b.offsetTop}px`, width: `${b.offsetWidth}px` });
    Object.assign(pill.style, place(to));
    const shown = pill.classList.contains("show");
    pill.classList.add("show");
    if (!shown || prev === undefined || prev < 0 || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const from = btns[prev];
    if (from.offsetTop !== to.offsetTop) return;
    const a = Math.min(from.offsetLeft, to.offsetLeft);
    const b = Math.max(from.offsetLeft + from.offsetWidth, to.offsetLeft + to.offsetWidth);
    pill.animate(
      [
        { left: `${from.offsetLeft}px`, width: `${from.offsetWidth}px`, transform: "scaleY(1)" },
        { left: `${to.offsetLeft < from.offsetLeft ? a : from.offsetLeft}px`, width: `${(to.offsetLeft < from.offsetLeft ? from.offsetLeft + from.offsetWidth : b) - (to.offsetLeft < from.offsetLeft ? a : from.offsetLeft)}px`, transform: "scaleY(0.82)", offset: 0.45 },
        { left: `${to.offsetLeft}px`, width: `${to.offsetWidth}px`, transform: "scaleY(1)" },
      ],
      { duration: 520, easing: "cubic-bezier(0.34, 1.2, 0.64, 1)" },
    );
  }

  private _onNav = () => {
    this._hash = location.hash;
  };

  private _onPick = () => {
    const g = this._config?.group;
    this._picked = g ? getSelected(g) : undefined;
  };

  override connectedCallback() {
    super.connectedCallback();
    window.addEventListener("location-changed", this._onNav);
    window.addEventListener("popstate", this._onNav);
    window.addEventListener("hashchange", this._onNav);
    this._unsel = onAnySelected(this._onPick);
    this._onPick();
  }

  private _ro?: ResizeObserver;
  private _fadeTimer?: number;

  /**
   * fade: a copy of the wallpaper laid over the page, shown only in a band above the
   * dock and fading in towards it – so whatever scrolls under the dock dissolves into
   * the wallpaper (a mask on the page itself would break the glass blur of its cards).
   */
  private _copyWallpaper() {
    const fade = this.shadowRoot?.querySelector<HTMLElement>(".fade");
    if (!fade) return;
    const wp = wallpaperElement() as HTMLElement | undefined;
    if (wp) {
      const cs = getComputedStyle(wp);
      for (const k of ["backgroundImage", "backgroundSize", "backgroundPosition", "backgroundRepeat", "backgroundColor"] as const)
        if (fade.style[k] !== cs[k]) fade.style[k] = cs[k];
    }
    // day / night swap the wallpaper: look again now and then
    clearTimeout(this._fadeTimer);
    this._fadeTimer = window.setTimeout(() => this.isConnected && this._copyWallpaper(), 15000);
  }

  /** Centre under a glass-dashboard area (its grid column), following its size. */
  private _align() {
    this._ro?.disconnect();
    const name = this._config?.align;
    if (!name || this._config?.inline) return this.style.removeProperty("left");
    const root = this.getRootNode() as ShadowRoot;
    const area = root.host?.shadowRoot?.querySelector<HTMLElement>(`section.area[style*="grid-area:${name}"]`);
    if (!area) return void setTimeout(() => this.isConnected && this._align(), 500);
    const place = () => {
      const r = area.getBoundingClientRect();
      if (r.width) this.style.left = `${r.left + r.width / 2}px`;
    };
    this._ro = new ResizeObserver(place);
    this._ro.observe(area);
    place();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._ro?.disconnect();
    clearTimeout(this._fadeTimer);
    window.removeEventListener("location-changed", this._onNav);
    window.removeEventListener("popstate", this._onNav);
    window.removeEventListener("hashchange", this._onNav);
    this._unsel?.();
  }

  private _tap(it: DockItem, ev: Event) {
    const g = this._config?.group;
    if (g && it.id && !it.tap_action) {
      setSelected(g, it.id);
      return;
    }
    const tap_action = it.tap_action ?? { action: "navigate", navigation_path: it.home ? location.pathname : it.link };
    runAction(this, this._hass, { tap_action }, "tap", ev.currentTarget as HTMLElement);
    // pop-ups set the hash themselves; pick it up once they have
    setTimeout(this._onNav, 50);
  }

  protected override render() {
    if (!this._config) return nothing;
    const c = this._config;
    const cols = c.inline ? Math.min(c.columns ?? 5, c.items!.length) : 0;
    const fadeH = typeof c.fade === "number" ? c.fade : 110;
    // in an editor preview the fade (a full-screen copy of the wallpaper) would cover the editor
    const preview = (this.parentNode as Element | null)?.classList?.contains("pv-bar");
    return html`${c.fade && !c.inline && !preview ? html`<div class="fade" style="--fade-h:${fadeH}px"></div>` : nothing}<nav class="dock ${cols && c.items!.length > cols ? "rows" : ""} ${c.bare ? "bare" : ""} ${c.scroll && !c.inline ? "scroll" : ""}" style=${cols ? `grid-template-columns:repeat(${cols}, 1fr)` : ""}>
      <i class="pill"></i>
      ${this._config.items!.map((it) => {
        const link = it.link ?? it.tap_action?.navigation_path;
        const on =
          c.group && it.id
            ? this._picked === it.id
            : it.home
              ? !this._hash || this._hash === "#"
              : !!link && link.startsWith("#") && link === this._hash;
        return html`<button class="btn ${on ? "on" : ""}" title=${it.name ?? ""} aria-label=${it.name ?? link ?? it.icon} @click=${(ev: Event) => this._tap(it, ev)}>
          <ha-icon .icon=${it.icon}></ha-icon>
        </button>`;
      })}
    </nav>`;
  }

  static override styles = [
    GlassElement.styles,
    css`
      :host {
        position: fixed;
        left: 50%;
        bottom: calc(var(--glass-dock-bottom, 6px) + env(safe-area-inset-bottom, 0px));
        transform: translateX(-50%);
        z-index: 5;
        display: block;
      }
      :host([inline]) {
        position: static;
        transform: none;
        margin-top: auto;
      }
      .dock {
        position: relative;
        isolation: isolate;
        display: flex;
        --dock-btn: var(--glass-dock-button, 52px);
        gap: 6px;
        padding: var(--glass-dock-padding, 7px);
        border-radius: 999px;
        --glass-liquid-squircle: 0;
        /* more lens than the panels: it floats above everything */
        --glass-liquid-edge-intensity: 0.14;
        --glass-liquid-rim-intensity: 0.1;
        --glass-liquid-edge-distance: 0.2;
        --glass-liquid-dispersion: 0.6;
        /* clear glass: little milk, a quiet highlight and rim */
        --glass-liquid-tint: 0.1;
        --glass-liquid-specular: 0.15;
        --glass-liquid-rim-light: 0.3;
        background: var(--glass-dock-surface, linear-gradient(180deg, rgba(255, 255, 255, 0.5), rgba(255, 255, 255, 0.34)));
        -webkit-backdrop-filter: blur(calc(16px * var(--glass-blur-scale, 1))) saturate(170%);
        backdrop-filter: blur(calc(16px * var(--glass-blur-scale, 1))) saturate(170%);
        box-shadow:
          0 12px 32px rgba(0, 0, 0, 0.16),
          0 2px 6px rgba(0, 0, 0, 0.08);
      }
      .pill {
        position: absolute;
        z-index: 0;
        height: var(--dock-btn);
        border-radius: 999px;
        /* a dark selected segment, as the alarm's mode switch */
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0) 60%),
          var(--glass-dock-active, rgba(40, 44, 52, 0.78));
        box-shadow:
          0 2px 8px rgba(0, 0, 0, 0.18),
          inset 0 0.5px 0 rgba(255, 255, 255, 0.25);
        opacity: 0;
        transform-origin: center;
        transition: opacity 0.25s;
        pointer-events: none;
      }
      .pill.show {
        opacity: 1;
      }
      :host([inline]) .dock {
        display: grid;
        justify-items: center;
        --glass-dock-icon: var(--glass-dock-inline-icon, #fff);
      }
      .dock.rows {
        border-radius: 26px;
        padding: 8px;
        row-gap: 6px;
      }
      /* scroll: across the whole width, swiped sideways; the ends fade out to show there is more */
      /* fade: no transform on the host (it would trap the fixed wallpaper copy); centred by flex instead */
      :host([fade]) {
        left: 0;
        right: 0;
        transform: none;
        display: flex;
        justify-content: center;
        pointer-events: none;
      }
      :host([fade]) .dock {
        pointer-events: auto;
      }
      .fade {
        position: fixed;
        inset: 0;
        z-index: -1;
        pointer-events: none;
        background-size: cover;
        background-position: center;
        -webkit-mask-image: linear-gradient(to bottom, transparent calc(100% - var(--fade-h)), #000 calc(100% - var(--fade-h) * 0.35));
        mask-image: linear-gradient(to bottom, transparent calc(100% - var(--fade-h)), #000 calc(100% - var(--fade-h) * 0.35));
      }
      :host([scroll]) {
        left: 0;
        right: 0;
        transform: none;
      }
      .dock.scroll {
        overflow-x: auto;
        scroll-snap-type: x proximity;
        scrollbar-width: none;
        overscroll-behavior-x: contain;
        padding-left: 14px;
        padding-right: 14px;
        /* the dot sits below the buttons; a scroller clips both ways */
        padding-bottom: 8px;
        margin-bottom: -8px;
        -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 22px, #000 calc(100% - 22px), transparent 100%);
        mask-image: linear-gradient(90deg, transparent 0, #000 22px, #000 calc(100% - 22px), transparent 100%);
      }
      .dock.scroll::-webkit-scrollbar {
        display: none;
      }
      .dock.scroll .btn {
        flex: none;
        scroll-snap-align: center;
      }
      .dock.bare {
        background: none;
        -webkit-backdrop-filter: none;
        backdrop-filter: none;
        box-shadow: none;
      }
      .dock.lg-on {
        background: none;
        -webkit-backdrop-filter: none !important;
        backdrop-filter: none !important;
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
      .btn {
        position: relative;
        z-index: 1;
        width: var(--dock-btn);
        height: var(--dock-btn);
        display: grid;
        place-items: center;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: none;
        color: var(--glass-dock-icon, #fff);
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        transition: transform 0.15s;
      }
      .btn ha-icon {
        --mdc-icon-size: 25px;
        display: flex;
        /* white icons on light glass, as on the room tiles' capsules */
        filter: var(--g-icon-shadow, drop-shadow(0 1px 2px rgba(0, 0, 0, 0.35)));
      }
      /* dot: only a small white dot under the icon; it slides over like the pill */
      :host([dot]) .pill {
        background: none;
        box-shadow: none;
      }
      :host([dot]) .pill::after {
        content: "";
        position: absolute;
        left: 50%;
        bottom: -1px;
        width: 5px;
        height: 5px;
        margin-left: -2.5px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 0 3px rgba(0, 0, 0, 0.25);
      }
      /* the open pop-up: a white icon on the dark segment */
      .btn.on {
        color: #fff;
      }
      .btn:active {
        transform: scale(0.92);
      }
    `,
  ];
}

registerCard("glass-dock", GlassDock, {
  requires: "Bubble Card",
  name: "Glass – dock",
  description: "Navigation buttons on one liquid glass capsule at the bottom.",
});
