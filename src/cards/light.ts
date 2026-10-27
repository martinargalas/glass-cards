import { tr } from "../i18n";
import { css, html, nothing } from "lit";
import { GlassElement } from "../core/glass-element";
import type { ActionConfig, BaseCardConfig, HassEntity, HomeAssistant } from "../core/types";
import { registerCard } from "../core/registry";
import { makeEditor } from "../editor/editor";
import { lightSpec } from "../editor/specs";
import { cssColor, tint } from "../core/colors";
import { control, liquidBar, surface } from "../core/styles";
import { pressHandlers, runAction, withDefaults, type ActionKind } from "../core/actions";
import { language } from "../core/settings";
import { LiquidController } from "../core/liquid";
import { SHEEN, materials, matTint, type Material } from "../core/materials";
import { LIGHT_PARTS } from "../core/card-parts";

/**
 * Room lights tile, a sibling of the thermostat: the room's name, its scenes as
 * round buttons, and a liquid glass bar per light – the bulb switches it, the
 * bar is the brightness slider (filled as bright as the light is). Switches get
 * a bar without a slider; a WLED-style preset select adds its options as chips.
 *
 *   type: custom:glass-light
 *   name: Kuchyň
 *   icon: mdi:silverware-fork-knife   # optional: the room's icon before the name
 *   lights:
 *     - entity: light.kitchen
 *       name: Bar
 *     - entity: light.wled_main
 *       name: Linka LED
 *       levels: [25, 50, 75, 100]           # quick brightness chips under the bar
 *       presets: select.wled_preset_2
 *       preset_options:                     # optional: only these, with own name / icon
 *         - { option: Horni svetlo, name: Horní, icon: mdi:light-flood-up }
 *     - switch.wall_switch                  # on / off only
 *       scenes: [scene.kitchen_relax, …]    # this light's scenes, small buttons above its bar
 *     - entity: switch.bath_1               # one bar for several: on while any is on,
 *       entities: [switch.bath_1, switch.bath_2, switch.bath_3]   #   a tap switches them all
 *     - entity: scene.stars_on              # a pair of scenes as one switch: on while
 *       off_scene: scene.stars_off          #   the "on" scene ran last
 *   layout: buttons                         # the lights as round buttons (switches) instead of bars
 *   scenes:
 *     - entity: scene.kitchen_relax
 *       name: Relax
 *       image: /local/scenes/relax.png      # or icon:
 *   active_color: yellow                    # the lit bulb (default)
 *
 *   own materials of the parts (core/materials); a colour alone tints the default glass:
 *   pill_glass / pill_color         the bar of each light
 *   icon_glass / icon_on_glass      the bulb's button off / on (on keeps its halo)
 *   icon_background                 its backing in every state (none = material only)
 *   icons: { icon: {…}, icon_on: {…} }  the bulb symbol while off / on (core/card-parts)
 *   modes_glass / modes_color       the picked one of brightness / temperature / colour
 *   presets_glass / presets_color   the picked preset
 *   scenes_glass / scenes_color     the scene buttons
 *   tray_glass / tray_color         the drawer under a bar (quick choices, the light's scenes)
 */
interface LightItem {
  entity: string;
  name?: string;
  icon?: string;
  levels?: number[];
  /** Several lights / switches as one (e.g. a bathroom's three): on while any is on, a tap switches all. */
  entities?: string[];
  /** Scenes of this light, as small round buttons just above its bar. */
  scenes?: (SceneItem | string)[];
  /** With a scene as `entity`: the scene that switches it off; together they act as one switch. */
  off_scene?: string;
  presets?: string;
  preset_options?: (string | { option: string; name?: string; icon?: string })[];
  hold_action?: ActionConfig;
}

interface SceneItem {
  entity: string;
  name?: string;
  icon?: string;
  image?: string;
}

interface LightConfig extends BaseCardConfig {
  name?: string;
  icon?: string;
  lights: (LightItem | string)[];
  scenes?: (SceneItem | string)[];
  active_color?: string;
  show_name?: boolean;
  layout?: "bars" | "buttons";
  pill_glass?: Material;
  pill_color?: string;
  icon_glass?: Material;
  icon_on_glass?: Material;
  icon_background?: string;
  modes_glass?: Material;
  modes_color?: string;
  presets_glass?: Material;
  presets_color?: string;
  scenes_glass?: Material;
  scenes_color?: string;
  tray_glass?: Material;
  tray_color?: string;
  /** the brightness fill in the bar: the light's own colour (default) or the card's colour when on */
  fill_source?: "light" | "accent";
  fill_color?: string;
  /** fade (default, stronger on the left), solid, glow (bright edge at the value), none */
  fill_style?: "fade" | "solid" | "glow" | "none";
  /** how strong the fill is, % (default 34) */
  fill_strength?: number;
}

const has = (v?: string) => !!v && v !== "none";
/** A part's own material: class and tint (a colour alone keeps `def`); none set → the card's default glass. */
function part(m: Material | undefined, color: string | undefined, def: Material) {
  const use = m ?? (has(color) ? def : undefined);
  return use ? { cls: `mat mat-${use}`, style: matTint(color) } : undefined;
}

/** Brightness in % (0 when off), or undefined for lights / switches without dimming. */
function brightnessOf(st: HassEntity | undefined): number | undefined {
  if (!st) return undefined;
  const modes: string[] = st.attributes.supported_color_modes ?? [];
  const dims = st.entity_id.startsWith("light.") && modes.some((m) => m !== "onoff");
  if (!dims) return undefined;
  if (st.state !== "on") return 0;
  const b = st.attributes.brightness;
  return typeof b === "number" ? Math.max(1, Math.round((b / 255) * 100)) : 100;
}

