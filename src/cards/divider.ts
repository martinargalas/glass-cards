import { css, html, nothing } from "lit";
import { GlassElement } from "../core/glass-element";
import type { BaseCardConfig } from "../core/types";
import { registerCard } from "../core/registry";
import { makeEditor } from "../editor/editor";
import { dividerSpec } from "../editor/specs";
import { DIVIDER_PARTS } from "../core/card-parts";

/**
 * Rounded separator line.
 *
 *   type: custom:glass-divider
 *   width: 92%          # line length
 *   thickness: 4        # px
 *   opacity: 0.55
 *   margin: 0           # extra px above and below (on top of the panel gap)
 *   name: Výroba        # optional: a heading in front of the line (section of a card)
 *   icon: mdi:flash
 *   line: false         # with a name / icon: just the heading, no line
 */
interface DividerConfig extends BaseCardConfig {
  name?: string;
  icon?: string;
  line?: boolean;
  width?: string | number;
  thickness?: number;
  opacity?: number;
  margin?: number;
}

class GlassDivider extends GlassElement<DividerConfig> {
  static override wrapTile = true;
  static override parts = DIVIDER_PARTS;
  static getConfigElement() {
    return makeEditor(dividerSpec);
  }

  static getStubConfig() {
    return {};
  }

  protected watchedEntities() {
    return [];
  }

  protected override render() {
    if (!this._config) return nothing;
    const c = this._config;
    const w = typeof c.width === "number" ? `${c.width}%` : (c.width ?? "92%");
    if (c.name || c.icon)
      return html`<div class="head" style="margin:${c.margin ?? 0}px 0">
        ${c.icon ? html`<ha-icon .icon=${c.icon}></ha-icon>` : nothing}${c.name ? html`<span>${c.name}</span>` : nothing}
        ${c.line === false
          ? nothing
          : html`<i class="line" style="height:${c.thickness !== undefined ? `${c.thickness}px` : "var(--glass-divider-size, 2px)"};${c.opacity !== undefined ? `opacity:${c.opacity}` : ""}"></i>`}
      </div>`;
    return html`<div
      class="line"
      style="width:${w};height:${c.thickness !== undefined ? `${c.thickness}px` : "var(--glass-divider-size, 2px)"};margin:${c.margin ?? 0}px auto;${c.opacity !== undefined ? `opacity:${c.opacity}` : ""}"
    ></div>`;
  }

  static override styles = [
    GlassElement.styles,
    css`
      :host {
        display: block;
      }
      /* between separate home tiles a line has nothing to divide */
      :host([on-bare][glass="home"]) {
        display: none;
      }
      /* a heading: icon, name and the line to the right edge */
      .head {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 0 4px;
        font-size: 15px;
        font-weight: 600;
        /* the text colour of the card it sits in (a panel hands it down) */
        color: var(--primary-text-color, var(--g-text));
        text-shadow: var(--g-text-shadow);
      }
      .head ha-icon {
        --mdc-icon-size: 20px;
        display: flex;
        filter: var(--g-icon-shadow);
      }
      .head span {
        white-space: nowrap;
      }
      .head .line {
        flex: 1;
        margin-left: 8px;
      }
      .line {
        border-radius: 999px;
        background: var(--glass-divider-color, color-mix(in srgb, var(--g-text, #fff) 55%, transparent));
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
      }
    `,
  ];
}

registerCard("glass-divider", GlassDivider, {
  name: "Glass – divider",
  description: "Rounded separator line between cards.",
});
