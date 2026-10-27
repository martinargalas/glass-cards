// The live demo for the web site: the real cards on the made-up demo home, no Home
// Assistant needed. The page around it steers it with the address or postMessage:
//   ?mode=mobile|tablet  &look=liquid|frosted|apple-home|light|solid  &night=1  &page=lights
//   postMessage({ glass: { look, night, page } })
import "./icons";
import "../src/index";
import { DEMO_DASHBOARD } from "../src/demo/dashboard";
import { setSelected } from "../src/core/select";

type Dash = HTMLElement & { setConfig(c: unknown): void; hass: unknown };

const q = new URLSearchParams(location.search);
const base = DEMO_DASHBOARD.views[0].cards[0];
const state = { look: q.get("look") ?? base.look, night: q.get("night") === "1" };

const root = document.getElementById("root")!;
const dash = document.createElement("glass-dashboard") as Dash;

function apply() {
  const night = state.night;
  // the made-up home's day / night: the dashboard follows HA's dark mode here
  dash.setConfig({ ...base, look: state.look, appearance: night ? "dark" : "light", offset: "0px" });
  dash.hass = { language: "en", locale: { language: "en", number_format: "language", time_format: "language" }, themes: { darkMode: night } };
  document.documentElement.toggleAttribute("dark", night);
}

apply();
root.appendChild(dash);
if (q.get("page")) setSelected("page", q.get("page")!);

window.addEventListener("message", (e) => {
  const m = (e.data as { glass?: { look?: string; night?: boolean; page?: string } })?.glass;
  if (!m) return;
  if (m.look) state.look = m.look;
  if (m.night !== undefined) state.night = m.night;
  if (m.look || m.night !== undefined) apply();
  if (m.page) setSelected("page", m.page);
});
// tell the page around which page the dock picked (to light its own buttons)
window.addEventListener("glass-select", (e) => parent.postMessage({ glassDemo: (e as CustomEvent).detail }, "*"));
