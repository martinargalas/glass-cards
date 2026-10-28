// What Home Assistant's frontend gives cards, for a page without it: `loadCardHelpers()`
// with the built-in cards the demo uses (stacks, grid, picture, markdown, heading, media
// control, conditional) and `<ha-card>`. Other custom cards – Bubble Card, apexcharts-card,
// layout-card… – are the real ones, loaded from vendor/ (see vendor.json) before the demo.
import type { HomeAssistant } from "../src/core/types";

type Cfg = Record<string, any>;
type CardEl = HTMLElement & { setConfig?(c: Cfg): void; hass?: HomeAssistant };

const base = `
  :host { display: block; }
  .stack { display: flex; gap: var(--stack-card-gap, 8px); }
  .stack.v { flex-direction: column; }
  .stack.h { flex-direction: row; } .stack.h > * { flex: 1 1 0; min-width: 0; }
`;

class HaCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" }).innerHTML =
      `<style>:host{display:block;position:relative;border-radius:var(--ha-card-border-radius,16px);background:var(--ha-card-background,var(--card-background-color,rgba(255,255,255,.7)));box-shadow:var(--ha-card-box-shadow,none);color:var(--primary-text-color);overflow:hidden}</style><slot></slot>`;
  }
}
if (!customElements.get("ha-card")) customElements.define("ha-card", HaCard);

/** A card that holds others and hands `hass` down. */
abstract class Holder extends HTMLElement {
  protected kids: CardEl[] = [];
  protected _hass?: HomeAssistant;
  protected cfg: Cfg = {};
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }
  set hass(h: HomeAssistant) {
    this._hass = h;
    for (const k of this.kids) k.hass = h;
  }
  get hass() {
    return this._hass as HomeAssistant;
  }
  setConfig(c: Cfg) {
    this.cfg = c;
    this.kids = (c.cards ?? []).map((x: Cfg) => createCardElement(x));
    this.render();
    if (this._hass) this.hass = this._hass;
  }
  getCardSize() {
    return this.kids.length * 2;
  }
  abstract render(): void;
}

class Stack extends Holder {
  render() {
    const h = this.cfg.type === "horizontal-stack";
    this.shadowRoot!.innerHTML = `<style>${base}</style><div class="stack ${h ? "h" : "v"}"></div>`;
    this.shadowRoot!.querySelector("div")!.append(...this.kids);
  }
}
class Grid extends Holder {
  render() {
    const n = this.cfg.columns ?? 2;
    this.shadowRoot!.innerHTML = `<style>${base}.grid{display:grid;gap:var(--grid-card-gap,8px);grid-template-columns:repeat(${n},minmax(0,1fr))}</style><div class="grid"></div>`;
    this.shadowRoot!.querySelector("div")!.append(...this.kids);
  }
}

/** `conditional`: its card while every condition holds (the glass conditions read HA's too). */
class Conditional extends Holder {
  private shown = false;
  setConfig(c: Cfg) {
    super.setConfig({ ...c, cards: c.card ? [c.card] : [] });
  }
  set hass(h: HomeAssistant) {
    super.hass = h;
    const ev = (window as any).GlassCards?.conditions?.evalCondition;
    const ok = !ev || (this.cfg.conditions ?? []).every((x: Cfg) => ev(x, h));
    if (ok !== this.shown) {
      this.shown = ok;
      this.style.display = ok ? "" : "none";
    }
  }
  render() {
    this.shadowRoot!.innerHTML = "";
    this.shadowRoot!.append(...this.kids);
  }
}

class Simple extends HTMLElement {
  protected cfg: Cfg = {};
  protected _hass?: HomeAssistant;
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }
  setConfig(c: Cfg) {
    this.cfg = c;
    this.render();
  }
  set hass(h: HomeAssistant) {
    this._hass = h;
    this.render();
  }
  getCardSize() {
    return 2;
  }
  render() {}
}

class Picture extends Simple {
  render() {
    const src = this.cfg.image ?? "";
    this.shadowRoot!.innerHTML = `<style>:host{display:block}img{display:block;width:100%;height:auto;border-radius:var(--ha-card-border-radius,16px)}</style><img alt="" loading="lazy">`;
    this.shadowRoot!.querySelector("img")!.src = src;
  }
}

