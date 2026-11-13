import { tr } from "../i18n";
import { html, nothing } from "lit";
import type { GlassMode, HomeAssistant } from "./types";
import { openSheet } from "./sheet";
import "./time-picker";
import {
  WEEK,
  WEEKDAYS,
  WEEKENDS,
  dayName,
  defaultSound,
  parseDays,
  sameDays,
  soundName,
  timeOf,
  uses12h,
  weekOrder,
  writeDays,
  type AlarmHelpers,
  type Day,
} from "./alarm-model";

/**
 * An alarm's settings in a modal (core/sheet), changed there and saved with Done: its name,
 * time, days, days off, where it rings and what plays – each only when the alarm has
 * the helper for it. The alarm card opens it on its days, the alarm list on any alarm (with
 * its time and name, and Delete for the alarms the cards created).
 */
export interface AlarmEditorOptions {
  hass: HomeAssistant;
  helpers: AlarmHelpers;
  title: string;
  dark: boolean;
  accent?: string;
  /** the name and the time too (the alarm list) */
  full?: boolean;
  /** calendars with days off are set: offer Not on days off (their names under it) */
  calendars?: string[];
  /** the players offered (default: every media player) */
  players?: string[];
  /** sounds offered beside the shipped one */
  sounds?: { name: string; url: string }[];
  minuteStep?: number;
  /** a new alarm: nothing to read from helpers yet – these values, and Save creates it */
  draft?: Partial<Draft>;
  onSave?: (d: Draft) => Promise<void> | void;
  /** the card it opens from: the modal takes its look */
  host?: HTMLElement;
  /** the modal's glass (as a card's background) and tint; its controls' material (core/materials: { cls, style }) */
  sheetGlass?: GlassMode | "";
  sheetTint?: string;
  controlsMat?: { cls: string; style: string };
  onDelete?: () => Promise<void> | void;
}

export interface Draft {
  name: string;
  hours: number;
  minutes: number;
  days: Set<Day> | undefined;
  skip: boolean;
  players: string[];
  sound: string;
}

const list = (s: string | undefined) =>
  (s ?? "")
    .split(/[\s,;]+/)
    .map((x) => x.trim())
    .filter((x) => x.includes("."));

/** The alarm's values as its helpers hold them. */
export function readDraft(hass: HomeAssistant, h: AlarmHelpers): Draft {
  const st = (id?: string) => (id ? hass.states[id]?.state : undefined);
  const t = timeOf(hass, h.entity) ?? [7, 0];
  const name = h.name?.startsWith("input_text.") ? st(h.name) : h.name;
  return {
    name: name && name !== "unknown" ? name : "",
    hours: t[0],
    minutes: t[1],
    days: h.days ? parseDays(st(h.days)) : new Set(WEEK),
    skip: h.skip_holidays ? st(h.skip_holidays) === "on" : true,
    players: list(st(h.player)),
    sound: st(h.sound) && st(h.sound) !== "unknown" ? st(h.sound)! : "",
  };
}

/** Writes what changed into the helpers. */
export async function saveDraft(hass: HomeAssistant, h: AlarmHelpers, d: Draft, was: Draft) {
  const calls: Promise<unknown>[] = [];
  const time = `${String(d.hours).padStart(2, "0")}:${String(d.minutes).padStart(2, "0")}:00`;
  if (d.hours !== was.hours || d.minutes !== was.minutes) calls.push(hass.callService("input_datetime", "set_datetime", { entity_id: h.entity, time }));
  if (h.days && writeDays(d.days) !== writeDays(was.days)) calls.push(hass.callService("input_text", "set_value", { entity_id: h.days, value: writeDays(d.days) }));
  if (h.skip_holidays && d.skip !== was.skip) calls.push(hass.callService(domainOf(h.skip_holidays), d.skip ? "turn_on" : "turn_off", { entity_id: h.skip_holidays }));
  if (h.name?.startsWith("input_text.") && d.name !== was.name) calls.push(hass.callService("input_text", "set_value", { entity_id: h.name, value: d.name.slice(0, 100) }));
  if (h.player && d.players.join(",") !== was.players.join(",")) calls.push(hass.callService("input_text", "set_value", { entity_id: h.player, value: d.players.join(",").slice(0, 255) }));
  if (h.sound && d.sound !== was.sound) calls.push(hass.callService("input_text", "set_value", { entity_id: h.sound, value: d.sound.slice(0, 255) }));
  await Promise.all(calls);
}

const domainOf = (id: string) => (id.split(".")[0] === "switch" ? "switch" : "input_boolean");

