import { tr } from "../i18n";
import { css, html, nothing } from "lit";
import { GlassElement } from "../core/glass-element";
import type { BaseCardConfig, HomeAssistant } from "../core/types";
import { createCard, registerCard } from "../core/registry";
import { makeEditor } from "../editor/editor";
import { chartSpec } from "../editor/specs";
import { onSelected } from "../core/select";
import { partsCss } from "../core/parts";
import { cssColor } from "../core/colors";
import { CHART_PARTS } from "../core/card-parts";
import type { FontSpec } from "../core/typography";
import { periodEnd, periodGroup, periodStart, readPeriod, usesHelpers, type Period, type PeriodKind, type PeriodSource } from "../core/period";

/**
 * A chart in the dashboard's look: apexcharts-card (HACS, needed) with its card, fonts, colours,
 * columns and tooltip drawn as glass (below). The data stay apexcharts-card's: series, group_by,
 * data_generator…
 *
 * Without a period it shows what `card` says (its own graph_span / span). With one it follows a
 * glass-period-bar: sets `graph_span` and `span` to the day / week / month / year picked there and
 * rebuilds when that changes – `period: true` (the bar without helpers; `group` for a second bar
 * on the screen) or the bar's helpers `offset_entity` + `select_entity`.
 *
 *   type: custom:glass-chart
 *   period: true
 *   card:                          # the shared look, as apexcharts has it – with a period without graph_span / span
 *     type: custom:apexcharts-card
 *     apex_config: { … }
 *   day:                           # each period's own data, merged over `card`
 *     series: [ … ]                #   (lists replace the card's, maps merge into them)
 *   month: { series: [ … ] }
 *   year: { series: [ … ] }        # a series for all periods may sit in `card` too
 *
 * The period comes from `group` (default "period") or, like the bar, from `offset_entity`
 * + `select_entity` (+ `kinds`).
 *
 * What a series leaves out follows the period too: `statistics.period` and `group_by.duration`
 * (day → hour, week / month → day, year → month) and the tooltip's date format – so one series,
 * e.g. `{ entity: sensor.energy, statistics: { type: change } }`, fits every period.
 *
 * And the look of the dashboard (`look: glass`, the default; `look: apex` leaves apexcharts as it is):
 * no card background, the glass font, axis labels and the tooltip in the text colours around it
 * (`fonts: { axis, tooltip }`), columns in `color` with a gradient to a lighter shade, a soft glow
 * and round ends, and a line at zero from the first column's edge to the last's. What apex_config
 * or a series sets itself wins.
 *
 *   color: "#ff9f0a"     # the series without their own colour (HA names too: light-blue, primary…)
 *   height: 214          # px
 *   values: true         # value labels on the left;  time: false – time labels under the chart
 *   grid: false          # horizontal lines at the values
 *   column_width: 62     # % of a column's slot;  radius: 5 – px, the columns' round ends
 *   gradient: true       # to a lighter shade;  glow: true – a soft glow around the columns
 *   zero_line: true      # a line at zero
 */
interface ChartConfig extends BaseCardConfig, PeriodSource {
  card: BaseCardConfig;
  period?: boolean;
  look?: "glass" | "apex";
  color?: string;
  height?: number;
  values?: boolean;
  time?: boolean;
  grid?: boolean;
  column_width?: number;
  radius?: number;
  gradient?: boolean;
  glow?: boolean;
  zero_line?: boolean;
  day?: Record<string, unknown>;
  week?: Record<string, unknown>;
  month?: Record<string, unknown>;
  year?: Record<string, unknown>;
}

const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** `over` merged into `base`: maps key by key, anything else (lists too) replaced. */
function merge(base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isMap(v) && isMap(out[k]) ? merge(out[k] as Record<string, unknown>, v) : v;
  return out;
}

/** apexcharts-card's span for the period: from its start, as long as it is. apexcharts takes the
 *  start of the current period and then adds the offset, so the offset is the exact distance
 *  between the two starts (in hours – months and DST days differ in length). */
