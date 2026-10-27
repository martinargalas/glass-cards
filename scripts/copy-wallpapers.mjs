// Copies the wallpapers that ship with the cards into dist/wallpapers – a dashboard
// picks one with `wallpaper: glass:<name>` (core/liquid-gl wallpaperUrl).
import { copyFileSync, mkdirSync } from "node:fs";

const SHIPPED = [
  "hills-day", "hills-night-blue-soft", "hills-night-amber", "green-hills-day",
  "dunes-day", "dunes-night", "sea-day",
  "steel-waves-day", "steel-waves-night", "grey-waves-day", "grey-waves-night",
  "pastel-waves-day", "pastel-waves-night",
];
const from = new URL("../wallpapers/", import.meta.url);
const to = new URL("../dist/wallpapers/", import.meta.url);
mkdirSync(to, { recursive: true });
for (const name of SHIPPED) copyFileSync(new URL(`${name}.jpg`, from), new URL(`${name}.jpg`, to));
console.log(`wallpapers: ${SHIPPED.length} → dist/wallpapers`);