/** Markdown: paragraphs, ### headings, **bold** and [links](…) – what the demo writes. */
class Markdown extends Simple {
  render() {
    // the demo's own config, but escaped all the same: text and link addresses can't break out
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const inline = (s: string) =>
      esc(s)
        .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
        .replace(/\[([^\]]+)\]\((https?:[^)\s&]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
    const html = String(this.cfg.content ?? "")
      .split(/\n{2,}/)
      .map((b) => (b.startsWith("#") ? `<h3>${inline(b.replace(/^#+\s*/, ""))}</h3>` : `<p>${inline(b).replace(/\n/g, "<br>")}</p>`))
      .join("");
    this.shadowRoot!.innerHTML = `<style>:host{display:block}ha-card{padding:16px;font-size:14px;line-height:1.5}h3{margin:0 0 8px;font-size:17px}p{margin:0 0 8px}a{color:var(--primary-color)}</style><ha-card>${html}</ha-card>`;
  }
}

class Heading extends Simple {
  render() {
    this.shadowRoot!.innerHTML = `<style>:host{display:block}h2{margin:8px 4px;font-size:16px;font-weight:600;color:var(--primary-text-color)}</style><h2></h2>`;
    this.shadowRoot!.querySelector("h2")!.textContent = this.cfg.heading ?? "";
  }
}

/** Media control: what plays, and play / pause through the demo's services. */
class MediaControl extends Simple {
  render() {
    const st = this._hass?.states[this.cfg.entity];
    const playing = st?.state === "playing";
    const title = st?.attributes.media_title ?? (st ? (this._hass?.formatEntityState?.(st) ?? st.state) : "");
    const name = st?.attributes.friendly_name ?? this.cfg.entity;
    this.shadowRoot!.innerHTML = `<style>:host{display:block}ha-card{display:flex;align-items:center;gap:12px;padding:14px 16px}
      .t{flex:1;min-width:0}.n{font-weight:600;font-size:15px}.s{opacity:.65;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      button{width:42px;height:42px;border-radius:50%;border:0;background:var(--primary-color,#0a84ff);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center}</style>
      <ha-card><ha-icon icon="mdi:music"></ha-icon><div class="t"><div class="n"></div><div class="s"></div></div><button><ha-icon icon="${playing ? "mdi:pause" : "mdi:play"}"></ha-icon></button></ha-card>`;
    this.shadowRoot!.querySelector(".n")!.textContent = name;
    this.shadowRoot!.querySelector(".s")!.textContent = title;
    this.shadowRoot!.querySelector("button")!.onclick = () =>
      void this._hass?.callService("media_player", "media_play_pause", { entity_id: this.cfg.entity });
  }
}

const BUILT_IN: Record<string, CustomElementConstructor> = {
  "vertical-stack": Stack,
  "horizontal-stack": Stack,
  grid: Grid,
  conditional: Conditional,
  picture: Picture,
  markdown: Markdown,
  heading: Heading,
  "media-control": MediaControl,
};
for (const [type, cls] of Object.entries(BUILT_IN)) {
  const tag = `hui-${type}-card`;
  if (!customElements.get(tag)) customElements.define(tag, class extends (cls as unknown as typeof HTMLElement) {});
}

/** An error card, as HA shows one. */
function errorCard(msg: string, config: Cfg): CardEl {
  const el = document.createElement("div") as CardEl;
  el.style.cssText = "padding:12px;border-radius:12px;background:rgba(255,80,80,.15);color:inherit;font:12px system-ui";
  el.textContent = `${msg}: ${config?.type}`;
  return el;
}

/** Creates any card by its config: a custom one once its element exists, else a built-in. */
export function createCardElement(config: Cfg): CardEl {
  const type = String(config?.type ?? "");
  if (type.startsWith("custom:")) {
    const tag = type.slice(7);
    const make = () => {
      const el = document.createElement(tag) as CardEl;
      try {
        el.setConfig?.(config);
      } catch (e) {
        return errorCard(String((e as Error).message ?? e), config);
      }
      return el;
    };
    if (customElements.get(tag)) return make();
    // not loaded (yet): the demo fetches it now if it can, and a stand-in becomes the card when it is
    (window as any).glassDemoNeed?.(tag);
    const holder = document.createElement("div") as CardEl;
    holder.style.display = "contents";
    let inner: CardEl | undefined;
    let h: HomeAssistant | undefined;
    Object.defineProperty(holder, "hass", { get: () => h, set: (v) => ((h = v), inner && (inner.hass = v)) });
    void customElements.whenDefined(tag).then(() => {
      inner = make();
      if (h) inner.hass = h;
      holder.appendChild(inner);
    });
    return holder;
  }
  const tag = `hui-${type}-card`;
  if (!customElements.get(tag)) return errorCard("Not in the web demo", config);
  const el = document.createElement(tag) as CardEl;
  el.setConfig?.(config);
  return el;
}

(window as any).loadCardHelpers = async () => ({ createCardElement });
