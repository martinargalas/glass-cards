/*
 * The starter dashboard: the demo's layout built from the user's own home. Rooms come from
 * HA's areas – each with the lights, blinds and climate found in it and a temperature – the
 * left column from what the home has (people, weather, calendars). With Bubble Card there is
 * one pop-up as an example: the weather.
 *
 * Dashboard Studio adds it on request ("From your rooms"). After an install an admin is offered
 * the demo home instead, once, in a bar at the bottom of the page – it always shows the cards at
 * their best, whatever state the home's areas are in. Nothing is created without a click.
 */

import { syncLang, tr } from "../i18n";
import { addDemoDashboard, saveConfig } from "./store";

type Hass = {
  callWS<T>(m: Record<string, unknown>): Promise<T>;
  states: Record<string, { state: string; attributes: Record<string, any> }>;
  areas?: Record<string, { area_id: string; name: string; icon?: string | null; picture?: string | null }>;
  entities?: Record<string, { entity_id: string; area_id?: string | null; device_id?: string | null; hidden?: boolean; entity_category?: string | null }>;
  devices?: Record<string, { area_id?: string | null }>;
  user?: { is_admin?: boolean };
};
type Cfg = Record<string, any>;

/** Where the starter dashboard lives once added. */
export const STARTER_URL = "glass-home";

/** Room photos of the demo, by the kind of room an area's name suggests (English, Czech and German). */
const KINDS: { name: string; re: RegExp; icon: string; image?: string; position?: string }[] = [
  { name: "Living room", re: /living|lounge|obyv|wohn/i, icon: "mdi:sofa", image: "photo-1631679706909-1844bbd07221", position: "center 92%" },
  { name: "Office", re: /office|study|pracov|b[uü]ro|arbeit/i, icon: "mdi:desk", image: "photo-1606223226350-4cf4cd93a221", position: "center 55%" }, // i18n-ok
  { name: "Kitchen", re: /kitchen|kuchy|(?<!wasch)k[uü]che/i, icon: "mdi:silverware-fork-knife", image: "photo-1723470917889-31b8a36056f9", position: "center 60%" }, // i18n-ok
  { name: "Kids\' room", re: /kid|child|nursery|d[eě]t|kinder/i, icon: "mdi:teddy-bear", image: "photo-1721395288477-b546804ce392" }, // i18n-ok
  { name: "Bedroom", re: /bed|lo[zž]nic|schlaf/i, icon: "mdi:bed-king-outline", image: "photo-1766431066492-9bec8410a57b", position: "center 85%" }, // i18n-ok
  { name: "Bathroom", re: /bath|koupel|\bbad/i, icon: "mdi:shower", image: "photo-1688786219616-598ed96aa19d", position: "center 100%" },
  { name: "Toilet", re: /toilet|wc|z[aá]chod/i, icon: "mdi:toilet", image: "photo-1737233536991-8ee3f92b7781", position: "35% 80%" }, // i18n-ok
  { name: "Hallway", re: /hall|entr|corridor|chodb|p[rř]eds|flur|diele|eingang/i, icon: "mdi:coat-rack", image: "photo-1689263132088-c9d2233ca5b1" }, // i18n-ok
  { name: "Laundry", re: /laundry|utility|pr[aá]delna|wasch/i, icon: "mdi:washing-machine" }, // i18n-ok
  { name: "Garage", re: /garage|gar[aá][zž]/i, icon: "mdi:garage" }, // i18n-ok
  { name: "Garden", re: /garden|yard|terrace|zahrad|terasa|garten|terrasse/i, icon: "mdi:flower-outline" },
];

const photo = (id: string) => `https://images.unsplash.com/${id}?w=1100&q=80&auto=format&fit=crop`;

const OFF = ["unavailable", "unknown"];

