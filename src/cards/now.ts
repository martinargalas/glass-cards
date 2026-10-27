import { tr } from "../i18n";
import { css, html, nothing } from "lit";
import { GlassElement } from "../core/glass-element";
import type {
  ActionConfig,
  BaseCardConfig,
  HassEntity,
  HomeAssistant,
} from "../core/types";
import { registerCard } from "../core/registry";
import { makeEditor } from "../editor/editor";
import { nowSpec } from "../editor/specs";
import {
  conditionEntities,
  evalCondition,
  type Condition,
} from "../core/conditions";
import { cssColor } from "../core/colors";
import { control, surface } from "../core/styles";
import { haptic, runAction } from "../core/actions";
import { LiquidController } from "../core/liquid";
import { hour12, language } from "../core/settings";
import { NOW_PARTS } from "../core/card-parts";
import {
  WASHER_STAGES,
  stageName,
  washerEntities,
  washerPhase,
  washerState,
} from "../core/washer";

/**
 * "Právě běží": what is on in the whole home, one row each, with a button to
 * switch it off – or, for machines that work on their own (washer, mower,
 * robots), the icon of what they are doing right now.
 *
 *   type: custom:glass-now
 *   title: Právě běží            # optional heading
 *   lights:                      # counted together: "4 světla · Obývák 2 · Koupelna · WC"
 *     - name: Obývák
 *       icon: mdi:sofa                          # in the menu (lights on in several rooms: one room or all)
 *       entities: [light.living_room]          # a light group counts its members
 *     - name: Koupelna
 *       entities: [switch.switch, switch.switch_switch1]
 *   items:
 *     - entity: media_player.playstation_5
 *       name: PS5
 *       room: Obývák
 *       icon: mdi:sony-playstation
 *       active: { state_not: [off, standby, unavailable, unknown] }   # default: on / playing / …
 *       off_action: { action: perform-action, perform_action: … }    # default: turn_off; false = none
 *     - type: washer
 *       entity: sensor.pracka_washer_job_state
 *       name: Pračka
 *       room: Prádelna
 *       completion: sensor.pracka_washer_completion_time   # default from the job state's name
 *     - type: mower
 *       entity: lawn_mower.luba
 *       progress: sensor.luba_progress
 *       time_left: sensor.luba_time_left
 *       area: sensor.luba_work_area
 *     - type: vacuum
 *       entity: vacuum.roomba
 *       name: Vysávání
 *       room: device_tracker.roomba      # the room it is in (Roomba+), or plain text
 *       progress: sensor.roomba_mission_progress
 *
 * Nothing on: the card renders nothing (hide_empty: false shows "Nic neběží").
 */
interface LightGroup {
  name: string;
  /** the room's icon in the menu that switches off one room or all of them */
  icon?: string;
  entities: string[];
}

interface NowItem {
  type?: "entity" | "washer" | "mower" | "vacuum";
  entity: string;
  name?: string;
  room?: string;
  icon?: string;
  color?: string;
  active?: Condition;
  off_action?: ActionConfig | false;
  tap_action?: ActionConfig;
  /** entity: a value shown after the room, e.g. a CPU load sensor */
  detail?: string;
  completion?: string;
  progress?: string;
  time_left?: string;
  area?: string;
}

interface NowConfig extends BaseCardConfig {
  title?: string;
  lights?: LightGroup[];
  light_icon?: string;
  light_color?: string;
  items?: NowItem[];
  hide_empty?: boolean;
  /** the coloured circle of each row, px (36) */
  icon_size?: number;
  /** the button on the right, px (36) */
  button_size?: number;
  /** row height: compact | normal | roomy */
  density?: "compact" | "normal" | "roomy";
  /** lines between the rows (true) */
  dividers?: boolean;
}

interface Row {
  key: string;
  icon: string;
  color: string;
  title: string;
  sub: string;
  /** a button that switches it off */
  off?: (ev?: Event) => void;
  /** or a button for the next step (pause while it works, play while paused) */
  act?: { icon: string; label: string; run: () => void };
  /** or the icon of what it is doing */
  stateIcon?: string;
  stateLabel?: string;
  tap?: () => void;
}

