import { tr } from "../i18n";
import type { HomeAssistant } from "./types";

export type WasherPhase = "run" | "pause" | "done" | "off";

/**
 * Where a washer's (or dryer's, dishwasher's) phase comes from:
 *   entity   its job / operation / status sensor – or a binary sensor (on = running),
 *            or a power sensor in W (running above `run_above`)
 *   machine  SmartThings: the machine state (run / pause / stop), next to the job state
 *   power    on until switched off (default `binary_sensor.<name>_power` with SmartThings)
 * and, for an integration of its own, the states that mean each phase.
 */
export interface WasherSource {
  entity: string;
  machine?: string;
  power?: string;
  run_states?: string[];
  pause_states?: string[];
  done_states?: string[];
  /** a power sensor as `entity`: running above this many W (default 5) */
  run_above?: number;
}

// the states of SmartThings, LG ThinQ, Home Connect, Miele, Electrolux, Haier, Whirlpool – lower case, `_` for spaces
const RUN = [
  "run", "running", "in_use", "inuse", "on_going", "ongoing", "active", "working",
  "wash", "washing", "pre_wash", "prewash", "main_wash", "soak", "soaking", "weight_sensing", "detecting", "sensing",
  "ai_wash", "air_wash", "delay_wash", "rinse", "rinsing", "ai_rinse", "spin", "spinning", "ai_spin",
  "dry", "drying", "steam", "steaming", "refresh", "refreshing", "cooling", "cool_down", "anti_crease", "wrinkle_prevent",
];
const PAUSE = ["pause", "paused", "rinse_hold", "action_required", "actionrequired", "interrupted"];
const DONE = ["finish", "finished", "end", "ended", "program_ended", "complete", "completed", "done", "end_of_cycle"];

export const washerState = (s: string | undefined) => (s ?? "").toLowerCase().replace(/[\s-]+/g, "_");

/** `sensor.<name>_washer_job_state` → its SmartThings siblings */
export const washerIds = (job: string, machine?: string, power?: string) => {
  const base = (machine ?? job).match(/^sensor\.(.+?)_washer_(?:machine|job)_state$/)?.[1];
  return {
    machine: machine ?? (base ? `sensor.${base}_washer_machine_state` : undefined),
    power: power ?? (base ? `binary_sensor.${base}_power` : undefined),
  };
};

/** SmartThings' job state: the source names its machine state itself */
export const isSmartThingsJob = (id: string) => /^sensor\..+_washer_job_state$/.test(id);

/** run / pause / done (finished, still switched on) / off */
export function washerPhase(hass: HomeAssistant | undefined, src: WasherSource): WasherPhase {
  const ids = washerIds(src.entity, src.machine, src.power);
  const st = hass?.states[src.entity];
  if (!st) return "off";
  const s = washerState(st.state);
  const has = (list: string[] | undefined, def: string[]) => (list ? list.map(washerState) : def).includes(s);

  if (src.entity.startsWith("binary_sensor.")) return s === "on" ? "run" : "off";
  const watts = parseFloat(st.state);
  if (Number.isFinite(watts) && /^(W|kW)$/.test(st.attributes.unit_of_measurement ?? "")) {
    return watts * (st.attributes.unit_of_measurement === "kW" ? 1000 : 1) > (src.run_above ?? 5) ? "run" : "off";
  }

  if (has(src.done_states, DONE)) {
    // done until it's switched off (no power sensor: for 30 minutes). SmartThings stops reporting once the
    // washer is switched off and keeps "on" for days (17. 10.): after 3 hours "done" is over regardless.
    const power = hass?.states[ids.power ?? ""]?.state;
    const since = Date.now() - new Date(st.last_changed).getTime();
    return since < 3 * 3600000 && (power === "on" || (power === undefined && since < 30 * 60000)) ? "done" : "off";
  }
  const machine = hass?.states[ids.machine ?? ""];
  if (machine) {
    // SmartThings: the job state says what, the machine state whether – but a job of none is over
    if (s === "none") return "off";
    const m = washerState(machine.state);
    return m === "run" ? "run" : m === "pause" ? "pause" : "off";
  }
  if (has(src.pause_states, PAUSE)) return "pause";
  return has(src.run_states, RUN) ? "run" : "off";
}

/** The entities a washer's phase reads – for render-on-change tracking. */
export const washerEntities = (src: WasherSource) => {
  const ids = washerIds(src.entity, src.machine, src.power);
  return [src.entity, ids.machine, ids.power].filter((x): x is string => !!x);
};

/** A washing machine's cycle; the machine's other states fall into these. `name` is translated (src/i18n). */
export const WASHER_STAGES: { state: string | string[]; name: string; icon?: string }[] = [
  {
    state: ["weight_sensing", "detecting", "sensing", "pre_wash", "prewash", "main_wash", "wash", "washing", "soak", "soaking", "ai_wash", "air_wash", "delay_wash"],
    name: "Washing",
    icon: "mdi:washing-machine",
  },
  { state: ["rinse", "rinsing", "ai_rinse", "rinse_hold"], name: "Rinsing", icon: "mdi:water-sync" },
  { state: ["spin", "spinning", "ai_spin"], name: "Spinning", icon: "mdi:sync" },
  {
    state: ["finish", "finished", "end", "ended", "program_ended", "complete", "completed", "done", "end_of_cycle", "cooling", "cool_down", "anti_crease", "wrinkle_prevent"],
    name: "Done",
    icon: "mdi:check",
  },
];

/** A stage's name in the UI language. */
export const stageName = (g: { name: string }) => tr(g.name);