/** Every entity of an area: its own area or its device's; hidden and diagnostic ones left out. */
function byArea(hass: Hass): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const e of Object.values(hass.entities ?? {})) {
    if (e.hidden || e.entity_category || !hass.states[e.entity_id]) continue;
    const area = e.area_id ?? (e.device_id ? hass.devices?.[e.device_id]?.area_id : undefined);
    if (!area) continue;
    out.set(area, [...(out.get(area) ?? []), e.entity_id]);
  }
  return out;
}

const domain = (id: string) => id.split(".")[0];
const cls = (hass: Hass, id: string) => hass.states[id]?.attributes.device_class as string | undefined;

function roomCard(hass: Hass, area: { name: string; icon?: string | null; picture?: string | null }, ids: string[]): Cfg | undefined {
  const lights = ids.filter((id) => domain(id) === "light");
  const covers = ids.filter((id) => domain(id) === "cover" && cls(hass, id) !== "garage" && cls(hass, id) !== "gate");
  const climate = ids.filter((id) => domain(id) === "climate");
  const media = ids.filter((id) => domain(id) === "media_player" && !hass.states[id].attributes.entity_id);
  const temp =
    ids.find((id) => domain(id) === "sensor" && cls(hass, id) === "temperature" && !OFF.includes(hass.states[id].state)) ??
    climate.find((id) => hass.states[id].attributes.current_temperature !== undefined);
  if (!lights.length && !covers.length && !climate.length && !media.length && !temp) return undefined;

  const entities: Cfg[] = [
    // a light group first: the button then counts its members
    ...lights.sort((a, b) => Number(!!hass.states[b].attributes.entity_id) - Number(!!hass.states[a].attributes.entity_id)).slice(0, 2).map((entity) => ({ entity, icon: "mdi:lightbulb-outline" })),
    ...covers.slice(0, 1).map((entity) => ({ entity, icon: "mdi:blinds-horizontal", active_states: ["closed"], state_icons: { closed: "mdi:blinds-horizontal-closed" } })),
    ...climate.slice(0, 1).map((entity) => ({ entity, icon: "mdi:radiator", active_states: ["heat", "cool", "heat_cool", "auto"] })),
    ...media.slice(0, 1).map((entity) => ({ entity, icon: cls(hass, entity) === "tv" ? "mdi:television" : "mdi:speaker", active: { state_not: ["off", "standby", "idle", "unavailable", "unknown"] } })),
  ];
  const kind = KINDS.find((k) => k.re.test(area.name) || tr(k.name) === area.name);
  const image = area.picture || (kind?.image ? photo(kind.image) : undefined);
  return {
    type: "custom:glass-room-card",
    name: area.name,
    icon: area.icon || kind?.icon || "mdi:home-outline",
    entities,
    ...(image ? { layout: "image-full", image, image_color: "active", ...(kind?.position && !area.picture ? { image_position: kind.position } : {}) } : {}),
    show_name: true,
    ...(temp ? { info: [domain(temp) === "climate" ? { entity: temp, attribute: "current_temperature", precision: 1, unit: "°" } : { entity: temp, precision: 1 }] } : {}),
    max_entities: 2,
    bar: "split",
    ...(lights.length ? { image_entities: lights.slice(0, 2) } : {}),
  };
}

/**
 * Without areas: rooms guessed from the entities' names (light.kitchen_ceiling → Kitchen); what
 * no name places is shared out among the demo's rooms, so the dashboard still shows the home.
 */