const MEDIA_ON = ["playing", "paused", "on", "buffering"];
const ON = ["on", "open", "unlocked"];
const OFF_LIKE = [
  "off",
  "unavailable",
  "unknown",
  "standby",
  "idle",
  "docked",
  "",
];

const MOWER_ON = ["mowing", "returning", "paused", "error"];
const MOWER: Record<string, [string, string]> = {
  mowing: ["mdi:robot-mower", "mowing"],
  returning: ["mdi:home-import-outline", "returning"],
  paused: ["mdi:pause", "paused"],
  error: ["mdi:alert-circle-outline", "error"],
};
const VACUUM_ON = ["cleaning", "returning", "paused", "error"];
const VACUUM: Record<string, [string, string]> = {
  cleaning: ["mdi:play", "cleaning"],
  returning: ["mdi:home-import-outline", "returning"],
  paused: ["mdi:pause", "paused"],
  error: ["mdi:alert-circle-outline", "error"],
};

const val = (st?: HassEntity) =>
  st && !["unavailable", "unknown", ""].includes(st.state)
    ? st.state
    : undefined;

class GlassNow extends GlassElement<NowConfig> {
  static override parts = NOW_PARTS;
  constructor() {
    super();
    new LiquidController(this);
  }

  static getConfigElement() {
    return makeEditor(nowSpec);
  }

  static getStubConfig(hass: HomeAssistant) {
    const lights = Object.keys(hass.states)
      .filter((e) => e.startsWith("light."))
      .slice(0, 3);
    return { lights: [{ name: "Domov", entities: lights }] };
  }

  protected watchedEntities(c: NowConfig) {
    const out = new Set<string>();
    for (const g of c.lights ?? [])
      for (const id of g.entities) {
        out.add(id);
        const members = this._hass?.states[id]?.attributes.entity_id;
        if (Array.isArray(members)) members.forEach((m: string) => out.add(m));
      }
    for (const it of c.items ?? []) {
      for (const id of [
        it.entity,
        it.detail,
        it.completion ?? this._completionId(it),
        it.progress,
        it.time_left,
        it.area,
      ])
        if (id) out.add(id);
      if (it.room?.includes(".")) out.add(it.room);
      if (it.type === "washer")
        washerEntities({ entity: it.entity }).forEach((id) => out.add(id));
      conditionEntities(it.active, it.entity, out);
    }
    return [...out];
  }

  private _completionId(it: NowItem) {
    return it.entity.match(/^sensor\.(.+)_washer_job_state$/)
      ? it.entity.replace(/_job_state$/, "_completion_time")
      : undefined;
  }

  private _off(entities: string[]) {
    haptic("light");
    const hass = this._hass!;
    const byDomain = new Map<string, string[]>();
    for (const id of entities) {
      const d = id.split(".")[0];
      byDomain.set(d, [...(byDomain.get(d) ?? []), id]);
    }
    for (const [d, ids] of byDomain) {
      const domain = [
        "light",
        "switch",
        "fan",
        "media_player",
        "input_boolean",
        "climate",
        "humidifier",
      ].includes(d)
        ? d
        : "homeassistant";
      hass.callService(domain, "turn_off", {}, { entity_id: ids });
    }
  }

  private _call(domain: string, service: string, entity: string) {
    haptic("light");
    this._hass!.callService(domain, service, {}, { entity_id: entity });
  }

  private _room(it: NowItem): string | undefined {
    if (!it.room) return undefined;
    if (!it.room.includes(".")) return it.room;
    const v = val(this._hass!.states[it.room]);
    // a device tracker at home / docked says nothing about the room
    return v &&
      !["home", "not_home", "docked", "Docked", "charging"].includes(v)
      ? v
      : undefined;
  }