function span(p: Period, now = new Date()) {
  const start = periodStart(p, now);
  const end = periodEnd(p, now);
  const days = Math.round((end.getTime() - start.getTime()) / 864e5);
  const startOf: Record<PeriodKind, string> = { day: "day", week: "isoWeek", month: "month", year: "year" };
  const out: Record<string, unknown> = { graph_span: `${days}d`, span: { start: startOf[p.kind] } };
  if (p.offset < 0) {
    const back = periodStart({ ...p, offset: 0 }, now).getTime() - start.getTime();
    (out.span as Record<string, string>).offset = `-${Math.round(back / 36e5)}h`;
  }
  return out;
}

/** Per kind: group_by.duration, statistics.period, tooltip date format. */
const GRAIN: Record<PeriodKind, [string, string, string]> = {
  day: ["1h", "hour", "d. M. HH:mm"],
  week: ["1d", "day", "d. M. yyyy"],
  month: ["1d", "day", "d. M. yyyy"],
  year: ["1month", "month", "M / yyyy"],
};

/** The series' grain and the tooltip's format for the kind, where the config has none. */
function grain(cfg: Record<string, unknown>, kind: PeriodKind): Record<string, unknown> {
  const [duration, period, format] = GRAIN[kind];
  const series = Array.isArray(cfg.series)
    ? cfg.series.map((x) => {
        if (!isMap(x)) return x;
        if (isMap(x.statistics)) return { ...x, statistics: { period, ...x.statistics } };
        if (isMap(x.group_by)) return { ...x, group_by: { duration, ...x.group_by } };
        return x;
      })
    : cfg.series;
  return merge({ ...cfg, series }, { apex_config: merge({ tooltip: { x: { format } } }, isMap(cfg.apex_config) ? cfg.apex_config : {}) });
}

/** A colour as rgb (CSS variables and names resolved on `host`), and the same mixed with white. */
function rgb(color: string, host: HTMLElement): [number, number, number] | undefined {
  const probe = document.createElement("span");
  probe.style.color = color;
  (host.shadowRoot ?? host).appendChild(probe);
  const m = getComputedStyle(probe).color.match(/[\d.]+/g);
  probe.remove();
  return m && m.length >= 3 ? [Number(m[0]), Number(m[1]), Number(m[2])] : undefined;
}
const hex = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const lighter = (c: number[]) => hex(c.map((v) => v + (255 - v) * 0.25));

/** The glass look as apexcharts settings, under the chart's own. */
function glassLook(cfg: Record<string, unknown>, c: ChartConfig, host: HTMLElement): Record<string, unknown> {
  // HA's colour names (light-blue, primary…) as the other cards take them; apexcharts wants a plain colour
  const base = rgb(cssColor(c.color) ?? "var(--glass-chart-color, #ff9f0a)", host) ?? [255, 159, 10];
  const series = (Array.isArray(cfg.series) ? cfg.series : []).map((x) => {
    if (!isMap(x)) return x;
    const own = typeof x.color === "string" ? cssColor(x.color) : undefined;
    return { ...x, color: hex((own && rgb(own, host)) || base) };
  }) as Record<string, unknown>[];
  const colors = series.map((x) => rgb(String(x.color), host) ?? base);
  const columns = series.length > 0 && series.every((x) => x.type === "column");
  const zero = c.zero_line !== false;
  const apex: Record<string, unknown> = {
    chart: {
      background: "transparent",
      toolbar: { show: false },
      ...(c.height ? { height: Number(c.height) } : {}),
      dropShadow: { enabled: c.glow !== false, top: 0, left: 0, blur: 4, color: hex(colors[0] ?? base), opacity: 0.2 },
      // the line at zero reaches the outer columns' edges (apex ends it where the plot ends)
      // (apexcharts-card copies its config as JSON: functions only as EVAL: strings)
      ...(zero ? { events: { mounted: ZERO_EVAL, updated: ZERO_EVAL } } : {}),
    },
    fill: {
      type: c.gradient === false ? "solid" : "gradient",
      gradient: { type: "vertical", shade: "light", shadeIntensity: 0, gradientToColors: colors.map(lighter), inverseColors: false, opacityFrom: 1, opacityTo: 0.85, stops: [0, 100] },
    },
    xaxis: { labels: { show: !!c.time, datetimeUTC: false }, axisBorder: { show: false }, axisTicks: { show: false }, tooltip: { enabled: false }, crosshairs: { show: false } },
    ...(c.values === false ? { yaxis: { labels: { show: false } } } : {}),
    // lines at the values: as faint as the zero line (their colour from CSS)
    grid: c.grid ? { show: true, strokeDashArray: 0, xaxis: { lines: { show: false } }, yaxis: { lines: { show: true } } } : { show: false },
    legend: { show: false },
    tooltip: { enabled: true, shared: true, followCursor: true },
    ...(columns ? { stroke: { width: 0 } } : {}),
    plotOptions: { bar: { borderRadius: Number(c.radius ?? 5), borderRadiusApplication: "end", columnWidth: `${Number(c.column_width ?? 62)}%`, borderRadiusWhenStacked: "all" } },
    ...(zero ? { annotations: { yaxis: [{ y: 0, borderColor: "transparent", borderWidth: 1, strokeDashArray: 0 }] } } : {}),
  };
  return merge({ header: { show: false }, series }, { ...cfg, series, apex_config: merge(apex, isMap(cfg.apex_config) ? cfg.apex_config : {}) });
}