function guessedRooms(hass: Hass): Cfg[] {
  const ids = Object.keys(hass.states).filter((id) => {
    const e = hass.entities?.[id];
    if (e?.hidden || e?.entity_category || OFF.includes(hass.states[id].state)) return false;
    const d = domain(id);
    return d === "light" || d === "climate" || d === "media_player" || (d === "cover" && !["garage", "gate"].includes(cls(hass, id) ?? "")) || (d === "sensor" && cls(hass, id) === "temperature");
  });
  const label = (id: string) => `${id.split(".")[1].replace(/_/g, " ")} ${hass.states[id].attributes.friendly_name ?? ""}`;
  const named = new Map<(typeof KINDS)[number], string[]>();
  const rest: string[] = [];
  for (const id of ids) {
    const kind = KINDS.find((k) => k.re.test(label(id)));
    if (kind) named.set(kind, [...(named.get(kind) ?? []), id]);
    else rest.push(id);
  }
  // the rest round the demo's main rooms, a light, a blind and a thermostat each before the next ones
  const spare = KINDS.slice(0, 5);
  const byKind = (d: string) => rest.filter((id) => domain(id) === d);
  // temperatures only where the name says: an outdoor or boiler sensor is no room's
  for (const d of ["light", "cover", "climate", "media_player"]) {
    byKind(d).forEach((id, i) => {
      const kind = spare[i % spare.length];
      named.set(kind, [...(named.get(kind) ?? []), id]);
    });
  }
  return KINDS.filter((k) => named.has(k))
    .map((k) => roomCard(hass, { name: tr(k.name) }, named.get(k)!))
    .filter((c): c is Cfg => !!c);
}

/** The weather pop-up of the demo, on the user's weather entity. */
function weatherPopup(weather: string): Cfg {
  return {
    type: "custom:bubble-card",
    card_type: "pop-up",
    hash: "#weather",
    margin_top_desktop: "-7%",
    width_desktop: "1080px",
    bg_blur: 90,
    bg_opacity: 0,
    is_sidebar_hidden: true,
    auto_close: 60000,
    icon: "mdi:weather-partly-cloudy",
    name: tr("Weather"),
    hide_backdrop: true,
    show_header: false,
    cards: [
      { type: "custom:glass-popup-header", name: tr("Weather"), icon: "mdi:weather-partly-cloudy" },
      {
        type: "custom:glass-panel",
        glass: "none",
        layout: "row",
        gap: 16,
        padding: 0,
        align: "stretch",
        height: "624px",
        responsive: { mobile: { layout: "column", height: "auto" } },
        cards: [
          {
            type: "custom:glass-panel",
            role: "sidebar",
            view_layout: { grow: 0, shrink: 0, basis: "max(340px, calc((100% - 22px) * 0.36 / 1.36))" },
            padding: 22,
            cards: [
              {
                type: "custom:glass-clock-weather",
                weather,
                show_clock: false,
                show_date: false,
                show_condition: true,
                daily_forecast: 5,
                hourly_forecast: 5,
                details: ["humidity", "pressure", "wind", "apparent_temperature", "cloud_coverage", "precipitation", "sunrise", "sunset"],
                details_columns: 2,
                tap_action: { action: "none" },
                dividers: true,
              },
            ],
          },
          { type: "custom:glass-radar", zoom: 7, frames: 7, height: "fill", style: "rain", styles: ["rain", "clouds"], forecast: 3, view_layout: { grow: 1, basis: "0px" } },
        ],
      },
    ],
  };
}

