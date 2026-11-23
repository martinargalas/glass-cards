// Copies the wallpapers that ship with the cards into dist/ as wallpaper-<name>.jpg – a
// dashboard picks one with `wallpaper: glass:<name>` (core/liquid-gl wallpaperUrl). Flat beside
// the bundle, as HACS downloads only the files right in dist/, no subfolders.
import { copyFileSync, readdirSync, rmSync } from "node:fs";

const SHIPPED = [
  "hills-day", "hills-night-blue-soft", "hills-night-amber", "green-hills-day",
  "dunes-day", "dunes-night", "sea-day",
  "steel-waves-day", "steel-waves-night", "grey-waves-day", "grey-waves-night",
  "pastel-waves-day", "pastel-waves-night",
];
const from = new URL("../wallpapers/", import.meta.url);
const to = new URL("../dist/", import.meta.url);
// the folders of older builds
for (const old of ["wallpapers", "demo"]) rmSync(new URL(old, to), { recursive: true, force: true });
for (const name of SHIPPED) copyFileSync(new URL(`${name}.jpg`, from), new URL(`wallpaper-${name}.jpg`, to));
console.log(`wallpapers: ${SHIPPED.length} → dist/wallpaper-*.jpg`);

// the demo home's photos (glass:demo/<file> → demo-<file>)
const demoFrom = new URL("../demo-assets/", import.meta.url);
const files = readdirSync(demoFrom);
for (const f of files) copyFileSync(new URL(f, demoFrom), new URL(`demo-${f}`, to));
console.log(`demo photos: ${files.length} → dist/demo-*`);

// the Calendar view's photo of each month (calendar-photos/01.webp → calendar-01.webp: glass:calendar/01.webp)
const calFrom = new URL("../calendar-photos/", import.meta.url);
const cals = readdirSync(calFrom).filter((f) => f.endsWith(".webp"));
for (const f of cals) copyFileSync(new URL(f, calFrom), new URL(`calendar-${f}`, to));
console.log(`calendar photos: ${cals.length} → dist/calendar-*`);

// the alarm's sounds (sounds/<name>.mp3 → sound-<name>.mp3): the Glass alarm's default melody
const soundsFrom = new URL("../sounds/", import.meta.url);
const sounds = readdirSync(soundsFrom).filter((f) => f.endsWith(".mp3"));
for (const f of sounds) copyFileSync(new URL(f, soundsFrom), new URL(`sound-${f}`, to));
console.log(`sounds: ${sounds.length} → dist/sound-*`);