/** apexcharts' chart events: the zero line from the first column's left edge to the last's right. */
function zeroLine(chart: { el?: HTMLElement }) {
  const el = chart?.el;
  const line = el?.querySelector<SVGLineElement>(".apexcharts-yaxis-annotations line");
  const bars = el ? [...el.querySelectorAll<SVGGraphicsElement>(".apexcharts-bar-area")] : [];
  if (!line || !bars.length) return;
  let min = Infinity;
  let max = -Infinity;
  for (const b of bars) {
    const box = b.getBBox();
    if (!box.width) continue;
    min = Math.min(min, box.x);
    max = Math.max(max, box.x + box.width);
  }
  // the bars' boxes are in the plot's coordinates, as is the line (same group transform)
  if (Number.isFinite(min)) {
    line.setAttribute("x1", String(Math.min(min, Number(line.getAttribute("x1")))));
    line.setAttribute("x2", String(Math.max(max, Number(line.getAttribute("x2")))));
  }
}

(window as unknown as Record<string, unknown>).glassChartZeroLine = zeroLine;
const ZERO_EVAL = "EVAL:(chart) => window.glassChartZeroLine && window.glassChartZeroLine(chart)";

/** Inside apexcharts' shadow root: no card, the glass font and text colours (currentColor is the
 *  text around the chart), the zero line, a glass tooltip. */
const APEX_CSS = `
ha-card { background: none !important; border: 0 !important; box-shadow: none !important; color: inherit !important;
  -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }
.apexcharts-text, .apexcharts-tooltip, .apexcharts-tooltip-title { font-family: var(--g-font) !important; }
.apexcharts-xaxis-label, .apexcharts-yaxis-label { fill: currentColor !important; color: color-mix(in srgb, currentColor 62%, transparent); }
.apexcharts-yaxis-annotations line { stroke: color-mix(in srgb, currentColor 28%, transparent) !important; }
.apexcharts-gridline { stroke: color-mix(in srgb, currentColor 12%, transparent) !important; }
.apexcharts-tooltip.apexcharts-theme-light, .apexcharts-tooltip.apexcharts-theme-dark, .apexcharts-tooltip {
  background: var(--glass-room-bg, rgba(246, 246, 248, 0.92)) !important; color: var(--glass-room-fg, #1c1c1e) !important;
  border: 0.5px solid var(--glass-home-border, rgba(255, 255, 255, 0.35)) !important; border-radius: 14px !important;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16) !important;
  -webkit-backdrop-filter: blur(20px) saturate(160%); backdrop-filter: blur(20px) saturate(160%); }
.apexcharts-tooltip-title { background: none !important; border-bottom: 0 !important; color: inherit !important; opacity: 0.7; }
`;

/** Follows a period bar: `period: true`, a `group` or the bar's helpers. */
const followsPeriod = (c: ChartConfig) => !!(c.period || c.group || c.offset_entity);

class GlassChart extends GlassElement<ChartConfig> {
  static override wrapTile = true;
  static override properties = { ...GlassElement.properties, _missing: { state: true } };
  /** apexcharts-card isn't installed (not defined a while after the first try) */
  declare _missing?: boolean;
  private _waiting = false;
  static override parts = CHART_PARTS;
  private _sheet?: CSSStyleSheet;
  private _card?: HTMLElement & { hass?: HomeAssistant };
  private _key?: string;
  private _unsub?: () => void;

