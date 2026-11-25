/*
 * What's new: after an update an admin is greeted once – a bar at the bottom of the page with the
 * new cards of the versions since the one they last saw, each with a link to its page in the docs.
 * Which version they saw is kept in Home Assistant (the user's frontend data), so it shows once per
 * person, not once per browser. A fresh install shows nothing (the starter offer greets it).
 */

import { syncLang, tr } from "../i18n";

type Hass = { callWS<T>(m: Record<string, unknown>): Promise<T>; user?: { is_admin?: boolean } };

const SEEN = "glass-cards-version";
const DOCS = "https://glass.argalas.org/docs/cards/";

/** The news of each version: what an update brings, newest last. */
const NEWS: { version: string; items: { name: string; text: string; doc: string; icon: string }[] }[] = [
  {
    version: "1.12.0",
    items: [
      {
        name: "Full calendar",
        text: "Your calendars in full on a photo of the month – add events, drag them with a finger and change them.",
        doc: "calendar-view",
        icon: "mdi:calendar-blank-multiple",
      },
      {
        name: "Media player",
        text: "Made for Music Assistant: the cover lights the glass, your library and a search, speakers to group – and a screensaver.",
        doc: "media",
        icon: "mdi:music",
      },
    ],
  },
];

/** "1.12.0" < "1.12.1" < "1.13.0" */
function newer(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}

export async function offerNews(version: string) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return;
  let hass: Hass | undefined;
  for (let i = 0; i < 40 && !(hass = (document.querySelector("home-assistant") as any)?.hass as Hass | undefined)?.user; i++) await new Promise((r) => setTimeout(r, 500));
  if (!hass?.user?.is_admin) return;
  const got = await hass.callWS<{ value?: { version?: string } | null }>({ type: "frontend/get_user_data", key: SEEN }).catch(() => undefined);
  if (!got) return;
  const seen = got.value?.version;
  const remember = () => hass!.callWS({ type: "frontend/set_user_data", key: SEEN, value: { version } }).catch(() => undefined);
  // a fresh install: nothing to tell yet – from now on, its updates
  if (!seen) return void remember();
  if (!newer(version, seen)) return;
  const items = NEWS.filter((n) => newer(n.version, seen) && !newer(n.version, version)).flatMap((n) => n.items);
  if (!items.length) return void remember();
  syncLang(hass as any);
  showBar(version, items, remember);
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function showBar(version: string, items: (typeof NEWS)[number]["items"], remember: () => Promise<unknown>) {
  if (document.querySelector("glass-whats-new")) return;
  const host = document.createElement("glass-whats-new");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); z-index: 9; width: min(560px, calc(100vw - 32px)); }
      .bar { display: flex; flex-direction: column; gap: 12px; padding: 16px; border-radius: 24px;
        background: color-mix(in srgb, var(--card-background-color, #1c1c1e) 82%, transparent); color: var(--primary-text-color, #fff);
        backdrop-filter: blur(24px) saturate(160%); -webkit-backdrop-filter: blur(24px) saturate(160%);
        border: 1px solid rgba(255,255,255,0.14); box-shadow: 0 12px 40px rgba(0,0,0,0.28); font: 14px/1.4 var(--paper-font-body1_-_font-family, system-ui, sans-serif); }
      .head { display: flex; align-items: start; gap: 12px; }
      .head .text { flex: 1; }
      b { display: block; font-weight: 600; font-size: 15px; }
      .head span { opacity: 0.72; font-size: 13px; }
      .items { display: grid; gap: 8px; }
      a.item { display: flex; gap: 12px; align-items: center; text-decoration: none; color: inherit; border-radius: 16px; padding: 12px 14px; background: rgba(127,127,127,0.16); }
      a.item:hover { background: rgba(127,127,127,0.26); }
      a.item ha-icon { --mdc-icon-size: 26px; flex: none; color: var(--primary-color, #0a84ff); }
      a.item strong { display: block; font-weight: 600; }
      a.item small { display: block; opacity: 0.72; font-size: 13px; margin-top: 2px; }
      button { border: 0; font: inherit; cursor: pointer; color: inherit; }
      .close { background: none; opacity: 0.6; font-size: 18px; line-height: 1; padding: 4px; }
      .ok { align-self: end; border-radius: 999px; padding: 8px 18px; background: var(--primary-color, #0a84ff); color: var(--text-primary-color, #fff); font-weight: 600; }
    </style>
    <div class="bar" role="dialog" aria-label="${esc(tr("What's new in Glass Cards"))}">
      <div class="head">
        <div class="text"><b>${esc(tr("New in Glass Cards {version}").replace("{version}", version))}</b><span>${esc(tr("Add them in Dashboard Studio, or with Add card in Home Assistant."))}</span></div>
        <button class="close" aria-label="${esc(tr("Close"))}">✕</button>
      </div>
      <div class="items">
        ${items
          .map(
            (it) =>
              `<a class="item" href="${DOCS}${it.doc}" target="_blank" rel="noopener"><ha-icon icon="${it.icon}"></ha-icon><span><strong>${esc(tr(it.name))}</strong><small>${esc(tr(it.text))}</small></span></a>`,
          )
          .join("")}
      </div>
      <button class="ok">${esc(tr("Got it"))}</button>
    </div>`;
  const done = () => {
    host.remove();
    void remember();
  };
  root.querySelector(".close")!.addEventListener("click", done);
  root.querySelector(".ok")!.addEventListener("click", done);
  document.body.appendChild(host);
}
