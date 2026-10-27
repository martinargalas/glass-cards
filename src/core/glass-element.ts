import { syncLang } from "../i18n";
import { LitElement, html, nothing, type CSSResultGroup, type PropertyValues } from "lit";
import type { BaseCardConfig, GlassMode, HassEntity, HomeAssistant } from "./types";
import { resolveGlass, isDark, language, settings } from "./settings";
import { surface, tokens } from "./styles";
import { LiquidController } from "./liquid";
import { fontVars, iconVars, type FontSpec, type IconSpec } from "./typography";
import { partsCss, type PartDef } from "./parts";
import { nightConfig } from "./night";

/** { color: [r,g,b] | "#rrggbb", strength: 0–100 } → CSS values; strength 100 ≈ 60 % color. */
function tintVars(t: any): { rgb: string; a: string } | undefined {
  if (!t || typeof t !== "object") return undefined;
  let rgb: number[] | undefined;
  if (Array.isArray(t.color) && t.color.length === 3) rgb = t.color.map(Number);
  else if (typeof t.color === "string" && /^#?[0-9a-f]{6}$/i.test(t.color)) {
    const h = t.color.replace("#", "");
    rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  if (!rgb || rgb.some((x) => Number.isNaN(x))) return undefined;
  const strength = Math.min(100, Math.max(0, Number(t.strength ?? 30)));
  return { rgb: rgb.join(", "), a: String((strength / 100) * 0.6) };
}

/**
 * Base for every glass card.
 *
 * Performance contract: HA hands every card a new `hass` object on *any* state
 * change in the house. We re-render only when an entity this card declared in
 * `watchedEntities()` changed (HA state objects are immutable, so a reference
 * check is enough), or when language / dark mode flipped.
 */
export abstract class GlassElement<C extends BaseCardConfig = BaseCardConfig> extends LitElement {
  static override properties = { _config: { state: true } };
  /** The config for the time of day: `dark:` merged in by night (core/night). */
  declare _config: C;
  /** The config as set, `dark:` included. */
  protected _rawConfig?: C;
  private _configNight?: boolean;

  protected _hass?: HomeAssistant;
  private _watched: string[] = [];
  private _seen = new Map<string, HassEntity | undefined>();
  private _lang?: string;
  private _dark?: boolean;

  static override styles: CSSResultGroup = [tokens, surface];

  /** A card with no tile of its own (a header, a divider, a bar…): with its own `glass` set,
   *  its content goes on one – the field does what it says on every card. */
  static wrapTile = false;

  constructor() {
    super();
    if (!(this.constructor as typeof GlassElement).wrapTile) return;
    const own = this.render;
    this.render = () => {
      const body = own.call(this);
      return body === nothing || !this.tile ? body : html`<div class="${this.tile} tile-wrap">${body}</div>`;
    };
    new LiquidController(this, ".tile-wrap");
  }

  /** The texts and icons its Appearance offers (core/parts): `fonts` / `icons` style them. */
  static parts?: PartDef[];
  private _partsSheet?: CSSStyleSheet;
  private _partsCss = "";
  private applyParts() {
    const parts = (this.constructor as typeof GlassElement).parts;
    const root = this.shadowRoot;
    if (!parts?.length || !root) return;
    const sc = this.styleConfig() as Record<string, any> | undefined;
    const css = partsCss(parts, sc?.fonts, sc?.icons);
    if (css === this._partsCss) return;
    this._partsCss = css;
    if (!this._partsSheet) {
      this._partsSheet = new CSSStyleSheet();
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, this._partsSheet];
    }
    this._partsSheet.replaceSync(css);
  }

  set hass(hass: HomeAssistant) {
    const first = !this._hass;
    syncLang(hass);
    this._hass = hass;
    this.forwardHass(hass);
    if (first || this._hassChanged(hass)) {
      this.requestUpdate();
      this.hassChanged(hass);
    }
  }

  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  setConfig(config: C) {
    if (!config) throw new Error("Invalid configuration");
    this._rawConfig = config;
    this._configNight = this.nightNow();
    this._config = this.validateConfig(nightConfig(config, this._configNight));
    this._watched = [...new Set([...this.watchedEntities(this._config)].filter(Boolean))];
    this._seen.clear();
    if (this._hass) for (const id of this._watched) this._seen.set(id, this._hass.states[id]);
    this.requestUpdate();
  }

  /** Whether the card is dark now – the dashboard's day / night. */
  protected nightNow(): boolean {
    return isDark(this._hass, this);
  }

  /** Normalise / validate config. Throw an Error with a readable message on bad input. */
  protected validateConfig(config: C): C {
    return config;
  }

  /** Entities whose changes trigger a re-render. */
  protected abstract watchedEntities(config: C): Iterable<string>;

  /** Hook for cards that need to react to hass beyond rendering (subscriptions…). */
  protected hassChanged(_hass: HomeAssistant): void {}

  /** Called on every hass update, before change detection. Containers pass hass to children here. */
  protected forwardHass(_hass: HomeAssistant): void {}

  private _hassChanged(hass: HomeAssistant): boolean {
    let changed = false;
    for (const id of this._watched) {
      const st = hass.states[id];
      if (this._seen.get(id) !== st) {
        this._seen.set(id, st);
        changed = true;
      }
    }
    const lang = language(hass);
    if (lang !== this._lang) {
      this._lang = lang;
      changed = true;
    }
    const dark = isDark(hass, this);
    if (dark !== this._dark) {
      this._dark = dark;
      changed = true;
    }
    return changed;
  }

  /** For a card without a tile of its own (a map, a list…): its own glass (`glass` set) gives
   *  its root a tile – the class to add there (core/styles surface). */
  protected get tile(): string {
    const g = this._config?.glass;
    return g && g !== "none" ? "surface own-glass" : "";
  }

  /** The HA user switched the language: draw the texts anew (states alone would not). */
  private _onLang = () => this.requestUpdate();

  override connectedCallback() {
    super.connectedCallback();
    // outside a glass dashboard / panel (HA's own dashboards, the card editor): the card
    // sets the dashboard's day / night look itself (core/styles dayVars, nightVars)
    this.toggleAttribute("standalone", !this._insideGlass());
    window.addEventListener("glass-lang", this._onLang);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("glass-lang", this._onLang);
  }

  private _insideGlass(): boolean {
    let n: Node = this;
    for (;;) {
      const root = n.getRootNode();
      const host = root instanceof ShadowRoot ? root.host : undefined;
      if (!host) return false;
      if (host.tagName.startsWith("GLASS-")) return true;
      n = host;
    }
  }

  protected override willUpdate(changed: PropertyValues) {
    super.willUpdate(changed);
    // Containers set `glass` explicitly; standalone cards resolve their own.
    this.toggleAttribute("dark", isDark(this._hass, this));
    // day turned to night (or back): the config again, with or without its `dark:`
    const raw = this._rawConfig;
    if (raw?.dark && this.nightNow() !== this._configNight) queueMicrotask(() => this._rawConfig === raw && this.setConfig(raw));
    if (!this.hasAttribute("glass-inherited")) this.setAttribute("glass", resolveGlass(this._config?.glass));
    // Third level: buttons, chips, people inside this card. Own setting, else the
    // dashboard's control_glass, else whatever this card is.
    if (!this.hasAttribute("control-glass-inherited")) {
      const own = (this._config?.control_glass ?? settings.control_glass) as GlassMode | undefined;
      this.setAttribute("control-glass", own ? resolveGlass(own) : (this.getAttribute("glass") ?? resolveGlass(undefined)));
    }
  }

  protected override updated(changed: PropertyValues) {
    super.updated(changed);
    this.applyStyleOverrides();
    this.applyParts();
    // room bars inherit bar_glass / bar_tint from a panel or the dashboard: a change there
    // re-renders the cards below (they aren't rebuilt when only the container changed)
    const cfg = this.styleConfig() as Record<string, any> | undefined;
    const bar = JSON.stringify([cfg?.bar_glass, cfg?.bar_tint]);
    if (this._barKey !== undefined && bar !== this._barKey && this.shadowRoot) requestAll(this.shadowRoot);
    this._barKey = bar;
  }
  private _barKey?: string;

  /** Config whose `styles:` / `fonts:` apply (containers return their per-mode config). */
  protected styleConfig(): C | undefined {
    return this._config;
  }

  /** `styles:` in config → CSS custom properties on the host. Theming without card_mod. */
  private _appliedStyles: string[] = [];
  private applyStyleOverrides() {
    const styles = this.styleConfig()?.styles as Record<string, string> | undefined;
    for (const k of this._appliedStyles) this.style.removeProperty(k);
    this._appliedStyles = [];
    // `fonts:` → --gt-<part>-* (see core/typography.ts)
    const sc = this.styleConfig() as Record<string, any> | undefined;
    for (const decl of `${fontVars(sc?.fonts as Record<string, FontSpec> | undefined)}${iconVars(sc?.icons as Record<string, IconSpec> | undefined)}`.split(";")) {
      const i = decl.indexOf(":");
      if (i < 0) continue;
      const prop = decl.slice(0, i);
      this.style.setProperty(prop, decl.slice(i + 1));
      this._appliedStyles.push(prop);
    }
    // glass_tint / tile_tint / control_tint → --glass-<level>-tint (r, g, b) + -a (alpha)
    const cfg = this.styleConfig() as Record<string, any> | undefined;
    const nested = this.hasAttribute("nested");
    const tints: [string, string][] = [
      ["glass_tint", nested ? "tile" : "panel"],
      // a nested card's own liquid glass (a room's bar over its photo) reads the panel tint
      ...(nested && cfg?.glass_tint ? ([["glass_tint", "panel"]] as [string, string][]) : []),
      ["tile_tint", "tile"],
      ["control_tint", "control"],
      // a room's bar over its photo (image-full / compact)
      ["bar_tint", "bar"],
    ];
    for (const [key, level] of tints) {
      const t = tintVars(cfg?.[key]);
      if (!t) continue;
      for (const [suffix, v] of [["", t.rgb], ["-a", t.a]] as const) {
        const prop = `--glass-${level}-tint${suffix}`;
        this.style.setProperty(prop, v);
        this._appliedStyles.push(prop);
      }
    }
    if (!styles || typeof styles !== "object") return;
    for (const [k, v] of Object.entries(styles)) {
      const prop = k.startsWith("--") ? k : `--glass-${k.replace(/_/g, "-")}`;
      this.style.setProperty(prop, String(v));
      this._appliedStyles.push(prop);
    }
  }

  stateOf(entity?: string): HassEntity | undefined {
    return entity ? this._hass?.states[entity] : undefined;
  }

  getCardSize(): number {
    return 3;
  }
}

/** requestUpdate() on every Lit element below, through shadow roots. */
function requestAll(root: ParentNode) {
  for (const el of root.querySelectorAll("*")) {
    (el as Partial<LitElement>).requestUpdate?.();
    if (el.shadowRoot) requestAll(el.shadowRoot);
  }
}
