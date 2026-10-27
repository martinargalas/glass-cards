import { locale, tr } from "../i18n";
import { css, html, nothing, type PropertyValues } from "lit";
import { GlassElement } from "../core/glass-element";
import type { BaseCardConfig, HassEntity, HomeAssistant } from "../core/types";
import { registerCard } from "../core/registry";
import { makeEditor } from "../editor/editor";
import { airQualitySpec } from "../editor/specs";
import { surface } from "../core/styles";
import { LiquidController } from "../core/liquid";
import { photoMask } from "./room-card";
import { airScene, airSceneStyles } from "./air-scene";
import { isDark } from "../core/settings";
import { cssColor } from "../core/colors";
import { materials, matTint, type Material } from "../core/materials";
import { AIR_QUALITY_PARTS } from "../core/card-parts";

/**
 * Air quality: a large index tile with an animated landscape of the current level
 * (clear sky and birds → haze → smog and chimneys; or your own pictures), fading
 * into the tile like the room cards' photos, and a small tile per pollutant.
 *
 *   type: custom:glass-air-quality
 *   entity: sensor.air_quality_index_air_quality_index
 *   pollutants:            # optional – default: the other sensors of the same device
 *     - sensor.air_quality_index_pm2_5
 *     - entity: sensor.air_quality_index_ozone
 *       name: Ozón
 *   images: [good.jpg, moderate.jpg, …]  # pictures per level (6) instead of the animation, or image: one for all
 *   image_color: active    # grey while the air is fine, in colour once it gets worse (always | never)
 *   limits: [50, 100, 150, 200, 300]   # optional: own upper bounds of the first five levels (also per pollutant)
 *   image_fade: false      # the picture to the tile's bottom edge, no fade; name_backdrop: false – no band under the name
 *   edge_fade: false       # no soft edge on the top, left and right
 *   hero_glass: frosted    # own materials (core/materials), *_color tints them: the index tile, the pollutants' tiles
 *   tiles_glass: liquid
 *   level_style: tile      # the level: dot (default) | tile (the tile tinted in its colour) | none
 *   level_colors: [green, yellow, orange, red, purple, "#a2324a"]   # own colours of the six levels
 *
 * Values are read on the US EPA AQI scale (0–500), which is what WAQI and most
 * integrations report for the index and for each pollutant (sub-index).
 */
/**
 * Upper bounds of the first five levels (good … very unhealthy), the sixth is above:
 * `[50, 100, 150, 200, 300]` (US EPA AQI, the default) or the same as text "50, 100, …".
 * E.g. a PM2.5 sensor in µg/m³ by the WHO / EU steps: `[15, 25, 37.5, 50, 75]`.
 */
type Limits = number[] | string;

interface Pollutant {
  entity: string;
  name?: string;
  icon?: string;
  limits?: Limits;
}

interface AirQualityConfig extends BaseCardConfig {
  entity: string;
  pollutants?: (Pollutant | string)[];
  name?: string;
  /** Pictures of the index tile per level (good … hazardous); default: from a run in the woods to smoking chimneys. */
  images?: string[];
  /** One picture for every level instead. */
  image?: string;
  /** active (default): grey while the air is good / moderate, in colour from "unhealthy for sensitive groups" on; always; never. */
  image_color?: "active" | "always" | "never";
  title?: string;
  image_fade?: boolean;
  name_backdrop?: boolean;
  /** the picture's soft edge on the top, left and right (default true) */
  edge_fade?: boolean;
  hero_glass?: Material;
  hero_color?: string;
  tiles_glass?: Material;
  tiles_color?: string;
  level_style?: "dot" | "tile" | "none";
  level_colors?: string[];
  /** Own levels for the index (see Limits). */
  limits?: Limits;
}

interface Band {
  max: number;
  color: string;
  /** the level's name, translated (src/i18n) */
  en: string;
}

const BANDS: Band[] = [
  { max: 50, color: "#34c759", en: "Good" },
  {
    max: 100,
    color: "#ffcc00",
    en: "Moderate",
  },
  {
    max: 150,
    color: "#ff9500",
    en: "Unhealthy for sensitive groups",
  },
  { max: 200, color: "#ff3b30", en: "Unhealthy" },
  { max: 300, color: "#af52de", en: "Very unhealthy" },
  { max: Infinity, color: "#a2324a", en: "Hazardous" },
];
/**
 * Default pictures of the index tile, one per level (Unsplash, free licence):
 * a run in the woods → a sunny city → haze → smog → thick smog → smoking chimneys.
 */