/** What the bar can set on this light: brightness always (if it dims), colour temperature, colour. */
type Mode = "b" | "t" | "c";
const COLOR_MODES = ["hs", "xy", "rgb", "rgbw", "rgbww"];
function modesOf(st: HassEntity | undefined): Mode[] {
  if (brightnessOf(st) === undefined) return [];
  const m: string[] = st!.attributes.supported_color_modes ?? [];
  const out: Mode[] = ["b"];
  if (m.includes("color_temp")) out.push("t");
  if (m.some((x) => COLOR_MODES.includes(x))) out.push("c");
  return out;
}
const kelvinRange = (st: HassEntity) => [Number(st.attributes.min_color_temp_kelvin) || 2000, Number(st.attributes.max_color_temp_kelvin) || 6500] as const;
/** Quick colour temperatures and colours. */
const TEMPS: [number, string][] = [
  [2700, "Warm"],
  [4000, "Neutral"],
  [6500, "Cool"],
];
const HUES = [0, 30, 330, 280, 220, 130];
const MODE_ICON: Record<Mode, string> = { b: "mdi:brightness-6", t: "mdi:thermometer", c: "mdi:palette" };

class GlassLight extends GlassElement<LightConfig> {
  static override parts = LIGHT_PARTS;
  static getConfigElement() {
    return makeEditor(lightSpec);
  }

  static getStubConfig(hass: HomeAssistant) {
    const light = Object.keys(hass.states).find((e) => e.startsWith("light."));
    return { name: "Living room", lights: light ? [{ entity: light }] : [] };
  }

  constructor() {
    super();
    new LiquidController(this, ".frame");
  }

  private _lights: LightItem[] = [];
  private _scenes: SceneItem[] = [];
  /** Value being dragged (0–1 along the bar), per light and mode: shown at once, sent while / when the finger stops. */
  private _drag = new Map<string, number>();
  private _sendTimer = new Map<string, number>();
  /** Brightness sent but not reported back yet. */
  private _pending = new Map<string, number>();
  /** What each light's bar sets right now (brightness unless switched); back to brightness after a while. */
  private _mode = new Map<string, Mode>();
  private _modeTimer = new Map<string, number>();

  protected override validateConfig(c: LightConfig) {
    if (!Array.isArray(c.lights) || !c.lights.length) throw new Error("`lights` needs at least one light or switch");
    this._lights = c.lights.map((l) => (typeof l === "string" ? { entity: l } : l)).filter((l) => l?.entity);
    this._scenes = (c.scenes ?? []).map((s) => (typeof s === "string" ? { entity: s } : s)).filter((s) => s?.entity);
    return c;
  }

  protected watchedEntities() {
    return [...this._lights.flatMap((l) => [l.entity, l.presets ?? "", l.off_scene ?? "", ...(l.entities ?? [])]), ...this._scenes.map((s) => s.entity)];
  }

  protected override hassChanged(hass: HomeAssistant) {
    // the light reached the dragged value: stop showing ours
    for (const [id, v] of this._pending) {
      const b = brightnessOf(hass.states[id]);
      if (b !== undefined && Math.abs(b - v) <= 2) this._pending.delete(id);
    }
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    for (const t of this._sendTimer.values()) clearTimeout(t);
    for (const t of this._modeTimer.values()) clearTimeout(t);
  }

  /** A scene pair is on while its "on" scene ran last (a scene's state is when it last ran). */
  private _isOn(l: LightItem, st: HassEntity | undefined) {
    if (!st) return false;
    if (l.off_scene) {
      const off = this._hass?.states[l.off_scene];
      return Date.parse(st.state) > (off ? Date.parse(off.state) || 0 : 0);
    }
    if (l.entities?.length) return l.entities.some((id) => this._hass?.states[id]?.state === "on");
    return st.state === "on";
  }

  private _switch(l: LightItem) {
    if (l.off_scene) {
      const on = this._isOn(l, this._hass?.states[l.entity]);
      this._hass?.callService("scene", "turn_on", { entity_id: on ? l.off_scene : l.entity });
    } else if (l.entities?.length) {
      // a group: all off when any is on, else all on
      const on = this._isOn(l, this._hass?.states[l.entity]);
      this._hass?.callService("homeassistant", on ? "turn_off" : "turn_on", { entity_id: l.entities });
    } else this._toggle(l.entity);
  }

  private _toggle(id: string) {
    const domain = id.split(".")[0];
    this._hass?.callService(domain === "switch" ? "switch" : domain === "light" ? "light" : "homeassistant", "toggle", { entity_id: id });
  }

  /** Switch what the bar sets; it returns to brightness after 20 s without a touch. */
  private _setMode(id: string, m: Mode) {
    this._mode.set(id, m);
    clearTimeout(this._modeTimer.get(id));
    if (m !== "b") this._modeTimer.set(id, window.setTimeout(() => (this._mode.delete(id), this.requestUpdate()), 20000));
    this.requestUpdate();
  }

  /** The light set from a place on the bar (0–1) in the given mode. */
  private _apply(id: string, m: Mode, f: number) {
    const st = this._hass?.states[id];
    if (!st) return;
    if (m === "b") {
      const pct = Math.min(100, Math.max(1, Math.round(f * 100)));
      this._pending.set(id, pct);
      this._hass!.callService("light", "turn_on", { entity_id: id, brightness_pct: pct });
    } else if (m === "t") {
      const [lo, hi] = kelvinRange(st);
      this._hass!.callService("light", "turn_on", { entity_id: id, color_temp_kelvin: Math.round(lo + f * (hi - lo)) });
    } else {
      this._hass!.callService("light", "turn_on", { entity_id: id, hs_color: [Math.round(f * 360) % 360, 100] });
    }
  }

