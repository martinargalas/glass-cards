import { css, html, nothing } from "lit";
import { GlassElement } from "../core/glass-element";
import { selectable } from "../core/styles";
import type { BaseCardConfig } from "../core/types";
import { registerCard } from "../core/registry";
import { makeEditor } from "../editor/editor";
import { tabsSpec } from "../editor/specs";
import { getSelected, onSelected, setDefault, setSelected } from "../core/select";
import { haptic } from "../core/actions";
import { materials, matTint, type Material } from "../core/materials";

/**
 * A segmented switch: picks one id in a group. Cards in a glass panel show for it with
 * a visibility condition (`condition: select, group: …, id: …`) – as they do for an
 * appliance bar's pick.
 *
 *   type: custom:glass-tabs
 *   group: cleaning_mower
 *   default: front                   # picked until one is tapped
 *   tabs:
 *     - { id: front, name: Kamera, icon: mdi:cctv }
 *     - { id: zones, name: Zóny, icon: mdi:map-marker-radius-outline }
 *   tabs_glass: home                 # the track; tab_glass: the current tab (core/materials), *_color tints them
 *   fonts: { tab: {…}, tab_on: {…} } # the text of a tab / the current one (core/typography); icons: the same for icons
 */
interface TabsConfig extends BaseCardConfig {
  group: string;
  default?: string;
  tabs: { id: string; name?: string; icon?: string }[];
  tabs_glass?: Material;
  tabs_color?: string;
  tab_glass?: Material;
  tab_color?: string;
}

const has = (v?: string) => !!v && v !== "none";
/** An element's own material (a colour alone tints the default one). */
function part(m: Material | undefined, color: string | undefined, def: Material) {
  const use = m ?? (has(color) ? def : undefined);
  return use ? { cls: `mat mat-${use}`, style: has(color) ? matTint(color) : "--mat-tint:initial;--mat-tinted:initial;--mat-sheen:initial" } : { cls: "", style: "" };
}

class GlassTabs extends GlassElement<TabsConfig> {
  static override properties = { ...GlassElement.properties, _cur: { state: true } };
  declare _cur?: string;
  private _unsub?: () => void;

  static getConfigElement() {
    return makeEditor(tabsSpec);
  }

  static getStubConfig() {
    return { group: "main", tabs: [{ id: "one", name: "One" }, { id: "two", name: "Two" }] };
  }

  protected override validateConfig(c: TabsConfig) {
    if (!c.group) throw new Error("`group` is required");
    if (!Array.isArray(c.tabs)) throw new Error("`tabs` must be a list");
    return c;
  }

  protected watchedEntities() {
    return [];
  }

  override connectedCallback() {
    super.connectedCallback();
    if (!this._config) return;
    const c = this._config;
    if (c.default) setDefault(c.group, c.default);
    this._cur = getSelected(c.group);
    this._unsub = onSelected(c.group, (id) => (this._cur = id));
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._unsub?.();
  }

  protected override render() {
    const c = this._config;
    if (!c) return nothing;
    const v = this._cur ?? c.default ?? c.tabs[0]?.id;
    const track = part(c.tabs_glass, c.tabs_color, "home");
    const cur = part(c.tab_glass, c.tab_color, "dark");
    return html`<div class="tabs ${track.cls}" style=${track.style}>
      ${c.tabs.map(
        (t) => html`<button
          class="tab ${t.id === v ? `on ${cur.cls}` : ""}"
          style=${t.id === v ? cur.style : ""}
          @click=${() => (haptic("selection"), setSelected(c.group, t.id))}
        >
          ${t.icon ? html`<ha-icon .icon=${t.icon}></ha-icon>` : nothing}${t.name ? html`<span>${t.name}</span>` : nothing}
        </button>`,
      )}
    </div>`;
  }

  override getCardSize() {
    return 1;
  }

  static override styles = [
    GlassElement.styles,
    selectable,
    css`
      :host {
        display: block;
      }
      /* a segmented control – the current one in the dark glass of the other controls */
      .tabs {
        display: flex;
        gap: 4px;
        padding: 4px;
        border-radius: 999px;
      }
      .tabs:not(.mat) {
        background: var(--glass-home-control, rgba(118, 118, 128, 0.16));
      }
      .tab {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        height: 40px;
        border: 0;
        border-radius: 999px;
        background: none;
        font: inherit;
        font-size: var(--gt-tab-size, 14px);
        font-weight: var(--gt-tab-weight, 600);
        color: var(--gt-tab-color, var(--glass-home-text, #1c1c1e));
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        transition: background 0.2s ease;
      }
      .tab ha-icon {
        --mdc-icon-size: var(--gi-tab-size, 18px);
        color: var(--gi-tab-color, inherit);
        display: flex;
      }
      .tab.on {
        font-size: var(--gt-tab_on-size, var(--gt-tab-size, 14px));
        font-weight: var(--gt-tab_on-weight, var(--gt-tab-weight, 600));
      }
      .tab.on.mat {
        color: var(--gt-tab_on-color, var(--gt-tab-color, inherit));
      }
      .tab.on ha-icon {
        --mdc-icon-size: var(--gi-tab_on-size, var(--gi-tab-size, 18px));
        color: var(--gi-tab_on-color, var(--gi-tab-color, inherit));
      }
      .tab.on:not(.mat) {
        color: var(--gt-tab_on-color, var(--glass-home-side-text, #fff));
        background: var(--glass-control-bg);
        box-shadow: var(--glass-control-shadow);
        -webkit-backdrop-filter: var(--glass-control-backdrop, none);
        backdrop-filter: var(--glass-control-backdrop, none);
      }
    `,
    materials,
  ];
}

registerCard("glass-tabs", GlassTabs, {
  name: "Glass – tabs",
  description: "A segmented switch: cards in a panel show for the picked tab (visibility: picked in a group).",
});