const U = (id: string) => `https://images.unsplash.com/photo-${id}?w=640&q=70&auto=format&fit=crop`;
const PHOTOS = [
  U("1623390003553-4fa3f9fceb89"),
  U("1750089440008-fedc3d2760f3"),
  U("1760112570747-8684a0b3e609"),
  U("1754373218499-8d48334e1303"),
  U("1755577540905-f62e5b55022a"),
  U("1761509418231-15bf0145b2a6"),
];

/** The five upper bounds from a config value; anything unusable falls back to the EPA steps. */
function limitsOf(l: Limits | undefined): number[] {
  const list = (Array.isArray(l) ? l : String(l ?? "").split(/[,;\s]+/)).map((x) => parseFloat(String(x).replace(",", "."))).filter((x) => !Number.isNaN(x));
  return list.length === 5 ? list : BANDS.slice(0, 5).map((b) => b.max);
}
const bandOf = (v: number, l?: Limits) => {
  const i = limitsOf(l).findIndex((m) => v <= m);
  return BANDS[i < 0 ? BANDS.length - 1 : i];
};

/** Known pollutants by entity id / name fragment → short formula. */
const KNOWN: [RegExp, string][] = [
  [/pm_?2[._]?5|pm25/i, "PM2.5"],
  [/pm_?10/i, "PM10"],
  [/pm_?1(?!\d)/i, "PM1"],
  [/nitrogen_?dioxide|\bno2\b/i, "NO₂"],
  [/nitrogen_?monoxide|\bno\b/i, "NO"],
  [/sulph?ur_?dioxide|\bso2\b/i, "SO₂"],
  [/carbon_?monoxide|\bco\b/i, "CO"],
  [/ozone|\bo3\b/i, "O₃"],
];


class GlassAirQuality extends GlassElement<AirQualityConfig> {
  static override parts = AIR_QUALITY_PARTS;
  static getConfigElement() {
    return makeEditor(airQualitySpec);
  }

  static getStubConfig(hass: HomeAssistant) {
    const aqi = Object.values(hass.states).find((s) => s.entity_id.startsWith("sensor.") && s.attributes.device_class === "aqi");
    return { entity: aqi?.entity_id ?? "" };
  }

  private _list: Pollutant[] = [];
  private _photoRo?: ResizeObserver;

  /** The room cards' soft edge: the picture fades out towards the tile's outline on every side. */
  private _applyPhotoMask() {
    const wrap = this.shadowRoot?.querySelector<HTMLElement>(".photo-wrap");
    if (!wrap) return;
    // edge_fade: false – the picture keeps sharp edges (only the tile's rounding clips it)
    if (this._config?.edge_fade === false) {
      wrap.style.removeProperty("-webkit-mask");
      wrap.style.removeProperty("mask");
      return;
    }
    const r = parseFloat(getComputedStyle(wrap).borderTopLeftRadius) || 26;
    // a narrower edge than on the room cards: this tile is small, the picture should still read
    const url = photoMask(Math.round(wrap.offsetWidth), Math.round(wrap.offsetHeight), r, Math.max(2, r * 1.2));
    if (!url) return;
    const m = `url(${url}) 0 0 / 100% 100% no-repeat`;
    wrap.style.setProperty("-webkit-mask", m);
    wrap.style.setProperty("mask", m);
  }

  protected override updated(changed: PropertyValues) {
    super.updated(changed);
    const wrap = this.shadowRoot?.querySelector<HTMLElement>(".photo-wrap");
    if (!wrap) return;
    this._photoRo ??= new ResizeObserver(() => this._applyPhotoMask());
    this._photoRo.disconnect();
    this._photoRo.observe(wrap);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._photoRo?.disconnect();
  }

  constructor() {
    super();
    new LiquidController(this, ".frame");
  }

  protected override validateConfig(c: AirQualityConfig) {
    if (!c.entity) throw new Error("`entity` (the air quality index sensor) is required");
    this._list = (c.pollutants ?? []).map((p) => (typeof p === "string" ? { entity: p } : p)).filter((p) => p?.entity);
    return c;
  }

