import type { HassEntity, HomeAssistant } from "./types";
import { language } from "./settings";

export type FormatKind = "state" | "number" | "power" | "energy" | "data_rate" | "duration" | "none";

export interface ValueOptions {
  entity?: string;
  entities?: string[];
  aggregate?: "sum" | "min" | "max" | "avg";
  attribute?: string;
  format?: FormatKind;
  precision?: number;
  unit?: string;
  abs?: boolean;
  scale?: number;
  text?: string;
  name?: string;
}

const UNAVAILABLE = new Set(["unavailable", "unknown"]);

/** An attribute, also nested: `data.Production` reads attributes.data.Production. */
export function attrOf(st: HassEntity | undefined, path: string): any {
  if (!st) return undefined;
  if (path in st.attributes) return st.attributes[path];
  return path.split(".").reduce<any>((o, k) => (o == null ? undefined : o[k]), st.attributes);
}

export const isUnavailable = (st?: HassEntity) => !st || UNAVAILABLE.has(st.state);

function numberFormatter(hass: HomeAssistant, lang: string, precision?: number) {
  const nf = hass.locale?.number_format;
  const locale =
    nf === "comma_decimal" ? "en-US" : nf === "decimal_comma" ? "de" : nf === "space_comma" ? "fr" : nf === "none" ? "en-US" : lang;
  const opts: Intl.NumberFormatOptions = { useGrouping: nf !== "none" };
  if (precision !== undefined) {
    opts.minimumFractionDigits = precision;
    opts.maximumFractionDigits = precision;
  } else {
    opts.maximumFractionDigits = 2;
  }
  return new Intl.NumberFormat(locale, opts);
}

