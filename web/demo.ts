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
// author's own Home Assistant (copied to vendor/ when the demo is built). Bubble Card at once
// (the pop-ups and the dock need it), the others only once a card of theirs is on screen:
// the charts and layouts sit in pop-ups, and a page that never opens them never loads them.
const vendorBase = new URL("./vendor/", import.meta.url);
const loaded = new Set<string>();
function vendor(name: string) {
  if (loaded.has(name)) return;
  loaded.add(name);
  const s = document.createElement("script");
  s.type = "module";
  s.src = new URL(`${name}.js`, vendorBase).href;
  s.onerror = () => console.warn(`demo: ${name} not available`);
  document.head.appendChild(s);
}
vendor("bubble-card");
const ON_DEMAND: Record<string, string> = { "apexcharts-card": "apexcharts-card", "layout-card": "layout-card", "solar-arc-card": "solar-arc-card" };
(window as any).glassDemoNeed = (tag: string) => ON_DEMAND[tag] && vendor(ON_DEMAND[tag]);
// the rest in the background once the dashboard is up – or as soon as a pop-up opens
const rest = () => Object.values(ON_DEMAND).forEach(vendor);
window.addEventListener("load", () => setTimeout(rest, 2500), { once: true });
window.addEventListener("location-changed", () => location.hash && rest());

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

// A phone's dashboard swipes its rooms; on a computer the mouse drags them the same way
// (browsers only scroll sideways by touch or a trackpad). Not in the Studio, which has
// its own dragging.
let drag: { el: HTMLElement; x: number; left: number; moved: boolean } | undefined;
const sideways = (path: EventTarget[]) =>
  path.find((t): t is HTMLElement => {
    if (!(t instanceof HTMLElement)) return false;
    const o = getComputedStyle(t).overflowX;
    return (o === "auto" || o === "scroll") && t.scrollWidth > t.clientWidth + 4;
  });
window.addEventListener(
  "pointerdown",
  (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0 || document.querySelector("dialog.glass-studio-dialog")) return;
    const el = sideways(e.composedPath());
    if (el) drag = { el, x: e.clientX, left: el.scrollLeft, moved: false };
  },
  true,
);
window.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  if (!drag.moved && Math.abs(dx) < 6) return;
  if (!drag.moved) {
    drag.moved = true;
    // follow the hand while it drags; the snap points take it again on release
    drag.el.style.scrollSnapType = "none";
    drag.el.style.scrollBehavior = "auto";
  }
  drag.el.scrollLeft = drag.left - dx;
});
window.addEventListener("pointerup", () => {
  if (!drag) return;
  const { el, moved } = drag;
  drag = undefined;
  if (!moved) return;
  el.style.scrollSnapType = "";
  el.style.scrollBehavior = "";
  // a drag is not a tap on the card it ended on
  const eat = (c: Event) => (c.stopPropagation(), c.preventDefault());
  window.addEventListener("click", eat, { capture: true, once: true });
  setTimeout(() => window.removeEventListener("click", eat, true), 100); // none came: nothing to eat later
});
