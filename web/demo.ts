// The live demo for the web site: the real cards on the made-up demo home, no Home
// Assistant needed. The page around it steers it with the address or postMessage:
//   ?look=liquid|frosted|apple-home|light|solid  &night=1  &open=lights (a pop-up)
//   ?studio=1  Dashboard Studio over it, editing this very dashboard
//   postMessage({ glass: { look, night, open } })
// Phone or tablet is the frame's width, as on a real screen (under 700 px: phone).
import "./icons";
import "./ha-runtime";
import "./editor-shims";
import "../src/index";
import { DEMO_DASHBOARD } from "../src/demo/dashboard";
import { demoHass } from "../src/demo/hass";
import { openStudio } from "../src/editor/studio";

type Dash = HTMLElement & { setConfig(c: unknown): void; hass: unknown };

// the custom cards the dashboard uses besides the glass ones – the same releases as the
// author's own Home Assistant (copied to vendor/ when the demo is built)
const VENDOR = ["bubble-card", "vertical-stack-in-card", "layout-card", "apexcharts-card", "solar-arc-card"];
const vendorBase = new URL("./vendor/", import.meta.url);
for (const name of VENDOR) {
  const s = document.createElement("script");
  s.type = "module";
  s.src = new URL(`${name}.js`, vendorBase).href;
  s.onerror = () => console.warn(`demo: ${name} not available`);
  document.head.appendChild(s);
}

const q = new URLSearchParams(location.search);
const base = DEMO_DASHBOARD.views[0].cards[0];
const state = { look: q.get("look") ?? base.look, night: q.get("night") === "1" };
// what Dashboard Studio changed: the dashboard keeps it while the page is open
let edited: Record<string, any> | undefined;

const root = document.getElementById("root")!;
const dash = document.createElement("glass-dashboard") as Dash;

const haBase = () => ({ language: "en", locale: { language: "en", number_format: "language", time_format: "24" }, themes: { darkMode: state.night }, user: { id: "demo", name: "Demo", is_admin: true } });

function apply() {
  const night = state.night;
  // the made-up home's day / night: the dashboard follows HA's dark mode here
  dash.setConfig({ ...(edited ?? base), look: state.look, appearance: night ? "dark" : "light", offset: "0px" });
  dash.hass = haBase();
  document.documentElement.toggleAttribute("dark", night);
}

/** HA's router, as far as the demo needs it: #pop-up links and the back button. */
function go(path: string) {
  const url = path.startsWith("#") ? `${location.pathname}${location.search}${path}` : path;
  history.pushState(null, "", url);
  window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}
window.addEventListener("hass-action", (e) => {
  const { config, action } = (e as CustomEvent).detail ?? {};
  const a = config?.[`${action}_action`];
  if (a?.action === "navigate" && a.navigation_path) go(a.navigation_path);
  else if (a?.action === "url" && a.url_path) window.open(a.url_path, "_blank", "noopener");
});
// Bubble Card's own navigation event
window.addEventListener("location-changed", () => parent.postMessage({ glassDemo: { hash: location.hash } }, "*"));

apply();
root.appendChild(dash);

/** Dashboard Studio on this dashboard: changes show on it, nothing is saved anywhere. */
function studio() {
  if (document.querySelector("dialog.glass-studio-dialog")) return;
  openStudio({
    config: structuredClone(edited ?? { ...base, look: state.look }),
    hass: demoHass(haBase() as any) as any,
    footer: "",
    mode: q.get("mode") === "mobile" ? "mobile" : "tablet",
    onChange: (c) => {
      edited = c;
      apply();
    },
  });
}
if (q.get("studio") === "1") setTimeout(studio, 300);
if (q.get("open")) setTimeout(() => go(`#${q.get("open")}`), 1500);

window.addEventListener("message", (e) => {
  const m = (e.data as { glass?: { look?: string; night?: boolean; open?: string; studio?: boolean } })?.glass;
  if (!m) return;
  if (m.look) state.look = m.look;
  if (m.night !== undefined) state.night = m.night;
  if (m.look || m.night !== undefined) apply();
  if (m.open !== undefined) go(m.open ? `#${m.open}` : location.pathname + location.search);
  if (m.studio) studio();
});