  /** `snap`: brightness levels the bar clicks to when let go near one (±4 %). */
  private _slide(id: string, m: Mode, e: PointerEvent, snap: number[] = []) {
    const el = e.currentTarget as HTMLElement;
    if (e.type === "pointerdown") el.setPointerCapture(e.pointerId);
    else if (!el.hasPointerCapture(e.pointerId)) return;
    const r = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const key = `${id}|${m}`;
    this._drag.set(key, f);
    if (m !== "b") this._setMode(id, m); // keep the mode while dragging
    this.requestUpdate();
    // while dragging: a few updates a second; on release: the final value
    const send = () => {
      this._sendTimer.delete(key);
      const v = this._drag.get(key);
      if (v !== undefined) this._apply(id, m, v);
    };
    if (e.type === "pointerup" || e.type === "pointercancel") {
      if (m === "b") {
        const near = snap.find((p) => Math.abs(p - f * 100) <= 4);
        if (near !== undefined) this._drag.set(key, near / 100);
      }
      clearTimeout(this._sendTimer.get(key));
      send();
      this._drag.delete(key);
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      this.requestUpdate();
    } else if (!this._sendTimer.has(key)) this._sendTimer.set(key, window.setTimeout(send, 300));
  }

  private _bar(l: LightItem, hass: HomeAssistant, cs: boolean) {
    const st = hass.states[l.entity];
    const on = this._isOn(l, st);
    const dim = brightnessOf(st);
    const modes = modesOf(st);
    const mode: Mode = modes.includes(this._mode.get(l.entity) as Mode) ? this._mode.get(l.entity)! : "b";
    const drag = this._drag.get(`${l.entity}|${mode}`);
    const color = this._config.active_color ?? "yellow";
    // the light's own colour for the fill when it has one, else a warm bulb
    const rgb = st?.attributes.rgb_color as number[] | undefined;
    const cf = this._config;
    const fillColor = has(cf.fill_color) ? cssColor(cf.fill_color) : on && rgb && cf.fill_source !== "accent" ? `rgb(${rgb.join(",")})` : cssColor(color);
    const name = l.name ?? st?.attributes.friendly_name ?? l.entity;
    // where the bar's value sits (0–1) and what it says
    let pos = 0;
    let state = !st ? (tr("Unavailable")) : on ? (tr("On")) : tr("Off");
    if (st && mode === "b" && dim !== undefined) {
      const shown = drag !== undefined ? Math.max(1, Math.round(drag * 100)) : (this._pending.get(l.entity) ?? dim);
      pos = on ? shown / 100 : 0;
      if (on) state = `${shown} %`;
    } else if (st && mode === "t") {
      const [lo, hi] = kelvinRange(st);
      const k = drag !== undefined ? lo + drag * (hi - lo) : Number(st.attributes.color_temp_kelvin) || lo;
      pos = (k - lo) / (hi - lo || 1);
      state = st.attributes.color_mode === "color_temp" || drag !== undefined ? `${Math.round(k / 50) * 50} K` : tr("Colour");
    } else if (st && mode === "c") {
      const hs = st.attributes.hs_color as number[] | undefined;
      const hue = drag !== undefined ? drag * 360 : (hs?.[0] ?? 0);
      pos = hue / 360;
      state = tr("Hue");
    }
    const target = withDefaults({ entity: l.entity, tap_action: { action: "none" }, hold_action: l.hold_action ?? { action: "more-info" } });
    const h = pressHandlers(
      () => target,
      // tap switches the light, hold opens its details – never both
      (kind: ActionKind) => (kind === "tap" ? this._switch(l) : runAction(this, hass, target, kind)),
    );
    const presets = l.presets ? hass.states[l.presets] : undefined;
    const all: string[] = presets?.attributes.options ?? [];
    const options = (l.preset_options?.length ? l.preset_options : all)
      .map((o) => (typeof o === "string" ? { option: o } : o) as { option: string; name?: string; icon?: string })
      .filter((o) => all.includes(o.option));
    const levels = dim !== undefined ? (l.levels ?? []) : [];
    const turnOn = (data: Record<string, unknown>) => this._hass?.callService("light", "turn_on", { entity_id: l.entity, ...data });
    const sliding = dim !== undefined;
    const slide = (e: PointerEvent) => this._slide(l.entity, mode, e, l.levels ?? []);
    // quick choices for what the bar sets
    let quick: unknown = nothing;
    // segmented control: one recessed track, the current choice lifted out of it
    const presetMat = part(this._config.presets_glass, this._config.presets_color, "liquid");
    const seg = (items: { cur: boolean; label: unknown; icon?: string; dot?: string; act: () => void }[]) =>
      html`<div class="seg">
        ${items.map(
          (i) => html`<button
            class="segb ${i.cur ? "cur" : ""} ${i.dot ? "has-dot" : i.cur && presetMat ? presetMat.cls : ""}"
            title=${String(i.label)}
            aria-label=${String(i.label)}
            aria-pressed=${i.cur ? "true" : "false"}
            style=${i.dot ? `--c:${i.dot}` : i.cur && presetMat ? presetMat.style : ""}
            @click=${i.act}
          >
            ${i.icon ? html`<ha-icon .icon=${i.icon}></ha-icon>` : nothing}
          </button>`,
        )}
      </div>`;
    // brightness levels are marks on the bar itself (it clicks to them), not buttons
    if (mode === "t" && st) {
      const [lo, hi] = kelvinRange(st);
      const k = Number(st.attributes.color_temp_kelvin);
      const isTemp = on && st.attributes.color_mode === "color_temp";
      quick = seg(
        TEMPS.map(([kv, en], i) => {
          const kk = Math.min(hi, Math.max(lo, kv));
          return { cur: isTemp && Math.abs(k - kk) <= 250, dot: ["#ffb35c", "#fff4e0", "#cfe2ff"][i], label: tr(en), act: () => turnOn({ color_temp_kelvin: kk }) };
        }),
      );
    } else if (mode === "c") {
      const hs = st?.attributes.hs_color as number[] | undefined;
      const isColor = on && !!hs && st?.attributes.color_mode !== "color_temp";
      quick = html`<div class="swatches">
        ${HUES.map((hue) => {
          const d = hs ? Math.abs(((hs[0] - hue + 540) % 360) - 180) : 999;
          return html`<button
            class="swatch control ${isColor && d <= 12 ? "cur" : ""}"
            aria-label=${`${hue}°`}
            style="--sw:hsl(${hue} 90% 55%)"
            @click=${() => turnOn({ hs_color: [hue, 100] })}
          ></button>`;
        })}
      </div>`;
    }
    // the current preset: exactly, or a variant of it ("Horni Svetlo Tepla" is "Horni svetlo"
    // in a warm white) – the longest option the state starts with
    const now = String(presets?.state ?? "").toLowerCase();
    const curOpt = options
      .map((o) => o.option)
      .filter((o) => now === o.toLowerCase() || now.startsWith(`${o.toLowerCase()} `))
      .sort((a, b) => b.length - a.length)[0];
    const presetSeg = options.length
      ? seg(
          options.map((o) => ({
            cur: o.option === curOpt,
            icon: o.icon,
            label: o.name ?? o.option,
            act: () => this._hass?.callService("select", "select_option", { entity_id: l.presets, option: o.option }),
          })),
        )
      : nothing;
    const scenes = this._sceneRow(l.scenes, hass, on ? st : undefined);
    // one row under the bar, for what the bar sets: scenes (and presets) with brightness, the quick temperatures / colours otherwise
    const row = mode === "b" ? html`${presetSeg}${scenes}` : quick;
    const hasTray = mode === "b" ? presetSeg !== nothing || scenes !== nothing : quick !== nothing;
    // what the bar sets: on the bar, or (a narrow tile) in a row of its own under it
    const modesBar = (where: "in" | "out") =>
      modes.length > 1 && on
        ? html`<div class="modes ${where}">
            ${modes.map(
              (m) => html`<button
                class="mode ${m === mode ? `cur ${modeMat?.cls ?? ""}` : ""}"
                style=${m === mode ? (modeMat?.style ?? "") : ""}
                aria-label=${m}
                @pointerdown=${(e: Event) => e.stopPropagation()}
                @click=${(e: Event) => (e.stopPropagation(), this._setMode(l.entity, m))}
              >
                <ha-icon .icon=${MODE_ICON[m]}></ha-icon>
              </button>`,
            )}
          </div>`
        : nothing;
    const c = this._config;
    const icon = this._icon(on);
    const pill = part(c.pill_glass, c.pill_color, "frosted");
    const tray = part(c.tray_glass, c.tray_color, "flat");
    const modeMat = part(c.modes_glass, c.modes_color, "dark");
    return html`<div class="light">
      <div
        class="lbar ${pill ? pill.cls : "control"} ${on ? "on" : ""} ${dim === undefined ? "switch" : ""} mode-${mode} fill-${c.fill_style ?? "fade"}"
        style="${pill ? `${pill.style};` : ""}--fill:${fillColor};--fill-a:${c.fill_strength ?? 34};--pos:${pos};--pct:${Math.round(pos * 100)}"
        @click=${dim === undefined ? () => this._switch(l) : nothing}
      >
        ${sliding ? html`<i class="fill"></i>` : nothing}
        <div
          class="btn ${icon.cls}"
          role="button"
          aria-pressed=${on ? "true" : "false"}
          style=${icon.style}
          @pointerdown=${(e: PointerEvent) => (e.stopPropagation(), h.down(e))}
          @pointermove=${h.move}
          @pointerup=${(e: PointerEvent) => (e.stopPropagation(), h.up(e))}
          @pointercancel=${h.cancel}
          @contextmenu=${h.context}
          @click=${(e: Event) => e.stopPropagation()}
        >
          ${l.icon ? html`<ha-icon .icon=${l.icon}></ha-icon>` : st ? html`<ha-state-icon .hass=${hass} .stateObj=${st}></ha-state-icon>` : nothing}
        </div>
        <div
          class="slider"
          @pointerdown=${sliding ? slide : nothing}
          @pointermove=${sliding ? slide : nothing}
          @pointerup=${sliding ? slide : nothing}
          @pointercancel=${sliding ? slide : nothing}
        >
          ${mode !== "b" ? html`<i class="thumb"></i>` : nothing}
          ${mode === "b" && on ? levels.filter((p) => p > 0 && p < 100).map((p) => html`<i class="tick" style="left:${p}%"></i>`) : nothing}
          <span class="lname">${name}</span>
          <span class="lstate">${state}</span>
        </div>
        ${modesBar("in")}
      </div>
      ${on && (hasTray || modes.length > 1)
        ? html`<div class="tray ${hasTray ? "" : "modes-only"} ${tray?.cls ?? ""}" style=${tray?.style ?? ""}>${modesBar("out")}${hasTray ? row : nothing}</div>`
        : nothing}
    </div>`;
  }