  private _rows(): Row[] {
    const hass = this._hass!;
    const c = this._config;
    const rows: Row[] = [];

    // lights: one row for the home, counted per room
    const on: string[] = [];
    const per: string[] = [];
    let total = 0;
    const roomsOn: { g: LightGroup; ids: string[] }[] = [];
    for (const g of c.lights ?? []) {
      let n = 0;
      const ids: string[] = [];
      for (const id of g.entities) {
        const st = hass.states[id];
        if (!st || st.state !== "on") continue;
        on.push(id);
        ids.push(id);
        const members = st.attributes.entity_id;
        n += Array.isArray(members)
          ? members.filter((m: string) => hass.states[m]?.state === "on")
              .length || 1
          : 1;
      }
      if (n) {
        per.push(n > 1 ? `${g.name} ${n}` : g.name);
        roomsOn.push({ g, ids });
      }
      total += n;
    }
    if (total)
      rows.push({
        key: "lights",
        icon: c.light_icon ?? "mdi:lightbulb",
        color: cssColor(c.light_color ?? "yellow") ?? "#ffcc00",
        title: tr("{n} lights", { n: total }),
        sub: per.join(" · "),
        // one room: off at once; several: a menu – each room, and all of them
        off:
          roomsOn.length > 1
            ? (ev?: Event) => {
                haptic("light");
                const off = (ids: string[]) => ({ action: "perform-action", perform_action: "homeassistant.turn_off", target: { entity_id: ids } });
                const items = [
                  ...roomsOn.map(({ g, ids }) => ({ icon: g.icon ?? "mdi:lightbulb-off-outline", name: g.name, tap_action: off(ids) })),
                  { icon: "mdi:lightbulb-group-off-outline", name: tr("All"), tap_action: off(on) },
                ];
                runAction(this, hass, { tap_action: { action: "menu", labels: true, items } as ActionConfig }, "tap", ev?.currentTarget as HTMLElement);
              }
            : () => this._off(on),
      });

    const time = new Intl.DateTimeFormat(language(hass), {
      hour: "numeric",
      minute: "2-digit",
      hour12: hour12(hass),
    });
    for (const it of c.items ?? []) {
      const st = hass.states[it.entity];
      if (!st) continue;
      const type = it.type ?? "entity";
      const room = this._room(it);
      const name =
        it.name ?? (st.attributes.friendly_name as string) ?? it.entity;
      const tap = () =>
        runAction(
          this,
          hass,
          {
            entity: it.entity,
            tap_action: it.tap_action ?? { action: "more-info" },
          },
          "tap",
        );

      if (type === "washer") {
        const phase = washerPhase(hass, { entity: it.entity });
        if (phase === "off") continue;
        const s = washerState(st.state);
        const stage = WASHER_STAGES.find((x) =>
          (Array.isArray(x.state) ? x.state : [x.state]).includes(s),
        );
        const end = Date.parse(
          hass.states[it.completion ?? this._completionId(it) ?? ""]?.state ??
            "",
        );
        const label =
          phase === "pause"
            ? tr("Paused")
            : phase === "done"
              ? tr("Washing done")
              : stage ? stageName(stage) : tr("Washing");
        const when =
          phase === "run" && Number.isFinite(end) && end > Date.now()
            ? `${tr("done at")} ${time.format(new Date(end))}`
            : "";
        rows.push({
          key: it.entity,
          icon: it.icon ?? "mdi:washing-machine",
          color: cssColor(it.color ?? "blue") ?? "#0a84ff",
          title: name,
          sub: [room, label, when].filter(Boolean).join(" · "),
          stateIcon:
            phase === "pause"
              ? "mdi:pause"
              : phase === "done"
                ? "mdi:check"
                : (stage?.icon ?? "mdi:washing-machine"),
          stateLabel: label,
          tap,
        });
        continue;
      }

      if (type === "mower" || type === "vacuum") {
        const list = type === "mower" ? MOWER_ON : VACUUM_ON;
        if (
          !(it.active
            ? evalCondition(it.active, hass, it.entity)
            : list.includes(st.state))
        )
          continue;
        const [sIcon, sEn] = (type === "mower" ? MOWER : VACUUM)[st.state] ?? ["mdi:dots-horizontal", ""];
        const sLabel = sEn ? tr(sEn) : st.state;
        const pct = parseFloat(val(hass.states[it.progress ?? ""]) ?? "");
        const left = parseFloat(val(hass.states[it.time_left ?? ""]) ?? "");
        const area = val(hass.states[it.area ?? ""]);
        const where =
          room ?? (area && !/not working/i.test(area) ? area : undefined);
        rows.push({
          key: it.entity,
          icon:
            it.icon ??
            (type === "mower" ? "mdi:robot-mower" : "mdi:robot-vacuum"),
          color: cssColor(it.color ?? "blue") ?? "#0a84ff",
          title: name,
          sub: [
            where,
            sLabel,
            Number.isFinite(pct) ? `${Math.round(pct)} %` : "",
            Number.isFinite(left) && left > 0
              ? tr("{n} min left", { n: Math.round(left) })
              : "",
          ]
            .filter(Boolean)
            .join(" · "),
          // working: pause it; paused: carry on; on its way home or stuck: just say so
          act:
            st.state === "mowing" || st.state === "cleaning"
              ? {
                  icon: "mdi:pause",
                  label: tr("Pause"),
                  run: () =>
                    this._call(
                      type === "mower" ? "lawn_mower" : "vacuum",
                      "pause",
                      it.entity,
                    ),
                }
              : st.state === "paused"
                ? {
                    icon: "mdi:play",
                    label: tr("Resume"),
                    run: () =>
                      this._call(
                        type === "mower" ? "lawn_mower" : "vacuum",
                        type === "mower" ? "start_mowing" : "start",
                        it.entity,
                      ),
                  }
                : undefined,
          stateIcon: sIcon,
          stateLabel: sLabel,
          tap,
        });
        continue;
      }

      const d = it.entity.split(".")[0];
      const active = it.active
        ? evalCondition(it.active, hass, it.entity)
        : d === "media_player"
          ? MEDIA_ON.includes(st.state)
          : d === "sensor"
            ? !OFF_LIKE.includes(st.state)
            : ON.includes(st.state);
      if (!active) continue;
      const detail = it.detail ? hass.states[it.detail] : undefined;
      const dv = val(detail);
      const media =
        d === "media_player"
          ? [st.attributes.media_title, st.attributes.app_name].find(
              (x) => typeof x === "string" && x,
            )
          : undefined;
      const offCfg = it.off_action;
      rows.push({
        key: it.entity,
        icon: it.icon ?? (st.attributes.icon as string) ?? "mdi:power",
        color: cssColor(it.color ?? "blue") ?? "#0a84ff",
        title: name,
        sub: [
          room,
          media as string | undefined,
          dv
            ? `${dv}${detail?.attributes.unit_of_measurement ? ` ${detail.attributes.unit_of_measurement}` : ""}`
            : "",
        ]
          .filter(Boolean)
          .join(" · "),
        off:
          offCfg === false || (offCfg === undefined && d === "sensor")
            ? undefined
            : offCfg
              ? () => {
                  haptic("light");
                  runAction(
                    this,
                    hass,
                    { entity: it.entity, tap_action: offCfg },
                    "tap",
                  );
                }
              : () => this._off([it.entity]),
        tap,
      });
    }
    return rows;
  }