export function openAlarmEditor(o: AlarmEditorOptions) {
  const hass = o.hass;
  const h = o.helpers;
  const was = o.draft ? { ...emptyDraft(), ...o.draft } : readDraft(hass, h);
  const d: Draft = { ...was, days: was.days ? new Set(was.days) : undefined, players: [...was.players] };
  let busy = false;
  let error = "";
  /** Delete tapped once: the second tap deletes */
  let deleting = false;
  /** the speakers' dropdown is open */
  let playersOpen = false;
  /** typing their own sound's address */
  let ownSound = !!d.sound && !isOffered(d.sound, o.sounds);

  const set = (fn: () => void) => {
    fn();
    sheet.update();
  };
  const toggleDay = (day: Day) =>
    set(() => {
      const s = new Set(d.days ?? []);
      if (s.has(day)) s.delete(day);
      else s.add(day);
      d.days = s.size ? s : undefined;
    });
  const save = async () => {
    if (busy) return;
    busy = true;
    error = "";
    sheet.update();
    try {
      if (o.onSave) await o.onSave(d);
      else await saveDraft(hass, h, d, was);
      sheet.close();
    } catch (e) {
      error = (e as { message?: string })?.message ?? String(e);
      busy = false;
      sheet.update();
    }
  };

  const players =
    o.players ??
    Object.keys(hass.states)
      .filter((id) => id.startsWith("media_player.") && hass.states[id].state !== "unavailable")
      .sort((a, b) => label(hass, a).localeCompare(label(hass, b)));
  const sounds = [{ name: soundName(defaultSound()), url: defaultSound() }, ...(o.sounds ?? [])];
  const cm = o.controlsMat;
  const ctl = cm?.cls ?? "";
  const cst = cm?.style ?? "";
  const chip = (text: string, cur: boolean, fn: () => void) => html`<button class="chip ${ctl} ${cur ? "cur" : ""}" style=${cst} aria-pressed=${cur} @click=${fn}>${text}</button>`;
  const opt = (icon: string, text: string, cur: boolean, fn: () => void, sub?: string) =>
    html`<button class="opt ${cur ? "cur" : ""}" role="checkbox" aria-checked=${cur} @click=${fn}>
      <ha-icon .icon=${icon}></ha-icon><span>${text}${sub ? html`<small>${sub}</small>` : nothing}</span><ha-icon class="tick" .icon=${"mdi:check"}></ha-icon>
    </button>`;

  const sheet = openSheet({
    title: o.title,
    dark: o.dark,
    accent: o.accent,
    host: o.host,
    glass: o.sheetGlass,
    tint: o.sheetTint,
    onEnter: save,
    render: () => html`
      ${o.full
        ? html`<input class="field ${ctl}" style=${cst} .value=${d.name} placeholder=${tr("Name")} maxlength="100" @input=${(e: InputEvent) => (d.name = (e.target as HTMLInputElement).value)} />
            <glass-time-wheels
              .hours=${d.hours}
              .minutes=${d.minutes}
              .hour12=${uses12h(hass)}
              .step=${o.minuteStep ?? 1}
              @change=${(e: CustomEvent) => ((d.hours = e.detail.hours), (d.minutes = e.detail.minutes))}
            ></glass-time-wheels>`
        : nothing}
      ${h.days
        ? html`<div class="label">${tr("Repeat")}</div>
            <div class="chips">
              ${chip(tr("Once"), !d.days, () => set(() => (d.days = undefined)))}
              ${chip(tr("Weekdays"), sameDays(d.days, WEEKDAYS), () => set(() => (d.days = new Set(WEEKDAYS))))}
              ${chip(tr("Every day"), sameDays(d.days, WEEK), () => set(() => (d.days = new Set(WEEK))))}
              ${chip(tr("Weekends"), sameDays(d.days, WEEKENDS), () => set(() => (d.days = new Set(WEEKENDS))))}
            </div>
            <div class="days">
              ${weekOrder(hass).map(
                (day) =>
                  html`<button class="day ${ctl} ${d.days?.has(day) ? "cur" : ""}" style=${cst} aria-pressed=${!!d.days?.has(day)} title=${dayName(hass, day, "long")} @click=${() => toggleDay(day)}>
                    ${dayName(hass, day, "narrow")}
                  </button>`,
              )}
            </div>`
        : nothing}
      ${o.calendars?.length && h.skip_holidays
        ? html`<button class="row ${ctl}" style=${cst} role="switch" aria-checked=${d.skip} @click=${() => set(() => (d.skip = !d.skip))}>
            <ha-icon .icon=${"mdi:calendar-star"}></ha-icon
            ><span>${tr("Not on days off")}<small>${o.calendars.map((id) => label(hass, id)).join(", ")}</small></span
            ><i class="sw ${d.skip ? "on" : ""}"></i>
          </button>`
        : nothing}
      ${h.player
        ? html`<div class="label">${tr("Rings on")}</div>
            ${players.length
              ? html`<div class="dropdown ${playersOpen ? "open" : ""}">
                  <button class="field select ${ctl}" style=${cst} aria-haspopup="listbox" aria-expanded=${playersOpen} @click=${() => set(() => (playersOpen = !playersOpen))}>
                    <ha-icon .icon=${"mdi:speaker"}></ha-icon>
                    <span class=${d.players.length ? "" : "placeholder"}>${d.players.length ? d.players.map((id) => label(hass, id)).join(", ") : tr("No speaker")}</span>
                    ${d.players.length > 1 ? html`<b class="count">${d.players.length}</b>` : nothing}
                    <ha-icon class="chev" .icon=${"mdi:chevron-down"}></ha-icon>
                  </button>
                  ${playersOpen
                    ? html`<div class="list checklist ${ctl}" style=${cst} role="listbox" aria-multiselectable="true">
                        ${players.map((id) => {
                          const cur = d.players.includes(id);
                          return html`<button class="opt check ${cur ? "cur" : ""}" role="option" aria-selected=${cur} @click=${() => set(() => (d.players = cur ? d.players.filter((x) => x !== id) : [...d.players, id]))}>
                            <i class="box">${cur ? html`<ha-icon .icon=${"mdi:check"}></ha-icon>` : nothing}</i><span>${label(hass, id)}</span>
                          </button>`;
                        })}
                      </div>`
                    : nothing}
                </div>`
              : html`<div class="note">${tr("No media players in Home Assistant")}</div>`}
            ${d.players.length || playersOpen ? nothing : html`<div class="note">${tr("None picked: the alarm only runs its automation's actions")}</div>`}`
        : nothing}
      ${h.sound
        ? html`<div class="label">${tr("Sound")}</div>
            <div class="list ${ctl}" style=${cst}>
              ${sounds.map((s) => opt("mdi:music-note", s.name, !ownSound && (d.sound || defaultSound()) === s.url, () => set(() => ((ownSound = false), (d.sound = s.url)))))}
              ${opt("mdi:link-variant", tr("Your own"), ownSound, () => set(() => (ownSound = true)), tr("An address: https://…, /local/… or media-source://…"))}
            </div>
            ${ownSound
              ? html`<input
                  class="field ${ctl}"
                  style=${cst}
                  .value=${isOffered(d.sound, o.sounds) ? "" : d.sound}
                  placeholder="https://… /local/… media-source://…"
                  maxlength="255"
                  @input=${(e: InputEvent) => (d.sound = (e.target as HTMLInputElement).value.trim())}
                />`
              : nothing}`
        : nothing}
      ${o.onDelete
        ? html`<button class="danger ${deleting ? "sure" : ""}" @click=${() => confirmDelete()}>${deleting ? tr("Tap again to delete it with its helpers and automation") : tr("Delete the alarm")}</button>`
        : nothing}
      ${error ? html`<div class="note" style="color:#ff453a">${error}</div>` : nothing}
    `,
    actions: () =>
      html`<button class="secondary" @click=${() => sheet.close()}>${tr("Cancel")}</button
        ><button class="primary" ?disabled=${busy} @click=${save}>${busy ? "…" : tr("Done")}</button>`,
  });

  const confirmDelete = async () => {
    if (!o.onDelete || busy) return;
    if (!deleting) {
      deleting = true;
      sheet.update();
      return;
    }
    busy = true;
    sheet.update();
    try {
      await o.onDelete();
      sheet.close();
    } catch (e) {
      error = String((e as { message?: string })?.message ?? e);
      busy = false;
      sheet.update();
    }
  };
  return sheet;
}

const emptyDraft = (): Draft => ({ name: "", hours: 7, minutes: 0, days: new Set(WEEKDAYS), skip: true, players: [], sound: "" });
const label = (hass: HomeAssistant, id: string) => hass.states[id]?.attributes.friendly_name ?? id;
const isOffered = (url: string, sounds?: { url: string }[]) => !url || url === defaultSound() || /sound-birds\.mp3$/.test(url) || !!sounds?.some((s) => s.url === url);