  /** The bulb's button: own material / backing / symbol colours (icon_*), else the control glass lit by `active_color`. */
  private _icon(on: boolean) {
    const c = this._config;
    const color = c.active_color ?? "yellow";
    const fill = on ? tint(color) : undefined;
    const accent = cssColor(color);
    const ownBg = !!c.icon_background;
    const lit = !!fill && !ownBg;
    // the symbol's colours: icons.icon / icon_on (core/card-parts)
    const onColor = c.icons?.icon_on?.color;
    const offColor = c.icons?.icon?.color;
    const sym = on ? (has(onColor) ? cssColor(onColor) : ownBg ? accent : undefined) : has(offColor) ? cssColor(offColor) : undefined;
    const bg = c.icon_background === "none" ? "transparent" : ownBg ? tint(c.icon_background) : undefined;
    // off and on each with its own material (icon_glass / icon_on_glass); unset → the control glass
    const m = on ? c.icon_on_glass : c.icon_glass;
    if (m)
      return {
        cls: `mat mat-${m} ${lit ? "on" : ""} ${on ? "glow" : ""}`,
        style: `${ownBg ? (bg === "transparent" ? "" : `${matTint(c.icon_background)};`) : lit ? `${matTint(color, 70)};` : ""}${sym ? `color:${sym};` : ""}--glow:${accent}`,
      };
    return {
      cls: `control ${lit ? "active glow" : ""} ${ownBg ? "own-bg" : ""} ${sym ? "own-fg" : ""}`,
      style: `${ownBg ? `--bg:${bg};${bg === "transparent" ? "" : `--sheen:${SHEEN};`}` : lit ? `--bg:${fill};--accent:${accent};` : ""}${sym ? `--fg:${sym};` : ""}--glow:${accent}`,
    };
  }