  protected override render() {
    if (!this._config || !this._hass) return nothing;
    const c = this._config;
    const rows = this._rows();
    if (!rows.length && c.hide_empty !== false) return nothing;
    const pad = { compact: 7, normal: 11, roomy: 15 }[c.density ?? "normal"] ?? 11;
    const sizes = `--now-ic:${c.icon_size ?? 36}px;--now-btn:${c.button_size ?? 36}px;--now-pad:${pad}px;`;
    const body = html`${c.title ? html`<div class="title">${c.title}</div>` : nothing}
      <div class="list ${c.dividers === false ? "plain" : ""}" style=${sizes}>
        ${
          rows.length
            ? rows.map(
                (r) =>
                  html`<div class="row">
                    <button class="what" @click=${r.tap}>
                      <span class="ic" style="--c:${r.color}"
                        ><ha-icon .icon=${r.icon}></ha-icon
                      ></span>
                      <span class="tx"
                        ><span class="a">${r.title}</span
                        >${r.sub ? html`<span class="b">${r.sub}</span>` : nothing}</span
                      >
                    </button>
                    ${
                      r.off
                        ? html`<button
                            class="end control off"
                            title=${tr("Turn off")}
                            @click=${r.off}
                          >
                            <ha-icon icon="mdi:power"></ha-icon>
                          </button>`
                        : r.act
                          ? html`<button
                              class="end control"
                              title=${r.act.label}
                              @click=${r.act.run}
                            >
                              <ha-icon .icon=${r.act.icon}></ha-icon>
                            </button>`
                          : r.stateIcon
                            ? html`<span
                                class="end control state"
                                title=${r.stateLabel ?? ""}
                                ><ha-icon .icon=${r.stateIcon}></ha-icon
                              ></span>`
                            : nothing
                    }
                  </div>`,
              )
            : html`<div class="empty">${tr("Nothing on")}</div>`
        }
      </div>`;
    // its own glass: title and list on a tile
    return this.tile ? html`<div class=${this.tile}>${body}</div>` : body;
  }

