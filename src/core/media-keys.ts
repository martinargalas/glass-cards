/**
 * The keyboard's media keys (play / pause, next, previous) for a media card – also with the window
 * minimised, Home Assistant in a tab behind, the card in a closed pop-up. The browser's Media Session
 * sends them, along with the system's own controls (macOS' Control Center, Windows' media flyout, which
 * show the song and its cover).
 *
 * A browser sends media keys only to a page that plays sound: while a card asks for them, the page plays
 * a loop of silence (the tab shows a speaker). Browsers let it start only after a first click or key on
 * the page. The keys go to the card touched last (its player: the one it shows).
 */

export interface MediaKeyTarget extends HTMLElement {
  /** what plays on the card's player now: for the system's controls */
  mediaKeyInfo(): { title?: string; artist?: string; album?: string; art?: string; playing: boolean; position?: number; duration?: number } | undefined;
  /** a key pressed (or the system's control used) */
  mediaKeyAction(action: "play" | "pause" | "next" | "previous" | "seek", position?: number): void;
  /** the card's hass made current (a card in a closed pop-up may not hear about changes) */
  mediaKeyRefresh(): void;
}

const targets = new Set<MediaKeyTarget>();
let active: MediaKeyTarget | undefined;
let audio: HTMLAudioElement | undefined;
let lastInfo = "";

/** One second of silence, as a WAV (8 kHz, 8-bit mono). */
function silence(): string {
  const n = 8000;
  const b = new Uint8Array(44 + n);
  const v = new DataView(b.buffer);
  const s = (o: number, t: string) => [...t].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
  s(0, "RIFF");
  v.setUint32(4, 36 + n, true);
  s(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true);
  v.setUint32(28, 8000, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  s(36, "data");
  v.setUint32(40, n, true);
  b.fill(128, 44); // the middle of 8-bit audio: silence
  let bin = "";
  for (const x of b) bin += String.fromCharCode(x);
  return `data:audio/wav;base64,${btoa(bin)}`;
}

/** The silent loop going (after a first gesture on the page, as browsers want). */
function start() {
  if (!("mediaSession" in navigator) || !targets.size) return;
  audio ??= Object.assign(new Audio(silence()), { loop: true });
  if (audio.paused) void audio.play().catch(() => undefined);
}
function stop() {
  audio?.pause();
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = "none";
  }
}

let armed = false;
function arm() {
  if (armed) return;
  armed = true;
  const go = () => {
    start();
    // once playing it stays; a blocked start tries again on the next gesture
    if (audio && !audio.paused) {
      window.removeEventListener("pointerdown", go, true);
      window.removeEventListener("keydown", go, true);
    }
  };
  window.addEventListener("pointerdown", go, true);
  window.addEventListener("keydown", go, true);
  const ms = navigator.mediaSession;
  const act = (a: "play" | "pause" | "next" | "previous") => () => {
    const t = pick();
    if (!t) return;
    t.mediaKeyRefresh();
    t.mediaKeyAction(a);
    start();
  };
  const set = (name: MediaSessionAction, fn: MediaSessionActionHandler) => {
    try {
      ms.setActionHandler(name, fn);
    } catch {
      /* this browser doesn't know that one */
    }
  };
  set("play", act("play"));
  set("pause", act("pause"));
  set("nexttrack", act("next"));
  set("previoustrack", act("previous"));
  set("seekto", (d) => {
    const t = pick();
    if (t && d.seekTime !== undefined) t.mediaKeyAction("seek", d.seekTime);
  });
}

/** The card the keys go to: the one touched last, else any still around. */
function pick(): MediaKeyTarget | undefined {
  if (active && targets.has(active)) return active;
  return (active = [...targets].find((t) => t.isConnected) ?? [...targets][0]);
}

/** A card that wants the media keys (while it's on the page, or in a closed pop-up). */
export function mediaKeysOn(t: MediaKeyTarget) {
  if (!("mediaSession" in navigator)) return;
  targets.add(t);
  active ??= t;
  arm();
  start();
}

/** It doesn't want them any more (its option off). */
export function mediaKeysOff(t: MediaKeyTarget) {
  targets.delete(t);
  if (active === t) active = [...targets][0];
  if (!targets.size) stop();
}

/** Touched: the keys go to this card. */
export function mediaKeysTouch(t: MediaKeyTarget) {
  if (targets.has(t)) active = t;
}

/** What plays, for the system's controls (from the card the keys go to). */
export function mediaKeysUpdate(t: MediaKeyTarget) {
  if (!("mediaSession" in navigator) || pick() !== t) return;
  const i = t.mediaKeyInfo();
  const ms = navigator.mediaSession;
  const key = JSON.stringify([i?.title, i?.artist, i?.album, i?.art]);
  if (key !== lastInfo) {
    lastInfo = key;
    ms.metadata = i?.title
      ? new MediaMetadata({
          title: i.title,
          artist: i.artist ?? "",
          album: i.album ?? "",
          artwork: i.art ? [{ src: new URL(i.art, location.href).href, sizes: "512x512" }] : [],
        })
      : null;
  }
  ms.playbackState = i ? (i.playing ? "playing" : "paused") : "none";
  try {
    if (i?.duration && i.duration > 0 && i.position !== undefined) ms.setPositionState({ duration: i.duration, position: Math.min(Math.max(0, i.position), i.duration), playbackRate: 1 });
  } catch {
    /* a position the browser won't take */
  }
}