  /**
   * Scenes as small round buttons with their picture (the name as a tooltip), quiet until
   * one is what the light shows: the last one run, no earlier than the light came on.
   */
  private _sceneRow(list: (SceneItem | string)[] | undefined, hass: HomeAssistant, light?: HassEntity) {
    const scenes = (list ?? []).map((x) => (typeof x === "string" ? { entity: x } : x)).filter((x) => x?.entity);
    if (!scenes.length) return nothing;
    const ran = (id: string) => Date.parse(hass.states[id]?.state ?? "") || 0;
    const last = scenes.reduce<SceneItem | undefined>((a, b) => (!a || ran(b.entity) > ran(a.entity) ? b : a), undefined);
    const since = light ? Date.parse(light.last_changed) - 5000 : Infinity;
    const cur = last && ran(last.entity) >= since ? last.entity : undefined;
    const mat = part(this._config.scenes_glass, this._config.scenes_color, "frosted");
    return html`<div class="scenes">
      ${scenes.map((sc) => {
        const name = sc.name ?? hass.states[sc.entity]?.attributes.friendly_name ?? sc.entity;
        return html`<button
          class="sbtn ${mat ? mat.cls : "control"} ${sc.entity === cur ? "cur" : ""}"
          style=${mat?.style ?? ""}
          title=${name}
          aria-label=${name}
          @click=${() => this._hass?.callService("scene", "turn_on", { entity_id: sc.entity })}
        >
          ${sc.image ? html`<i class="simg" style="background-image:url('${sc.image}')"></i>` : html`<ha-icon .icon=${sc.icon ?? "mdi:palette"}></ha-icon>`}
        </button>`;
      })}
    </div>`;
  }

  /** layout: buttons – a light as a round button (the bulb), its name under it. */
  private _button(l: LightItem, hass: HomeAssistant) {
    const st = hass.states[l.entity];
    const on = this._isOn(l, st);
    const name = l.name ?? st?.attributes.friendly_name ?? l.entity;
    const target = withDefaults({ entity: l.entity, tap_action: { action: "none" }, hold_action: l.hold_action ?? { action: "more-info" } });
    const h = pressHandlers(
      () => target,
      // tap switches the light, hold opens its details – never both
      (kind: ActionKind) => (kind === "tap" ? this._switch(l) : runAction(this, hass, target, kind)),
    );
    const icon = this._icon(on);
    return html`<div class="bitem">
      <div
        class="btn ${icon.cls}"
        role="button"
        aria-pressed=${on ? "true" : "false"}
        title=${name}
        style=${icon.style}
        @pointerdown=${h.down}
        @pointermove=${h.move}
        @pointerup=${h.up}
        @pointercancel=${h.cancel}
        @contextmenu=${h.context}
      >
        ${l.icon ? html`<ha-icon .icon=${l.icon}></ha-icon>` : st ? html`<ha-state-icon .hass=${hass} .stateObj=${st}></ha-state-icon>` : nothing}
      </div>
      <span class="slabel">${name}</span>
    </div>`;
  }

  protected override render() {
    const c = this._config;
    const hass = this._hass;
    if (!c || !hass) return nothing;
    const cs = language(hass).startsWith("cs");
    return html`<div class="frame surface">
      ${c.name && c.show_name !== false
        ? html`<div class="title">${c.icon ? html`<ha-icon class="ricon" .icon=${c.icon}></ha-icon>` : nothing}<span class="name">${c.name}</span></div>`
        : nothing}
      ${this._sceneRow(this._scenes, hass)}
      ${c.layout === "buttons"
        ? html`<div class="buttons">${this._lights.map((l) => this._button(l, hass))}</div>`
        : html`<div class="lights">${this._lights.map((l) => this._bar(l, hass, cs))}</div>`}
    </div>`;
  }

  override getCardSize() {
    return 3;
  }

  getGridOptions() {
    return { columns: 6, rows: 3, min_rows: 2 };
  }