  protected watchedEntities(c: AirQualityConfig) {
    return [c.entity, ...this._pollutants().map((p) => p.entity)];
  }

  /** Configured pollutants, else the other numeric sensors on the index's device (or with its prefix). */
  private _pollutants(): Pollutant[] {
    if (this._list.length) return this._list;
    const hass = this._hass;
    const c = this._config;
    if (!hass || !c) return [];
    const reg = (hass as unknown as { entities?: Record<string, { device_id?: string }> }).entities;
    const dev = reg?.[c.entity]?.device_id;
    const prefix = c.entity.replace(/_[^_]+$/, "");
    const ids = Object.keys(hass.states).filter(
      (id) =>
        id !== c.entity &&
        id.startsWith("sensor.") &&
        (dev ? reg?.[id]?.device_id === dev : id.startsWith(prefix)) &&
        !Number.isNaN(parseFloat(hass.states[id].state)) &&
        KNOWN.some(([re]) => re.test(id)),
    );
    // stable, familiar order: particles first, then gases
    const rank = (id: string) => KNOWN.findIndex(([re]) => re.test(id));
    return ids.sort((a, b) => rank(a) - rank(b)).map((entity) => ({ entity }));
  }

  /** Re-evaluate auto-discovered pollutants once the registry is there. */
  protected override hassChanged(hass: HomeAssistant) {
    if (!this._list.length && this._config) {
      const ids = this._pollutants().map((p) => p.entity);
      const watched = [this._config.entity, ...ids];
      // GlassElement keeps its own list; refresh it when discovery finds more
      if (watched.join() !== this._lastWatched) {
        this._lastWatched = watched.join();
        this.setConfig(this._rawConfig!);
      }
    }
    void hass;
  }
  private _lastWatched = "";

  private _meta(p: Pollutant, st: HassEntity | undefined) {
    const k = KNOWN.find(([re]) => re.test(p.entity) || re.test(st?.attributes.friendly_name ?? ""));
    return { name: p.name ?? k?.[1] ?? st?.attributes.friendly_name ?? p.entity };
  }

  protected override render() {
    const c = this._config;
    const hass = this._hass;
    if (!c || !hass) return nothing;
    const st = hass.states[c.entity];
    if (!st) return html`<div class="frame surface"><div class="missing">${c.entity}?</div></div>`;
    const num = (id: string) => parseFloat(hass.states[id]?.state ?? "");
    const fmt = (v: number) => (Math.round(v * 10) / 10).toLocaleString(locale());
    const v = num(c.entity);
    const ok = !Number.isNaN(v);
    const band = bandOf(ok ? v : 0, c.limits);
    const level = ok ? BANDS.indexOf(band) : 0;
    const photo = c.image ?? c.images?.[level] ?? PHOTOS[level];
    // a level's colour: the card's own (level_colors) or the band's
    const tone = (b: Band) => cssColor(c.level_colors?.[BANDS.indexOf(b)]) ?? b.color;
    const mat = (m: Material | undefined, color: string | undefined, def: Material) => {
      const use = m ?? (color && color !== "none" ? def : undefined);
      return use ? { cls: `mat mat-${use}`, style: matTint(color && color !== "none" ? color : undefined) } : { cls: "", style: "" };
    };
    const hero = mat(c.hero_glass, c.hero_color, "frosted");
    const tile = mat(c.tiles_glass, c.tiles_color, "liquid");
    const lvl = `lv-${c.level_style ?? "dot"}`;
    return html`<div class="frame surface">
      ${c.title ? html`<div class="title">${c.title}</div>` : nothing}
      <div class="aq"><div class="aq-in">
        <div class="hero ${hero.cls} ${lvl}" style="--c:${tone(band)};${hero.style}">
          <div class="photo-wrap ${c.image_fade === false ? "nofade" : ""} ${c.name_backdrop === false ? "noband" : ""}">
            ${c.image || c.images?.length
              ? html`<div
                  class="photo ${(c.image_color ?? "active") === "always" || ((c.image_color ?? "active") === "active" && level >= 2) ? "" : "grey"}"
                  style="background-image:url('${photo}')"
                ></div>`
              : html`<div class="photo scene">${airScene(level, isDark(hass, this))}</div>`}
          </div>
          <span class="name">${c.name ?? (tr("Air quality"))}</span>
          <div class="hero-text">
            <span class="big">${ok ? Math.round(v) : "–"}</span>
            <span class="lvl"><i class="dot"></i>${ok ? tr(band.en) : tr("Unavailable")}</span>
          </div>
        </div>
        <div class="small">
          ${this._pollutants().map((p) => {
            const x = num(p.entity);
            const has = !Number.isNaN(x);
            const b = bandOf(has ? x : 0, p.limits);
            return html`<div class="tile ${tile.cls} ${has ? lvl : ""}" style="--c:${has ? tone(b) : "#8e8e93"};${tile.style}">
              <span class="label">${this._meta(p, hass.states[p.entity]).name}</span>
              <span class="val">${has ? fmt(x) : "–"}</span>
              <span class="lvl"><i class="dot"></i>${has ? tr(b.en) : ""}</span>
            </div>`;
          })}
        </div>
      </div></div>
    </div>`;
  }

