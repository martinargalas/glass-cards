import type { ActionConfig, HomeAssistant } from "./types";
import { openMenu } from "./menu";

export type ActionKind = "tap" | "hold" | "double_tap";

export interface ActionTarget {
  entity?: string;
  tap_action?: ActionConfig;
  hold_action?: ActionConfig;
  double_tap_action?: ActionConfig;
}

const TOGGLE_DOMAINS = new Set(["light", "switch", "input_boolean", "fan", "siren", "humidifier", "script", "group"]);

export function defaultTapAction(entity?: string): ActionConfig {
  if (!entity) return { action: "none" };
  return TOGGLE_DOMAINS.has(entity.split(".")[0]) ? { action: "toggle" } : { action: "more-info" };
}

/** Fills in default tap/hold actions for an entity-bound element. */
export function withDefaults(t: ActionTarget, defaults: Partial<ActionTarget> = {}): ActionTarget {
  return {
    entity: t.entity,
    tap_action: t.tap_action ?? defaults.tap_action ?? defaultTapAction(t.entity),
    hold_action: t.hold_action ?? defaults.hold_action ?? (t.entity ? { action: "more-info" } : undefined),
    double_tap_action: t.double_tap_action ?? defaults.double_tap_action,
  };
}

export const hasAction = (a?: ActionConfig) => !!a && a.action !== "none";

export function haptic(kind: "light" | "medium" | "selection" = "light") {
  window.dispatchEvent(new CustomEvent("haptic", { detail: kind }));
}

/**
 * Runs an action. Standard HA actions are delegated to the frontend through the
 * `hass-action` event (confirmation, navigation, more-info, perform-action … all
 * behave exactly like in core cards). `menu` is handled here.
 */
export function runAction(host: HTMLElement, hass: HomeAssistant | undefined, target: ActionTarget, kind: ActionKind, anchor?: HTMLElement) {
  const action = target[`${kind}_action`];
  if (!hasAction(action)) return;
  haptic(kind === "hold" ? "medium" : "light");
  if (action!.action === "menu") {
    if (hass) openMenu(host, hass, action!, target.entity, anchor);
    return;
  }
  // demo mode (src/demo): the made-up home runs it, HA's frontend never sees a demo entity
  const demo = (hass as { demo?: { action(a: ActionConfig, entity?: string): boolean } } | undefined)?.demo;
  if (demo?.action(action!, target.entity)) return;
  host.dispatchEvent(
    new CustomEvent("hass-action", {
      bubbles: true,
      composed: true,
      detail: { config: { entity: target.entity, [`${kind}_action`]: action }, action: kind },
    }),
  );
}

interface PressState {
  timer?: number;
  held: boolean;
  x: number;
  y: number;
  tapTimer?: number;
  pending: boolean;
}

const presses = new WeakMap<EventTarget, PressState>();
const HOLD_MS = 500;
const DOUBLE_MS = 250;
const MOVE_TOLERANCE = 10;

/**
 * Pointer handlers for tap / hold / double-tap. Spread into a Lit template:
 *
 *   ${press(() => this._fire(...))}   → use the returned handlers with @pointerdown etc.
 *
 * State lives on the element (WeakMap) so a re-render mid-press is harmless.
 */
export function pressHandlers(getTarget: () => ActionTarget, fire: (kind: ActionKind, el: HTMLElement) => void) {
  return {
    down: (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      const el = ev.currentTarget as HTMLElement;
      const prev = presses.get(el);
      const st: PressState = { held: false, x: ev.clientX, y: ev.clientY, pending: prev?.pending ?? false, tapTimer: prev?.tapTimer };
      presses.set(el, st);
      if (hasAction(getTarget().hold_action)) {
        st.timer = window.setTimeout(() => {
          st.held = true;
          fire("hold", el);
        }, HOLD_MS);
      }
    },
    move: (ev: PointerEvent) => {
      const st = presses.get(ev.currentTarget!);
      if (st?.timer && (Math.abs(ev.clientX - st.x) > MOVE_TOLERANCE || Math.abs(ev.clientY - st.y) > MOVE_TOLERANCE)) {
        clearTimeout(st.timer);
        st.timer = undefined;
      }
    },
    up: (ev: PointerEvent) => {
      const el = ev.currentTarget as HTMLElement;
      const st = presses.get(el);
      if (!st) return;
      clearTimeout(st.timer);
      const moved = Math.abs(ev.clientX - st.x) > MOVE_TOLERANCE || Math.abs(ev.clientY - st.y) > MOVE_TOLERANCE;
      if (st.held || moved) return;
      if (hasAction(getTarget().double_tap_action)) {
        if (st.pending) {
          clearTimeout(st.tapTimer);
          st.pending = false;
          fire("double_tap", el);
        } else {
          st.pending = true;
          st.tapTimer = window.setTimeout(() => {
            st.pending = false;
            fire("tap", el);
          }, DOUBLE_MS);
        }
        return;
      }
      fire("tap", el);
    },
    cancel: (ev: PointerEvent) => {
      const st = presses.get(ev.currentTarget!);
      if (st) clearTimeout(st.timer);
    },
    key: (ev: KeyboardEvent) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        fire("tap", ev.currentTarget as HTMLElement);
      }
    },
    context: (ev: Event) => ev.preventDefault(),
  };
}
