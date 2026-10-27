import { tr } from "../i18n";
import { css, html, nothing } from "lit";
import { GlassElement } from "../core/glass-element";
import type { BaseCardConfig } from "../core/types";
import { registerCard } from "../core/registry";
import { makeEditor } from "../editor/editor";
import { dateHeaderSpec } from "../editor/specs";
import { evalCondition, type Condition } from "../core/conditions";
import { displayText, type ValueOptions } from "../core/format";
import { language } from "../core/settings";
import { DATE_HEADER_PARTS } from "../core/card-parts";

/**
 * Date, today's public holiday and name day (and anything else worth one line).
 * The language and the date format are the HA user's.
 *
 *   type: custom:glass-date-header
 *   holidays: calendar.czechia        # HA's Holiday integration: today's holiday, if any
 *   nameday: sensor.nameday           # a sensor of your own whose state is today's names
 *   lines:
 *     - entity: sensor.power
 *       text: "{state} now"
 *   greeting: true        # "Good morning" / "Dobré dopoledne" instead of the date
 *   join: " · "           # all lines in one: "Doma 2 · 1,5 kW · zabezpečeno"
 */
interface Line extends ValueOptions {
  icon?: string;
  visible?: Condition;
}

interface DateHeaderConfig extends BaseCardConfig {
  align?: "start" | "center" | "end";
  date_format?: Intl.DateTimeFormatOptions;
  title?: string;
  lines?: Line[];
  /** A calendar of public holidays (HA's Holiday integration): today's one, while it is on. */
  holidays?: string;
  /** A sensor whose state is today's names (from a name day integration or a template). */
  nameday?: string;
  /** A greeting by the time of day instead of the date. */
  greeting?: boolean;
  /** The lines as one, joined by this. */
  join?: string;
}

class GlassDateHeader extends GlassElement<DateHeaderConfig> {
  static override wrapTile = true;
  static override parts = DATE_HEADER_PARTS;
  static getConfigElement() {
    return makeEditor(dateHeaderSpec);
  }

  private _timer?: number;

  static getStubConfig(hass?: { states: Record<string, unknown> }) {
    const holidays = Object.keys(hass?.states ?? {}).find((e) => e.startsWith("calendar.") && /holiday|svatk|feiertag|ferie|festiv/i.test(e));
    return holidays ? { holidays } : {};
  }

  protected watchedEntities(c: DateHeaderConfig) {
    const ids: string[] = [c.holidays, c.nameday].filter((x): x is string => !!x);
    for (const l of c.lines ?? []) {
      if (l.entity) ids.push(l.entity);
      if (l.entities) ids.push(...l.entities);
      if (l.visible && typeof l.visible === "object" && !Array.isArray(l.visible) && l.visible.entity) ids.push(l.visible.entity);
    }
    return ids;
  }

  override connectedCallback() {
    super.connectedCallback();
    this._schedule();
    this._ro = new ResizeObserver(() => this._fit());
    this._ro.observe(this);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    clearTimeout(this._timer);
    this._ro?.disconnect();
  }

