// Copies the wallpapers that ship with the cards into dist/wallpapers – a dashboard
// picks one with `wallpaper: glass:<name>` (core/liquid-gl wallpaperUrl).
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";

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

// the demo home's photos (glass:demo/<file>)
const demoTo = new URL("../dist/demo/", import.meta.url);
mkdirSync(demoTo, { recursive: true });
const demoFrom = new URL("../demo-assets/", import.meta.url);
const files = readdirSync(demoFrom);
for (const f of files) copyFileSync(new URL(f, demoFrom), new URL(f, demoTo));
console.log(`demo photos: ${files.length} → dist/demo`);