/** The dashboard: the demo's layout with the user's rooms, people, weather and calendars. */
export function starterConfig(hass: Hass, bubble: boolean): Cfg {
  const ids = Object.keys(hass.states);
  const weather = ids.find((id) => domain(id) === "weather");
  const people = ids.filter((id) => domain(id) === "person").map((entity) => ({ entity }));
  const calendars = ids.filter((id) => domain(id) === "calendar").slice(0, 4).map((entity) => ({ entity }));
  const members = byArea(hass);
  let rooms = Object.values(hass.areas ?? {})
    .map((a) => roomCard(hass, a, members.get(a.area_id) ?? []))
    .filter((c): c is Cfg => !!c);
  if (!rooms.length) rooms = guessedRooms(hass);
  // the living room gets the wide tile, as in the demo – or else the room with most buttons
  const living = rooms.findIndex((c) => KINDS[0].re.test(c.name) || c.name === tr(KINDS[0].name));
  const wide = living >= 0 ? living : rooms.reduce((best, c, i) => (c.entities.length > (rooms[best]?.entities.length ?? -1) ? i : best), -1);
  const grid = rooms.map((c, i) => (i === wide && rooms.length > 2 ? { ...c, view_layout: { span: 2 } } : c));

  const left: Cfg[] = [
    {
      type: "custom:glass-panel",
      layout: "row",
      align: "start",
      gap: 8,
      padding: 0,
      glass: "none",
      view_layout: { height: "auto", grow: 0 },
      cards: [
        { type: "custom:glass-date-header", align: "start", styles: { date_size: "15px", date_line_size: "13px" }, view_layout: { grow: 1 } },
        ...(people.length ? [{ type: "custom:glass-people", people, size: 30, view_layout: { shrink: 0 } }] : []),
      ],
    },
    weather
      ? { type: "custom:glass-clock-weather", weather, forecast_type: "hourly", forecast_rows: 5, show_weather: false, clock_align: "center" }
      : { type: "custom:glass-clock-weather", show_weather: false, clock_align: "center" },
    ...(weather
      ? [
          {
            type: "custom:glass-clock-weather",
            weather,
            show_clock: false,
            hourly_forecast: 5,
            rain_nowcast: true,
            daily_forecast: 0,
            show_condition: true,
            dividers: true,
            now_style: "line",
            icon_style: "mdi",
            forecast_style: "columns",
            rain_bars: false,
            now_align: "center",
            icons: { weather: { color: "rgba(255,255,255,0.92)" } },
            ...(bubble ? { tap_action: { action: "navigate", navigation_path: "#weather" } } : {}),
          },
        ]
      : []),
    ...(calendars.length ? [{ type: "custom:glass-divider" }, { type: "custom:glass-calendar", days: 14, max_events: 6, calendars, hide_empty: true, fit: true }] : []),
  ];

  const mobileHead: Cfg = {
    type: "custom:glass-panel",
    glass: "none",
    layout: "row",
    align: "center",
    gap: 10,
    padding: 0,
    cards: [
      weather
        ? { type: "custom:glass-clock-weather", variant: "compact", weather, glass: "none", view_layout: { grow: 1 }, ...(bubble ? { tap_action: { action: "navigate", navigation_path: "#weather" } } : {}) }
        : { type: "custom:glass-date-header", align: "start", view_layout: { grow: 1 } },
      ...(people.length ? [{ type: "custom:glass-people", people, size: 34, gap: 6, view_layout: { shrink: 0 } }] : []),
    ],
  };

  const popups = bubble && weather ? [weatherPopup(weather)] : [];
  const dock = popups.length ? [{ type: "custom:glass-dock", items: [{ icon: "mdi:weather-partly-cloudy", link: "#weather" }], indicator: "dot", bare: true, fade: true }] : [];
  const noRooms = { type: "markdown", content: tr("No lights, blinds or thermostats found yet. Add some to Home Assistant, then add this dashboard again in Dashboard Studio.") };

  return {
    title: "Glass",
    views: [
      {
        title: tr("Home"),
        path: "home",
        type: "panel",
        cards: [
          {
            type: "custom:glass-dashboard",
            preset: "sidebar",
            left_width: "minmax(340px, 0.36fr)",
            left: [{ type: "custom:glass-panel", padding: "26px 28px", gap: 22, justify: "start", cards: left, visible_on: ["tablet", "desktop"] }],
            main: [
              {
                type: "custom:glass-panel",
                layout: "column",
                gap: 14,
                padding: 20,
                cards: [
                  rooms.length
                    ? { type: "custom:glass-panel", layout: "grid", columns: 3, gap: 14, padding: 0, glass: "none", view_layout: { grow: 1, basis: "0" }, responsive: { mobile: { columns: 2, gap: 8 } }, cards: grid }
                    : noRooms,
                ],
              },
            ],
            breakpoints: { mobile: 700, desktop: 1500 },
            responsive: {
              mobile: {
                gap: 12,
                padding: "10px 12px 12px",
                left: null,
                main: [
                  {
                    type: "custom:glass-panel",
                    glass: "none",
                    gap: 12,
                    padding: 0,
                    cards: [
                      mobileHead,
                      { type: "custom:glass-divider", name: tr("Rooms"), line: false },
                      rooms.length
                        ? { type: "custom:glass-panel", glass: "none", layout: "row", scroll: true, item_width: "max(150px, calc((100vw - 48px) / 2.25))", height: "clamp(200px, 34dvh, 320px)", gap: 12, padding: 0, cards: rooms }
                        : noRooms,
                    ],
                  },
                ],
                ...(dock.length ? { overlay: [...popups, { ...dock[0], scroll: true }] } : {}),
              },
            },
            ...(dock.length ? { overlay: [...popups, ...dock] } : {}),
            appearance: "sun",
            time_tint: false,
            look: "apple-home",
            wallpaper: "glass:hills-day",
            dark: { wallpaper: "glass:hills-night-blue-soft" },
            liquid: { rim_width: 1.25 },
            styles: {
              room_button_size: "46px",
              corner_shape: "round",
              liquid_squircle: 0,
              radius: "32px",
              room_strip_radius: "999px",
              liquid_edge_intensity: 0.09,
              liquid_edge_distance: 0.08,
              liquid_specular: 0.55,
              liquid_rim_light: 0.6,
              liquid_tint: 0.2,
            },
          },
        ],
      },
    ],
  };
}

