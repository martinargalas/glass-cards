import { LitElement, css, html, nothing, svg } from "lit";
import { GlassElement } from "./core/glass-element";
import { registerCard, createCard } from "./core/registry";
import { applyRules, evalCondition } from "./core/conditions";
import { displayText, computeValue } from "./core/format";
import { animations, control, surface, tokens } from "./core/styles";
import { pressHandlers, runAction, withDefaults } from "./core/actions";
import { LiquidController } from "./core/liquid";
import { settings } from "./core/settings";
import { cssColor, tint } from "./core/colors";
import { demoHass, onDemoChange, setDemoState } from "./demo/hass";

import "./cards/date-header";
import "./cards/status-bar";
import "./cards/people";
import "./cards/dock";
import "./cards/now";
import "./cards/room-card";
import "./cards/clock-weather";
import "./cards/divider";
import "./cards/calendar";
import "./cards/radar";
import "./cards/air-quality";
import "./cards/thermostat";
import "./cards/heat-pump";
import "./cards/blind";
import "./cards/automation-parts";
import "./cards/light";
import "./cards/period-bar";
import "./cards/chart";
import "./cards/popup-header";
import "./cards/appliance";
import "./cards/tabs";
import "./cards/room-map";
import "./cards/panel";
import "./cards/notifications";
import "./cards/dashboard";
import "./editor/studio";

declare const __VERSION__: string;
const VERSION = typeof __VERSION__ === "string" ? __VERSION__ : "dev";

/**
 * Plugin API. Third-party card packs load after this bundle and build on the same
 * base class, styles and helpers instead of shipping their own copies:
 *
 *   const { GlassElement, lit: { html, css }, registerCard, styles } = window.GlassCards;
 *   class MyCard extends GlassElement { watchedEntities(c) { return [c.entity] } render() { … } }
 *   registerCard("glass-my-card", MyCard, { name: "…", description: "…" });
 *
 * Packs that load first can wait for it:  window.addEventListener("glass-cards-ready", …)
 */
const api = {
  version: VERSION,
  GlassElement,
  lit: { LitElement, html, css, svg, nothing },
  registerCard,
  createCard,
  conditions: { evalCondition, applyRules },
  format: { displayText, computeValue },
  colors: { cssColor, tint },
  actions: { pressHandlers, runAction, withDefaults },
  styles: { tokens, surface, control, animations },
  LiquidController,
  settings,
  /** The made-up demo home (src/demo): a hass for pages without HA, and its changes. */
  demo: { hass: demoHass, onChange: onDemoChange, setState: setDemoState },
};

declare global {
  interface Window {
    GlassCards?: typeof api;
  }
}

/**
 * The loader imports this bundle asynchronously, so HA can render a dashboard
 * before our elements exist and show an error card instead. Ask HA to rebuild
 * those cards (the same `ll-rebuild` event HA itself uses).
 */
function rebuildEarlyErrors() {
  const walk = (root: ParentNode, out: Element[]) => {
    root.querySelectorAll("hui-error-card").forEach((e) => out.push(e));
    root.querySelectorAll("*").forEach((e) => e.shadowRoot && walk(e.shadowRoot, out));
    return out;
  };
  for (const el of walk(document, [])) {
    const cfg = JSON.stringify((el as any)._config ?? (el as any).config ?? {});
    if (cfg.includes("custom:glass-")) el.dispatchEvent(new CustomEvent("ll-rebuild", { bubbles: true, composed: true }));
  }
}

if (!window.GlassCards) {
  window.GlassCards = api;
  requestAnimationFrame(rebuildEarlyErrors);
  window.dispatchEvent(new CustomEvent("glass-cards-ready", { detail: api }));
  console.info(`%c GLASS-CARDS %c ${VERSION} `, "background:#0a84ff;color:#fff;border-radius:4px 0 0 4px;padding:2px 4px", "background:#fff;color:#0a84ff;border-radius:0 4px 4px 0;padding:2px 4px");
}