  static override styles = [
    GlassElement.styles,
    surface,
    control,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      .title {
        font-size: 16px;
        font-weight: 600;
        margin: 0 4px 10px;
        color: var(--g-text);
        text-shadow: var(--g-text-shadow);
      }
      .list {
        border-radius: var(--g-radius, 24px);
        overflow: hidden;
        color: var(--g-text);
        /* its own tile, readable over any wallpaper: a darker glass (the liquid one replaces it where it runs) */
        background: var(
          --glass-now-surface,
          linear-gradient(
            180deg,
            rgba(30, 34, 46, 0.34),
            rgba(30, 34, 46, 0.26)
          )
        );
        -webkit-backdrop-filter: blur(calc(20px * var(--glass-blur-scale, 1))) saturate(160%);
        backdrop-filter: blur(calc(20px * var(--glass-blur-scale, 1))) saturate(160%);
        box-shadow:
          inset 0 0.5px 0 rgba(255, 255, 255, 0.3),
          0 6px 20px rgba(0, 0, 0, 0.12);
        --g-text: #fff;
        --g-text-2: rgba(255, 255, 255, 0.75);
      }
      .row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 0 12px 0 0;
      }
      .row + .row {
        border-top: 0.5px solid
          var(--glass-now-divider, rgba(255, 255, 255, 0.14));
      }
      .plain .row + .row {
        border-top: 0;
      }
      .what {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: var(--now-pad, 11px) 0 var(--now-pad, 11px) 14px;
        border: 0;
        background: none;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }
      /* the thing: as a lit button on a room tile – the colour with a highlight */
      .ic {
        width: var(--now-ic, 36px);
        height: var(--now-ic, 36px);
        flex: none;
        border-radius: 50%;
        display: grid;
        place-items: center;
        color: #fff;
        background:
          radial-gradient(120% 90% at 30% 15%, rgba(255, 255, 255, 0.4), rgba(255, 255, 255, 0) 55%),
          color-mix(in srgb, var(--c) 68%, transparent);
        box-shadow:
          0 4px 14px color-mix(in srgb, var(--c) 38%, transparent),
          inset 0 1px 0 rgba(255, 255, 255, 0.5);
        --mdc-icon-size: calc(var(--now-ic, 36px) * 0.53);
      }
      .tx {
        min-width: 0;
        display: flex;
        flex-direction: column;
      }
      .a {
        font-size: 14.5px;
        font-weight: 600;
        text-shadow: var(--g-text-shadow);
      }
      .b {
        font-size: 12.5px;
        color: var(--g-text-2);
        margin-top: 1px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      /* off / pause / play / state: just the white icon – an action, not a switch (the colour on the left says it is on) */
      .end {
        width: var(--now-btn, 36px);
        height: var(--now-btn, 36px);
        flex: none;
        border-radius: 50%;
        display: grid;
        place-items: center;
        padding: 0;
        border: 0 !important;
        box-shadow: none !important;
        background: var(--glass-now-button, none) !important;
        color: #fff;
        --mdc-icon-size: calc(var(--now-btn, 36px) * 0.61);
      }
      .end::before,
      .end::after {
        display: none;
      }
      button.end:active {
        opacity: 0.6;
      }
      .end ha-icon {
        display: flex;
        filter: var(--g-icon-shadow);
      }
      button.end {
        cursor: pointer;
      }
      /* what the machine is doing: the same round shape, not a button */
      .end.state {
        cursor: default;
      }
      .empty {
        padding: 14px 16px;
        font-size: 14px;
        color: var(--g-text-2);
      }
    `,
  ];
}

registerCard("glass-now", GlassNow, {
  name: "Glass – running now",
  description:
    "What is on in the whole home, each with a button to switch it off or the state it is in.",
});