/** Bubble Card is installed: its element is defined or a dashboard resource loads it. */
async function hasBubble(hass: Hass): Promise<boolean> {
  if (customElements.get("bubble-card")) return true;
  const res = await hass.callWS<{ url: string }[]>({ type: "lovelace/resources" }).catch(() => []);
  return res.some((r) => /bubble-card/i.test(r.url));
}

/** Adds the starter dashboard (once – later only its url); the user's changes are never overwritten. */
export async function addStarterDashboard(hass: Hass): Promise<string> {
  const list = await hass.callWS<any[]>({ type: "lovelace/dashboards/list" });
  if (list.some((d) => d.url_path === STARTER_URL)) return STARTER_URL;
  const config = starterConfig(hass, await hasBubble(hass));
  await hass.callWS({ type: "lovelace/dashboards/create", url_path: STARTER_URL, title: "Glass", icon: "mdi:home-variant-outline", show_in_sidebar: true, require_admin: false, mode: "storage" });
  await saveConfig(hass, STARTER_URL, config);
  return STARTER_URL;
}

/* ── the offer after an install ─────────────────────────────────────────── */

const SEEN = "glass-cards-starter";

function haHass(): Hass | undefined {
  return (document.querySelector("home-assistant") as any)?.hass;
}

function navigate(path: string) {
  history.pushState(null, "", path);
  window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
}

/** When the cards' files were put in place (the bundle's Last-Modified): a reinstall changes it. */
async function installStamp(): Promise<string> {
  const bundle = import.meta.url.split("?")[0];
  return fetch(bundle, { method: "HEAD", cache: "no-store" })
    .then((r) => r.headers.get("last-modified") ?? "")
    .catch(() => "");
}

/**
 * Once per admin and install, the first time Glass Cards load: a bar offering the demo home.
 * Not shown while a Glass dashboard is there, nor again after an answer – until the cards are
 * installed anew (kept in HA's user data with the files' date, so another device doesn't ask
 * either). `?glass-setup` in the address shows it any time.
 */