  /** Re-render right after midnight, then sleep until the next one. */
  private _schedule() {
    clearTimeout(this._timer);
    const now = new Date();
    // a greeting changes during the day: the next full hour, else midnight
    const next = this._config?.greeting
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 5)
      : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
    this._timer = window.setTimeout(() => {
      this.requestUpdate();
      this._schedule();
    }, next.getTime() - now.getTime());
  }

  /** The date doesn't fit on one line (narrow phones) → short weekday ("Po" / "Mon"). */
  private _short = false;
  private _ro?: ResizeObserver;

  protected override updated(changed: Map<string, unknown>) {
    super.updated(changed);
    this._fit();
  }

  /** Long weekday when it fits, else the short one – measured, so it works for any language and font. */
  private _fit() {
    const el = this.shadowRoot?.querySelector<HTMLElement>(".title");
    if (!el || this._config?.title || this._config?.greeting || this._config?.date_format) return;
    const probe = this.shadowRoot!.querySelector<HTMLElement>(".probe");
    if (!probe) return;
    const short = probe.scrollWidth > el.clientWidth + 1;
    if (short !== this._short) {
      this._short = short;
      this.requestUpdate();
    }
  }

  private _title(short = this._short): string {
    if (this._config.title) return this._config.title;
    const lang = language(this._hass);
    if (this._config.greeting) {
      const h = new Date().getHours();
      const i = h < 5 ? 4 : h < 9 ? 0 : h < 12 ? 1 : h < 18 ? 2 : h < 22 ? 3 : 4;
      return tr(["Good morning", "Good late morning", "Good afternoon", "Good evening", "Good night"][i]);
    }
    const opts = this._config.date_format ?? { weekday: short ? "short" : "long", day: "numeric", month: "long" };
    const parts = new Intl.DateTimeFormat(lang, opts).formatToParts(new Date());
    // "čtvrtek 8. října" → "Čtvrtek, 8. října"
    let out = "";
    parts.forEach((p, i) => {
      out += p.type === "literal" && parts[i - 1]?.type === "weekday" && !p.value.includes(",") ? ", " : p.value;
    });
    return out.charAt(0).toUpperCase() + out.slice(1);
  }

  protected override render() {
    if (!this._config || !this._hass) return nothing;
    const hass = this._hass;
    // today's public holiday (the calendar is on all day) and name day, above the own lines
    const known = (id?: string) => {
      const st = id ? hass.states[id] : undefined;
      return st && !["unavailable", "unknown", ""].includes(st.state) ? st : undefined;
    };
    const holiday = known(this._config.holidays);
    const names = known(this._config.nameday);
    const extra: Line[] = [
      ...(holiday?.state === "on" && holiday.attributes.message ? [{ text: String(holiday.attributes.message), icon: "mdi:flag-variant-outline" }] : []),
      ...(names ? [{ text: tr("Name day: {names}", { names: names.state }) }] : []),
    ];
    const lines = [...extra, ...(this._config.lines ?? [])]
      .filter((l) => evalCondition(l.visible, hass, l.entity))
      .map((l) => ({ l, t: displayText(hass, l) }))
      .filter(({ t }) => t.available && t.text);
    return html`
      <div
        class="wrap"
        style="text-align:${this._config.align ?? "center"};--line-justify:${({ start: "flex-start", end: "flex-end" } as Record<string, string>)[this._config.align ?? ""] ?? "center"}"
      >
        <div class="title">${this._title()}</div>
        <div class="title probe" aria-hidden="true">${this._title(false)}</div>
        ${this._config.join !== undefined
          ? lines.length
            ? html`<div class="line"><span>${lines.map(({ t }) => t.text).join(this._config.join)}</span></div>`
            : nothing
          : lines.map(
              ({ l, t }) => html`<div class="line">${l.icon ? html`<ha-icon .icon=${l.icon}></ha-icon>` : nothing}<span>${t.text}</span></div>`,
            )}
      </div>
    `;
  }

  static override styles = [
    GlassElement.styles,
    css`
      :host {
        display: block;
      }
      .wrap {
        display: flex;
        flex-direction: column;
        justify-content: center;
        height: 100%;
        gap: 2px;
        text-shadow: var(--g-text-shadow);
      }
      .title {
        font-family: var(--gt-title-font, inherit);
        font-size: var(--gt-title-size, var(--glass-date-size, 30px));
        font-weight: var(--gt-title-weight, 400);
        font-style: var(--gt-title-style, normal);
        color: var(--gt-title-color, inherit);
        line-height: 1.2;
        letter-spacing: var(--gt-title-spacing, -0.01em);
      }
      /* invisible copy of the long date, to measure whether it fits on one line */
      .probe {
        position: absolute;
        visibility: hidden;
        white-space: nowrap;
        pointer-events: none;
        width: max-content;
      }
      .wrap {
        position: relative;
      }
      .line {
        font-family: var(--gt-lines-font, inherit);
        font-size: var(--gt-lines-size, var(--glass-date-line-size, 22px));
        font-weight: var(--gt-lines-weight, 400);
        font-style: var(--gt-lines-style, normal);
        letter-spacing: var(--gt-lines-spacing, normal);
        color: var(--gt-lines-color, var(--g-text-2));
        display: inline-flex;
        gap: 6px;
        align-items: center;
        justify-content: var(--line-justify);
      }
      ha-icon {
        --mdc-icon-size: 20px;
      }
    `,
  ];
}

registerCard("glass-date-header", GlassDateHeader, {
  name: "Glass – date header",
  description: "The date, name day and other one-line information.",
});