/** Scales a raw number into the nicest unit of a family (W → kW, MB/s → kB/s, …). */
function autoScale(kind: FormatKind, value: number, unit: string | undefined): { value: number; unit: string; precision: number } {
  switch (kind) {
    case "power": {
      const w = unit === "kW" ? value * 1000 : value;
      return Math.abs(w) < 1000 ? { value: w, unit: "W", precision: 0 } : { value: w / 1000, unit: "kW", precision: 1 };
    }
    case "energy": {
      const wh = unit === "kWh" ? value * 1000 : unit === "MWh" ? value * 1e6 : value;
      if (Math.abs(wh) < 1000) return { value: wh, unit: "Wh", precision: 0 };
      if (Math.abs(wh) < 1e6) return { value: wh / 1000, unit: "kWh", precision: 1 };
      return { value: wh / 1e6, unit: "MWh", precision: 2 };
    }
    case "data_rate": {
      const factor: Record<string, number> = { "B/s": 1 / 1e6, "kB/s": 1 / 1000, "KB/s": 1 / 1000, "MB/s": 1, "GB/s": 1000, "Mbit/s": 1 / 8, "kbit/s": 1 / 8000 };
      const mb = value * (unit && factor[unit] !== undefined ? factor[unit] : 1);
      return Math.abs(mb) < 1 ? { value: mb * 1000, unit: "kB/s", precision: 0 } : { value: mb, unit: "MB/s", precision: 1 };
    }
    default:
      return { value, unit: unit ?? "", precision: 1 };
  }
}

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h} h ${m.toString().padStart(2, "0")} min`;
  if (m) return `${m} min`;
  return `${s} s`;
}

export interface FormattedValue {
  value: string;
  unit: string;
  /** Raw numeric value (NaN when not numeric). */
  number: number;
  available: boolean;
}

export function computeValue(hass: HomeAssistant, o: ValueOptions): FormattedValue {
  const ids = o.entities ?? (o.entity ? [o.entity] : []);
  const objs = ids.map((id) => hass.states[id]);
  const lang = language(hass);
  if (!ids.length) return { value: "", unit: "", number: NaN, available: true };
  if (objs.every(isUnavailable)) return { value: "", unit: "", number: NaN, available: false };

  const raw = objs.map((st) => (st ? (o.attribute ? attrOf(st, o.attribute) : st.state) : undefined));
  const nums = raw.map(Number).filter((n) => !Number.isNaN(n));
  const first = objs.find((s) => s) as HassEntity;
  const srcUnit: string | undefined = o.attribute ? undefined : first.attributes.unit_of_measurement;

  const kind: FormatKind = o.format ?? (o.attribute || ids.length > 1 ? "number" : "state");
  if (kind === "none") return { value: "", unit: "", number: nums[0] ?? NaN, available: true };

  if (kind === "state") {
    // Numeric states are formatted here when HA wouldn't localise them (no unit of
    // its own, e.g. template sensors) or when the config sets its own unit/precision.
    const numeric = raw[0] !== "" && raw[0] !== null && !Number.isNaN(Number(raw[0]));
    if (numeric && (o.precision !== undefined || o.unit !== undefined || !srcUnit)) {
      const n = Number(raw[0]) * (o.scale ?? 1);
      const v = o.abs ? Math.abs(n) : n;
      return { value: numberFormatter(hass, lang, o.precision).format(v), unit: o.unit ?? srcUnit ?? "", number: v, available: true };
    }
    const str = hass.formatEntityState ? hass.formatEntityState(first) : `${first.state}${srcUnit ? ` ${srcUnit}` : ""}`;
    return { value: str, unit: "", number: Number(raw[0]), available: true };
  }

  if (!nums.length) return { value: String(raw[0] ?? ""), unit: "", number: NaN, available: true };
  let n: number;
  switch (o.aggregate ?? "sum") {
    case "min":
      n = Math.min(...nums);
      break;
    case "max":
      n = Math.max(...nums);
      break;
    case "avg":
      n = nums.reduce((a, b) => a + b, 0) / nums.length;
      break;
    default:
      n = nums.reduce((a, b) => a + b, 0);
  }
  n *= o.scale ?? 1;
  if (o.abs) n = Math.abs(n);

  if (kind === "duration") {
    const secs = srcUnit === "min" ? n * 60 : srcUnit === "h" ? n * 3600 : n;
    return { value: formatDuration(secs), unit: "", number: n, available: true };
  }
  if (kind === "power" || kind === "energy" || kind === "data_rate") {
    const s = autoScale(kind, n, srcUnit);
    return {
      value: numberFormatter(hass, lang, o.precision ?? s.precision).format(s.value),
      unit: o.unit ?? s.unit,
      number: n,
      available: true,
    };
  }
  return { value: numberFormatter(hass, lang, o.precision).format(n), unit: o.unit ?? srcUnit ?? "", number: n, available: true };
}

/**
 * Fills a text pattern:  "TUV {value} {unit}", "Plex: {value}", "{name}", "{state}",
 * "{attr:current_position}", "{state:sensor.other}".
 */
export function fillText(pattern: string, hass: HomeAssistant, v: FormattedValue, o: ValueOptions): string {
  const st = o.entity ? hass.states[o.entity] : undefined;
  return pattern.replace(/\{([a-z_]+)(?::([^}]+))?\}/gi, (_m, key: string, arg?: string) => {
    switch (key) {
      case "value":
        return v.value;
      case "unit":
        return v.unit;
      case "name":
        return o.name ?? st?.attributes.friendly_name ?? "";
      case "state":
        return arg ? (hass.states[arg]?.state ?? "") : (st?.state ?? "");
      case "attr":
        return arg && st ? String(attrOf(st, arg) ?? "") : "";
      default:
        return "";
    }
  });
}

export function displayText(hass: HomeAssistant, o: ValueOptions): { text: string; available: boolean; number: number } {
  const v = computeValue(hass, o);
  if (!v.available) return { text: "", available: false, number: NaN };
  if (o.text !== undefined) return { text: fillText(o.text, hass, v, o).replace(/\s+/g, " ").trim(), available: true, number: v.number };
  const text = v.unit ? `${v.value} ${v.unit}` : v.value;
  return { text, available: true, number: v.number };
}