export async function offerStarter() {
  let hass: Hass | undefined;
  for (let i = 0; i < 40 && !(hass = haHass())?.user; i++) await new Promise((r) => setTimeout(r, 500));
  if (!hass?.user?.is_admin) return;
  const install = await installStamp();
  const remember = () => hass!.callWS({ type: "frontend/set_user_data", key: SEEN, value: { at: new Date().toISOString(), install } }).catch(() => undefined);
  if (!new URLSearchParams(location.search).has("glass-setup")) {
    const [seen, list] = await Promise.all([
      hass.callWS<{ value?: { install?: string } | null }>({ type: "frontend/get_user_data", key: SEEN }).catch(() => undefined),
      hass.callWS<any[]>({ type: "lovelace/dashboards/list" }).catch(() => undefined),
    ]);
    if (!seen || !list) return;
    // someone with a Glass dashboard uses Glass Cards already: nothing to offer
    if (list.some((d) => /glass/i.test(`${d.url_path} ${d.title ?? ""}`))) return;
    // answered for these very files
    if (seen.value && seen.value.install === install) return;
  }
  syncLang(hass as any);
  showBar(hass, remember);
}

function showBar(hass: Hass, remember: () => Promise<unknown>) {
  const host = document.createElement("glass-starter-offer");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); z-index: 9; width: min(600px, calc(100vw - 32px)); }
      .bar { display: flex; flex-direction: column; gap: 12px; padding: 16px; border-radius: 24px;
        background: color-mix(in srgb, var(--card-background-color, #1c1c1e) 82%, transparent); color: var(--primary-text-color, #fff);
        backdrop-filter: blur(24px) saturate(160%); -webkit-backdrop-filter: blur(24px) saturate(160%);
        border: 1px solid rgba(255,255,255,0.14); box-shadow: 0 12px 40px rgba(0,0,0,0.28); font: 14px/1.4 var(--paper-font-body1_-_font-family, system-ui, sans-serif); }
      .head { display: flex; align-items: start; gap: 12px; }
      .text { flex: 1; }
      b { display: block; font-weight: 600; margin-bottom: 2px; }
      .choices { display: grid; gap: 8px; }
      button { border: 0; font: inherit; cursor: pointer; color: inherit; }
      .pick { text-align: left; border-radius: 16px; padding: 12px 14px; background: rgba(127,127,127,0.16); }
      .pick:hover { background: rgba(127,127,127,0.26); }
      .pick strong { display: block; font-weight: 600; }
      .pick span { display: block; opacity: 0.72; font-size: 13px; margin-top: 2px; }
      .pick.main { background: var(--primary-color, #0a84ff); color: var(--text-primary-color, #fff); }
      .pick.main span { opacity: 0.85; }
      .no { border-radius: 999px; padding: 6px 12px; background: none; opacity: 0.7; font-weight: 600; flex: none; }
      .no:hover { opacity: 1; }
      button[disabled] { opacity: 0.6; cursor: default; }
    </style>
    <div class="bar" role="dialog">
      <div class="head"><div class="text"><b></b><span class="msg"></span></div><button class="no"></button></div>
      <div class="choices">
        <button class="pick main"><strong></strong><span></span></button>
      </div>
    </div>`;
  const title = root.querySelector("b")!;
  const text = root.querySelector<HTMLElement>(".msg")!;
  const no = root.querySelector<HTMLButtonElement>(".no")!;
  const picks = [...root.querySelectorAll<HTMLButtonElement>(".pick")];
  title.textContent = tr("Glass Cards are installed");
  text.textContent = tr("Want to see what they can do?");
  picks[0].querySelector("strong")!.textContent = tr("Create the demo home");
  picks[0].querySelector("span")!.textContent = tr("Every card on a made-up home – a tour of everything Glass Cards can do. Then make it yours in Dashboard Studio: swap in your own devices, keep what you like.");
  no.textContent = tr("No, thanks");
  no.onclick = () => {
    void remember();
    host.remove();
  };
  for (const b of picks)
    b.onclick = async () => {
      for (const x of [...picks, no]) x.disabled = true;
      try {
        const url = await addDemoDashboard(hass);
        await remember();
        host.remove();
        navigate(`/${url}/0`);
      } catch (e: any) {
        for (const x of [...picks, no]) x.disabled = false;
        text.textContent = `${tr("The dashboard could not be created:")} ${e?.message ?? e}`;
      }
    };
  document.body.appendChild(host);
}
