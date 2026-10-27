import type { HomeAssistant } from "./types";
import { getSelected } from "./select";

/**
 * Declarative conditions — replace Jinja / JS templates.
 *
 *   state: "on" | ["on", "heat"]   state_not: ...
 *   above: 45 | sensor.limit       below: ...
 *   entity: sensor.x               attribute: current_position
 *   and: [...] / or: [...] / not: {...}
 *
 * A bare list means "all of". HA-style `condition: state|numeric_state|screen|user|and|or|not`
 * keys are accepted too, so conditions copied from the conditional card (or a card's
 * `visibility`) work. Our own: `condition: select, group: cleaning, id: roomba` – what is
 * picked in a group on this screen (an appliance bar, glass-tabs; see core/select).
 */
export type Condition = Record<string, any> | Condition[];

const CONDITION_KEYS = new Set([
  "condition",
  "entity",
  "attribute",
  "state",
  "state_not",
  "above",
  "below",
  "and",
  "or",
  "not",
  "conditions",
]);

const ENTITY_ID = /^[a-z_]+\.[a-z0-9_]+$/;

export const isEntityId = (v: unknown): v is string => typeof v === "string" && ENTITY_ID.test(v);

function readValue(hass: HomeAssistant, entityId: string | undefined, attribute?: string): any {
  if (!entityId) return undefined;
  const st = hass.states[entityId];
  if (!st) return undefined;
  return attribute ? st.attributes[attribute] : st.state;
}

function numeric(hass: HomeAssistant, v: unknown): number {
  if (isEntityId(v)) return Number(readValue(hass, v));
  return Number(v);
}

const asList = (v: unknown): any[] => (Array.isArray(v) ? v : [v]);

export function evalCondition(cond: Condition | undefined, hass: HomeAssistant, defaultEntity?: string): boolean {
  if (cond === undefined || cond === null) return true;
  if (Array.isArray(cond)) return cond.every((c) => evalCondition(c, hass, defaultEntity));
  if (typeof cond !== "object") return Boolean(cond);

  const kind = cond.condition;
  const subs = cond.conditions;
  if (kind === "and" && subs) return evalCondition(subs, hass, defaultEntity);
  if (kind === "or" && subs) return asList(subs).some((c) => evalCondition(c, hass, defaultEntity));
  if (kind === "not" && subs) return !asList(subs).some((c) => evalCondition(c, hass, defaultEntity));
  // HA's visibility conditions: the screen's width (a media query) and who is looking
  if (kind === "screen") return !cond.media_query || window.matchMedia(cond.media_query).matches;
  if (kind === "user") return asList(cond.users ?? []).includes(hass.user?.id);
  if (kind === "select") return !cond.group || asList(cond.id).map(String).includes(String(getSelected(cond.group)));

  if (cond.and && !evalCondition(cond.and, hass, defaultEntity)) return false;
  if (cond.or && !asList(cond.or).some((c) => evalCondition(c, hass, defaultEntity))) return false;
  if (cond.not && evalCondition(cond.not, hass, defaultEntity)) return false;

  const entity: string | undefined = cond.entity ?? defaultEntity;
  const value = readValue(hass, entity, cond.attribute);

  if (cond.state !== undefined && !asList(cond.state).map(String).includes(String(value))) return false;
  if (cond.state_not !== undefined && asList(cond.state_not).map(String).includes(String(value))) return false;

  if (cond.above !== undefined || cond.below !== undefined) {
    const n = Number(value);
    if (Number.isNaN(n)) return false;
    if (cond.above !== undefined && !(n > numeric(hass, cond.above))) return false;
    if (cond.below !== undefined && !(n < numeric(hass, cond.below))) return false;
  }
  return true;
}

/** Every entity a condition reads — used for render-on-change tracking. */
export function conditionEntities(cond: Condition | undefined, defaultEntity?: string, out = new Set<string>()): Set<string> {
  if (!cond || typeof cond !== "object") return out;
  if (Array.isArray(cond)) {
    cond.forEach((c) => conditionEntities(c, defaultEntity, out));
    return out;
  }
  const entity = cond.entity ?? defaultEntity;
  if (entity && (cond.state !== undefined || cond.state_not !== undefined || cond.above !== undefined || cond.below !== undefined)) {
    out.add(entity);
  }
  for (const k of ["above", "below"]) if (isEntityId(cond[k])) out.add(cond[k]);
  for (const k of ["and", "or", "not", "conditions"]) if (cond[k]) conditionEntities(cond[k], defaultEntity, out);
  return out;
}

/**
 * Rules: a condition plus overrides in one flat object.
 *
 *   rules:
 *     - above: 43
 *       color: yellow
 *     - entity: sensor.water_heating_on
 *       state: "on"
 *       animation: glow
 *
 * Every matching rule is applied in order, later rules win.
 */
export type Rule = Record<string, any>;

export function splitRule(rule: Rule): { when: Condition; set: Record<string, any> } {
  if (rule.when !== undefined) {
    const { when, ...set } = rule;
    return { when, set };
  }
  const when: Record<string, any> = {};
  const set: Record<string, any> = {};
  for (const [k, v] of Object.entries(rule)) (CONDITION_KEYS.has(k) ? when : set)[k] = v;
  return { when, set };
}

export function applyRules<T extends Record<string, any>>(base: T, rules: Rule[] | undefined, hass: HomeAssistant, defaultEntity?: string): T {
  if (!rules?.length) return base;
  let out = base;
  for (const rule of rules) {
    const { when, set } = splitRule(rule);
    if (evalCondition(when, hass, defaultEntity)) out = { ...out, ...set };
  }
  return out;
}

export function ruleEntities(rules: Rule[] | undefined, defaultEntity?: string, out = new Set<string>()): Set<string> {
  rules?.forEach((r) => {
    const { when, set } = splitRule(r);
    conditionEntities(when, defaultEntity, out);
    // a `when:` rule may switch to another entity: that one is shown, so it is watched too
    if (isEntityId(set.entity)) out.add(set.entity);
    if (Array.isArray(set.entities)) set.entities.filter(isEntityId).forEach((e: string) => out.add(e));
  });
  return out;
}

/** Whether a condition looks at what is picked in a group (it changes with a tap, not with a state). */
export function usesSelect(cond: Condition | undefined): boolean {
  if (!cond || typeof cond !== "object") return false;
  if (Array.isArray(cond)) return cond.some(usesSelect);
  return cond.condition === "select" || ["and", "or", "not", "conditions"].some((k) => usesSelect(cond[k]));
}

/** Whether a condition looks at the screen (it changes with the window, not with a state). */
export function usesScreen(cond: Condition | undefined): boolean {
  if (!cond || typeof cond !== "object") return false;
  if (Array.isArray(cond)) return cond.some(usesScreen);
  return cond.condition === "screen" || ["and", "or", "not", "conditions"].some((k) => usesScreen(cond[k]));
}