  static override styles = [
    GlassElement.styles,
    surface,
    control,
    liquidBar,
    css`
      :host {
        display: block;
        height: 100%;
        /* the tile adapts to its own width (two columns on a wide phone) */
        container: lighttile / inline-size;
      }
      /* the mode buttons' row in the drawer: only on a narrow tile (on a wide one they sit
         on the bar), so a drawer holding nothing else stays shut there */
      .modes.out,
      .tray.modes-only {
        display: none;
      }
      /* narrow tile: the mode buttons leave the bar (the name needs the room) for a row
         under it, the scenes shrink to fit across */
      @container lighttile (max-width: 250px) {
        .modes.in {
          display: none;
        }
        /* no room for the level marks next to the name and value */
        .tick {
          display: none;
        }
        .modes.out,
        .tray.modes-only {
          display: flex;
        }
        .modes.out {
          justify-content: space-around;
          padding: 0 4px;
        }
        .scenes,
        .tray .scenes {
          gap: 4px;
          padding: 0 2px 2px;
        }
        /* temperature dots / presets: the size of the scenes and swatches next to them */
        .seg .segb {
          width: 24px;
          height: 24px;
        }
        .seg .segb ha-icon {
          --mdc-icon-size: 15px;
        }
        /* the colour swatches the same way */
        .swatches {
          gap: 4px;
          padding: 2px;
        }
        .swatches .swatch {
          flex: 0 1 28px;
          width: auto;
          height: auto;
          min-width: 0;
          aspect-ratio: 1;
        }
        /* as many as there are, always across: they give way down to fit, 28 px at most */
        .scenes .sbtn {
          flex: 0 1 28px;
          width: auto;
          height: auto;
          min-width: 0;
          aspect-ratio: 1;
        }
      }
      .frame {
        --btn: var(--glass-light-button-size, 42px);
        position: relative;
        box-sizing: border-box;
        height: 100%;
        min-height: 120px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 12px 10px 10px;
        border-radius: var(--g-radius);
        overflow: hidden;
        isolation: isolate;
      }
      /* inside a panel the panel is the glass; the card is only its content */
      /* (a card with its own glass on a panel without any – own-tile – is its own tile) */
      :host([nested][glass]:not([own-tile])) .frame.surface {
        background: none !important;
        border: none !important;
        box-shadow: none !important;
        -webkit-backdrop-filter: none !important;
        backdrop-filter: none !important;
      }
      :host([nested]:not([own-tile])) .frame::before,
      :host([nested]:not([own-tile])) .frame::after {
        display: none;
      }
      /* home tiles on a panel without glass: the card is its own tile, like a room card */
      :host([nested][on-bare][glass="home"]) .frame.surface {
        background: var(--glass-home-fill, linear-gradient(var(--glass-home-surface, rgba(246, 246, 248, 0.8)), var(--glass-home-surface, rgba(246, 246, 248, 0.8)))) !important;
        border: 0.5px solid var(--glass-home-border, rgba(255, 255, 255, 0.35)) !important;
        box-shadow: var(--glass-home-shadow, 0 4px 16px rgba(0, 0, 0, 0.1)) !important;
        -webkit-backdrop-filter: blur(calc(var(--glass-home-blur, 24px) * var(--glass-blur-scale, 1))) saturate(var(--glass-home-saturate, 100%)) !important;
        backdrop-filter: blur(calc(var(--glass-home-blur, 24px) * var(--glass-blur-scale, 1))) saturate(var(--glass-home-saturate, 100%)) !important;
      }
      :host([nested]:not([on-bare])) .frame.surface {
        --g-text: inherit;
        --g-text-2: inherit;
        --g-text-shadow: inherit;
        --g-icon-shadow: inherit;
        color: inherit;
        padding: 0;
      }
      .title {
        padding: 0 4px;
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }
      /* the room's icon before the name, in the accent of the sidebar icons */
      .ricon {
        flex: none;
        --mdc-icon-size: 20px;
        display: flex;
        color: var(--glass-accent-icon, var(--glass-color-orange, #ff9f0a));
      }
      /* the name as on the room cards */
      .name {
        font-size: var(--glass-room-title-size, 15px);
        font-weight: 600;
        letter-spacing: -0.01em;
        color: var(--glass-room-title-color, var(--g-text));
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* scenes: small round buttons with the scene's picture */
      /* spread evenly across the tile */
      .scenes {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        padding: 0 6px;
      }
      .sbtn {
        flex: none;
        width: var(--glass-scene-size, 32px);
        height: var(--glass-scene-size, 32px);
        padding: 0;
        display: grid;
        place-items: center;
        -webkit-tap-highlight-color: transparent;
      }
      /* the scene's picture: its own layer, so the look's button material can't cover it */
      .simg {
        position: absolute;
        inset: 0;
        border-radius: inherit;
        background-size: var(--glass-scene-image-size, 125%);
        background-position: center;
        background-repeat: no-repeat;
      }
      /* quiet until it's the scene the light shows: smaller and muted, so the lights'
         state reads first; the current one in full colour and full size */
      .sbtn {
        transition:
          transform 0.25s ease,
          filter 0.25s ease,
          opacity 0.25s ease;
      }
      .sbtn:not(.cur) {
        transform: scale(0.82);
        filter: saturate(0.35);
        opacity: 0.7;
      }
      .sbtn:not(.cur):hover {
        filter: saturate(0.8);
        opacity: 0.9;
      }
      .sbtn ha-icon {
        --mdc-icon-size: 22px;
      }
      .slabel {
        max-width: 100%;
        font-size: 11px;
        font-weight: 600;
        color: var(--g-text-2);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* layout: buttons – round bulbs side by side, at the bottom of the tile */
      .buttons {
        margin-top: auto;
        display: flex;
        justify-content: space-around;
        gap: 8px;
        padding: 0 4px 2px;
      }
      .bitem {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 5px;
      }
      /* the lights from the top, so the first ones line up across tiles; a line between them */
      .lights {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .light + .light {
        padding-top: 10px;
        border-top: var(--glass-divider-size, 1px) solid var(--glass-divider-color, color-mix(in srgb, var(--g-text) 14%, transparent));
      }
      .light {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .lbar {
        position: relative;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 4px;
        isolation: isolate;
      }
      /* brightness: the bar fills from the left, in the light's colour */
      .fill {
        position: absolute;
        inset: 0;
        z-index: -1;
        border-radius: inherit;
        pointer-events: none;
        background: linear-gradient(
          90deg,
          color-mix(in srgb, var(--fill) calc(var(--fill-a) * 1%), transparent),
          color-mix(in srgb, var(--fill) calc(var(--fill-a) * 0.65%), transparent)
        );
        clip-path: inset(0 calc(100% - (var(--btn) + 8px) - (100% - var(--btn) - 8px) * var(--pct) / 100) 0 0 round 999px);
        transition: clip-path 0.25s ease;
      }
      .lbar:not(.on) .fill {
        opacity: 0;
      }
      /* fill_style: one even colour, or a glow that brightens towards the value */
      .lbar.fill-solid .fill {
        background: color-mix(in srgb, var(--fill) calc(var(--fill-a) * 1%), transparent);
      }
      .lbar.fill-glow .fill {
        background: linear-gradient(
          90deg,
          color-mix(in srgb, var(--fill) calc(var(--fill-a) * 0.4%), transparent),
          color-mix(in srgb, var(--fill) calc(var(--fill-a) * 1.6%), transparent)
        );
      }
      .lbar.mode-b.fill-none .fill {
        display: none;
      }
      /* colour temperature / hue: the bar shows the whole range, a thumb marks the value */
      .lbar.mode-t .fill,
      .lbar.mode-c .fill {
        opacity: 0.55;
        clip-path: none;
      }
      .lbar.mode-t .fill {
        background: linear-gradient(90deg, #ffa34d, #ffd9a8 45%, #f4f6ff 70%, #bcd6ff);
      }
      .lbar.mode-c .fill {
        background: linear-gradient(90deg, #ff3b30, #ff9500, #ffcc00, #34c759, #00c7be, #007aff, #af52de, #ff2d55, #ff3b30);
      }
      .slider {
        position: relative;
      }
      /* brightness levels: small marks along the bar's bottom edge */
      .tick {
        position: absolute;
        bottom: 5px;
        width: 2px;
        height: 6px;
        margin-left: -1px;
        border-radius: 1px;
        background: currentColor;
        opacity: 0.28;
        pointer-events: none;
      }
      .thumb {
        position: absolute;
        top: 50%;
        left: calc(var(--pos) * 100%);
        width: 18px;
        height: 18px;
        margin: -9px 0 0 -9px;
        border-radius: 50%;
        background: #fff;
        box-shadow:
          0 0 0 1px rgba(0, 0, 0, 0.08),
          0 2px 6px rgba(0, 0, 0, 0.3);
        pointer-events: none;
      }
      /* what the bar sets: brightness / temperature / colour */
      .modes {
        flex: none;
        display: flex;
        gap: 2px;
        padding-right: 4px;
      }
      .mode {
        width: 32px;
        height: 32px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: none;
        color: var(--g-text-2);
        display: grid;
        place-items: center;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        transition: background 0.2s ease;
      }
      .mode.cur:not(.mat) {
        color: var(--g-text);
        background: color-mix(in srgb, var(--g-text) 12%, transparent);
      }
      .mode ha-icon {
        --mdc-icon-size: 17px;
      }
      .lbar.switch {
        cursor: pointer;
      }
      .btn {
        flex: none;
        width: var(--btn);
        height: var(--btn);
        display: grid;
        place-items: center;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }
      .btn ha-icon,
      .btn ha-state-icon {
        --mdc-icon-size: calc(var(--btn) * 0.52);
        display: flex;
        filter: var(--g-icon-shadow);
      }
      .btn:not(.active) {
        --fg: var(--glass-icon-inactive, var(--g-text));
      }
      /* on: a lit bulb (specific enough to beat the look's button shadow) */
      :host([control-glass]) .btn.control.active.glow,
      .btn.control.active.glow {
        overflow: visible;
        box-shadow:
          0 0 10px 1px color-mix(in srgb, var(--glow) 55%, transparent),
          0 0 22px 5px color-mix(in srgb, var(--glow) 25%, transparent),
          inset 0 1px 0 rgba(255, 255, 255, 0.5) !important;
      }
      .slider {
        flex: 1;
        min-width: 0;
        align-self: stretch;
        display: flex;
        flex-direction: column;
        justify-content: center;
        padding-right: 12px;
        cursor: ew-resize;
        touch-action: pan-y;
        user-select: none;
        -webkit-user-select: none;
      }
      .lbar.switch .slider {
        cursor: pointer;
      }
      .lname {
        font-size: 14px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .lstate {
        font-size: 12px;
        color: var(--g-text-2);
        font-variant-numeric: tabular-nums;
      }
      /* quick choices: a segmented control – a recessed track, the current one lifted out */
      .seg {
        display: flex;
        gap: 2px;
        padding: 3px;
        border-radius: 999px;
        background: var(--glass-seg-bg, color-mix(in srgb, var(--g-text) 7%, transparent));
        box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.07);
      }
      /* right under its bar, as wide as it: tucked beneath from the bar's vertical
         middle, square on top, rounded only at the bottom */
      .lbar {
        z-index: 1;
      }
      /* under the bar, as wide as it: a drawer tucked beneath from the bar's vertical
         middle – square on top, rounded at the bottom – with the quick choices and the
         light's scenes */
      .lbar {
        z-index: 1;
      }
      .tray {
        position: relative;
        z-index: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: calc(-6px - var(--btn) / 2 - 4px);
        padding: calc(var(--btn) / 2 + 4px + 10px) 4px 8px;
        border-radius: 0 0 22px 22px;
        /* the bar is see-through glass: cut its lower half out of the drawer, leaving only
           the corners beside its round ends, so the tint does not show through it */
        --r: calc(var(--btn) / 2 + 4px);
        -webkit-mask:
          linear-gradient(transparent var(--r), #000 var(--r)),
          radial-gradient(circle var(--r) at 100% 0, transparent 98%, #000) 0 0 / var(--r) var(--r) no-repeat,
          radial-gradient(circle var(--r) at 0 0, transparent 98%, #000) 100% 0 / var(--r) var(--r) no-repeat;
        mask:
          linear-gradient(transparent var(--r), #000 var(--r)),
          radial-gradient(circle var(--r) at 100% 0, transparent 98%, #000) 0 0 / var(--r) var(--r) no-repeat,
          radial-gradient(circle var(--r) at 0 0, transparent 98%, #000) 100% 0 / var(--r) var(--r) no-repeat;
      }
      .tray:not(.mat) {
        background: var(--glass-seg-bg, color-mix(in srgb, var(--g-text) 7%, transparent));
        box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.07);
      }
      /* own materials (pill_glass, icon_glass, scenes_glass): the shape the control glass would give */
      .lbar.mat,
      .btn.mat,
      .sbtn.mat {
        border-radius: 999px;
      }
      .sbtn.mat {
        position: relative;
        border: 0;
        cursor: pointer;
      }
      /* a lit icon in its own material keeps the bulb's halo */
      .btn.mat.glow {
        overflow: visible;
        box-shadow:
          0 0 10px 1px color-mix(in srgb, var(--glow) 55%, transparent),
          0 0 22px 5px color-mix(in srgb, var(--glow) 25%, transparent),
          inset 0 1px 0 rgba(255, 255, 255, 0.5);
      }
      .btn.mat.on {
        color: #fff;
      }
      /* icon_background / icon colours on the control glass: they beat every look's (Apple Home's grey too) */
      :host([control-glass]) .btn.control.own-bg {
        background: var(--sheen, linear-gradient(transparent, transparent)), linear-gradient(var(--bg), var(--bg)) !important;
      }
      :host([control-glass]) .btn.control.own-bg::before {
        display: none;
      }
      :host([control-glass]) .btn.control.own-fg {
        color: var(--fg) !important;
      }
      /* inside the drawer the rows need no track of their own */
      .tray .seg {
        padding: 0;
        background: none;
        box-shadow: none;
      }
      .tray .scenes {
        padding: 0 8px 2px;
      }
      /* round icon buttons like the scenes, spread across, no labels (the value as a tooltip) */
      .tray .seg,
      .seg {
        justify-content: space-between;
        padding: 0 8px;
      }
      .segb {
        flex: none;
        width: 32px;
        height: 32px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: color-mix(in srgb, var(--g-text) 8%, transparent);
        color: var(--g-text-2);
        display: grid;
        place-items: center;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        transition:
          background 0.25s ease,
          color 0.25s ease,
          box-shadow 0.25s ease,
          transform 0.15s ease;
      }
      .segb:active {
        transform: scale(0.92);
      }
      .segb ha-icon {
        --mdc-icon-size: 18px;
      }
      /* the current one lifted out, lit */
      /* the current preset: the light liquid glass of the appliance list's lit button
         (dark icon by day), smoky glass with a light icon by night */
      .segb.cur:not(.has-dot):not(.mat) {
        color: #1c1c1e;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.62), rgba(255, 255, 255, 0.22) 55%, rgba(255, 255, 255, 0.34));
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.95),
          inset 0 -1px 0 rgba(255, 255, 255, 0.45),
          inset 0 0 14px rgba(255, 255, 255, 0.35),
          0 1px 2px rgba(0, 0, 0, 0.06),
          0 6px 18px rgba(0, 0, 0, 0.08);
        -webkit-backdrop-filter: blur(calc(10px * var(--glass-blur-scale, 1))) saturate(170%) brightness(1.04);
        backdrop-filter: blur(calc(10px * var(--glass-blur-scale, 1))) saturate(170%) brightness(1.04);
      }
      :host([dark]) .segb.cur:not(.has-dot):not(.mat) {
        color: #fff;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.42), rgba(255, 255, 255, 0.2) 55%, rgba(255, 255, 255, 0.28));
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.6),
          inset 0 -1px 0 rgba(255, 255, 255, 0.2),
          0 1px 2px rgba(0, 0, 0, 0.12),
          0 6px 18px rgba(0, 0, 0, 0.18);
        -webkit-backdrop-filter: blur(calc(10px * var(--glass-blur-scale, 1))) saturate(150%);
        backdrop-filter: blur(calc(10px * var(--glass-blur-scale, 1))) saturate(150%);
      }
      /* colour temperatures: the button is the colour, the current one ringed */
      .segb.has-dot {
        background: var(--c);
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.5),
          0 0 0 1px rgba(0, 0, 0, 0.08);
      }
      .segb.has-dot.cur {
        box-shadow:
          0 0 0 2px var(--glass-seg-ring, #fff),
          0 0 0 3.5px var(--c),
          0 2px 6px rgba(0, 0, 0, 0.18);
      }
      /* colour swatches; the current one gets a ring */
      .swatches {
        display: flex;
        justify-content: space-between;
        padding: 2px 10px;
      }
      .swatch {
        flex: none;
        width: 28px;
        height: 28px;
        padding: 0;
      }
      /* specific enough to beat the look's button material */
      :host([control-glass]) .swatch.control,
      .swatch.control {
        background: var(--sw) !important;
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.45),
          0 2px 6px rgba(0, 0, 0, 0.18) !important;
      }
      :host([control-glass]) .swatch.control.cur,
      .swatch.control.cur {
        box-shadow:
          0 0 0 2px var(--glass-seg-ring, #fff),
          0 0 0 3.5px var(--sw),
          0 2px 6px rgba(0, 0, 0, 0.18) !important;
      }
    `,
    // after the card's own rules: a picked material replaces the default glass
    materials,
  ];
}

registerCard("glass-light", GlassLight, {
  name: "Glass – lights",
  description: "Room lights tile: scenes as round buttons and a liquid glass brightness bar per light.",
});