  static getConfigElement() {
    return makeEditor(chartSpec);
  }

  static getStubConfig() {
    return { card: { type: "custom:apexcharts-card", series: [] } };
  }

  protected override validateConfig(c: ChartConfig) {
    if (!isMap(c.card) || !c.card.type) throw new Error("`card` (the chart card) is required");
    this._key = undefined;
    this._listen(c);
    return c;
  }

  private _listen(c: ChartConfig) {
    this._unsub?.();
    this._unsub = !followsPeriod(c) || usesHelpers(c) ? undefined : onSelected(periodGroup(c), () => this.requestUpdate());
  }

  override connectedCallback() {
    super.connectedCallback();
    if (this._config && !this._unsub) this._listen(this._config);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._unsub?.();
    this._unsub = undefined;
  }

  protected watchedEntities(c: ChartConfig) {
    return [c.offset_entity, c.select_entity].filter(Boolean) as string[];
  }

  protected override forwardHass(hass: HomeAssistant) {
    if (this._card) this._card.hass = hass;
  }

  /** apexcharts-card loads with the dashboard's resources: wait for it a while, then say it's missing. */
  private _ready(): boolean {
    const tag = String(this._config.card.type ?? "").replace(/^custom:/, "");
    if (!tag.includes("-") || customElements.get(tag)) return true;
    if (!this._waiting) {
      this._waiting = true;
      customElements.whenDefined(tag).then(() => {
        this._missing = false;
        this._key = undefined;
        this.requestUpdate();
      });
      setTimeout(() => (this._missing = !customElements.get(tag)), 6000);
    }
    return false;
  }

  /** The chart for the current period; the same one until the period (or the day) changes. */
  private _chart(): HTMLElement | undefined {
    const c = this._config;
    const p = followsPeriod(c) ? readPeriod(this._hass, c) : undefined;
    // the period's start in the key: past midnight "today" is another day
    const key = p ? `${p.kind}:${periodStart(p).getTime()}` : "fixed";
    if (key !== this._key || !this._card) {
      this._key = key;
      const own = p ? c[p.kind] : undefined;
      let cfg = p ? grain(merge(merge(c.card, span(p)), isMap(own) ? own : {}), p.kind) : { ...c.card };
      if (c.look !== "apex") cfg = glassLook(cfg, c, this);
      this._card = createCard(cfg as BaseCardConfig, this._hass);
      this._style(this._card);
    }
    return this._card;
  }

  /** The glass CSS and the `fonts` of its parts into the chart card's shadow root (once it has one). */
  private _style(holder: HTMLElement) {
    if (this._config.look === "apex") return;
    this._sheet ??= new CSSStyleSheet();
    this._sheet.replaceSync(APEX_CSS + partsCss(CHART_PARTS, this._config.fonts as Record<string, FontSpec> | undefined));
    const sheet = this._sheet;
    let tries = 0;
    const attach = () => {
      const el = holder.shadowRoot ? holder : (holder.firstElementChild as HTMLElement | null);
      const root = el?.shadowRoot;
      if (root) {
        if (!root.adoptedStyleSheets.includes(sheet)) root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
        return;
      }
      if (tries++ < 120) requestAnimationFrame(attach);
    };
    attach();
  }

  protected override render() {
    if (!this._config || !this._hass) return nothing;
    if (!this._ready())
      return this._missing
        ? html`<div class="missing">${tr("The chart needs apexcharts-card (HACS).")}</div>`
        : nothing;
    return html`${this._chart()}`;
  }

  override getCardSize() {
    return 4;
  }

  static override styles = [
    GlassElement.styles,
    css`
      :host {
        display: block;
      }
      .missing {
        padding: 16px;
        font-size: 14px;
        opacity: 0.7;
      }
    `,
  ];
}

registerCard("glass-chart", GlassChart, {
  requires: "apexcharts-card",
  name: "Glass – chart",
  description: "apexcharts-card in the dashboard's look; can follow the day, week, month or year picked in the period bar.",
});