  static override styles = [
    GlassElement.styles,
    surface,
    airSceneStyles,
    css`
      :host {
        display: block;
      }
      .frame {
        border-radius: var(--g-radius-lg);
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      /* inside a panel the card adds no surface: its tiles sit on the panel / the background
         (unless it has its own glass on a panel without any – own-tile) */
      :host([nested]:not([own-tile])) .frame.surface {
        background: none !important;
        border: none !important;
        box-shadow: none !important;
        -webkit-backdrop-filter: none !important;
        backdrop-filter: none !important;
        padding: 0;
      }
      :host([nested]:not([own-tile])) .frame::before,
      :host([nested]:not([own-tile])) .frame::after {
        display: none;
      }
      .title {
        font-size: 15px;
        font-weight: 500;
        text-shadow: var(--g-text-shadow);
      }
      .aq-in {
        display: flex;
        gap: 10px;
      }
      /* tiles coloured like the room cards: light by day, metal at night */
      .hero,
      .tile {
        position: relative;
        box-sizing: border-box;
        min-width: 0;
        border-radius: var(--g-radius);
        background: var(--glass-room-bg, color-mix(in srgb, var(--g-text) 8%, transparent));
        color: var(--glass-room-fg, var(--g-text));
        box-shadow: var(--glass-room-shadow, none);
        border: 0.5px solid rgba(255, 255, 255, 0.14);
        text-shadow: none;
        overflow: hidden;
      }
      /* by day a sheen over the tile's own light colour, a bright top edge */
      :host(:not([dark])) .tile:not(.mat) {
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.4), rgba(255, 255, 255, 0) 60%),
          var(--glass-room-bg, color-mix(in srgb, var(--g-text) 8%, transparent));
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.7),
          0 1px 2px rgba(0, 0, 0, 0.04),
          0 4px 12px rgba(0, 0, 0, 0.06);
      }
      /* by night the value tiles are the appliance bars' pill: a faint top-down sheen, a fine top edge */
      :host([dark]) .tile:not(.mat) {
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.13), rgba(255, 255, 255, 0.04) 55%, rgba(255, 255, 255, 0.07));
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.16),
          0 1px 2px rgba(0, 0, 0, 0.1),
          0 4px 12px rgba(0, 0, 0, 0.12);
        border: 0;
      }
      .hero {
        flex: 0 0 34%;
        min-height: 140px;
        isolation: isolate;
      }
      /* the picture as on the room cards (image-background): top part of the tile,
         fading into it, the tile's colour under the name */
      .photo-wrap {
        position: absolute;
        inset: 0;
        z-index: -1;
        border-radius: inherit;
        pointer-events: none;
      }
      .photo {
        position: absolute;
        inset: 0 0 auto 0;
        height: 86%;
        background-size: cover;
        background-position: center 35%;
        opacity: calc(0.9 * var(--glass-image-k, 1));
        filter: saturate(0.85);
        transition:
          filter 0.6s ease,
          opacity 0.6s ease;
        -webkit-mask-image: linear-gradient(180deg, #000 62%, transparent);
        mask-image: linear-gradient(180deg, #000 62%, transparent);
      }
      /* the animated landscape (default): full strength, fading into the tile like a photo */
      .photo.scene {
        opacity: var(--glass-image-k, 1);
        filter: none;
      }
      /* calm: grey like a room card with nothing on */
      .photo.grey {
        filter: grayscale(var(--glass-image-grey, 1)) contrast(1.08);
        opacity: calc(0.95 * var(--glass-image-k, 1) * var(--glass-image-off, 1));
      }
      .photo-wrap::after {
        content: "";
        position: absolute;
        inset: 0 0 auto 0;
        height: 26%;
        background: linear-gradient(180deg, var(--glass-room-solid, rgba(246, 246, 248, 0.9)), transparent);
      }
      /* the name as on the room cards */
      .name {
        position: absolute;
        top: 10px;
        left: 12px;
        right: 12px;
        font-size: var(--glass-room-title-size, 15px);
        font-weight: 600;
        letter-spacing: -0.01em;
        color: var(--glass-room-fg, var(--g-text));
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .hero-text {
        position: absolute;
        left: 14px;
        right: 14px;
        bottom: 12px;
        display: flex;
        flex-direction: column;
      }
      .big {
        font-size: 40px;
        font-weight: 300;
        line-height: 1.05;
        font-variant-numeric: tabular-nums;
      }
      .small {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .tile {
        flex: 1 1 calc(33.3% - 10px);
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 1px;
        padding: 10px 14px;
      }
      .label {
        font-size: 13px;
        color: var(--glass-room-fg-2, var(--g-text-2));
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .val {
        font-size: 20px;
        font-weight: 400;
        font-variant-numeric: tabular-nums;
      }
      .lvl {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: var(--glass-room-fg-2, var(--g-text-2));
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .hero .lvl {
        font-size: 14px;
        color: inherit;
      }
      .dot {
        flex: none;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--c);
      }
      .missing {
        color: var(--g-text-2);
      }
      /* image_fade: false – the picture to the bottom, no fade; name_backdrop: false – no band under the name */
      .photo-wrap.nofade .photo {
        height: 100%;
        -webkit-mask-image: none;
        mask-image: none;
      }
      .photo-wrap.noband::after {
        display: none;
      }
      /* own materials: they replace the tile's colours (the shape stays) */
      .hero.mat,
      .tile.mat {
        border: 0;
        color: inherit;
      }
      /* level_style: tile – the tile tinted in the level's colour; none – no dot */
      .lv-none .dot {
        display: none;
      }
      .tile.lv-tile,
      .hero.lv-tile {
        background-image:
          linear-gradient(180deg, rgba(255, 255, 255, 0.28), rgba(255, 255, 255, 0) 60%),
          linear-gradient(color-mix(in srgb, var(--c) 32%, transparent), color-mix(in srgb, var(--c) 32%, transparent)) !important;
      }
      .lv-tile .dot {
        display: none;
      }
      /* narrow (a phone): the index square beside the pollutants (three above, two below) –
         each its value and coloured dot, the level's word only on the big tile */
      .aq {
        container: aq / inline-size;
      }
      @container aq (max-width: 480px) {
        .frame .aq-in {
          gap: 8px;
        }
        .frame .hero {
          flex: 0 0 40%;
          aspect-ratio: 1;
          min-height: 0;
        }
        .frame .small {
          gap: 8px;
          align-content: stretch;
        }
        /* two lines: the name, beneath it the value with its level's dot */
        .frame .tile {
          flex: 1 1 calc(33.3% - 8px);
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          grid-template-areas: "label label" "val lvl";
          align-content: center;
          align-items: center;
          column-gap: 6px;
          padding: 8px 8px 8px 10px;
        }
        .frame .tile .label {
          grid-area: label;
          font-size: 12px;
          text-overflow: clip;
        }
        .frame .tile .val {
          grid-area: val;
          font-size: 20px;
        }
        .frame .tile .lvl {
          grid-area: lvl;
          justify-self: start;
          font-size: 0;
          gap: 0;
        }
      }
      }
    `,
    // after the card's own rules: a picked material replaces the default glass
    materials,
  ];
}

registerCard("glass-air-quality", GlassAirQuality, {
  name: "Glass – air quality",
  description: "Air quality index with a gauge, its meaning and every pollutant on the same scale.",
});
