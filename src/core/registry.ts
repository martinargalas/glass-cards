import type { BaseCardConfig, HomeAssistant } from "./types";
import { syncLang, tr } from "../i18n";

export interface CardMeta {
  name: string;
  description: string;
  preview?: boolean;
  /** Another card it needs, as named in HACS (e.g. "Bubble Card"): said in HA's card picker. */
  requires?: string;
}

declare global {
  interface Window {
    customCards?: Array<{ type: string; name: string; description: string; preview?: boolean; documentationURL?: string }>;
    loadCardHelpers?: () => Promise<{ createCardElement(config: BaseCardConfig): HTMLElement }>;
  }
}

/** Defines the element and lists it in the HA card picker. Safe to call twice. */
export function registerCard(tag: string, cls: CustomElementConstructor, meta: CardMeta) {
  if (!customElements.get(tag)) customElements.define(tag, cls);
  window.customCards = window.customCards || [];
  if (!window.customCards.some((c) => c.type === tag)) {
    // in the HA user's language when HA's card picker reads them (getters: the language is
    // known only once Home Assistant is up, long after the cards are defined)
    const user = () => syncLang((document.querySelector("home-assistant") as unknown as { hass?: HomeAssistant } | null)?.hass);
    window.customCards.push({
      type: tag,
      get name() {
        user();
        return tr(meta.name);
      },
      get description() {
        user();
        const d = tr(meta.description);
        return meta.requires ? `${d} ${tr("Requires {card} (HACS).", { card: meta.requires })}` : d;
      },
      preview: meta.preview ?? false,
    });
  }
}

type CardEl = HTMLElement & { setConfig?(c: BaseCardConfig): void; hass?: HomeAssistant };

let helpers: Promise<{ createCardElement(config: BaseCardConfig): HTMLElement }> | undefined;

/**
 * Creates any card (ours or third-party). Our own cards are created synchronously;
 * others go through HA's card helpers so errors render as HA error cards.
 */
export function createCard(config: BaseCardConfig, hass?: HomeAssistant): CardEl {
  const tag = typeof config?.type === "string" && config.type.startsWith("custom:") ? config.type.slice(7) : "";
  if (tag.startsWith("glass-") && customElements.get(tag)) {
    const el = document.createElement(tag) as CardEl;
    try {
      el.setConfig!(config);
    } catch (e) {
      return errorCard(String((e as Error).message ?? e), config);
    }
    if (hass) el.hass = hass;
    return el;
  }
  // Placeholder swapped for the real card once HA's helpers are loaded.
  const holder = document.createElement("div") as CardEl;
  holder.style.display = "contents";
  helpers = helpers ?? window.loadCardHelpers?.();
  if (!helpers) return errorCard("Card helpers unavailable", config);
  helpers.then((h) => {
    const el = h.createCardElement(config) as CardEl;
    if (holder.hass) el.hass = holder.hass;
    holder.appendChild(el);
    Object.defineProperty(holder, "hass", {
      configurable: true,
      get: () => el.hass,
      set: (v) => (el.hass = v),
    });
  });
  if (hass) holder.hass = hass;
  return holder;
}

function errorCard(message: string, config: BaseCardConfig): CardEl {
  const el = document.createElement("div") as CardEl;
  el.style.cssText =
    "padding:12px 16px;border-radius:18px;background:rgba(255,69,58,.25);color:#fff;font:500 13px/1.4 Roboto,system-ui;border:1px solid rgba(255,69,58,.6)";
  el.textContent = `${config?.type ?? "card"}: ${message}`;
  return el;
}
