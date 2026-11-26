import { tr } from "../i18n";
import { css, html, nothing } from "lit";
import { GlassElement } from "../core/glass-element";
import type { ActionConfig, BaseCardConfig, HassEntity, HomeAssistant } from "../core/types";
import { registerCard } from "../core/registry";
import { makeEditor } from "../editor/editor";
import { mediaSpec } from "../editor/specs";
import { control, liquidBar, surface } from "../core/styles";
import { haptic, pressHandlers, runAction, withDefaults, type ActionKind } from "../core/actions";
import { LiquidController } from "../core/liquid";
import { materials, type Material } from "../core/materials";
import { searchBus, searchScope, lastSearch, type SearchDetail } from "../core/search-bus";
import { matPart } from "./alarms";
import { MEDIA_PARTS } from "../core/card-parts";
import { Visualizer, VIZ_STYLES, type VizStyle } from "../core/visualizer";
import { maCommand, maImage, maPlayerProviders } from "../core/ma-api";
import { roomToDock } from "../core/dock-space";
import { KIND_LABEL, kindIcon, kindOfDevice, kindOfProvider, type PlayerKind } from "../core/player-kinds";
import { mediaKeysOff, mediaKeysOn, mediaKeysTouch, mediaKeysUpdate } from "../core/media-keys";
import { hour12, language } from "../core/settings";
import { keyed } from "lit/directives/keyed.js";

/**
 * A media player in glass: the album art as the tile's light (blurred behind the glass, its
 * colour tinting the fill), what plays, the controls the player has, a liquid glass volume
 * bar and its speakers – any `media_player` (Sonos, Music Assistant, Apple TV, Cast…).
 *
 *   type: custom:glass-media
 *   entity: media_player.kitchen          # the player
 *   entities: [media_player.kitchen, …]   # or several: it shows the one playing (else the first),
 *                                         #   and they are the speakers to group it with
 *   layout: card                          # card (default) or tile – one pill: art, title, play;
 *                                         #   drag along it for the volume
 *   layout: screen                        #   or screen – the whole view: the cover big over itself
 *                                         #   blurred, the song, the time; a dashboard of its own for a
 *                                         #   kiosk's screensaver
 *   clock: true                           # layout screen: the time and date (default true)
 *   name: Kitchen                         # instead of the player's name
 *   art_background: true                  # the art blurred behind the glass (default true)
 *   speakers: true                        # the speakers drawer (players that can be grouped)
 *   library: true                         # the card (not the tile): the player's library in rows –
 *                                         #   open while nothing plays, down to a handle while it
 *                                         #   does; it scrolls on its own (never the pop-up).
 *                                         #   From the player: Music Assistant's library, Sonos
 *                                         #   favourites; else the player's sources (inputs left out)
 *   music_assistant_url: http://…:8095    # optional, with a token: Music Assistant's home rows and
 *   music_assistant_token: …              #   every playlist's tracks (the token is readable – see docs)
 *   library_close: 8                      # opened while it plays: down after 8 s untouched (0 = stays)
 *   favorites:                            # or your own instead:
 *     - { name: Radio 1, source: Radio 1 }
 *     - { name: Jazz, media_content_id: …, media_content_type: playlist, image: /local/jazz.jpg }
 *   controls_glass: liquid-gl             # the buttons and bars: WebGL liquid glass that bends the
 *                                         #   blurred art under it (dark-liquid-gl at night)
 *
 * Only what the player supports shows (`supported_features`): an Apple TV gets no shuffle,
 * a radio no seeking. With both Sonos and Music Assistant set up, each speaker is there twice:
 * the speakers list keeps one per name, Music Assistant's.
 */

/** MediaPlayerEntityFeature (homeassistant/components/media_player/const.py). */
const F = {
  PAUSE: 1,
  SEEK: 2,
  VOLUME_SET: 4,
  VOLUME_MUTE: 8,
  PREVIOUS: 16,
  NEXT: 32,
  TURN_ON: 128,
  TURN_OFF: 256,
  SELECT_SOURCE: 2048,
  PLAY_MEDIA: 512,
  SEARCH_MEDIA: 4194304,
  BROWSE: 131072,
  STOP: 4096,
  PLAY: 16384,
  SHUFFLE: 32768,
  REPEAT: 262144,
  GROUPING: 524288,
} as const;

/** Something to start at rest: a source of the player (a Sonos favourite / playlist) or any media. */
interface Pick {
  name: string;
  icon?: string;
  /** a cover */
  image?: string;
  /** what it is (media_class): artist, album, playlist, radio… */
  kind?: string;
  /** it can be played / opened (browsed items) */
  play?: boolean;
  expand?: boolean;
  source?: string;
  media_content_id?: string;
  media_content_type?: string;
  /** favorites: the row it goes in (default Favorites) */
  row?: string;
  /** an item of Music Assistant's (its recommendations): played by its uri on a Music Assistant player */
  ma_uri?: string;
  /** Music Assistant's items: the line under the name (the owner, the artists), where it's from
   *  (YouTube Music: a badge on the cover) and, in the top picks, the row it was picked from */
  sub?: string;
  src?: "youtube";
  from?: string;
  /** Music Assistant's item: its id and provider (to read its tracks) */
  ma_item?: { id: string; prov: string };
  /** a track in an opened playlist / album: its length (s), and the playlist it's in (it plays on from it) */
  dur?: number;
  within?: string;
}

/** A row of the library: a recommendation, a library, the favourites… */
interface Section {
  title: string;
  items: Pick[];
  /** where it came from: "all" opens the whole of it */
  cid?: string;
  ctype?: string;
  total?: number;
  /** Music Assistant's rows: drawn as its app draws them (a title, covers with a line under the name);
   *  "picks": its top picks – a big tile and smaller wide ones */
  ma?: "row" | "picks";
  /** Music Assistant's: a line under the row's title, and where the row comes from (its badge) */
  sub?: string;
  src?: "youtube";
}
interface Lib {
  sections: Section[];
}

/** What isn't music: films, TV, videos, pictures (Plex' server-wide rows, its film libraries). */
const NOT_MUSIC = new Set(["movie", "tv_show", "season", "episode", "video", "image", "game", "url", "app"]);
/** Folders not worth a row: all tracks (too many), audiobooks, videos, "continue watching",
 *  a list of speakers to play on (YouTube Music's "Playback device"), moods and genres (folders of folders). */
const SKIP_DIR = /^(tracks|audiobooks|speakers?)$|video|watching|on deck|playback device|moods?\b|genres?\b/i;
/** What a library has that isn't music to pick: YouTube Music Player's own queue (its songs by
 *  their number in it – nothing another player could play). */
const SKIP_TYPE = new Set(["cur_playlists", "PLAYLIST_GOTO_TRACK"]);
/** Row order: what was played, what is new, playlists, favourites, radio, albums, artists. */
function rank(t: string): number {
  const x = t.toLowerCase();
  if (/played/.test(x)) return 0;
  if (/recent|new|added/.test(x)) return 1;
  if (/playlist/.test(x)) return 2;
  if (/favou?rit/.test(x)) return 3;
  if (/radio|station/.test(x)) return 4;
  if (/album/.test(x)) return 5;
  if (/artist|hudba|music/.test(x)) return 6;
  return 7;
}
const KIND_ICON: Record<string, string> = {
  artist: "mdi:account-music",
  album: "mdi:album",
  playlist: "mdi:playlist-music",
  track: "mdi:music-note",
  podcast: "mdi:podcast",
  channel: "mdi:radio",
  music: "mdi:radio",
  directory: "mdi:folder-music",
};
/** What a Music Assistant item is, in words (on its tile in the top picks). */
const KIND_NAME: Record<string, string> = {
  playlist: "Playlist",
  album: "Album",
  track: "Track",
  artist: "Artist",
  radio: "Radio",
  podcast: "Podcast",
  audiobook: "Audiobook",
};

/** Sources that are inputs, not something to play. */
const INPUTS = /^(line[- ]?in|tv|hdmi|optical|spdif|s\/pdif|aux|bluetooth|airplay|music assistant queue|analog|coaxial|phono|usb)\b/i;

interface MediaConfig extends BaseCardConfig {
  /** the player */
  entity?: string;
  /** more players: the card shows the one playing (a tap on the name picks another) */
  entities?: string[];
  /** with more players: move to the one that starts playing (default true); false: always `entity`
   *  – one picked by hand stays while something is on it */
  follow_playing?: boolean;
  name?: string;
  /** card (default), tile – one pill; screen – the whole screen (a kiosk's screensaver) */
  layout?: "card" | "tile" | "screen";
  /** layout screen: the time and the date (default true) */
  clock?: boolean;
  /** all (default): the player with its library; player: the player alone; library: the library alone,
   *  as a card of its own (beside the player, as in a pop-up's two sides) */
  show?: "all" | "player" | "library";
  art_background?: boolean;
  /** the glass the cover's colours light: liquid (light) or dark-liquid; default by day and night
   *  (in a panel: by the panel) */
  art_glass?: "liquid" | "dark-liquid";
  /** the button of the speakers to group with the one shown (default true) */
  speakers?: boolean;
  /** show: all – the player's library (playlists, albums, artists in rows): open while nothing plays,
   *  a handle on top while it does (default true) */
  library?: boolean;
  /** opened while something plays: down again after this many seconds without a touch (default 8; 0 = stays) */
  library_close?: number;
  /** show: all – the library as a sheet over the player (default, its handle on top), or below it */
  library_layout?: "sheet" | "below";
  /** the card as tall as the screen lets it: down to the dock (glass-dock, Bubble Card's buttons) */
  fill_height?: boolean;
  /** your own covers, the first row of the library */
  favorites?: Pick[];
  /** the library of another player for the others (YouTube Music for a Sonos): a tap plays it
   *  through that player on the one picked */
  library_from?: string;
  /** which rows of the library, in this order (their titles); default: all, played and new first */
  library_sections?: string[];
  /** a speaker on a TV's HDMI (a Sonos soundbar): what the TV plays, from these players – the first
   *  one playing (or paused), in this order – while the speaker plays the TV's sound */
  tv_sources?: { speaker?: string; tv?: string; sources: (string | { entity: string; input?: string })[] }[];
  /** Music Assistant's own address (`http://…:8095`) – with a token, the card talks to Music Assistant
   *  itself: its home's rows, every playlist's tracks, each player's kind (optional) */
  music_assistant_url?: string;
  /** a token made in Music Assistant (Settings → profile → tokens) – stored in the dashboard in plain
   *  text: anyone who can read the dashboard's configuration can read it (optional, see the docs) */
  music_assistant_token?: string;
  /** the buttons and bars: real liquid glass over the blurred art (default liquid-gl; dark-liquid-gl at night) */
  controls_glass?: Material;
  controls_color?: string;
  /** the keyboard's media keys (play / pause, next, previous) play on this card's player – also with
   *  the window minimised or the card in a closed pop-up (default false) */
  media_keys?: boolean;
  /** a tap on the cover shows a visualizer in its place – the cover's colours moving to the music
   *  (default true; false: the tap action) */
  visualizer?: boolean;
  tap_action?: ActionConfig;
  hold_action?: ActionConfig;
}

/** The visualizer: on or not, and which look – remembered by the browser, the same in every card. */
const VIZ_KEY = "glass-media-viz";
const vizPref: { on: boolean; style: VizStyle } = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(VIZ_KEY) ?? "{}");
    return {
      on: !!v.on,
      style: VIZ_STYLES.includes(v.style) ? v.style : VIZ_STYLES[0],
    };
  } catch {
    return { on: false, style: VIZ_STYLES[0] };
  }
})();
const vizBus = new EventTarget();
function saveViz() {
  try {
    localStorage.setItem(VIZ_KEY, JSON.stringify(vizPref));
  } catch {
    /* private mode: for this page only */
  }
  vizBus.dispatchEvent(new Event("change"));
}


const supports = (st: HassEntity | undefined, f: number) => !!st && ((Number(st.attributes.supported_features) || 0) & f) === f;
const ACTIVE = new Set(["playing", "paused", "buffering", "on"]);
/** Something is on it – playing or paused: the art at full strength, the look unchanged by a pause. */
const LOADED = new Set(["playing", "paused", "buffering"]);
/** A line too long to show: how fast it drifts, and its drift now (by the element). */
const MARQUEE_PX_S = 32;
const marquees = new WeakMap<HTMLElement, { text: string; w: number; anim?: Animation }>();
const isMA = (st?: HassEntity) => !!st?.attributes.mass_player_type;

/** An item of YouTube Music's library (the YouTube Music Player integration) as Music Assistant's
 *  YouTube Music knows it: a song by its video, a playlist (without YouTube's VL), an album, an artist. */
function ytmUri(pk: { media_content_id?: string; media_content_type?: string; kind?: string }): string | undefined {
  const id = pk.media_content_id;
  if (!id) return undefined;
  const t = pk.media_content_type ?? pk.kind;
  if (t === "track") return `ytmusic://track/${id}`;
  if (t === "playlist") return `ytmusic://playlist/${id.replace(/^VL/, "")}`;
  if (t === "album") return `ytmusic://album/${id}`;
  if (t === "artist") return `ytmusic://artist/${id}`;
  return undefined;
}

/** The player picked by hand, shared by the cards with the same players (a player and its library
 *  beside it): a pick in one shows in all of them. */
interface Chosen {
  id: string;
  at: number;
  /** started from the library: held on this player until it plays what was tapped */
  hold?: number;
  /** what was tapped (its id), and what played before – to tell when it's there */
  pick?: string;
  from?: string;
  /** what its twin in Music Assistant played before (MA tells first) */
  twinFrom?: string;
}
const picks = new Map<string, Chosen>();
/** follow_playing: false – how long a speaker picked by hand stays without anything on it */
const FOLLOW_OFF_MS = 5 * 60000;
/**
 * The player last picked and last shown, per set of players – remembered by the browser, so a card
 * made again (a pop-up opened again, the page reloaded) comes back to the player you used last.
 */
const MEMORY_KEY = "glass-media-players";
const lastShown = new Map<string, string>();
try {
  const m = JSON.parse(localStorage.getItem(MEMORY_KEY) ?? "{}");
  for (const [k, v] of Object.entries<{
    pick?: { id: string; at: number };
    shown?: string;
  }>(m)) {
    if (v?.pick && typeof v.pick.id === "string") picks.set(k, { id: v.pick.id, at: Number(v.pick.at) || 0 });
    if (typeof v?.shown === "string") lastShown.set(k, v.shown);
  }
} catch {
  /* nothing remembered */
}
function rememberPlayers() {
  const m: Record<string, { pick?: { id: string; at: number }; shown?: string }> = {};
  for (const [k, c] of picks) m[k] = { pick: { id: c.id, at: c.at } };
  for (const [k, id] of lastShown) (m[k] ??= {}).shown = id;
  try {
    localStorage.setItem(MEMORY_KEY, JSON.stringify(m));
  } catch {
    /* private mode: for this page only */
  }
}
/** What goes to the player that holds the queue when the shown one plays through it. */
const QUEUE_CALLS = new Set(["media_next_track", "media_previous_track", "shuffle_set", "repeat_set", "media_play", "media_pause", "media_seek"]);
const pickBus = new EventTarget();
/**
 * A speaker paused (or resumed) from the card while its twin in Music Assistant played it: a Sonos
 * playing MA's stream stops at once, but MA may say for a minute more that it plays (it only polls the
 * speaker) and then just idle – so the song stays shown paused, at the second it was paused, until the
 * speaker plays again. Shared by the cards on the same speaker.
 */
const pausedHere = new Map<string, { pos: number; at: number; title?: string; resume?: boolean }>();
/**
 * What a player last said while something was on it, and the song it showed before – to ride out
 * what some say for a moment between two songs (Music Assistant, a Chromecast): idle for a blink,
 * or the old song back once more after the new one showed. Shared by the cards on the same player.
 */
/**
 * Paused – from a card or anywhere: Music Assistant says idle, never paused (a Sonos playing its stream
 * stops: idle, without even the title) – the song stays shown paused, at the second it stopped, with
 * play to go on, until the player plays again, another song comes, it goes off or an hour passes.
 * Idle at a song's end (the queue over) is idle. Shared by the cards.
 */
const heldPause = new Map<string, { title?: string; at: number; pos?: number; snap: HassEntity }>();
const HELD_MS = 3600000;

/** A held song to look at again (cards re-render). */
const steadyBus = new EventTarget();
const steadyMem = new Map<string, SteadyMem>();
/** When next or previous was last pressed on a player: the song changing then is what was asked for. */
const skipAt = new Map<string, number>();
const STEADY_MS = 4000;
/** After next / previous: idle this long is still the way to the next song. */
const SKIP_MS = 20000;
/** How long a twin may say idle between two songs: longer just after next / previous. */
function betweenMs(sonos: boolean, ...ids: string[]): number {
  return sonos && ids.some((i) => Date.now() - (skipAt.get(i) ?? 0) < SKIP_MS) ? SKIP_MS : 8000;
}
/** A song shown less than this long ago: another one has to hold HOLD_MS before it shows. */
const CALM_MS = 8000;
const HOLD_MS = 1500;

/**
 * A Sonos (on Music Assistant's stream) and the rest (a Chromecast…) go their own ways between two
 * songs: a Sonos says idle up to ~20 s after next while it loads the song; a Chromecast blinks idle.
 */
function steady(st: HassEntity | undefined, sonos = false): HassEntity | undefined {
  if (!st) return st;
  const id = st.entity_id;
  let m = steadyMem.get(id);
  if (!m) steadyMem.set(id, (m = { lastAt: 0, replacedAt: 0 }));
  const now = Date.now();
  const title = st.attributes.media_title;
  const held = heldPause.get(id);
  // playing again since (not still playing as it was when pause was pressed), another song, off
  const since = Date.parse(st.last_changed) > held?.at!;
  if (held && (((st.state === "playing" || st.state === "buffering") && since) || st.state === "off" || st.state === "unavailable" || (title && title !== held.title) || now - held.at > HELD_MS))
    heldPause.delete(id);
  if (LOADED.has(st.state)) {
    m.idle = undefined;
    const lt = m.last?.attributes.media_title;
    // Music Assistant (on a Sonos, a Chromecast) says another song for a blink in the seconds after a
    // change – the old one, one from elsewhere in the queue – and then the right one again. A change
    // shows at once when next / previous was pressed for it or after a calm while (a song ending);
    // one soon after another change only once it has held a moment
    if (m.last && title && lt && title !== lt) {
      const asked = (skipAt.get(id) ?? 0) > m.replacedAt;
      if (!asked && now - m.replacedAt < CALM_MS) {
        let pend = m.pending;
        if (!pend || pend.title !== title) pend = m.pending = { title, since: now };
        if (now - pend.since < HOLD_MS) {
          // looked at again once it could have held (no new state may come to ask)
          window.setTimeout(() => steadyBus.dispatchEvent(new Event("check")), HOLD_MS + 50);
          return m.last;
        }
      }
    }
    m.pending = undefined;
    if (lt && title && lt !== title) ((m.prevTitle = lt), (m.replacedAt = now));
    m.last = st;
    m.lastAt = now;
    return st;
  }
  // idle for a blink (between two songs, after a seek): what it said last, a few seconds more – its
  // time stopped where it went idle (the last song over: no time running on)
  // how long a blink may be: a few seconds – after next / previous longer (MA on a Sonos says idle
  // up to ~20 s while it loads the song), counted from when it went idle, not from the last render
  const went = Date.parse(st.last_changed) || now;
  if (sonos) {
    const r = sonosBetween(st, m, id, title, went, now);
    if (r) return r;
  } else if (st.state === "idle" && m.last && now - m.lastAt < STEADY_MS) {
    // the rest (a Chromecast): a blink, counted from what it last said while on
    if (!m.idle) {
      const a = m.last.attributes;
      const p = Number(a.media_position);
      const at = Date.parse(a.media_position_updated_at ?? "");
      const dur = Number(a.media_duration) || Infinity;
      m.idle = { at: now, pos: Number.isFinite(p) ? Math.min(dur, p + (m.last.state === "playing" && Number.isFinite(at) ? (now - at) / 1000 : 0)) : undefined };
      const lt = a.media_title;
      const inside = m.idle.pos === undefined || dur === Infinity || m.idle.pos < dur - 5;
      if (!heldPause.has(id) && lt && (!title || title === lt) && inside) heldPause.set(id, { title: lt, at: now, pos: m.idle.pos, snap: m.last });
    }
    return { ...m.last, attributes: { ...m.last.attributes, media_position: m.idle.pos, media_position_frozen: true } } as HassEntity;
  }
  return heldOrAsTold(st, m, id, title, went, now, sonos);
}

type SteadyMem = { last?: HassEntity; lastAt: number; prevTitle?: string; replacedAt: number; pending?: { title: string; since: number }; idle?: { at: number; pos?: number } };

/** A Sonos idle between two songs (after next: up to SKIP_MS), counted from when it went idle. */
function sonosBetween(st: HassEntity, m: SteadyMem, id: string, title: string | undefined, went: number, now: number): HassEntity | undefined {
  const skipped = (skipAt.get(id) ?? 0) > went - 5000 && now - (skipAt.get(id) ?? 0) < SKIP_MS;
  if (st.state === "idle" && m.last && now - went < (skipped ? SKIP_MS : STEADY_MS)) {
    const lt = m.last.attributes.media_title;
    // the queue moved on (next): the new song already named – shown, on its way, from its start
    if (title && lt && title !== lt) {
      heldPause.delete(id);
      return { ...st, state: m.last.state, attributes: { ...st.attributes, media_position: 0, media_position_updated_at: new Date(now).toISOString(), media_position_frozen: true } } as HassEntity;
    }
    if (skipped) {
      heldPause.delete(id);
      return { ...m.last, attributes: { ...m.last.attributes, media_position_frozen: true } } as HassEntity;
    }
    if (!m.idle) {
      const a = m.last.attributes;
      const p = Number(a.media_position);
      const at = Date.parse(a.media_position_updated_at ?? "");
      const dur = Number(a.media_duration) || Infinity;
      m.idle = { at: went, pos: Number.isFinite(p) ? Math.min(dur, p + (m.last.state === "playing" && Number.isFinite(at) ? Math.max(0, went - at) / 1000 : 0)) : undefined };
      // stopped inside the song (not at its end), the same song or none named: paused there
      const lt = a.media_title;
      const inside = m.idle.pos === undefined || dur === Infinity || m.idle.pos < dur - 5;
      if (!heldPause.has(id) && lt && (!title || title === lt) && inside) heldPause.set(id, { title: lt, at: went, pos: m.idle.pos, snap: m.last });
    }
    return { ...m.last, attributes: { ...m.last.attributes, media_position: m.idle.pos, media_position_frozen: true } } as HassEntity;
  }
  return undefined;
}

/** Paused (MA says idle): held at the second it stopped; else the state as told. */
function heldOrAsTold(st: HassEntity, m: SteadyMem, id: string, title: string | undefined, went: number, now: number, sonos: boolean): HassEntity {
  let h = heldPause.get(id);
  // idle on first sight (a page opened after the pause – a kiosk's screensaver): stopped inside the
  // song by what it last told – where it was, counted on to when it went idle – paused too
  if (!h && st.state === "idle" && title) {
    const a = st.attributes;
    const dur = Number(a.media_duration);
    const p = Number(a.media_position);
    const upd = Date.parse(a.media_position_updated_at ?? "");
    if (dur > 0 && Number.isFinite(p) && now - went < HELD_MS) {
      const pos = Math.max(0, p + (Number.isFinite(upd) && went > upd ? (went - upd) / 1000 : 0));
      if (pos < dur - 5) heldPause.set(id, (h = { title, at: went, pos, snap: st }));
    }
  }
  if (h && (st.state === "idle" || st.state === "paused")) {
    if (st.state === "paused" && title) return st;
    return {
      ...h.snap,
      state: "paused",
      attributes: {
        ...h.snap.attributes,
        volume_level: st.attributes.volume_level ?? h.snap.attributes.volume_level,
        is_volume_muted: st.attributes.is_volume_muted ?? h.snap.attributes.is_volume_muted,
        group_members: st.attributes.group_members ?? h.snap.attributes.group_members,
        media_position: h.pos,
        media_position_updated_at: new Date(h.at).toISOString(),
        media_position_frozen: true,
      },
    } as HassEntity;
  }
  // a Sonos with nothing on it: what it said before is no blink to ride out any more
  if (sonos && !LOADED.has(st.state)) m.last = undefined;
  return st;
}

/** A picture's address as a CSS url() – its quotes, backslashes and line breaks escaped, so an
 *  address from a player's attributes can't end the url() and add CSS of its own. */
/**
 * Pictures loaded before they show: a cover appears whole once it's there (never drawn row by row
 * as it comes), and one that fails (an Apple TV's art gone with its pause) shows as none.
 */
const artLoad = new Map<string, "ok" | "fail" | Promise<void>>();
/** a programme's channel found by a TV guide's search (played from a recording), by its title */
const channelFound = new Map<string, { name: string; picture?: string } | null>();
/** each loaded picture's width / height (a TV's 16:9 frame, a 2:3 poster) */
const artRatio = new Map<string, number>();
const artWaiters = new Set<() => void>();
function artReady(url: string): "ok" | "fail" | "wait" {
  const got = artLoad.get(url);
  if (got === "ok" || got === "fail") return got;
  if (!got) {
    const img = new Image();
    const done = (r: "ok" | "fail") => {
      artLoad.set(url, r);
      for (const w of artWaiters) w();
    };
    artLoad.set(
      url,
      new Promise<void>((res) => {
        img.onload = () => (artRatio.set(url, img.naturalWidth / (img.naturalHeight || 1)), done("ok"), res());
        img.onerror = () => (done("fail"), res());
      }),
    );
    img.src = url;
  }
  return "wait";
}

function cssUrl(u: string): string {
  return `url("${String(u).replace(/["\\\n\r\f]/g, (c) => encodeURIComponent(c))}")`;
}

/** Where in the song MA's stream to a speaker began (a resume, a seek): the speaker counts from there. */
const streamBase = new Map<string, { url: string; base: number }>();

/** The art's colour: a weighted average of its saturated pixels (same-origin pictures only). */
/** The art's accent colour and its average lightness (0–1), for the text over it. */
interface ArtTone {
  color: string;
  light: number;
}
const artColors = new Map<string, Promise<ArtTone | undefined>>();
function artColor(url: string): Promise<ArtTone | undefined> {
  let p = artColors.get(url);
  if (p) return p;
  p = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = c.height = 24;
        const g = c.getContext("2d", { willReadFrequently: true })!;
        g.drawImage(img, 0, 0, 24, 24);
        const d = g.getImageData(0, 0, 24, 24).data;
        let r = 0,
          gr = 0,
          b = 0,
          w = 0,
          lum = 0;
        for (let i = 0; i < d.length; i += 4) {
          const mx = Math.max(d[i], d[i + 1], d[i + 2]);
          const mn = Math.min(d[i], d[i + 1], d[i + 2]);
          // colourful, neither black nor white, counts most
          const wt = 0.05 + ((mx - mn) / 255) ** 2 * (mx > 40 && mn < 235 ? 1 : 0.1);
          r += d[i] * wt;
          gr += d[i + 1] * wt;
          b += d[i + 2] * wt;
          w += wt;
          lum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
        }
        resolve({
          color: `rgb(${Math.round(r / w)}, ${Math.round(gr / w)}, ${Math.round(b / w)})`,
          light: lum / (d.length / 4),
        });
      } catch {
        resolve(undefined); // another origin without CORS
      }
    };
    img.onerror = () => resolve(undefined);
    img.src = url;
  });
  artColors.set(url, p);
  return p;
}

/** A listener that never blocks scrolling: the browser scrolls at once, without waiting for it (a busy
 *  page – a visualizer drawing, liquid glass – would otherwise hold the wheel and the finger back). */
const passive = (fn: (e: Event) => void) => ({
  handleEvent: fn,
  passive: true,
});

const fmt = (s: number) => {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};

class GlassMedia extends GlassElement<MediaConfig> {
  static override parts = MEDIA_PARTS;
  static getConfigElement() {
    return makeEditor(mediaSpec);
  }

  static getStubConfig(hass: HomeAssistant) {
    const ids = Object.keys(hass.states).filter((e) => e.startsWith("media_player."));
    const playing = ids.find((e) => hass.states[e].state === "playing");
    return {
      entity: playing ?? ids.find((e) => hass.states[e].state !== "unavailable") ?? ids[0] ?? "",
    };
  }

  constructor() {
    super();
    new LiquidController(this, ".frame");
    // touched: the media keys go to this card (with more than one card asking for them)
    this.addEventListener("pointerdown", () => mediaKeysTouch(this));
  }

  /** The WebGL glass of the buttons and bars bends the blurred art behind them. */
  protected override glassUnder(el: HTMLElement): Element | undefined {
    // layout screen: its own blurred cover
    return el.closest(".frame")?.querySelector(".bg") ?? el.closest(".screen")?.querySelector(".sbgi") ?? undefined;
  }

  /** The material of the buttons and bars: clear liquid glass by day, dark at night. */
  /** Dark glass under the cover's colours: as set (art_glass), else by night – or by the panel. */
  private _artDark(): boolean {
    if (this._config.layout === "screen") return true;
    const g = this._config.art_glass;
    if (g) return g === "dark-liquid";
    // the card's own glass dark (or the panel's it takes): its buttons dark too
    return this.nightNow() || this.getAttribute("glass") === "dark-liquid" || (this._inPanel() && this._panelCtl() === "dark-liquid");
  }

  private _ctl() {
    const panel = this._inPanel() ? this._panelCtl() : undefined;
    const art = this._config.art_background !== false && !!this._art;
    const m = this._config.controls_glass ?? (panel && !art && !this._config.art_glass ? panel : this._artDark() ? "dark-liquid-gl" : "liquid-gl");
    return (
      matPart(m, this._config.controls_color, m) ?? {
        cls: "control",
        style: "",
      }
    );
  }

  /** In a panel (a pop-up's side): on the panel's own glass. */
  private _inPanel() {
    return this.hasAttribute("nested") && !this.hasAttribute("on-bare");
  }
  /** The panel it lies in (across the shadow roots), to spread the blurred art over it. */
  private _panelEl(): HTMLElement | undefined {
    let n: Node | null = this;
    for (let i = 0; i < 12 && n; i++) {
      n = (n as HTMLElement).parentElement ?? ((n.getRootNode() as ShadowRoot).host as Node | undefined) ?? null;
      if (n && (n as HTMLElement).tagName === "GLASS-PANEL") {
        const inner = (n as HTMLElement).shadowRoot?.querySelector<HTMLElement>(".panel");
        return inner ?? (n as HTMLElement);
      }
    }
    return undefined;
  }
  /** The buttons on a panel: glass of the panel's kind (no WebGL glass over its WebGL glass) –
   *  dark under light text, light under dark text. */
  private _panelCtl(): Material {
    const m = /(\d+)\D+(\d+)\D+(\d+)/.exec(getComputedStyle(this).color);
    const light = m ? (Number(m[1]) * 0.3 + Number(m[2]) * 0.59 + Number(m[3]) * 0.11) / 255 : 1;
    return light > 0.6 ? "dark-liquid" : "liquid";
  }

  private _ids: string[] = [];
  /** Bars being dragged (not just tapped). */
  private _moved = new Set<string>();
  /** A dragged value (0–1) per bar – volume of a player, or the position – shown at once. */
  private _drag = new Map<string, number>();
  private _sendTimer = new Map<string, number>();
  /** A volume sent but not reported back yet. */
  private _pending = new Map<string, number>();
  private _tick?: number;
  private _open = false;
  private _art?: string;
  private _color?: string;
  /** The art's average lightness (before the background's filter). */
  private _light?: number;

  protected override validateConfig(c: MediaConfig) {
    this._ids = [...new Set([c.entity, ...(c.entities ?? [])].filter((e): e is string => !!e))];
    this._lib.clear();
    this._stack = [];
    if (!this._ids.length) throw new Error("`entity` needs a media player");
    return c;
  }

  protected watchedEntities() {
    // the speakers list: every grouping player of the main one's kind
    const from = this._config?.library_from ? [this._config.library_from] : [];
    return this._config?.speakers === false ? [...this._ids, ...from] : [...this._ids, ...from, ...this._speakerIds()];
  }

  /**
   * The shown player's state – what it plays told by the player it plays through, if any (a Sonos
   * playing YouTube Music's stream knows only the stream's address: the title, artist, cover,
   * position and modes come from YouTube Music; the volume stays the speaker's).
   */
  private _shownState(id = this._main()): HassEntity | undefined {
    const sonos = this._kind(id) === "sonos";
    const st = steady(this.stateOf(id), sonos);
    const via = this._via(id);
    // the TV's sound, but none of its devices plays: nothing playing (not the soundbar's "TV Audio")
    if (!via && st && this._tvSet(id)) {
      const attrs: Record<string, unknown> = { ...st.attributes };
      for (const k of ["media_title", "media_artist", "media_album_name", "entity_picture", "entity_picture_local", "media_duration", "media_position", "app_name"]) delete attrs[k];
      return { ...st, state: "idle", attributes: attrs } as HassEntity;
    }
    let v = via ? this.stateOf(via) : undefined;
    const keys = [
      "media_title",
      "media_artist",
      "media_album_name",
      "media_album_artist",
      "entity_picture",
      "entity_picture_local",
      "media_image_url",
      "media_duration",
      "media_position",
      "media_position_updated_at",
      "media_content_id",
      "media_content_type",
      "media_series_title",
      "media_season",
      "media_episode",
      "app_name",
      "shuffle",
      "repeat",
    ];
    // played by its twin in Music Assistant: MA knows first what plays (a speaker of its own
    // integration may only poll it) and where in the song it is (the speaker counts from the start
    // of MA's stream, and a seek starts a new one) – so its song, art, time, shuffle and repeat show
    let ph = pausedHere.get(id);
    // a new stream from MA: where in the song it starts (resumed, sought – else the song's start)
    const url = String(st?.attributes.media_content_id ?? "");
    if (/^https?:/.test(url) && streamBase.get(id)?.url !== url) {
      const sk = this._seek;
      streamBase.set(id, {
        url,
        base: ph?.resume ? ph.pos : sk && sk.id === id && Date.now() - sk.at < 30000 ? sk.pos : 0,
      });
    }
    if (ph && st && st.state === "playing" && Date.parse(st.last_changed) > ph.at) (pausedHere.delete(id), (ph = undefined));
    else if (ph?.resume && Date.now() - ph.at > 25000) (pausedHere.delete(id), (ph = undefined));
    let fromTwin = false;
    if (!v && st) {
      const twin = this._twinPlays(id);
      if (twin) {
        fromTwin = true;
        const t = steady(this.stateOf(twin), sonos);
        // paused here: its song, whatever MA says meanwhile (playing a while more, then idle)
        if (ph && t && t.attributes.media_title === ph.title) v = t;
        // a moment idle between two songs: what it said last, so the time doesn't jump; idle for
        // longer (MA let go of it – it joined a group, was played from its own app): the speaker's own
        else if (t && LOADED.has(t.state)) {
          this._twinLast.set(twin, t);
          v = t;
        } else if (t && Date.now() - Date.parse(t.last_changed) < betweenMs(this._kind(id) === "sonos", id, twin)) v = this._twinLast.get(twin);
      }
    }
    if (st && !v && fromTwin && st.state === "playing") {
      // MA slow to tell (it may poll the speaker for a minute): the speaker's own, counted from where
      // MA's stream began
      const base = streamBase.get(id)?.base ?? 0;
      const pos = Number(st.attributes.media_position);
      if (base && Number.isFinite(pos))
        return {
          ...st,
          attributes: { ...st.attributes, media_position: pos + base },
        } as HassEntity;
    }
    if (!st || !v) return st;
    const a = v.attributes;
    const attrs: Record<string, unknown> = { ...st.attributes };
    const tv = via !== undefined && via === this._tvVia(id);
    if (tv) {
      // the TV's: none of the speaker's own "TV Audio" – what plays there, or which device it is
      for (const k of keys) delete attrs[k];
      attrs.media_title = a.media_title ?? a.media_series_title ?? a.app_name ?? a.source ?? v.attributes.friendly_name;
      // live TV in an app (SledovaniTV): which channel shows it now, by a TV guide in Home Assistant
      const ch = a.media_title ? this._channelOf(String(a.media_title)) : undefined;
      if (ch?.picture) attrs.glass_logo = ch.picture;
      // under it: the channel, the series, the app – never the title again (only an app: the device)
      const under = [ch?.name, a.media_artist, a.media_title && a.media_series_title, a.app_name, a.source, v.attributes.friendly_name];
      attrs.media_artist = under.find((x) => x && x !== attrs.media_title);
      attrs.glass_tv = true;
    }
    for (const k of keys) if (k in a && !(tv && (k === "media_title" || k === "media_artist"))) attrs[k] = a[k];
    // what the queue can do (next, previous, shuffle, repeat) is the source's – on the TV, play and
    // pause too (a PlayStation has none: no button)
    const q = F.NEXT | F.PREVIOUS | F.SHUFFLE | F.REPEAT | F.SEEK | (tv ? F.PAUSE | F.PLAY : 0);
    attrs.supported_features = ((Number(st.attributes.supported_features) || 0) & ~q) | ((Number(a.supported_features) || 0) & q);
    // a twin between two songs is idle for a moment: the speaker's state then
    let state = LOADED.has(v.state) ? v.state : st.state;
    if (fromTwin && ph && v.attributes.media_title === ph.title) {
      // paused here (or resumed, on its way): as pressed, from the second it was paused
      state = ph.resume ? "playing" : "paused";
      attrs.media_position = ph.pos;
      attrs.media_position_updated_at = new Date(ph.at).toISOString();
    } else if (
      fromTwin &&
      state === "playing" &&
      st.state !== "playing" &&
      Date.parse(st.last_changed) > Date.parse(v.last_changed) &&
      Date.now() - Date.parse(st.last_changed) > 12000
    ) {
      // paused elsewhere (the Sonos app): the speaker stopped after MA last said it plays – longer
      // than between two songs
      state = "paused";
    }
    return { ...st, state, attributes: attrs } as HassEntity;
  }

  /** Whose library shows: the shown player's – or library_from's for the other players. */
  private _libId(): string {
    return this._config.library_from ?? this._main();
  }

  /** The player another one plays through (YouTube Music on this speaker): it holds the queue, so
   *  next, previous, shuffle, repeat, play and pause go to it. */
  private _via(id: string): string | undefined {
    const s = this._hass?.states;
    if (!s) return undefined;
    const cands = [...this._ids, ...(this._config.library_from ? [this._config.library_from] : [])];
    return cands.find((c) => c !== id && s[c]?.attributes.remote_player_id === id && ACTIVE.has(s[c]?.state ?? "")) ?? this._tvVia(id);
  }

  /**
   * A soundbar playing the TV's sound (its input: TV, HDMI): the player that plays on the TV – of
   * its tv_sources the one that changed last (an Apple TV, Plex on it, a PlayStation), or one listed
   * before it playing the same (Plex: the poster). Its title,
   * picture and time show; play, pause and skips go to it; the volume stays the speaker's.
   */
  /** The speaker's tv_sources while it plays the TV's sound (its input: TV, HDMI). */
  private _tvSet(id: string) {
    const list = this._config.tv_sources;
    const s = this._hass?.states;
    if (!list?.length || !s) return undefined;
    const st = s[id];
    const a = st?.attributes ?? {};
    if (!LOADED.has(st?.state ?? "") || !(a.app_id === "tv" || /^(tv|hdmi)/i.test(String(a.source ?? "")))) return undefined;
    // its own list – by the speaker, or by its twin (the Sonos' own entity and Music Assistant's)
    const tw = this._twins.get(id);
    return list.find((t) => {
      const sp = t.speaker ?? this._ids[0];
      return sp === id || sp === tw || this._twins.get(sp) === id;
    });
  }

  private _tvVia(id: string): string | undefined {
    const s = this._hass?.states;
    const set = this._tvSet(id);
    if (!set || !s) return undefined;
    let pool = (set.sources ?? []).map((x) => (typeof x === "string" ? { entity: x } : x)).filter((x) => x?.entity);
    // the TV knows which input is on screen (an LG: "PS5", "Apple TV"): only the devices on it – a
    // PlayStation may say for an hour it plays the same game, an Apple TV stays paused behind it
    const tv = set.tv ? s[set.tv] : undefined;
    const input = tv && ACTIVE.has(tv.state) ? String(tv.attributes.source ?? "").toLowerCase() : "";
    if (input && pool.some((x) => x.input)) {
      const here = pool.filter((x) => x.input?.toLowerCase() === input);
      // another input (an app of the TV itself: Netflix, YouTube): the TV is what plays
      if (!here.length) return set.tv;
      pool = here;
    }
    // listed before a device on the same input (Plex before the Apple TV): it only tells better what
    // that device plays – never on its own (Plex may say "playing" for hours after you closed it)
    const detail = (x: { entity: string; input?: string }, i: number) => !!x.input && pool.slice(i + 1).some((y) => y.input === x.input);
    const details = pool.filter(detail).map((x) => x.entity).filter((x) => LOADED.has(s[x]?.state ?? ""));
    // what an app on screen plays or holds paused (YouTube paused: still YouTube) – the home screen
    // or an app's own menu (idle, or nothing in it) is nothing playing
    const on = pool.filter((x, i) => !detail(x, i)).map((x) => x.entity).filter((x) => LOADED.has(s[x]?.state ?? ""));
    if (!on.length) return undefined;
    // what's on the TV: the one that changed last – started, paused, another app (Plex keeps saying
    // "playing" long after you moved on to another app or the PlayStation, but it doesn't change)
    const changed = (x: string) => Date.parse(s[x].last_changed) || 0;
    const lead = on.reduce((a, b) => (changed(b) > changed(a) ? b : a));
    // only an app open, nothing in it (the Apple TV "paused" in Infuse's menu): nothing plays – and
    // nothing older shows instead (it was left behind)
    if (!s[lead].attributes.media_title && !s[lead].attributes.media_series_title) return undefined;
    // the same thing told better by one listed before it (Plex on the Apple TV: the poster)
    const words = (x: string) =>
      [s[x].attributes.media_title, s[x].attributes.media_series_title, s[x].attributes.media_artist]
        .filter((w): w is string => typeof w === "string" && w.trim().length > 2)
        .map((w) => w.toLowerCase().trim());
    const same = (x: string) => {
      const a = words(x);
      const b = words(lead);
      return a.some((w) => b.some((v) => v.includes(w) || w.includes(v)));
    };
    return [...details, ...on.slice(0, on.indexOf(lead))].find(same) ?? lead;
  }

  /**
   * The channel showing a programme now, by a TV guide in Home Assistant (an EPG integration: a
   * sensor per channel with its channel_name and current_title) – the app tells only the programme.
   */
  private _channelOf(title: string): { name: string; picture?: string } | undefined {
    const s = this._hass?.states;
    if (!s) return undefined;
    const norm = (t: string) =>
      t
        .toLowerCase()
        .replace(/\(.*?\)|\[.*?\]/g, " ")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
    const want = norm(title);
    if (want.length < 3) return undefined;
    const alike = (t: string) => t.length >= 3 && (t === want || (Math.min(t.length, want.length) >= 6 && (t.startsWith(want) || want.startsWith(t))));
    for (const e of Object.values(s)) {
      const a = e.attributes;
      if (typeof a.channel_name !== "string" || typeof a.current_title !== "string") continue;
      // its programme on air now: the next one once the current one ended (a guide may refresh rarely)
      const ended = Date.parse(String(a.current_stop ?? "").replace(" ", "T")) < Date.now();
      const onAir = ended && typeof a.next_title === "string" ? a.next_title : a.current_title;
      const now = norm(onAir);
      if (!alike(now)) continue;
      const logo = [a.entity_picture, a.logo_url].find((u) => typeof u === "string" && /^(https?:|\/)/.test(u)) as string | undefined;
      return { name: a.channel_name, picture: logo };
    }
    // not on air now (played from a recording): the guide's own search, once per title – what it
    // aired before (an EPG integration with an epg/search command)
    const got = channelFound.get(want);
    if (got !== undefined) return got ?? undefined;
    channelFound.set(want, null);
    const q = title.replace(/\(.*?\)|\[.*?\]/g, " ").trim();
    this._hass
      ?.callWS<{ results?: { channel_id?: string; title?: string; start?: string }[] }>({ type: "epg/search", query: q, days: 1 })
      .then((r) => {
        const now = Date.now();
        const hit = (r?.results ?? [])
          .filter((x) => x.title && alike(norm(x.title)) && Date.parse(String(x.start ?? "").replace(" ", "T")) <= now)
          .pop();
        if (!hit?.channel_id) return;
        const sensor = Object.values(this._hass?.states ?? {}).find((e) => String(e.attributes.channel_id) === String(hit.channel_id) && typeof e.attributes.channel_name === "string");
        if (!sensor) return;
        const pic = [sensor.attributes.entity_picture, sensor.attributes.logo_url].find((u) => typeof u === "string" && /^(https?:|\/)/.test(u)) as string | undefined;
        channelFound.set(want, { name: sensor.attributes.channel_name, picture: pic });
        this.requestUpdate();
      })
      .catch(() => undefined);
    return undefined;
  }

  /**
   * A speaker's twin in Music Assistant (the same speaker, as Music Assistant's player): the same
   * unique id in the entity registry (a Sonos' RINCON_…), else the same name. Music Assistant plays
   * YouTube Music's library on it; the card keeps showing the speaker's own (quicker) entity.
   */
  private _twins = new Map<string, string | null>();
  private async _twin(id: string): Promise<string | undefined> {
    if (this._twins.has(id)) return this._twins.get(id) ?? undefined;
    const hass = this._hass;
    if (!hass) return undefined;
    const mas = Object.values(hass.states)
      .filter((x) => x.entity_id.startsWith("media_player.") && isMA(x))
      .map((x) => x.entity_id);
    let twin: string | undefined;
    try {
      const list = await hass.callWS<{ entity_id: string; unique_id?: string }[] | Record<string, { unique_id?: string } | null>>({
        type: "config/entity_registry/get_entries",
        entity_ids: [id, ...mas],
      });
      const entries = Array.isArray(list)
        ? list
        : Object.entries(list).map(([entity_id, e]) => ({
            entity_id,
            unique_id: e?.unique_id,
          }));
      const uid = entries.find((e) => e.entity_id === id)?.unique_id;
      if (uid) twin = entries.find((e) => e.entity_id !== id && e.unique_id === uid && mas.includes(e.entity_id))?.entity_id;
    } catch {
      /* not an admin: by name */
    }
    if (!twin) {
      const name = hass.states[id]?.attributes.friendly_name;
      // never itself (a Music Assistant player has no twin)
      twin = name ? mas.find((m) => m !== id && hass.states[m]?.attributes.friendly_name === name) : undefined;
    }
    this._twins.set(id, twin ?? null);
    return twin;
  }

  /** The player that holds the queue of what the shown one plays: the one it plays through
   *  (YouTube Music), or its twin in Music Assistant when that one plays it. */
  private _queueVia(id: string): string | undefined {
    return this._via(id) ?? this._twinPlays(id);
  }

  /** The speaker's twin in Music Assistant, when it plays the twin's queue: MA plays, or the
   *  speaker plays MA's stream (between two songs MA says idle for a moment). */
  private _twinPlays(id: string): string | undefined {
    const twin = this._twins.get(id);
    const s = this._hass?.states;
    const t = twin ? s?.[twin] : undefined;
    const st = s?.[id];
    if (!t || !st || !t.attributes.media_title) return undefined;
    if (t.attributes.app_id !== "music_assistant" && t.attributes.source !== "Music Assistant Queue") return undefined;
    const fromMA = /^https?:/.test(String(st.attributes.media_content_id ?? ""));
    // between two songs both may say idle for a moment (the speaker's stream ended, MA starts the
    // next one): still on, a few seconds after MA last played
    const just = this._twinLast.has(twin!) && Date.now() - Date.parse(t.last_changed) < betweenMs(this._kind(id) === "sonos", id, twin!);
    // paused from the card: MA soon says idle, the speaker stopped – still its song, played by MA
    const ph = pausedHere.get(id);
    const held = !!ph && ph.title === t.attributes.media_title && st.state !== "playing";
    const on = held || (fromMA ? LOADED.has(t.state) || LOADED.has(st.state) || just : t.state === "playing" || (LOADED.has(t.state) && st.state !== "playing"));
    return on ? (twin ?? undefined) : undefined;
  }
  /** What the twin said last while it played (its time, between two songs). */
  private _twinLast = new Map<string, HassEntity>();

  /** The player shown: the one playing (a group's leader), else the first. */
  private _main(): string {
    const s = this._hass?.states;
    if (!s || this._ids.length === 1) return this._ids[0];
    // a card made again: the player it showed last
    this._shown ??= lastShown.get(this._linkKey);
    const was = this._shown;
    const id = this._pickMain(s);
    if (id !== was) {
      lastShown.set(this._linkKey, id);
      rememberPlayers();
    }
    return id;
  }

  private _pickMain(s: Record<string, HassEntity>): string {
    const shown = this._shown && this._ids.includes(this._shown) ? s[this._shown] : undefined;
    const since = (id: string) => Date.parse(s[id]?.last_changed ?? "") || 0;
    // something on it – playing or paused (a Sonos paused from the card says idle: see pausedHere)
    const loaded = (id: string) => LOADED.has(s[id]?.state ?? "") || pausedHere.has(id) || heldPause.has(id);
    // picked by hand: it stays until another one starts playing after the pick
    // a player that plays through another (YouTube Music on a speaker): that speaker is never
    // the one to move to – it plays the same thing
    const relays = new Set(this._ids.map((id) => s[id]?.attributes.remote_player_id).filter(Boolean));
    const ch = picks.get(this._linkKey) ?? this._chosen;
    // its own player first (a kitchen's tablet: the kitchen): another one only while picked by hand
    // – started from the library, something on it, or picked a moment ago (to look around)
    if (this._config.follow_playing === false) {
      const keep = ch && ch.id !== this._ids[0] && this._ids.includes(ch.id) && (this._busy(ch) || loaded(ch.id) || Date.now() - ch.at < FOLLOW_OFF_MS);
      return (this._shown = keep ? ch.id : this._ids[0]);
    }
    if (ch && this._ids.includes(ch.id)) {
      // started from the library: it stays on that player while it gets there (on the way it
      // may say off, idle – YouTube Music switches its speaker off and on)
      if (this._busy(ch)) return (this._shown = ch.id);
      // another one started playing after the pick – and the picked one has nothing on it (paused,
      // it stays: you come back to it)
      const newer = this._ids.find((id) => id !== ch.id && !relays.has(id) && s[id]?.state === "playing" && since(id) > ch.at && !loaded(ch.id));
      if (!newer) return (this._shown = ch.id);
      this._chosen = undefined;
      if (picks.get(this._linkKey) === ch) (picks.delete(this._linkKey), rememberPlayers());
      return (this._shown = newer);
    }
    // stays with the player it shows while that one is on (paused too: play must stay at hand),
    // and moves to another only when that one started playing after it
    // its speaker plays (YouTube Music between two songs, its speaker switched off and on): it
    // stays – what the speaker plays is its music
    const relay = shown?.attributes.remote_player_id as string | undefined;
    if (shown && relay && s[relay]?.state === "playing") return shown.entity_id;
    // between two songs (idle a moment after next) or paused (MA says idle): still on
    if (shown && (ACTIVE.has(shown.state) || pausedHere.has(shown.entity_id) || (this._kind(shown.entity_id) === "sonos" && LOADED.has(steady(shown, true)?.state ?? "")))) {
      const newer = this._ids.find(
        (id) => id !== shown.entity_id && !relays.has(id) && s[id]?.state === "playing" && since(id) > since(shown.entity_id) && !loaded(shown.entity_id),
      );
      this._shown = newer ?? shown.entity_id;
    } else {
      this._shown =
        this._ids.find((id) => !relays.has(id) && s[id]?.state === "playing") ??
        this._ids.find((id) => s[id]?.state === "playing") ??
        this._ids.find((id) => ACTIVE.has(s[id]?.state ?? "")) ??
        this._ids[0];
    }
    return this._shown;
  }
  private _shown?: string;
  /** The player picked in the card's list of players. */
  private _chosen?: Chosen;

  private _busyOn(id: string) {
    const ch = picks.get(this._linkKey) ?? this._chosen;
    return ch?.id === id && this._busy(ch);
  }

  /** Started from the library and not playing it yet: a spinner, and the card stays on it. */
  private _busy(ch: Chosen | undefined = picks.get(this._linkKey) ?? this._chosen): boolean {
    if (!ch?.hold || Date.now() > ch.hold) return false;
    const st = this._hass?.states[ch.id];
    const now = st?.attributes.media_content_id ?? st?.attributes.media_title;
    const tw = this._twins.get(ch.id);
    const ts = tw ? this._hass?.states[tw] : undefined;
    const twNow = ts?.attributes.media_content_id ?? ts?.attributes.media_title;
    if ((st?.state === "playing" && now !== ch.from) || (ch.twinFrom !== undefined && ts?.state === "playing" && twNow !== ch.twinFrom)) {
      ch.hold = undefined;
      return false;
    }
    return true;
  }
  private _pickOpen = false;

  /** The player's name – with more than one player, a tap on it lists them to pick from. */
  private _who(name: string, cls = "") {
    if (this._ids.length < 2) return html`<span class=${cls}>${name}</span>`;
    return html`<button
      class="who ${cls}"
      aria-haspopup="listbox"
      aria-expanded=${this._pickOpen ? "true" : "false"}
      @pointerdown=${(e: Event) => e.stopPropagation()}
      @click=${(e: Event) => {
        e.stopPropagation();
        haptic("selection");
        this._pickOpen = !this._pickOpen;
        this._open = false;
        this.requestUpdate();
      }}
    >
      <span>${name}</span><ha-icon .icon=${"mdi:chevron-down"}></ha-icon>
    </button>`;
  }

  /** The cards with the same players share what was picked. */
  private get _linkKey() {
    return [...this._ids].sort().join(",");
  }
  private _onPick = (e: Event) => {
    if ((e as CustomEvent<string>).detail !== this._linkKey) return;
    this._chosen = picks.get(this._linkKey);
    this._stack = [];
    this._pickOpen = false;
    this.requestUpdate();
  };

  /** A search typed in the pop-up's header: its text, and what the player's own search found. */
  private _q = "";
  private _found?: { q: string; items: Pick[] | "loading" | "none" };
  private _qTimer?: number;
  private _onSearch = (e: Event) => {
    const d = (e as CustomEvent<SearchDetail>).detail;
    if (d.scope !== searchScope(this)) return;
    this._setQuery(d.text);
  };

  private _setQuery(text: string) {
    if (!this._libOn) return;
    const q = text.trim();
    this._q = q;
    this._stack = [];
    clearTimeout(this._qTimer);
    if (!q) this._found = undefined;
    // the player's own search (the whole catalogue): once the typing pauses
    else if (this._canSearch(this._libId())) {
      this._found = { q, items: "loading" };
      this._qTimer = window.setTimeout(() => void this._searchRemote(q), 650);
    } else this._found = undefined;
    this.requestUpdate();
  }

  /** The integration a player comes from (Home Assistant's entity registry). */
  private _platform(id: string): string | undefined {
    return (
      this._hass as unknown as {
        entities?: Record<string, { platform?: string }>;
      }
    )?.entities?.[id]?.platform;
  }

  /** YouTube Music's own search service, or Home Assistant's search of the players that have one. */
  private _canSearch(id: string): "ytube" | "ha" | undefined {
    const hass = this._hass;
    if (!hass) return undefined;
    const ents = (hass as unknown as { entities?: Record<string, { platform?: string }> }).entities;
    if (
      ents?.[id]?.platform === "ytube_music_player" &&
      (
        hass as unknown as {
          services?: Record<string, Record<string, unknown>>;
        }
      ).services?.ytube_music_player?.search
    )
      return "ytube";
    if (supports(hass.states[id], F.SEARCH_MEDIA)) return "ha";
    return undefined;
  }

  private async _searchRemote(q: string) {
    const hass = this._hass;
    const id = this._libId();
    const how = this._canSearch(id);
    if (!hass || !how) return;
    let kids: any[] = [];
    try {
      if (how === "ytube") {
        // it keeps the query, and its library shows what it found
        await hass.callService("ytube_music_player", "search", {
          entity_id: id,
          query: q,
        });
        kids = (await this._browse(id, "", "search"))?.children ?? [];
      } else {
        const r = await (hass as any).callService("media_player", "search_media", { search_query: q }, { entity_id: id }, false, true);
        kids = r?.response?.[id]?.result ?? [];
      }
    } catch {
      kids = [];
    }
    if (this._q !== q) return;
    // YouTube Music names each by its kind ("Track: …"): the cover says it already
    const items = (await this._picks(kids.slice(0, 40))).map((p) => ({
      ...p,
      name: p.name.replace(/^(Track|Playlist|Album|Artist): /, ""),
    }));
    if (this._q !== q) return;
    this._found = { q, items: items.length ? items : "none" };
    this.requestUpdate();
  }

  /** The search: what in the library loaded already matches, then what the player's search found. */
  private _searchBody(id: string, lib: Lib | "loading", keep: (e: Event) => void) {
    const norm = (t: string) =>
      t
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
    const q = norm(this._q);
    const seen = new Set<string>();
    const mine =
      lib === "loading"
        ? []
        : lib.sections
            .flatMap((sec) => sec.items as Pick[])
            .filter((pk) => {
              const k = pk.media_content_id ?? pk.name;
              if (seen.has(k) || !norm(pk.name).includes(q)) return false;
              seen.add(k);
              return true;
            })
            .slice(0, 30);
    const f = this._found;
    const ghosts = Array.from({ length: 6 }, () => html`<div class="it ghost"><i class="cov"></i><span></span></div>`);
    const mv = this._mouseDrag("y");
    return html`<div class="rows" @scroll=${keep} @pointerdown=${mv.down} @pointermove=${mv.move} @pointerup=${mv.up} @pointercancel=${mv.up}>
      ${
        mine.length
          ? html`<div class="sec">
              <div class="sec-head"><span>${tr("In the library")}</span></div>
              <div class="sgrid">${mine.map((pk) => this._cover(id, pk))}</div>
            </div>`
          : nothing
      }
      ${
        f
          ? html`<div class="sec">
              <div class="sec-head"><span>${tr("Search results")}</span></div>
              ${
                f.items === "none"
                  ? html`<div class="none">${tr("Nothing found")}</div>`
                  : html`<div class="sgrid">${f.items === "loading" ? ghosts : f.items.map((pk) => this._cover(id, pk))}</div>`
              }
            </div>`
          : !mine.length
            ? html`<div class="none">${tr("Nothing found")}</div>`
            : nothing
      }
    </div>`;
  }

  /** Whether the library shows in this card: as its sheet, or alone (show: library). */
  /** A narrow card (a phone): the sheet's rows drawn as the library card's (bigger covers). */
  private _narrow = false;
  private _ro?: ResizeObserver;
  /** show: all with its library below the player (not a sheet over it). */
  private get _below() {
    const c = this._config;
    if (!this._libOn || c.show === "library") return false;
    return c.library_layout === "below";
  }
  /** fill_height: from the card's top down to the dock or the screen's bottom (measured again as a
   *  pop-up slides in, on a turn of the phone). */
  private _fillH?: number;
  private _fillAsked = false;
  private _onOpen = () => {
    for (const ms of [0, 60, 400, 900]) window.setTimeout(this._onFill, ms);
  };
  /** fill_height, or the screen layout */
  private get _fills() {
    const c = this._config;
    return !!c && (c.layout === "screen" || (!!c.fill_height && c.layout !== "tile"));
  }
  private _onFill = () => {
    this._fillAsked = false;
    if (!this._fills || !this.isConnected || !this.getClientRects().length) {
      if (this._fillH !== undefined) ((this._fillH = undefined), this.requestUpdate());
      return;
    }
    const h = this._config.layout === "screen" ? roomToDock(this, 320, 0) : roomToDock(this, 360);
    if (h !== this._fillH) {
      this._fillH = h;
      this.requestUpdate();
    }
  };

  private get _libOn() {
    const c = this._config;
    return !!c && c.layout !== "tile" && c.layout !== "screen" && c.show !== "player" && (c.show === "library" || c.library !== false);
  }

  private _choose(id: string) {
    haptic("selection");
    this._chosen = { id, at: Date.now() };
    picks.set(this._linkKey, this._chosen);
    rememberPlayers();
    pickBus.dispatchEvent(new CustomEvent("pick", { detail: this._linkKey }));
    this._shown = id;
    this._pickOpen = false;
    this._open = false;
    this._stack = [];
    this._libOpen = undefined;
    this.requestUpdate();
  }

  /** Each player's kind (Sonos, Chromecast… or Home Assistant's), for the list of players: Music
   *  Assistant's own word with its token, else a guess from the device. */
  private _kinds = new Map<string, PlayerKind>();
  private _maUids = new Map<string, string>();
  private _maProv?: Map<string, string>;
  private _kindsLoading = false;
  private async _loadKinds() {
    const hass = this._hass;
    if (this._kindsLoading || !hass) return;
    this._kindsLoading = true;
    await Promise.all(this._ids.map((id) => this._twin(id)));
    const mas = [...new Set(this._ids.map((id) => (isMA(hass.states[id]) ? id : this._twins.get(id))).filter((x): x is string => !!x))];
    const { music_assistant_url: url, music_assistant_token: token } = this._config;
    if (url && token && mas.length) {
      try {
        const list = await hass.callWS<{ entity_id: string; unique_id?: string }[] | Record<string, { unique_id?: string } | null>>({ type: "config/entity_registry/get_entries", entity_ids: mas });
        const entries = Array.isArray(list) ? list : Object.entries(list).map(([entity_id, e]) => ({ entity_id, unique_id: e?.unique_id }));
        for (const e of entries) if (e.unique_id) this._maUids.set(e.entity_id, e.unique_id);
        this._maProv = await maPlayerProviders(url, token);
      } catch {
        /* not an admin, or Music Assistant away: the guess */
      }
    }
    this._kinds.clear();
    this.requestUpdate();
  }
  private _kind(id: string): PlayerKind {
    const got = this._kinds.get(id);
    if (got) return got;
    const hass = this._hass!;
    const ma = isMA(hass.states[id]) ? id : this._twins.get(id);
    let k: PlayerKind = "hass";
    if (ma) {
      const uid = this._maUids.get(ma);
      k = kindOfProvider(uid ? this._maProv?.get(uid) : undefined) ?? "ma";
      if (k === "ma") {
        const reg = hass as unknown as { entities?: Record<string, { device_id?: string }>; devices?: Record<string, { manufacturer?: string; model?: string }> };
        const dev = reg.devices?.[reg.entities?.[ma]?.device_id ?? ""];
        k = kindOfDevice(dev?.manufacturer, dev?.model);
      }
    }
    if (!ma || this._twins.has(id) || isMA(hass.states[id])) this._kinds.set(id, k);
    return k;
  }
  private _kindBadge(id: string) {
    const k = this._kind(id);
    const ic = kindIcon(k);
    if (ic.word) return html`<i class="pkind word" title=${KIND_LABEL[k]}>${ic.word}</i>`;
    return html`<i class="pkind" title=${KIND_LABEL[k]} aria-label=${KIND_LABEL[k]}
      >${ic.mask ? html`<b style=${`-webkit-mask-image:${ic.mask};mask-image:${ic.mask}`}></b>` : html`<ha-icon .icon=${ic.mdi}></ha-icon>`}</i
    >`;
  }

  /** The card's players to pick from: each with its art (or icon), name and what it does. */
  private _players(main: string) {
    const hass = this._hass!;
    void this._loadKinds();
    return html`<div class="scrim" @click=${() => ((this._pickOpen = false), this.requestUpdate())}></div>
      <div class="spks plist" role="listbox">
        ${this._ids.map((id) => {
          // a soundbar on the TV: what plays there (its picture, title), not its "TV Audio"
          const st = this._tvSet(id) ? this._shownState(id) : hass.states[id];
          const a = st?.attributes ?? {};
          const url = this._artUrl(st);
          const icon = a.device_class === "tv" ? "mdi:television" : a.device_class === "receiver" ? "mdi:audio-video" : "mdi:speaker";
          const what =
            !st || st.state === "unavailable"
              ? tr("Unavailable")
              : st.state === "off"
                ? tr("Off")
                : LOADED.has(st.state) && a.media_title
                  ? [a.media_title, a.media_artist].filter(Boolean).join(" · ")
                  : tr("Nothing playing");
          return html`<button class="prow ${id === main ? "in" : ""}" role="option" aria-selected=${id === main ? "true" : "false"} @click=${() => this._choose(id)}>
            <i class="pic" style=${url ? `background-image:${cssUrl(url)}` : ""}>${url ? nothing : html`<ha-icon .icon=${icon}></ha-icon>`}</i>
            <span class="ptxt"><span class="sname"><span class="nm">${a.friendly_name ?? id}</span>${this._kindBadge(id)}</span><span class="psub">${what}</span></span>
            ${st?.state === "playing" ? html`<i class="eq ${id === main ? "main" : ""}" aria-hidden="true"><b></b><b></b><b></b></i>` : nothing}
            ${id === main ? html`<ha-icon class="chk" .icon=${"mdi:check"}></ha-icon>` : nothing}
          </button>`;
        })}
      </div>`;
  }

  /** Players it can be grouped with: the configured ones, else every one of its kind that groups. */
  private _speakerIds(): string[] {
    const hass = this._hass;
    if (!hass) return [];
    // only players that can join the shown one: they group, and are of its kind (Music Assistant's
    // players group with each other, Sonos' with Sonos…) – a TV or a radio gets no tick
    const main = hass.states[this._main()];
    if (!supports(main, F.GROUPING)) return [];
    const ma = isMA(main);
    // the integration a player comes from: only its own players join it (Sonos with Sonos…)
    const ents = (hass as unknown as { entities?: Record<string, { platform?: string }> }).entities;
    const kind = (id: string) => ents?.[id]?.platform;
    const mine = kind(main.entity_id);
    const seen = new Set<string>();
    return Object.values(hass.states)
      .filter((st) => st.entity_id.startsWith("media_player.") && st.state !== "unavailable" && supports(st, F.GROUPING) && isMA(st) === ma)
      .filter((st) => kind(st.entity_id) === mine)
      .filter((st) => !ma || st.attributes.mass_player_type === "player")
      .filter((st) => {
        const n = String(st.attributes.friendly_name ?? st.entity_id);
        if (seen.has(n)) return false;
        seen.add(n);
        return true;
      })
      .map((st) => st.entity_id);
  }

  private _clockT?: number;
  /** the screen untouched a while: the buttons and the cursor fade away, the song and the time stay */
  private _calm = false;
  private _calmT = 0;
  private _wake = () => {
    if (this._calm) ((this._calm = false), this.requestUpdate());
    clearTimeout(this._calmT);
    this._calmT = window.setTimeout(() => ((this._calm = true), this.requestUpdate()), 5000);
  };

  protected override hassChanged(hass: HomeAssistant) {
    for (const [id, v] of this._pending) {
      const cur = Number(hass.states[id]?.attributes.volume_level);
      if (Number.isFinite(cur) && Math.abs(cur - v) < 0.02) this._pending.delete(id);
    }
    this._syncTick();
    this._syncArt();
  }

  override connectedCallback() {
    super.connectedCallback();
    artWaiters.add(this._artWake);
    this._syncTick();
    pickBus.addEventListener("pick", this._onPick);
    searchBus.addEventListener("search", this._onSearch);
    vizBus.addEventListener("change", this._onViz);
    steadyBus.addEventListener("check", this._onViz);
    this._ro ??= new ResizeObserver(() => {
      const n = this.clientWidth > 0 && this.clientWidth < 600;
      if (n !== this._narrow) ((this._narrow = n), this.requestUpdate());
    });
    this._ro.observe(this);
    window.addEventListener("resize", this._onFill);
    window.addEventListener("location-changed", this._onOpen);
    window.addEventListener("hashchange", this._onOpen);
    if (this._config?.layout === "screen") {
      // the time moves on with nothing playing too
      this._clockT ??= window.setInterval(() => this.requestUpdate(), 10000);
      this._wake();
    }
    this._onOpen();
    const q = lastSearch(this);
    if (q !== this._q) this._setQuery(q);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    artWaiters.delete(this._artWake);
    clearInterval(this._clockT);
    this._clockT = undefined;
    clearTimeout(this._calmT);
    pickBus.removeEventListener("pick", this._onPick);
    searchBus.removeEventListener("search", this._onSearch);
    vizBus.removeEventListener("change", this._onViz);
    steadyBus.removeEventListener("check", this._onViz);
    this._ro?.disconnect();
    window.removeEventListener("resize", this._onFill);
    window.removeEventListener("location-changed", this._onOpen);
    window.removeEventListener("hashchange", this._onOpen);
    this._viz?.destroy();
    this._viz = this._vizCv = undefined;
    clearInterval(this._tick);
    this._tick = undefined;
    for (const t of this._sendTimer.values()) clearTimeout(t);
  }

  /** While playing the position moves on its own (HA reports it only on a change). */
  private _syncTick() {
    // what's shown (a speaker playing its MA twin's queue may say late that it plays)
    const playing = this.isConnected && this._shownState()?.state === "playing";
    if (playing && !this._tick) this._tick = window.setInterval(() => this.requestUpdate(), 1000);
    else if (!playing && this._tick) {
      clearInterval(this._tick);
      this._tick = undefined;
    }
  }

  private _artUrl(st?: HassEntity): string | undefined {
    const p = this._artRaw(st);
    // only once loaded: whole, never drawn as it comes
    return p && artReady(p) === "ok" ? p : undefined;
  }

  private _artRaw(st?: HassEntity): string | undefined {
    const p = (st?.attributes.entity_picture_local ?? st?.attributes.entity_picture) as string | undefined;
    // HA's own proxy (/api/media_player_proxy/…) is on the page's origin: the WebGL glass and
    // the colour can read it
    return p || undefined;
  }

  /** A picture on its way: a spinner where it will be. */
  private _artWaits(st?: HassEntity): boolean {
    const p = this._artRaw(st);
    return !!p && artReady(p) === "wait";
  }

  private _artWake = () => this.requestUpdate();

  private _syncArt() {
    const url = this._artUrl(this._shownState());
    if (url === this._art) return;
    this._art = url;
    if (!url) {
      this._color = undefined;
      this._light = undefined;
      return;
    }
    artColor(url).then((c) => {
      if (this._art !== url) return;
      this._color = c?.color;
      this._light = c?.light;
      this.requestUpdate();
    });
  }

  /**
   * Dark or light text over the blurred art: its lightness as the background's filter leaves it
   * (the art at its opacity over the card's own glass).
   */
  private _tone(st: HassEntity | undefined): string {
    if (this._light === undefined || this._config.art_background === false || !this._artUrl(st)) return "";
    // the art over light glass or dark (art_glass, the night, the panel)
    const night = this._artDark();
    // the tone of a paused player is the playing one's: a pause dims the art, not the text's colour
    const idle = !LOADED.has(st?.state ?? "");
    // the blurred art at its opacity over the card's glass (light by day, dark at night)
    const a = night ? (idle ? 0.18 : 0.4) : idle ? 0.25 : 0.55;
    const l = night ? a * this._light * 0.7 + (1 - a) * 0.15 : a * this._light + (1 - a) * 0.92;
    return l > 0.58 ? "ink-dark" : "ink-light";
  }

  private _call(service: string, data: Record<string, unknown> = {}, id = this._main()) {
    if (id === this._main() && QUEUE_CALLS.has(service)) id = this._queueVia(id) ?? id;
    if (service === "media_previous_track" || service === "media_next_track") for (const p of [this._main(), id]) skipAt.set(p, Date.now());
    this._hass?.callService("media_player", service, {
      entity_id: id,
      ...data,
    });
  }

  /** A seek sent: shown from there on until the player reports a position after it (or 6 s pass). */
  private _seek?: { id: string; pos: number; at: number };

  private _position(st: HassEntity): number | undefined {
    const sk = this._seek;
    if (sk && sk.id === st.entity_id && Date.now() - sk.at < 6000) {
      const rep = Date.parse(st.attributes.media_position_updated_at ?? "");
      if (!(rep > sk.at)) return sk.pos + (st.state === "playing" ? (Date.now() - sk.at) / 1000 : 0);
    }
    const pos = Number(st.attributes.media_position);
    if (!Number.isFinite(pos)) return undefined;
    if (st.state !== "playing" || st.attributes.media_position_frozen) return pos;
    const at = Date.parse(st.attributes.media_position_updated_at ?? "");
    return pos + (Number.isFinite(at) ? (Date.now() - at) / 1000 : 0);
  }

  /** A bar dragged with a finger: shown at once, sent a few times a second and on release. */
  private _slide(key: string, e: PointerEvent, apply: (f: number) => void) {
    const el = e.currentTarget as HTMLElement;
    if (e.type === "pointerdown") {
      if (e.button !== 0) return;
      el.setPointerCapture(e.pointerId);
    } else if (!el.hasPointerCapture(e.pointerId)) return;
    const r = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    // a tap glides to its place, a drag follows the finger
    if (e.type === "pointerdown") this._moved.delete(key);
    else if (e.type === "pointermove") this._moved.add(key);
    this._drag.set(key, f);
    this.requestUpdate();
    const send = () => {
      this._sendTimer.delete(key);
      const v = this._drag.get(key);
      if (v !== undefined) apply(v);
    };
    if (e.type === "pointerup" || e.type === "pointercancel") {
      clearTimeout(this._sendTimer.get(key));
      send();
      this._drag.delete(key);
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    } else if (!this._sendTimer.has(key)) this._sendTimer.set(key, window.setTimeout(send, 250));
  }

  /** Play / pause pressed: shown at once, until the player reports it (or 4 s pass). */
  private _want?: { id: string; playing: boolean; from: string; until: number };
  /** The volume before a mute by the volume icon, for players without a mute of their own. */
  private _before = new Map<string, number>();

  private _isPlaying(st: HassEntity | undefined): boolean {
    const w = this._want;
    const real = st?.state === "playing";
    if (st && w && w.id === st.entity_id && Date.now() < w.until) {
      // pressed: shown so until the player gets there (on the way it may say idle, buffering…)
      if (real === w.playing && st.state !== w.from) this._want = undefined;
      else return w.playing;
    }
    return real;
  }

  /** Mute pressed: shown at once, until the player reports it (some, like Plex, take seconds). */
  private _muteWant = new Map<string, { muted: boolean; from: boolean; until: number }>();

  /** Whether the player is muted – as pressed, while the player hasn't said so yet. */
  private _isMuted(st: HassEntity | undefined): boolean {
    if (!st) return false;
    const real = !!st.attributes.is_volume_muted;
    const w = this._muteWant.get(st.entity_id);
    if (w && real === w.from && Date.now() < w.until) return w.muted;
    return real;
  }

  /** The volume icon: all the way down, and back to where it was. */
  private _mute(id: string, st: HassEntity) {
    if (supports(st, F.VOLUME_MUTE)) {
      const muted = !this._isMuted(st);
      this._muteWant.set(id, {
        muted,
        from: !!st.attributes.is_volume_muted,
        until: Date.now() + 8000,
      });
      window.setTimeout(() => this.requestUpdate(), 8100);
      this._call("volume_mute", { is_volume_muted: muted }, id);
      this.requestUpdate();
      return;
    }
    const v = this._volume(id) ?? 0;
    if (v > 0) {
      this._before.set(id, v);
      this._setVolume(id, 0);
    } else this._setVolume(id, this._before.get(id) ?? 0.3);
  }

  private _volume(id: string): number | undefined {
    const st = this.stateOf(id);
    if (!supports(st, F.VOLUME_SET)) return undefined;
    const d = this._drag.get(`vol|${id}`);
    if (d !== undefined) return d;
    return this._pending.get(id) ?? (Number(st!.attributes.volume_level) || 0);
  }

  private _setVolume(id: string, f: number) {
    const v = Math.round(f * 100) / 100;
    this._pending.set(id, v);
    // setting a volume means hearing it: a muted player is unmuted
    const st = this.stateOf(id);
    if (v > 0 && this._isMuted(st) && supports(st, F.VOLUME_MUTE)) {
      this._muteWant.set(id, {
        muted: false,
        from: !!st!.attributes.is_volume_muted,
        until: Date.now() + 8000,
      });
      this._call("volume_mute", { is_volume_muted: false }, id);
    }
    this._call("volume_set", { volume_level: v }, id);
    // a value the player never reports back (the same as before) stops being shown after a while
    window.setTimeout(() => {
      if (this._pending.get(id) !== v) return;
      this._pending.delete(id);
      this.requestUpdate();
    }, 5000);
  }

  private _volEvents(id: string) {
    const h = (e: PointerEvent) => this._slide(`vol|${id}`, e, (f) => this._setVolume(id, f));
    return { down: h, move: h, up: h, cancel: h };
  }

  private _btn(icon: string, label: string, act: () => void, cls = "", on = false, off = false) {
    // play: its solid pill; the volume icon: bare on its bar (glass on glass is too much); the rest: the glass
    const m = cls.includes("main") ? { cls: "control", style: "" } : cls.includes("mute") ? { cls: "plain", style: "" } : this._ctl();
    return html`<button
      class="cbtn ${m.cls} ${cls} ${on ? "toggled" : ""}"
      ?disabled=${off}
      style=${m.style}
      aria-label=${label}
      title=${label}
      aria-pressed=${on ? "true" : "false"}
      @pointerdown=${(e: Event) => e.stopPropagation()}
      @click=${(e: Event) => {
        e.stopPropagation();
        // a tap you can feel and see: a buzz on a phone, a ring inside the button – held a moment,
        // so a quick tap on a touch screen shows too
        haptic("light");
        const b = e.currentTarget as HTMLElement;
        b.classList.add("tap");
        window.setTimeout(() => b.classList.remove("tap"), 260);
        act();
      }}
    >
      <i class="press"></i>
      <ha-icon .icon=${icon}></ha-icon>
      ${on && cls.includes("small") && !cls.includes("mute") ? html`<i class="dot"></i>` : nothing}
      ${cls.includes("busy") ? html`<i class="spin"></i>` : nothing}
    </button>`;
  }

  private _playIcon(st: HassEntity) {
    return this._isPlaying(st) ? (supports(st, F.PAUSE) ? "mdi:pause" : "mdi:stop") : "mdi:play";
  }

  private _playPause(st: HassEntity) {
    const now = this._isPlaying(st);
    if (now)
      heldPause.set(st.entity_id, {
        title: st.attributes.media_title,
        at: Date.now(),
        pos: this._position(st),
        snap: st,
      });
    // play: still held until the player says it plays (a Sonos through MA says idle, untitled, till then)
    // through MA's twin: the speaker reports it only on its next poll, MA starts its stream in seconds
    const twin = this._via(st.entity_id) ? undefined : this._twinPlays(st.entity_id);
    const wait = twin ? 20000 : 4000;
    this._want = {
      id: st.entity_id,
      playing: !now,
      from: st.state,
      until: Date.now() + wait,
    };
    window.setTimeout(() => this.requestUpdate(), wait + 100);
    if (twin) {
      const ph = pausedHere.get(st.entity_id);
      const title = st.attributes.media_title as string | undefined;
      if (now)
        pausedHere.set(st.entity_id, {
          pos: this._position(st) ?? 0,
          at: Date.now(),
          title,
        });
      else {
        const pos = ph?.pos ?? this._position(st) ?? 0;
        pausedHere.set(st.entity_id, {
          pos,
          at: Date.now(),
          title: ph?.title ?? title,
          resume: true,
        });
        // MA still says it plays (it hasn't seen the speaker stop): a play would do nothing there –
        // a seek to where it was paused starts its stream again
        if (this.stateOf(twin)?.state === "playing") {
          this._hass?.callService("media_player", "media_seek", {
            entity_id: twin,
            seek_position: Math.floor(pos),
          });
          return;
        }
      }
    }
    if (now) this._call(supports(st, F.PAUSE) ? "media_pause" : "media_stop");
    else if (st.state === "off" && supports(st, F.TURN_ON)) this._call("turn_on");
    else this._call("media_play");
  }

  /** What plays, in two lines: the title, then the artist (or the app, the source). */
  private _what(st: HassEntity | undefined): [string, string, string?] {
    const a = st?.attributes ?? {};
    const name = this._config.name ?? a.friendly_name ?? this._main();
    if (!st || st.state === "unavailable") return [name, tr("Unavailable")];
    if (st.state === "off") return [name, tr("Off")];
    const title = a.media_title ?? a.media_series_title ?? "";
    const artist = a.media_artist ?? a.media_album_artist ?? a.app_name ?? a.source ?? "";
    if (!title) return [name, ACTIVE.has(st.state) && artist ? artist : tr("Nothing playing")];
    return [title, [artist, name].filter(Boolean).join(" · "), artist];
  }

  private _art_(st: HassEntity | undefined, cls: string) {
    const url = this._artUrl(st);
    // a film's poster, a video's frame: cut to the square like any cover; on its way: a spinner
    const wait = !url && this._artWaits(st);
    const icon = st?.attributes.glass_tv || st?.attributes.device_class === "tv" ? "mdi:television" : "mdi:music-note";
    // the channel's logo (live TV, by a TV guide): a badge on the programme's picture – or, with none,
    // the logo itself on a light plate
    const logo = cls === "square" ? (st?.attributes.glass_logo as string | undefined) : undefined;
    if (logo && !url && !wait)
      return html`<div class="art ${cls} logoplate"><img class="chlogo big" src=${logo} alt="" /></div>`;
    // the TV's picture not square (a 16:9 frame, a 2:3 poster): whole, over a blur of itself
    const r = url ? (artRatio.get(url) ?? 1) : 1;
    // live TV with its channel's logo: the programme cut to the square, the logo over it
    // YouTube's thumbnail: a 16:9 frame inside black bars (4:3) – the frame only
    const yt = url && /\/\/i\.ytimg\.com\/vi\/[^/]+\/(hq|sd)default\./.test(url) ? "yt" : "";
    // (cut to the square like a cover; anything else from the TV not square: whole, over a blur)
    const fit = yt || (url && st?.attributes.glass_tv && !st?.attributes.glass_logo && (r > 1.15 || r < 0.87) ? "fit" : "");
    return html`<div class="art ${cls} ${fit} ${url ? "" : "none"}" style=${url ? (fit === "fit" ? `--art:${cssUrl(url)}` : `background-image:${cssUrl(url)}`) : ""}>
      ${url ? nothing : wait ? html`<i class="spin" aria-hidden="true"></i>` : html`<ha-icon .icon=${icon}></ha-icon>`}
      ${url && logo ? html`<img class="chlogo" src=${logo} alt="" />` : nothing}
    </div>`;
  }

  private _press(st: HassEntity | undefined, onTap?: () => void) {
    const c = this._config;
    const target = withDefaults(
      {
        entity: st?.entity_id,
        tap_action: c.tap_action,
        hold_action: c.hold_action,
      },
      { tap_action: { action: "more-info" } },
    );
    return pressHandlers(
      () => target,
      (kind: ActionKind, el: HTMLElement) => (kind === "tap" && onTap ? onTap() : runAction(this, this._hass, target, kind, el)),
    );
  }

  /** Whether the cover shows as the visualizer. */
  private _vizOn(): boolean {
    return this._config.visualizer !== false && vizPref.on;
  }
  private _viz?: Visualizer;
  private _vizCv?: HTMLCanvasElement;
  /** the dots of the looks, shown a moment after a change */
  private _vizDots = 0;
  private _vizFrom?: { x: number; y: number };
  private _onViz = () => this.requestUpdate();

  private _showDots() {
    clearTimeout(this._vizDots);
    this._vizDots = window.setTimeout(() => ((this._vizDots = 0), this.requestUpdate()), 1600);
  }

  /** The cover (or the visualizer in its place): a tap switches them, a swipe picks another look. */
  private _artArea(st: HassEntity | undefined, label: string) {
    const viz = this._config.visualizer !== false;
    const on = this._vizOn();
    const p = this._press(
      st,
      viz
        ? () => {
            vizPref.on = !vizPref.on;
            if (vizPref.on) this._showDots();
            haptic("light");
            saveViz();
          }
        : undefined,
    );
    const i = VIZ_STYLES.indexOf(vizPref.style);
    return html`<div
      class="artbtn ${on ? "vizon" : ""}"
      role="button"
      aria-label=${on ? tr("Visualizer") : label}
      @pointerdown=${(e: PointerEvent) => ((this._vizFrom = { x: e.clientX, y: e.clientY }), p.down(e))}
      @pointermove=${p.move}
      @pointerup=${(e: PointerEvent) => {
        p.up(e);
        const f = this._vizFrom;
        this._vizFrom = undefined;
        if (!on || !f) return;
        const dx = e.clientX - f.x;
        if (Math.abs(dx) < 28 || Math.abs(dx) < Math.abs(e.clientY - f.y) * 1.5) return;
        const n = VIZ_STYLES.length;
        vizPref.style = VIZ_STYLES[(i + (dx < 0 ? 1 : n - 1)) % n];
        this._showDots();
        haptic("light");
        saveViz();
      }}
      @pointercancel=${p.cancel}
      @contextmenu=${p.context}
    >
      <div class="artwrap">
        ${this._art_(st, "square")} ${on ? html`<canvas class="viz"></canvas>` : nothing}

        ${on ? html`<div class="vdots ${this._vizDots ? "show" : ""}">${VIZ_STYLES.map((_, k) => html`<i class=${k === i ? "on" : ""}></i>`)}</div>` : nothing}
      </div>
    </div>`;
  }

  /** The visualizer told what plays, its cover and look (after each render). */
  private _syncViz() {
    const cv = this.renderRoot.querySelector<HTMLCanvasElement>("canvas.viz") ?? undefined;
    if (cv !== this._vizCv) {
      this._viz?.destroy();
      this._viz = cv ? new Visualizer(cv) : undefined;
      this._vizCv = cv;
    }
    if (!this._viz) return;
    const st = this._shownState();
    const a = st?.attributes ?? {};
    this._viz.setStyle(vizPref.style);
    this._viz.setInk(this._tone(st) === "ink-dark");
    this._viz.setArt(this._artUrl(st), this._color);
    this._viz.setTrack({
      playing: this._isPlaying(st),
      pos: (st && this._position(st)) || 0,
      at: Date.now(),
      dur: Number(a.media_duration) || 0,
      seed: `${a.media_title ?? ""}|${a.media_artist ?? ""}`,
    });
  }

  /** The library per player: its sections, loaded once by browsing it; "none" when it has none. */
  private _lib = new Map<string, Lib | "loading" | "none">();
  /** Where the sheet has gone in: an artist's albums, a whole section… (back returns). */
  private _stack: { title: string; items: Pick[] | "loading"; detail?: Pick }[] = [];

  private _browse(id: string, cid?: string, ctype?: string) {
    return this._hass!.callWS<any>({
      type: "media_player/browse_media",
      entity_id: id,
      ...(ctype !== undefined ? { media_content_id: cid ?? "", media_content_type: ctype } : {}),
    });
  }

  /** A browsed item as the sheet shows it; Home Assistant's own pictures get a signed address. */
  private async _picks(kids: any[]): Promise<Pick[]> {
    const hass = this._hass!;
    const items: Pick[] = kids.map((c) => ({
      name: c.title,
      image: c.thumbnail || undefined,
      kind: c.media_class,
      media_content_id: String(c.media_content_id),
      media_content_type: c.media_content_type,
      play: !!c.can_play,
      expand: !!c.can_expand,
    }));
    await Promise.all(
      items.map(async (it) => {
        if (!it.image?.startsWith("/") || it.image.includes("authSig")) return;
        try {
          it.image = (
            await hass.callWS<{ path: string }>({
              type: "auth/sign_path",
              path: it.image,
            })
          ).path;
        } catch {
          it.image = undefined;
        }
      }),
    );
    return items;
  }

  /**
   * The library as rows, as in Plexamp: browsing the player – its recommendations (recently played,
   * recently added…), playlists, favourites, radio, albums, artists – music only (no films, no TV).
   * The card's favorites come first; a player that can't browse offers its sources (inputs left out).
   */
  private async _loadLib(id: string) {
    const hass = this._hass;
    if (!hass || this._lib.has(id)) return;
    this._lib.set(id, "loading");
    const st = hass.states[id];
    const sections: Section[] = [];
    // your own covers: the first row – or rows of their own, by each one's `row`
    for (const pk of this._config.favorites ?? []) {
      const title = pk.row ?? tr("Favorites");
      const sec = sections.find((x) => x.title === title);
      if (sec) (sec.items as Pick[]).push(pk);
      else sections.push({ title, items: [pk] });
    }
    // Music Assistant's home (with its address and a token): its rows next, as it orders them
    sections.push(...(await this._maRows()));
    const mine = sections.length;
    if (supports(st, F.BROWSE)) {
      try {
        const root = await this._browse(id);
        const dirs = (root.children ?? []).filter(
          (c: any) =>
            c.can_expand &&
            c.media_class !== "app" &&
            !String(c.media_content_id).startsWith("media-source://") &&
            !NOT_MUSIC.has(c.children_media_class) &&
            !SKIP_DIR.test(c.title) &&
            !SKIP_TYPE.has(c.media_content_type),
        );
        const hubs: { title: string; cid: string; ctype: string }[] = [];
        const own: Section[] = [];
        await Promise.all(
          dirs.slice(0, 10).map(async (d: any) => {
            const node = await this._browse(id, d.media_content_id, d.media_content_type).catch(() => undefined);
            const kids: any[] = (node?.children ?? []).filter((c: any) => !SKIP_TYPE.has(c.media_content_type));
            const folders = kids.filter((c) => c.can_expand && !c.can_play);
            // folders only (Plex' recommendations, Sonos' favourites by kind): each a row;
            // a library with its own recommendations among its items (Plex' music) adds theirs
            const rows = folders.length === kids.length ? folders : folders.filter((x) => x.media_class === "directory" && /recommend|doporu/i.test(x.title));
            for (const f of rows)
              hubs.push({
                title: f.title,
                cid: f.media_content_id,
                ctype: f.media_content_type,
              });
            const leaves = kids.filter((c) => !rows.includes(c));
            if (leaves.length)
              own.push({
                title: d.title,
                items: await this._picks(leaves.slice(0, 30)),
                cid: d.media_content_id,
                ctype: d.media_content_type,
                total: leaves.length,
              });
          }),
        );
        // a recommendation folder inside a library: one more level (Plex: "Recommended (Hudba)")
        const deep = hubs.filter((h) => /recommend|doporu/i.test(h.title));
        for (const h of deep) {
          hubs.splice(hubs.indexOf(h), 1);
          const n = await this._browse(id, h.cid, h.ctype).catch(() => undefined);
          for (const c of n?.children ?? [])
            if (c.can_expand && !c.can_play)
              hubs.push({
                title: c.title,
                cid: c.media_content_id,
                ctype: c.media_content_type,
              });
        }
        const wanted = hubs
          .filter((h) => !SKIP_DIR.test(h.title) && !SKIP_TYPE.has(h.ctype))
          .sort((a, b) => rank(a.title) - rank(b.title))
          .slice(0, 10);
        const fromHubs = await Promise.all(
          wanted.map(async (h) => {
            const n = await this._browse(id, h.cid, h.ctype).catch(() => undefined);
            const kids: any[] = (n?.children ?? []).filter((c: any) => !SKIP_TYPE.has(c.media_content_type));
            return {
              title: h.title,
              items: await this._picks(kids.slice(0, 30)),
              cid: h.cid,
              ctype: h.ctype,
              total: kids.length,
            } as Section;
          }),
        );
        for (const sec of [...fromHubs, ...own]) {
          // music only: a row of films or episodes (Plex' server-wide recommendations) goes
          sec.items = sec.items.filter((it) => !NOT_MUSIC.has(it.kind ?? ""));
          if (sec.items.length && !sections.some((x) => x.title === sec.title)) sections.push(sec);
        }
      } catch {
        /* no browsing: its sources below */
      }
    }
    if (sections.length <= mine && supports(st, F.SELECT_SOURCE)) {
      const list: string[] = (st?.attributes.source_list ?? []).filter((x: string) => !INPUTS.test(x));
      if (list.length)
        sections.push({
          title: tr("Favorites"),
          items: list.map((x) => ({ name: x, source: x, play: true })),
        });
    }
    const order = this._config.library_sections;
    const shown = order?.length
      ? order.map((t) => sections.find((x) => x.title.toLowerCase() === t.toLowerCase())).filter((x): x is Section => !!x)
      : [...sections.slice(0, mine), ...sections.slice(mine).sort((a, b) => rank(a.title) - rank(b.title))];
    this._lib.set(id, shown.length ? { sections: shown.slice(0, 12) } : "none");
    this.requestUpdate();
  }

  /** The rows of Music Assistant's home (its recommendations: your mixes, top picks, played lately…),
   *  straight from its API – Home Assistant doesn't pass them on. None without its address and token. */
  private async _maRows(): Promise<Section[]> {
    const url = this._config.music_assistant_url;
    const token = this._config.music_assistant_token;
    if (!url || !token) return [];
    try {
      const rows: any[] = await maCommand(url, token, "music/recommendations");
      const wanted = rows.filter((r) => r && r.enabled_by_default !== false).slice(0, 10);
      const out = await Promise.all(
        wanted.map(async (r): Promise<Section | undefined> => {
          let items: any[] = r.items ?? [];
          if (!items.length) items = await maCommand<any[]>(url, token, "music/recommendations/items", { provider: r.provider, item_id: r.item_id }).catch(() => []);
          const title = r.name || r.translation_key || "";
          const picks: Pick[] = items
            .filter((it) => it?.uri && it.media_type !== "folder")
            .slice(0, 30)
            .map((it) => ({
              sub:
                it.owner ||
                (it.artists ?? [])
                  .map((a: any) => a?.name)
                  .filter(Boolean)
                  .join(", ") ||
                undefined,
              src: this._maYoutube(it) ? ("youtube" as const) : undefined,
              from: title,
              // Music Assistant marks YouTube's own mixes "(YouTube Music)": the row says where they're from
              name: [String(it.name ?? "").replace(/\s*\(YouTube Music\)$/, ""), it.version ? `(${it.version})` : ""].filter(Boolean).join(" "),
              image: maImage(url, it),
              kind: it.media_type === "track" ? "track" : it.media_type,
              play: true,
              ma_uri: it.uri,
              media_content_id: it.uri,
              ma_item: it.item_id !== undefined ? { id: String(it.item_id), prov: String(it.provider ?? "library") } : undefined,
            }));
          return picks.length && title ? { title, items: picks, total: picks.length, ma: "row" as const, sub: r.subtitle || undefined, src: String(r.provider ?? "").startsWith("ytmusic") ? ("youtube" as const) : undefined } : undefined;
        }),
      );
      const rowsOut = out.filter((x): x is Section => !!x);
      // the top picks, as Music Assistant's home opens: the first of each row, then the second…
      const top: Pick[] = [];
      // each once: the same playlist may be in two rows (YouTube's, and the library's copy of it)
      const seen = new Set<string>();
      const key = (pk: Pick) => `${pk.kind}|${pk.name.trim().toLowerCase()}`;
      for (let i = 0; i < 6 && top.length < 9; i++)
        for (const sec of rowsOut) {
          const pk = sec.items[i];
          if (!pk || top.length >= 9 || seen.has(key(pk))) continue;
          seen.add(key(pk));
          top.push(pk);
        }
      return top.length >= 3
        ? [
            {
              title: tr("Top picks for you"),
              items: top,
              total: top.length,
              ma: "picks",
            },
            ...rowsOut,
          ]
        : rowsOut;
    } catch (e) {
      console.warn("glass-media: Music Assistant recommendations", e);
      return [];
    }
  }

  /** A Music Assistant item from YouTube Music (its badge on the cover): by its provider, or a library
   *  playlist Music Assistant made of a YouTube one ("… (YouTube Music)"). */
  private _maYoutube(it: any): boolean {
    const ids = [it.provider, it.uri, ...(it.provider_mappings ?? []).map((m: any) => m?.provider_domain)].map((x) => String(x ?? ""));
    return ids.some((x) => x.startsWith("ytmusic")) || /\(YouTube Music\)$/.test(String(it.name ?? ""));
  }

  /** Into an artist, an album or a whole section: its items in the sheet, back returns. */
  private async _enter(id: string, title: string, cid?: string, ctype?: string, items?: Pick[]) {
    haptic("selection");
    const entry: { title: string; items: Pick[] | "loading" } = {
      title,
      items: items ?? "loading",
    };
    this._stack = [...this._stack, entry];
    this._armClose();
    this.requestUpdate();
    if (items || ctype === undefined) return;
    try {
      const n = await this._browse(id, cid, ctype);
      entry.items = await this._picks((n.children ?? []).slice(0, 200));
    } catch {
      entry.items = [];
    }
    this.requestUpdate();
  }

  /** A tap on a cover: an artist opens (its albums), what plays starts, a folder opens. */
  private _tapPick(id: string, pk: Pick) {
    if (this._held) {
      this._held = false;
      return;
    }
    if (pk.expand && (pk.kind === "artist" || !pk.play)) void this._enter(id, pk.name, pk.media_content_id, pk.media_content_type);
    else void this._start(pk);
  }

  /** The sheet's inside: the rows of the library, or what was opened (an artist, a whole row). */
  private _sheetBody(id: string, lib: Lib | "loading", keep: (e: Event) => void) {
    const top = this._stack[this._stack.length - 1];
    if (this._q && !top) return this._searchBody(id, lib, keep);
    if (top?.detail) return this._detailBody(id, top as { title: string; items: Pick[] | "loading"; detail: Pick }, keep);
    if (top)
      return html`<div class="sheet-head">
          <button class="back" aria-label=${tr("Back")} @click=${() => ((this._stack = this._stack.slice(0, -1)), this.requestUpdate())}>
            <ha-icon .icon=${"mdi:chevron-left"}></ha-icon>
          </button>
          <span>${top.title}</span>
        </div>
        <div
          class="grid"
          @scroll=${keep}
          @pointerdown=${this._mouseDrag("y").down}
          @pointermove=${this._mouseDrag("y").move}
          @pointerup=${this._mouseDrag("y").up}
          @pointercancel=${this._mouseDrag("y").up}
        >
          ${
            top.items === "loading"
              ? Array.from({ length: 6 }, () => html`<div class="it ghost"><i class="cov"></i><span></span></div>`)
              : top.items.map((pk) => this._cover(id, pk))
          }
        </div>`;
    if (lib === "loading")
      return html`<div class="rows">
        ${[0, 1].map(
          () =>
            html`<div class="sec">
              <div class="sec-head"><span class="ghost-t"></span></div>
              <div class="row">${Array.from({ length: 4 }, () => html`<div class="it ghost"><i class="cov"></i><span></span></div>`)}</div>
            </div>`,
        )}
      </div>`;
    const mv = this._mouseDrag("y");
    const mh = this._mouseDrag("x");
    return html`<div class="rows" @scroll=${keep} @pointerdown=${mv.down} @pointermove=${mv.move} @pointerup=${mv.up} @pointercancel=${mv.up}>
      ${lib.sections.map((sec) =>
        sec.ma === "picks"
          ? this._picksRow(id, sec, keep)
          : html`<div class="sec ${sec.ma ? "ma" : ""}">
              <div class="sec-head">
                <span class="sec-t">${sec.title}${sec.sub ? html`<small>${sec.sub}</small>` : nothing}</span>
                ${sec.src === "youtube" ? html`<i class="src-yt head" aria-hidden="true"></i>` : nothing}
                ${
                  (sec.total ?? sec.items.length) > 4
                    ? html`<button class="all" @click=${() => void this._enter(id, sec.title, sec.cid, sec.ctype, sec.ctype === undefined ? sec.items : undefined)}>
                        ${tr("All")}<ha-icon .icon=${"mdi:chevron-right"}></ha-icon>
                      </button>`
                    : nothing
                }
              </div>
              <div
                class="row"
                @scroll=${keep}
                @pointerdown=${(e: PointerEvent) => (e.stopPropagation(), mh.down(e))}
                @pointermove=${mh.move}
                @pointerup=${mh.up}
                @pointercancel=${mh.up}
              >
                ${sec.items.map((pk) => this._cover(id, pk))}
              </div>
            </div>`,
      )}
    </div>`;
  }

  /** Music Assistant's top picks: a big tile, then smaller wide ones in two rows – each its cover
   *  behind, the row it came from on top, what it is, its name and where from at the bottom. */
  private _picksRow(id: string, sec: Section, keep: (e: Event) => void) {
    const mh = this._mouseDrag("x");
    const [first, ...rest] = sec.items;
    return html`<div class="sec ma">
      <div class="sec-head"><span>${sec.title}</span></div>
      <div
        class="row picks"
        @scroll=${keep}
        @pointerdown=${(e: PointerEvent) => (e.stopPropagation(), mh.down(e))}
        @pointermove=${mh.move}
        @pointerup=${mh.up}
        @pointercancel=${mh.up}
      >
        ${this._pickTile(id, first, true)}
        <div class="pk-grid">${rest.map((pk) => this._pickTile(id, pk, false))}</div>
      </div>
    </div>`;
  }

  private _pickTile(id: string, pk: Pick, big: boolean) {
    const ch = picks.get(this._linkKey) ?? this._chosen;
    const loading = !!ch && ch.id === this._main() && ch.pick === (pk.media_content_id ?? pk.name) && this._busy(ch);
    const hue = [...pk.name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
    return html`<button
      class="pk ${big ? "big" : ""} ${loading ? "loading" : ""}"
      @pointerdown=${this._hold.down(id, pk)}
      @pointermove=${this._hold.move}
      @pointerup=${this._hold.end}
      @pointercancel=${this._hold.end}
      @contextmenu=${this._hold.menu(id, pk)}
      title=${pk.name}
      style="--h:${hue}"
      @click=${(e: Event) => {
        haptic("light");
        const b = e.currentTarget as HTMLElement;
        b.classList.add("tap");
        window.setTimeout(() => b.classList.remove("tap"), 260);
        this._tapPick(id, pk);
      }}
    >
      ${pk.image ? html`<img src=${pk.image} alt="" loading="lazy" draggable="false" @error=${(e: Event) => ((e.currentTarget as HTMLElement).hidden = true)} />` : nothing}
      <i class="pk-shade"></i>
      ${pk.from ? html`<span class="pk-from"><ha-icon .icon=${"mdi:creation"}></ha-icon>${pk.from}</span>` : nothing}
      <span class="pk-txt">
        ${pk.kind && KIND_NAME[pk.kind] ? html`<span class="pk-kind">${tr(KIND_NAME[pk.kind])}</span>` : nothing}
        <span class="pk-name">${pk.name}</span>
        ${pk.sub ? html`<span class="pk-sub">${pk.sub}</span>` : nothing}
      </span>
      ${loading ? html`<i class="spin"></i>` : nothing}
    </button>`;
  }

  /** A playlist or an album that opens to its tracks (held, or right-clicked). */
  private _canOpen(pk: Pick): boolean {
    if (pk.kind !== "playlist" && pk.kind !== "album") return false;
    const { music_assistant_url: url, music_assistant_token: token } = this._config;
    return (!!pk.ma_item && !!url && !!token) || (!!pk.expand && !!pk.media_content_id);
  }

  /** Held (half a second, without moving) or right-clicked: a playlist / album opens; its click is
   *  swallowed. A tap still plays it. */
  private _held = false;
  private _holdT?: { t: number; x: number; y: number };
  private _hold = {
    down: (id: string, pk: Pick) => (e: PointerEvent) => {
      if (this._holdT) clearTimeout(this._holdT.t);
      this._holdT = undefined;
      this._held = false;
      if ((e.pointerType === "mouse" && e.button !== 0) || !this._canOpen(pk)) return;
      const t = window.setTimeout(() => {
        this._holdT = undefined;
        this._held = true;
        haptic("medium");
        void this._openDetail(id, pk);
      }, 480);
      this._holdT = { t, x: e.clientX, y: e.clientY };
    },
    move: (e: PointerEvent) => {
      const h = this._holdT;
      if (h && Math.hypot(e.clientX - h.x, e.clientY - h.y) > 8) {
        clearTimeout(h.t);
        this._holdT = undefined;
      }
    },
    end: () => {
      if (this._holdT) clearTimeout(this._holdT.t);
      this._holdT = undefined;
    },
    menu: (id: string, pk: Pick) => (e: Event) => {
      if (!this._canOpen(pk)) return;
      e.preventDefault();
      // a finger's long press may say "context menu" too: opened once
      if (this._held || this._stack[this._stack.length - 1]?.detail === pk) return;
      this._hold.end();
      void this._openDetail(id, pk);
    },
  };

  /** A playlist / album opened: its cover, name, play – and its tracks, each playing on from there. */
  private async _openDetail(id: string, pk: Pick) {
    const entry: { title: string; items: Pick[] | "loading"; detail: Pick } = { title: pk.name, items: "loading", detail: pk };
    this._stack = [...this._stack, entry];
    this._armClose();
    this.requestUpdate();
    const { music_assistant_url: url, music_assistant_token: token } = this._config;
    const within = pk.ma_uri ?? pk.media_content_id;
    try {
      if (pk.ma_item && url && token) {
        const cmd = pk.kind === "album" ? "music/albums/album_tracks" : "music/playlists/playlist_tracks";
        const list: any[] = await maCommand(url, token, cmd, { item_id: pk.ma_item.id, provider_instance_id_or_domain: pk.ma_item.prov });
        entry.items = (list ?? [])
          .filter((t) => t?.uri)
          .slice(0, 300)
          .map((t) => ({
            name: [t.name, t.version ? `(${t.version})` : ""].filter(Boolean).join(" "),
            sub: [(t.artists ?? []).map((a: any) => a?.name).filter(Boolean).join(", "), pk.kind === "album" ? "" : t.album?.name].filter(Boolean).join(" • ") || undefined,
            image: pk.kind === "album" ? undefined : (maImage(url, t) ?? maImage(url, t.album)),
            kind: "track",
            play: true,
            ma_uri: t.uri,
            media_content_id: t.uri,
            dur: Number(t.duration) || undefined,
            within,
          }));
      } else {
        const n = await this._browse(this._libId(), pk.media_content_id, pk.media_content_type);
        entry.items = (await this._picks((n.children ?? []).filter((c: any) => c.can_play).slice(0, 300))).map((t) => ({ ...t, within }));
      }
    } catch (e) {
      console.warn("glass-media: tracks", e);
      entry.items = [];
    }
    this.requestUpdate();
  }

  /** The opened playlist / album: its cover big (on a phone behind, faded), name, where from, play
   *  on the shown player – and its tracks. */
  private _detailBody(id: string, top: { title: string; items: Pick[] | "loading"; detail: Pick }, keep: (e: Event) => void) {
    const pk = top.detail;
    const mv = this._mouseDrag("y");
    const tracks = top.items;
    const player = this._hass?.states[this._main()]?.attributes.friendly_name ?? "";
    const total = tracks === "loading" ? 0 : tracks.reduce((a, t) => a + (t.dur ?? 0), 0);
    const meta = [
      pk.sub,
      tracks !== "loading" && tracks.length ? tr("{n} tracks", { n: tracks.length }) : "",
      total > 0 ? (total >= 3600 ? `${Math.floor(total / 3600)} h ${Math.round((total % 3600) / 60)} min` : `${Math.round(total / 60)} min`) : "",
    ].filter(Boolean);
    const fmt = (d: number) => `${Math.floor(d / 60)}:${String(Math.floor(d % 60)).padStart(2, "0")}`;
    return html`<div class="sheet-head">
        <button class="back" aria-label=${tr("Back")} @click=${() => ((this._stack = this._stack.slice(0, -1)), this.requestUpdate())}>
          <ha-icon .icon=${"mdi:chevron-left"}></ha-icon>
        </button>
        <span>${tr(KIND_NAME[pk.kind ?? ""] ?? "Playlist")}</span>
      </div>
      <div class="rows det" @scroll=${keep} @pointerdown=${mv.down} @pointermove=${mv.move} @pointerup=${mv.up} @pointercancel=${mv.up}>
        <div class="det-hero">
          ${pk.image ? html`<i class="det-bg" style=${`background-image:${cssUrl(pk.image)}`}></i>` : nothing}
          <i class="det-cov cov ${pk.image ? "" : "tile"}" style="--h:${[...pk.name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)}">
            <ha-icon .icon=${KIND_ICON[pk.kind ?? ""] ?? "mdi:playlist-music"}></ha-icon>
            ${pk.image ? html`<img src=${pk.image} alt="" draggable="false" @error=${(e: Event) => ((e.currentTarget as HTMLElement).hidden = true)} />` : nothing}
          </i>
          <div class="det-info">
            <span class="det-name">${pk.name}</span>
            ${meta.length || pk.src ? html`<span class="det-meta">${pk.src === "youtube" ? html`<i class="src-yt" aria-hidden="true"></i>` : nothing}${meta.join(" · ")}</span>` : nothing}
            <button class="det-play" @click=${() => (haptic("light"), void this._start(pk))}>
              <ha-icon .icon=${"mdi:play"}></ha-icon><span>${player || tr("Play")}</span>
            </button>
          </div>
        </div>
        <div class="det-list">
          ${
            tracks === "loading"
              ? Array.from({ length: 6 }, () => html`<div class="trk ghost"><i class="tcov"></i><span class="ttxt"><span></span></span></div>`)
              : tracks.map(
                  (t) =>
                    html`<button class="trk" @click=${() => (haptic("light"), void this._start(t))}>
                      ${t.image || pk.kind !== "album" ? html`<i class="tcov" style=${t.image ? `background-image:${cssUrl(t.image)}` : ""}></i>` : nothing}
                      <span class="ttxt"><span class="tn">${t.name}</span>${t.sub ? html`<span class="ts">${t.sub}</span>` : nothing}</span>
                      ${t.dur ? html`<span class="td">${fmt(t.dur)}</span>` : nothing}
                    </button>`,
                )
          }
        </div>
      </div>`;
  }

  /** Drag with the mouse: a row sideways, the sheet up and down (a finger scrolls them by itself).
   *  A drag doesn't count as a tap on the cover it started on. */
  private _md?: {
    el: HTMLElement;
    x: number;
    y: number;
    left: number;
    top: number;
    moved: boolean;
    axis: "x" | "y";
    vertical?: boolean;
  };
  private _mouseDrag(axis: "x" | "y") {
    return {
      down: (e: PointerEvent) => {
        if (e.pointerType !== "mouse" || e.button !== 0) return;
        const el = e.currentTarget as HTMLElement;
        this._md = {
          el,
          x: e.clientX,
          y: e.clientY,
          left: el.scrollLeft,
          top: el.scrollTop,
          moved: false,
          axis,
        };
      },
      move: (e: PointerEvent) => {
        const d = this._md;
        if (!d || d.axis !== axis || (d.el !== e.currentTarget && !d.moved)) return;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        if (!d.moved) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) < 5) return;
          d.moved = true;
          // a row dragged up or down moves the sheet instead
          const sheet = axis === "x" && Math.abs(dy) > Math.abs(dx) ? d.el.closest<HTMLElement>(".rows") : null;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          if (sheet) {
            d.el = sheet;
            d.top = sheet.scrollTop;
            d.vertical = true;
          }
          d.el.classList.add("dragging");
        }
        e.stopPropagation();
        if (axis === "x" && !d.vertical) d.el.scrollLeft = d.left - dx;
        else d.el.scrollTop = d.top - dy;
        this._armClose();
      },
      up: (e: PointerEvent) => {
        const d = this._md;
        if (!d) return;
        this._md = undefined;
        if (!d.moved) return;
        e.stopPropagation();
        d.el.classList.remove("dragging");
        const t = e.currentTarget as HTMLElement;
        if (t.hasPointerCapture(e.pointerId)) t.releasePointerCapture(e.pointerId);
        // the click that ends a drag opens nothing
        t.addEventListener("click", (c) => (c.stopPropagation(), c.preventDefault()), { capture: true, once: true });
      },
    };
  }

  /** One cover: an artist round, an album / playlist square, a radio or a cover-less one a colour tile. */
  private _cover(id: string, pk: Pick) {
    const round = pk.kind === "artist";
    const hue = [...pk.name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);
    const ch = picks.get(this._linkKey) ?? this._chosen;
    const loading = !!ch && ch.id === this._main() && ch.pick === (pk.media_content_id ?? pk.source ?? pk.name) && this._busy(ch);
    return html`<button
      class="it ${round ? "round" : ""} ${loading ? "loading" : ""}"
      @pointerdown=${this._hold.down(id, pk)}
      @pointermove=${this._hold.move}
      @pointerup=${this._hold.end}
      @pointercancel=${this._hold.end}
      @contextmenu=${this._hold.menu(id, pk)}
      title=${pk.name}
      @click=${(e: Event) => {
        haptic("light");
        const b = e.currentTarget as HTMLElement;
        b.classList.add("tap");
        window.setTimeout(() => b.classList.remove("tap"), 260);
        this._tapPick(id, pk);
      }}
    >
      <i class="cov ${pk.image ? "" : "tile"}" style="--h:${hue}">
        <ha-icon .icon=${pk.icon ?? KIND_ICON[pk.kind ?? ""] ?? "mdi:playlist-music"}></ha-icon>
        ${pk.image ? html`<img src=${pk.image} alt="" loading="lazy" draggable="false" @error=${(e: Event) => ((e.currentTarget as HTMLElement).hidden = true)} />` : nothing}
        ${pk.src === "youtube" ? html`<i class="src-yt" aria-hidden="true"></i>` : nothing} ${loading ? html`<i class="spin"></i>` : nothing}
      </i>
      <span>${pk.name}</span>
      ${pk.sub || (pk.ma_uri && pk.kind && KIND_NAME[pk.kind]) ? html`<span class="sub">${pk.sub ?? tr(KIND_NAME[pk.kind!])}</span>` : nothing}
    </button>`;
  }

  /** The handle the sheet's render made, put on top of the card. */
  private _handleTpl: unknown = nothing;
  private _closeT?: number;
  /** Down to the handle after `library_close` s without a touch (only while something plays). */
  private _armClose() {
    clearTimeout(this._closeT);
    // the library below the player stays: nothing slides away
    if (this._below) {
      this._closeT = 0;
      return;
    }
    let sec = Number(this._config.library_close ?? 8);
    // an opened playlist is read: longer before it goes down
    if (sec > 0 && this._stack[this._stack.length - 1]?.detail) sec = Math.max(sec, 30);
    if (!(sec > 0)) {
      this._closeT = 0; // armed, never fires: it stays open
      return;
    }
    this._closeT = window.setTimeout(() => {
      this._closeT = undefined;
      this._libOpen = false;
      this._stack = [];
      this.requestUpdate();
    }, sec * 1000);
  }

  /** The sheet: open while nothing plays, down to its handle while something does – or as tapped. */
  private _libOpen?: boolean;
  private _libRest?: boolean;

  private async _start(pk: Pick) {
    const id = this._main();
    const st = this.stateOf(id);
    // the sheet goes down at once, the player shown as playing until it says so
    this._libOpen = false;
    this._stack = [];
    // starting a playlist takes a while (a player may say idle, buffering meanwhile)
    this._want = {
      id,
      playing: true,
      from: st?.state ?? "",
      until: Date.now() + 12000,
    };
    window.setTimeout(() => this.requestUpdate(), 12100);
    // the card stays on this player, a spinner on the cover and on play, till it plays it
    const twn = this._twins.get(id);
    const tws = twn ? this._hass?.states[twn] : undefined;
    const ch: Chosen = {
      id,
      at: Date.now(),
      hold: Date.now() + 20000,
      pick: pk.media_content_id ?? pk.source ?? pk.name,
      from: st?.state === "playing" ? (st.attributes.media_content_id ?? st.attributes.media_title) : "\u0000",
      twinFrom: tws ? (tws.state === "playing" ? (tws.attributes.media_content_id ?? tws.attributes.media_title) : "\u0000") : undefined,
    };
    this._chosen = ch;
    picks.set(this._linkKey, ch);
    rememberPlayers();
    pickBus.dispatchEvent(new CustomEvent("pick", { detail: this._linkKey }));
    window.setTimeout(() => this.requestUpdate(), 20100);
    this.requestUpdate();
    // a player that is off is switched on first
    if (st?.state === "off" && supports(st, F.TURN_ON)) {
      await this._hass?.callService("media_player", "turn_on", {
        entity_id: id,
      });
    }
    // an item of Music Assistant's own (its recommendations): a Music Assistant player plays it – this
    // one, or a speaker's twin in Music Assistant
    if (pk.within && (await this._playWithin(id, st, pk))) return;
    if (pk.ma_uri) {
      const ma = isMA(st) ? id : await this._twin(id);
      if (ma) {
        this._hass?.callService("media_player", "play_media", {
          entity_id: ma,
          media_content_id: pk.ma_uri,
          media_content_type: "music",
          enqueue: "replace",
        });
        return;
      }
    }
    // the library of another player (YouTube Music) on this one (a Sonos): that player is told
    // to play on this one, then what was tapped
    const src = this._libId();
    // YouTube Music's library on a Music Assistant player: Music Assistant plays it itself, from
    // its own YouTube Music (ytmusic://…) – it fetches the songs, YouTube Music only browsed them
    const uri = src !== id && this._platform(src) === "ytube_music_player" ? ytmUri(pk) : undefined;
    // a speaker of its own integration (a Sonos): its twin in Music Assistant plays it
    const ma = uri ? (isMA(st) ? id : await this._twin(id)) : undefined;
    if (uri && ma) {
      // replace: the queue becomes what was tapped and it plays (Music Assistant would only add it)
      this._hass?.callService("media_player", "play_media", {
        entity_id: ma,
        media_content_id: uri,
        media_content_type: "music",
        enqueue: "replace",
      });
      return;
    }
    if (src !== id && pk.media_content_id) {
      await this._hass?.callService("media_player", "select_source", {
        entity_id: src,
        source: id,
      });
      this._hass?.callService("media_player", "play_media", {
        entity_id: src,
        media_content_id: pk.media_content_id,
        media_content_type: pk.media_content_type ?? "music",
      });
      return;
    }
    if (pk.source) this._call("select_source", { source: pk.source }, id);
    else if (pk.media_content_id && supports(st, F.PLAY_MEDIA))
      this._call(
        "play_media",
        {
          media_content_id: pk.media_content_id,
          media_content_type: pk.media_content_type ?? "music",
        },
        id,
      );
    // a player that can't be told what to play (a demo one): it just plays
    else if (supports(st, F.PLAY) && st?.state !== "playing") this._call("media_play", {}, id);
  }

  /** How many songs Music Assistant's queue of the shown player holds (with the token): one alone
   *  greys next and previous. Asked again when the song changes, at most every few seconds. */
  private _qInfo = new Map<string, { key: string; at: number; items?: number }>();
  private _queueItems(id: string, st: HassEntity | undefined): number | undefined {
    const { music_assistant_url: url, music_assistant_token: token } = this._config;
    if (!url || !token || !st) return undefined;
    const ma = isMA(this.stateOf(id)) ? id : this._twins.get(id);
    const queue = ma ? this.stateOf(ma)?.attributes.active_queue : undefined;
    if (!queue) return undefined;
    const key = `${queue}|${st.attributes.media_content_id ?? st.attributes.media_title ?? ""}`;
    const got = this._qInfo.get(queue);
    if (!got || (got.key !== key && Date.now() - got.at > 3000) || Date.now() - got.at > 30000) {
      const entry = { key, at: Date.now(), items: got?.items };
      this._qInfo.set(queue, entry);
      maCommand<any>(url, token, "player_queues/get", { queue_id: queue })
        .then((q) => {
          const n = Number(q?.items);
          if (Number.isFinite(n) && n !== entry.items) ((entry.items = n), this.requestUpdate());
        })
        .catch(() => undefined);
    }
    return got?.items;
  }

  /** A track of an opened playlist / album on a Music Assistant player (this one or its twin), with
   *  the token: Music Assistant plays the playlist from that track on. False: played alone. */
  private async _playWithin(id: string, st: HassEntity | undefined, pk: Pick): Promise<boolean> {
    const { music_assistant_url: url, music_assistant_token: token } = this._config;
    const track = pk.ma_uri ?? pk.media_content_id;
    if (!url || !token || !track || !/^[a-z_]+:\/\/(playlist|album)\//.test(pk.within ?? "")) return false;
    const ma = isMA(st) ? id : await this._twin(id);
    if (!ma) return false;
    let queue = this._maUids.get(ma);
    if (!queue) {
      try {
        const list = await this._hass!.callWS<{ entity_id: string; unique_id?: string }[] | Record<string, { unique_id?: string } | null>>({ type: "config/entity_registry/get_entries", entity_ids: [ma] });
        queue = (Array.isArray(list) ? list[0]?.unique_id : list[ma]?.unique_id) ?? undefined;
        if (queue) this._maUids.set(ma, queue);
      } catch {
        return false;
      }
    }
    if (!queue) return false;
    try {
      await maCommand(url, token, "player_queues/play_media", { queue_id: queue, media: pk.within, option: "replace", start_item: track });
      return true;
    } catch (e) {
      console.warn("glass-media: play from track", e);
      return false;
    }
  }

  /** At rest: the player's icon on the glass, its name and state, what to start, play / power. */
  /** What plays elsewhere in the house on speakers of its kind, to join: each group's leader (a
   *  few at most) – the card's own players first, then the one that started last. */
  private _playingElsewhere(id: string): HassEntity[] {
    const s = this._hass?.states;
    if (!s || this._config.speakers === false || !supports(s[id], F.GROUPING)) return [];
    const leader = (x: HassEntity) => {
      const m = x.attributes.group_members as string[] | undefined;
      return !Array.isArray(m) || m.length === 0 || m[0] === x.entity_id;
    };
    const cands = this._speakerIds()
      .filter((x) => x !== id)
      .map((x) => s[x])
      .filter((x): x is HassEntity => !!x && this._isPlaying(x) && leader(x) && !((x.attributes.group_members as string[] | undefined) ?? []).includes(id));
    const since = (x: HassEntity) => Date.parse(x.last_changed) || 0;
    cands.sort((a, b) => Number(this._ids.includes(b.entity_id)) - Number(this._ids.includes(a.entity_id)) || since(b) - since(a));
    return cands.slice(0, 3);
  }

  /** A group by its speakers' names: "Koupelna + Kuchyně". */
  private _groupName(leader: HassEntity): string {
    const name = (x: string) => String(this.stateOf(x)?.attributes.friendly_name ?? x);
    const m = ((leader.attributes.group_members as string[] | undefined) ?? []).filter((x) => this.stateOf(x));
    return (m.length > 1 ? m : [leader.entity_id]).map(name).join(" + ");
  }

  /** Music elsewhere in the house, each with Join (a speaker at rest). */
  private _joinBars(st: HassEntity | undefined) {
    if (!st || st.state === "unavailable") return nothing;
    // a soundbar on the TV's sound: joining would take it from the TV
    if (this._tvSet(st.entity_id)) return nothing;
    const joins = this._playingElsewhere(st.entity_id);
    if (!joins.length) return nothing;
    const busy = this._busyOn(st.entity_id);
    return html`<div class="joins">
      ${joins.map((j) => {
        const art = this._artUrl(j);
        return html`<button class="joinbar" @click=${() => this._joinTo(st.entity_id, j.entity_id)} ?disabled=${busy}>
          ${art ? html`<img src=${art} alt="" />` : html`<ha-icon icon="mdi:speaker-multiple"></ha-icon>`}
          <span class="jt">
            <span class="jn">${tr("Playing in {name}", { name: this._groupName(j) })}</span>
            <span class="js">${[j.attributes.media_title, j.attributes.media_artist].filter(Boolean).join(" · ")}</span>
          </span>
          <span class="jgo">${busy && this._joining === j.entity_id ? html`<i class="spin"></i>` : tr("Join")}</span>
        </button>`;
      })}
    </div>`;
  }

  /** This speaker joins the one playing elsewhere: it plays the same, in its group. */
  private _joining?: string;
  private _joinTo(id: string, leader: string) {
    haptic("selection");
    this._joining = leader;
    const members: string[] = this.stateOf(leader)?.attributes.group_members ?? [];
    this._groupWant.set(id, {
      inGroup: true,
      members: JSON.stringify(members),
      until: Date.now() + 10 * 60_000,
    });
    // the card stays on this speaker, a spinner till it plays
    const ch: Chosen = {
      id,
      at: Date.now(),
      hold: Date.now() + 15000,
      from: "\u0000",
    };
    this._chosen = ch;
    picks.set(this._linkKey, ch);
    rememberPlayers();
    pickBus.dispatchEvent(new CustomEvent("pick", { detail: this._linkKey }));
    window.setTimeout(() => this.requestUpdate(), 15100);
    // the music comes from Music Assistant (the leader's twin plays its queue): MA groups them, so
    // its queue goes on playing on both – the speakers' own grouping would take it from MA
    void (async () => {
      const lt = this._twinPlays(leader) ?? (await this._twin(leader).then(() => this._twinPlays(leader)));
      const mt = lt ? await this._twin(id) : undefined;
      if (lt && mt)
        this._hass?.callService("media_player", "join", {
          entity_id: lt,
          group_members: [mt],
        });
      else
        this._hass?.callService("media_player", "join", {
          entity_id: leader,
          group_members: [id],
        });
    })();
    this.requestUpdate();
  }

  private _idleTop(st: HassEntity | undefined) {
    const name = this._config.name ?? st?.attributes.friendly_name ?? this._main();
    const off = st?.state === "off";
    const gone = !st || st.state === "unavailable";
    const icon = st?.attributes.device_class === "tv" ? "mdi:television" : st?.attributes.device_class === "receiver" ? "mdi:audio-video" : "mdi:speaker";
    const p = this._press(st);
    const canPlay = !gone && (off ? supports(st, F.TURN_ON) : supports(st, F.PLAY));
    // music elsewhere in the house: join it
    return html`<div class="rest-top">
      <div class="rest-icon" role="button" aria-label=${name} @pointerdown=${p.down} @pointermove=${p.move} @pointerup=${p.up} @pointercancel=${p.cancel} @contextmenu=${p.context}>
        <ha-icon .icon=${icon}></ha-icon>
      </div>
      <div class="txt">
        ${this._who(name, "title")}
        <span class="sub">${gone ? tr("Unavailable") : off ? tr("Off") : tr("Nothing playing")}</span>
      </div>
      ${this._joinBars(st)}
      ${
        canPlay
          ? html`<div class="ctrls rest-ctrls">
              ${this._btn(off ? "mdi:power" : "mdi:play", off ? tr("Turn on") : tr("Play"), () => (off ? this._call("turn_on") : this._playPause(st!)), st && this._busyOn(st.entity_id) ? "main busy" : "main")}
            </div>`
          : nothing
      }
    </div>`;
  }

  /** The sheet of covers over the card, and the handle that brings it back. */
  private _sheet(main: string, idle: boolean, below: number) {
    if (!this._libOn) return nothing;
    const id = this._libId();
    const lib = this._lib.get(id);
    if (!lib || lib === "none") return nothing;
    // open by default while nothing plays; what was tapped wins until that changes
    if (this._libRest !== idle) {
      this._libRest = idle;
      this._libOpen = undefined;
    }
    const open = this._q ? true : (this._libOpen ?? idle);
    // opened while something plays: down again after a few quiet seconds
    // (armed once when it opens; a touch re-arms it – not every redraw, it redraws each second)
    if (open && !idle) {
      if (this._closeT === undefined) this._armClose();
    } else {
      clearTimeout(this._closeT);
      this._closeT = undefined;
    }
    const toggle = () => {
      haptic("selection");
      this._libOpen = !open;
      if (open) this._stack = [];
      this.requestUpdate();
    };
    // a finger in the sheet scrolls the sheet – never the page or a Bubble Card pop-up around it;
    // any touch there holds it open a while longer
    const keep = (e: Event) => {
      e.stopPropagation();
      if (open && !idle) this._armClose();
    };
    // the handle on top of the card (away from play); the sheet drops from there
    this._handleTpl = html`<button class="handle ${open ? "open" : ""}" aria-label=${tr("Favorites")} aria-expanded=${open ? "true" : "false"} @click=${toggle}>
      <i></i>
    </button>`;
    return html`<div class="libwrap ${open ? "open" : ""}" style="--below:${below}px">
      <div class="sheet ${this._narrow || this._fillH ? "libf" : ""}" @touchstart=${passive(keep)} @touchmove=${passive(keep)} @wheel=${passive(keep)} @pointerdown=${keep}>
        ${
          this._ids.length > 1 && !this._stack.length
            ? html`<div class="sheet-who">${this._who(this._config.name ?? this.stateOf(main)?.attributes.friendly_name ?? main)}</div>`
            : nothing
        }
        ${idle && !this._stack.length && !this._q ? html`<div class="sheet-join">${this._joinBars(this.stateOf(main))}</div>` : nothing} ${this._sheetBody(id, lib, keep)}
        <button class="grab" aria-label=${tr("Close")} @click=${toggle}>
          <i></i>
        </button>
      </div>
    </div>`;
  }

  /** show: all on a phone – the library below the player, as the library card draws it: always
   *  there, it scrolls on its own (the card filling the screen: down to the dock). */
  private _pane(main: string, idle: boolean) {
    const id = this._libId();
    const lib = this._lib.get(id);
    if (!lib || lib === "none") return nothing;
    const keep = (e: Event) => e.stopPropagation();
    return html`<div class="libpane libf" @touchstart=${passive(keep)} @touchmove=${passive(keep)} @wheel=${passive(keep)}>
      ${idle && !this._stack.length && !this._q ? html`<div class="sheet-join">${this._joinBars(this.stateOf(main))}</div>` : nothing}
      ${this._sheetBody(id, lib, keep)}
    </div>`;
  }

  /** show: library – the library alone, always open: whose it is (a tap picks another player), its rows. */
  private _libCard(st: HassEntity | undefined) {
    const main = this._main();
    const id = this._libId();
    const lib = this._lib.get(id);
    // a finger in it scrolls it – never the page or a Bubble Card pop-up around it
    const keep = (e: Event) => e.stopPropagation();
    const name = this._config.name ?? st?.attributes.friendly_name ?? main;
    return html`<div class="frame surface libf" @touchstart=${passive(keep)} @touchmove=${passive(keep)} @wheel=${passive(keep)}>
      <div class="lib-head">${this._who(name, "title")} ${st?.state === "playing" ? html`<i class="eq" aria-hidden="true"><b></b><b></b><b></b></i>` : nothing}</div>
      ${lib === "none" ? html`<div class="lib-empty">${tr("Nothing to start here")}</div>` : this._sheetBody(id, lib ?? "loading", keep)}
      ${this._pickOpen && this._ids.length > 1 ? this._players(main) : nothing}
    </div>`;
  }

  /** layout: screen – the whole screen: the cover big over itself blurred, the song, the time. */
  private _screen(st: HassEntity | undefined) {
    const c = this._config;
    const id = this._main();
    const a = st?.attributes ?? {};
    const playing = this._isPlaying(st);
    const idle = !playing && !LOADED.has(st?.state ?? "");
    const url = idle ? undefined : this._artUrl(st);
    const pname = c.name ?? a.friendly_name ?? id;
    const title = a.media_title ?? a.media_series_title ?? "";
    const artist = a.media_artist ?? a.media_album_artist ?? a.app_name ?? a.source ?? "";
    const album = a.media_album_name && a.media_album_name !== title ? a.media_album_name : "";
    const now = new Date();
    const lang = language(this._hass);
    const time = now.toLocaleTimeString(lang, { hour: "numeric", minute: "2-digit", hour12: hour12(this._hass) });
    const date = now.toLocaleDateString(lang, { weekday: "long", day: "numeric", month: "long" });
    const clock = c.clock !== false;
    return html`<div
      class="screen ink-light ${playing ? "playing" : ""} ${idle ? "rest" : ""} ${this._calm ? "calm" : ""}"
      style=${this._color ? `--sc:${this._color}` : ""}
      @pointermove=${this._wake}
      @pointerdown=${this._wake}
    >
      <div class="sbg">${keyed(url ?? "", html`<i class="sbgi ${url ? "" : "none"}" style=${url ? `background-image:${cssUrl(url)}` : ""}></i>`)}</div>
      <div class="sshade"></div>
      <div class="shead">
        ${clock && !idle ? html`<div class="sclock"><b>${time}</b><span>${date}</span></div>` : html`<span></span>`}
      </div>
      ${
        idle
          ? html`<div class="sidle">
              ${clock ? html`<b class="sbig">${time}</b><span class="sdate">${date}</span>` : nothing}
              <span class="snow">${this._kindBadge(id)}<span>${pname}</span><span class="dim">· ${st?.state === "unavailable" ? tr("Unavailable") : tr("Nothing playing")}</span></span>
              ${
                st && st.state !== "unavailable" && (supports(st, F.PLAY) || supports(st, F.TURN_ON))
                  ? html`<div class="ctrls">${this._btn("mdi:play", tr("Play"), () => this._playPause(st), this._busyOn(st.entity_id) ? "main busy" : "main")}</div>`
                  : nothing
              }
            </div>`
          : html`<div class="sbody">
              <div class="scov">${keyed(url ?? "", html`<div class="scovin">${this._artArea(st, title)}</div>`)}</div>
              <div class="sinfo">
                <span class="splayer">${this._kindBadge(id)}<span>${pname}</span></span>
                ${keyed(
                  title,
                  html`<div class="stxt">
                    <div class="stitle">${title || pname}</div>
                    ${artist ? html`<div class="sartist">${artist}</div>` : nothing} ${album ? html`<div class="salbum">${album}</div>` : nothing}
                  </div>`,
                )}
                <div class="sctl">${this._progBar(st, id)}
                  <div class="ctrls">${this._ctrls(st, id)}</div>
                </div>
              </div>
            </div>`
      }
    </div>`;
  }

  /** layout: tile – one pill: the art, what plays, play / pause; the pill itself is the volume. */
  private _tile(st: HassEntity | undefined) {
    const id = this._main();
    const vol = this._volume(id);
    const [t1, t2] = this._what(st);
    const ev = vol !== undefined ? this._volEvents(id) : undefined;
    const p = this._press(st);
    const playing = this._isPlaying(st);
    return html`<div class="frame surface tilef ${playing ? "playing" : ""} ${this._tone(st)}">
      ${this._bg(st)}
      <div
        class="lbar tile ${vol !== undefined ? "slides" : ""} ${LOADED.has(st?.state ?? "") || this._drag.has(`vol|${id}`) ? "lit" : ""}"
        style="--pct:${Math.round((vol ?? 0) * 100)}"
        @pointerdown=${ev?.down}
        @pointermove=${ev?.move}
        @pointerup=${ev?.up}
        @pointercancel=${ev?.cancel}
      >
        ${vol !== undefined ? html`<i class="fill"></i>` : nothing}
        <div
          class="artbtn"
          role="button"
          aria-label=${t1}
          @pointerdown=${(e: PointerEvent) => (e.stopPropagation(), p.down(e))}
          @pointermove=${p.move}
          @pointerup=${(e: PointerEvent) => (e.stopPropagation(), p.up(e))}
          @pointercancel=${p.cancel}
          @contextmenu=${p.context}
        >
          ${this._art_(st, "round")}
        </div>
        <div class="txt">
          <span class="title">${t1}</span>
          <span class="sub">${this._drag.has(`vol|${id}`) ? `${tr("Volume")} ${Math.round((vol ?? 0) * 100)} %` : t2}</span>
        </div>
        ${
          st && st.state !== "unavailable" && (supports(st, F.PLAY) || supports(st, F.PAUSE) || supports(st, F.TURN_ON))
            ? this._btn(this._playIcon(st), playing ? tr("Pause") : tr("Play"), () => this._playPause(st), this._busyOn(st.entity_id) ? "main busy" : "main")
            : nothing
        }
      </div>
    </div>`;
  }

  /** The art, blurred, as the tile's light behind the glass. */
  private _bg(st: HassEntity | undefined) {
    const url = this._artUrl(st);
    if (this._config.art_background === false || !url) return nothing;
    // a pause dims the art (the colours of the text and buttons stay: see _tone)
    const bg = html`<i class="bg ${st?.state === "playing" ? "" : "idle"}" style=${`background-image:${cssUrl(url)}`}></i>`;
    // in a panel (a pop-up's side): the light of the art fills the whole panel, to its edges
    return this.hasAttribute("in-panel") ? html`<div class="bgclip">${bg}</div>` : bg;
  }

  /** The song's bar: where it is, a drag (or a tap) seeks. */
  private _progBar(st: HassEntity | undefined, id: string) {
    const live = !!st && st.state !== "unavailable" && st.state !== "off";
    const dur = Number(st?.attributes.media_duration) || 0;
    const posAt = st && live ? this._position(st) : undefined;
    // never past the end (the next song may come a moment late)
    const posRaw = posAt !== undefined && dur > 0 ? Math.min(posAt, dur) : posAt;
    const drag = this._drag.get("pos");
    const pos = drag !== undefined ? drag * dur : posRaw;
    const seek = dur > 0 && supports(st, F.SEEK);
    const posEv = (e: PointerEvent) =>
      this._slide("pos", e, (f) => {
        const p = Math.round(f * dur);
        this._seek = { id, pos: p, at: Date.now() };
        this._call("media_seek", { seek_position: p });
      });
    if (!(dur > 0) || pos === undefined) return nothing;
    return html`<div class="prog">
                        <div
                          class="track ${seek ? "seek" : ""} ${drag !== undefined && this._moved.has("pos") ? "dragging" : ""}"
                          style="--f:${Math.min(1, pos / dur)}"
                          @pointerdown=${seek ? posEv : nothing}
                          @pointermove=${seek ? posEv : nothing}
                          @pointerup=${seek ? posEv : nothing}
                          @pointercancel=${seek ? posEv : nothing}
                        >
                          <i></i>
                        </div>
                        <div class="times"><span>${fmt(pos)}</span><span>-${fmt(dur - pos)}</span></div>
                      </div>`;
  }

  /** Shuffle, previous, play / pause, next, repeat – those the player has. */
  private _ctrls(st: HassEntity | undefined, id: string) {
    const live = !!st && st.state !== "unavailable" && st.state !== "off";
    const playing = this._isPlaying(st);
    const repeat = String(st?.attributes.repeat ?? "off");
    // one song alone in Music Assistant's queue: nowhere to skip to
    const lone = live && (this._queueItems(id, st) ?? 2) <= 1;
    return html`${live && supports(st, F.SHUFFLE) ? this._btn("mdi:shuffle-variant", tr("Shuffle"), () => this._call("shuffle_set", { shuffle: !st!.attributes.shuffle }), "small", !!st!.attributes.shuffle) : nothing}
                  ${live && supports(st, F.PREVIOUS) ? this._btn("mdi:skip-previous", tr("Previous"), () => this._call("media_previous_track"), "", false, lone) : nothing}
                  ${
                    st && st.state !== "unavailable" && (supports(st, F.PLAY) || supports(st, F.PAUSE) || supports(st, F.TURN_ON))
                      ? this._btn(this._playIcon(st), playing ? tr("Pause") : tr("Play"), () => this._playPause(st), this._busyOn(st.entity_id) ? "main busy" : "main")
                      : nothing
                  }
                  ${live && supports(st, F.NEXT) ? this._btn("mdi:skip-next", tr("Next"), () => this._call("media_next_track"), "", false, lone) : nothing}
                  ${
                    live && supports(st, F.REPEAT)
                      ? this._btn(
                          repeat === "one" ? "mdi:repeat-once" : repeat === "all" ? "mdi:repeat" : "mdi:repeat-off",
                          tr("Repeat"),
                          () =>
                            this._call("repeat_set", {
                              repeat: repeat === "off" ? "all" : repeat === "all" ? "one" : "off",
                            }),
                          "small",
                          repeat !== "off",
                        )
                      : nothing
                  }`;
  }

  private _card(st: HassEntity | undefined) {
    const id = this._main();
    const [t1, t2, by] = this._what(st);
    const pname = this._config.name ?? st?.attributes.friendly_name ?? id;
    const vol = this._volume(id);
    const ev = vol !== undefined ? this._volEvents(id) : undefined;
    // muted shows an empty bar – unless it is being dragged (that unmutes it)
    const muted = this._isMuted(st) && !this._drag.has(`vol|${id}`) && !this._pending.has(id);
    const speakers = this._config.speakers === false ? [] : this._speakerIds().filter((s) => s !== id);
    const members: string[] = st?.attributes.group_members ?? [];
    const grouped = speakers.filter((m) => this._inGroup(id, m, members)).length;
    const playing = this._isPlaying(st);
    const ctl = this._ctl();
    // nothing on it (idle, off): no empty cover and no track buttons – the player, what to start
    const idle = !playing && !LOADED.has(st?.state ?? "");
    this._handleTpl = nothing;
    const below = this._below;
    const sheet = below ? nothing : this._sheet(id, idle, vol !== undefined || speakers.length ? 12 + 42 : 12);
    return html`<div class="frame surface cardf ${playing ? "playing" : ""} ${idle ? "rest" : ""} ${below ? "stacked" : ""} ${this._fillH ? "filled" : ""} ${this._tone(st)}">
      ${this._bg(st)} ${this._handleTpl}
      ${
        idle
          ? this._idleTop(st)
          : html` <div class="top">
              ${this._artArea(st, t1)}
              <div class="info">
                <div class="txt">
                  ${this._ids.length > 1 && by === undefined ? this._who(t1, "title") : html`<span class="title">${t1}</span>`}
                  ${
                    this._ids.length > 1 && by !== undefined
                      ? html`<span class="sub subw">${by ? html`<span class="by">${by} ·</span>` : nothing}${this._who(pname)}</span>`
                      : html`<span class="sub">${t2}</span>`
                  }
                </div>
                ${this._progBar(st, id)}
                <div class="ctrls">${this._ctrls(st, id)}                </div>
              </div>
            </div>`
      }
      ${sheet}
      ${
        vol !== undefined || speakers.length
          ? html`<div class="volrow">
              ${
                vol !== undefined
                  ? html`<div
                      class="lbar ${ctl.cls} vol slides ${muted ? "muted" : ""}"
                      style="${ctl.style};--pct:${muted ? 0 : Math.round(vol * 100)}"
                      @pointerdown=${ev!.down}
                      @pointermove=${ev!.move}
                      @pointerup=${ev!.up}
                      @pointercancel=${ev!.cancel}
                    >
                      <i class="fill"></i>
                      ${this._btn(
                        muted || vol === 0 ? "mdi:volume-off" : vol < 0.34 ? "mdi:volume-low" : vol < 0.67 ? "mdi:volume-medium" : "mdi:volume-high",
                        muted || vol === 0 ? tr("Unmute") : tr("Mute"),
                        () => this._mute(id, st!),
                        "small mute",
                        muted,
                      )}
                      <span class="vval">${muted ? tr("Muted") : `${Math.round(vol * 100)} %`}</span>
                    </div>`
                  : nothing
              }
              ${
                speakers.length
                  ? html`<button
                      class="spk ${ctl.cls} ${this._open ? "on" : ""}"
                      style=${ctl.style}
                      aria-expanded=${this._open ? "true" : "false"}
                      @click=${() => ((this._open = !this._open), this.requestUpdate())}
                    >
                      <ha-icon .icon=${"mdi:speaker-multiple"}></ha-icon>
                      ${grouped ? html`<span>+${grouped}</span>` : nothing}
                    </button>`
                  : nothing
              }
            </div>`
          : nothing
      }
      ${below ? this._pane(id, idle) : nothing}
      ${this._pickOpen && this._ids.length > 1 ? this._players(id) : nothing}
      ${
        this._open && speakers.length
          ? html`<div class="scrim" @click=${() => ((this._open = false), this.requestUpdate())}></div>
              ${this._speakers(id, [id, ...speakers], members)}`
          : nothing
      }
    </div>`;
  }

  /** Ticked or unticked: shown as pressed until the group the shown player reports changes
   *  (some players, like HA's demo ones, never report a speaker leaving). */
  private _groupWant = new Map<string, { inGroup: boolean; members: string; until: number }>();

  /**
   * Whether a speaker plays with the shown one: the leader lists it – unless the speaker itself says
   * otherwise (a list without the leader, or an empty one outside Music Assistant, whose members
   * report nothing of their own); some players update only the one that left.
   */
  private _inGroup(main: string, id: string, members: string[]): boolean {
    if (id === main) return true;
    const w = this._groupWant.get(id);
    if (w && w.members === JSON.stringify(members) && Date.now() < w.until) return w.inGroup;
    if (!members.includes(id)) return false;
    // the speaker's own list, when it has one, without the shown player: it left
    const own = this.stateOf(id)?.attributes.group_members as string[] | undefined;
    return !(Array.isArray(own) && own.length > 0 && !own.includes(main));
  }

  private _toggleGroup(main: string, id: string, inGroup: boolean) {
    const members: string[] = this.stateOf(main)?.attributes.group_members ?? [];
    this._groupWant.set(id, {
      inGroup: !inGroup,
      members: JSON.stringify(members),
      until: Date.now() + 10 * 60_000,
    });
    // played from Music Assistant: MA groups them (or lets go), so its queue keeps playing
    void (async () => {
      const lt = this._twinPlays(main);
      const mt = lt ? await this._twin(id) : undefined;
      if (lt && mt) {
        if (inGroup) this._hass?.callService("media_player", "unjoin", { entity_id: mt });
        else
          this._hass?.callService("media_player", "join", {
            entity_id: lt,
            group_members: [mt],
          });
      } else if (inGroup) this._call("unjoin", {}, id);
      else this._call("join", { group_members: [id] }, main);
    })();
    this.requestUpdate();
  }

  /** The speakers drawer: each with a tick (in this player's group or not) and its volume. */
  private _speakers(main: string, ids: string[], members: string[]) {
    const hass = this._hass!;
    const ctl = this._ctl();
    return html`<div class="spks">
      ${ids.map((id) => {
        const st = hass.states[id];
        const inGroup = this._inGroup(main, id, members);
        const vol = this._volume(id);
        const ev = vol !== undefined ? this._volEvents(id) : undefined;
        const name = st?.attributes.friendly_name ?? id;
        return html`<div class="srow ${inGroup ? "in" : ""}">
          <button class="tick" aria-pressed=${inGroup ? "true" : "false"} aria-label=${name} ?disabled=${id === main} @click=${() => this._toggleGroup(main, id, inGroup)}>
            <ha-icon .icon=${inGroup ? "mdi:check-circle" : "mdi:circle-outline"}></ha-icon>
          </button>
          <div
            class="lbar ${ctl.cls} svol ${vol !== undefined ? "slides" : ""}"
            style="${ctl.style};--pct:${Math.round((vol ?? 0) * 100)}"
            @pointerdown=${ev?.down}
            @pointermove=${ev?.move}
            @pointerup=${ev?.up}
            @pointercancel=${ev?.cancel}
          >
            ${vol !== undefined ? html`<i class="fill"></i>` : nothing}
            <span class="sname">${name}</span>
            <span class="vval">${vol !== undefined ? `${Math.round(vol * 100)} %` : ""}</span>
          </div>
        </div>`;
      })}
    </div>`;
  }

  /** The card's height while it plays: at rest it keeps it, so the dashboard doesn't jump. */
  private _fullH = 0;

  protected override updated(changed: Map<string, unknown>) {
    super.updated(changed);
    const f = this.renderRoot.querySelector<HTMLElement>(".frame.cardf");
    if (f) {
      if (f.classList.contains("rest")) f.style.minHeight = this._fullH ? `${this._fullH}px` : "";
      else {
        f.style.minHeight = "";
        this._fullH = f.offsetHeight;
      }
    }
    if (this._libOn && this._hass) void this._loadLib(this._libId());
    // the shown speaker's twin in Music Assistant, known before a button needs it
    if (this._config?.library_from && this._hass && !this._twins.has(this._main())) void this._twin(this._main());
    this._fitPanel();
    this._syncViz();
    this._marquee();
    if (this._config?.media_keys) mediaKeysOn(this), mediaKeysUpdate(this);
    else mediaKeysOff(this);
  }

  /**
   * A line too long for its place drifts slowly to its end, glides quickly back, waits a moment and
   * drifts again (the title, the artist, a player's name) – its indent moves, so the element stays.
   */
  private _marquee() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (const el of this.renderRoot.querySelectorAll<HTMLElement>(".title, .sub:not(.subw), .sartist, .salbum, .who > span")) {
      const text = el.textContent ?? "";
      const was = marquees.get(el);
      const w = el.clientWidth;
      if (was && was.text === text && was.w === w) continue;
      was?.anim?.cancel();
      el.classList.remove("mq");
      const dist = el.scrollWidth - w;
      if (!w || dist < 3) {
        marquees.set(el, { text, w });
        continue;
      }
      el.classList.add("mq");
      const wait = 2000, end = 1000, back = 600, run = (dist / MARQUEE_PX_S) * 1000;
      const T = wait + run + end + back;
      const at = (ms: number) => ms / T;
      const anim = el.animate(
        [
          { textIndent: "0px", offset: 0 },
          { textIndent: "0px", offset: at(wait), easing: "linear" },
          { textIndent: `${-dist}px`, offset: at(wait + run) },
          { textIndent: `${-dist}px`, offset: at(wait + run + end), easing: "cubic-bezier(.4,0,.2,1)" },
          { textIndent: "0px", offset: 1 },
        ],
        { duration: T, iterations: Infinity },
      );
      marquees.set(el, { text, w, anim });
    }
  }

  /** The media keys: what plays on the shown player, for the system's controls (macOS, Windows). */
  mediaKeyInfo() {
    const st = this._shownState();
    if (!st || !LOADED.has(st.state)) return undefined;
    const a = st.attributes;
    return {
      title: a.media_title ?? a.media_series_title,
      artist: a.media_artist ?? a.media_album_artist ?? a.app_name,
      album: a.media_album_name,
      art: this._artUrl(st),
      playing: this._isPlaying(st),
      position: this._position(st),
      duration: Number(a.media_duration) || undefined,
    };
  }

  /** A media key pressed: on the shown player, as the card's own buttons do it (through its queue). */
  mediaKeyAction(action: "play" | "pause" | "next" | "previous" | "seek", position?: number) {
    const st = this._shownState();
    if (!st) return;
    // play / pause: always a switch. The page keeps its silence playing for the keys, so the browser may
    // think it still plays and send pause again after a pause – a key pressed means "the other one"
    if (action === "play" || action === "pause") this._playPause(st);
    else if (action === "next") this._call("media_next_track");
    else if (action === "previous") this._call("media_previous_track");
    else if (action === "seek" && position !== undefined) {
      this._seek = { id: this._main(), pos: Math.round(position), at: Date.now() };
      this._call("media_seek", { seek_position: Math.round(position) });
    }
    this.requestUpdate();
  }

  /** A card in a closed pop-up may not get Home Assistant's changes: the page's current state. */
  mediaKeyRefresh() {
    const h = (document.querySelector("home-assistant") as (HTMLElement & { hass?: HomeAssistant }) | null)?.hass;
    if (h && h !== this._hass) this.hass = h;
  }

  /** In a panel: where the panel's edges are from the card's, for the art spread over it. */
  private _fitPanel() {
    const f = this.renderRoot.querySelector<HTMLElement>(".frame");
    const p = this._inPanel() ? this._panelEl() : undefined;
    const was = this.hasAttribute("in-panel");
    if (!f || !p) {
      if (was) (this.removeAttribute("in-panel"), this.requestUpdate());
      return;
    }
    const a = f.getBoundingClientRect();
    const b = p.getBoundingClientRect();
    if (!b.width) return;
    f.style.setProperty("--pl", `${a.left - b.left}px`);
    f.style.setProperty("--pt", `${a.top - b.top}px`);
    f.style.setProperty("--pr", `${b.right - a.right}px`);
    f.style.setProperty("--pb", `${b.bottom - a.bottom}px`);
    if (!was) (this.setAttribute("in-panel", ""), this.requestUpdate());
  }

  protected override willUpdate(changed: Map<string, unknown>) {
    super.willUpdate(changed);
    this.setAttribute("layout", this._config?.layout ?? "card");
    this.setAttribute("show", this._config?.show ?? "all");
    const g = this._config?.art_glass;
    if (g) this.setAttribute("art-glass", g === "dark-liquid" ? "dark" : "light");
    else this.removeAttribute("art-glass");
  }

  protected override render() {
    const c = this._config;
    if (!c || !this._hass) return nothing;
    const st = this._shownState();
    const accent = this._color ?? "var(--glass-media-accent, rgba(255, 255, 255, 0.9))";
    // the art's own colour lights the switched-on buttons (none without art: they keep the text's colour)
    const on = this._color ? `;--art-c:${this._color}` : "";
    const body = c.layout === "tile" ? this._tile(st) : c.layout === "screen" ? this._screen(st) : c.show === "library" ? this._libCard(st) : this._card(st);
    // fill_height: measured once it's on the page (and again on a resize, a pop-up opening)
    if (this._fills ? this._fillH === undefined : this._fillH !== undefined) {
      if (!this._fillAsked) ((this._fillAsked = true), this._onOpen());
    }
    const fill = this._fills && this._fillH ? `;height:${this._fillH}px` : "";
    return html`<div class="host" style="--art:${accent}${on}${fill}">${body}</div>`;
  }

  override getCardSize() {
    return this._config?.layout === "tile" ? 1 : 3;
  }

  getGridOptions() {
    return this._config?.layout === "tile" ? { columns: 6, rows: 1, min_rows: 1 } : { columns: 6, rows: 3, min_rows: 2 };
  }

  static override styles = [
    GlassElement.styles,
    surface,
    control,
    liquidBar,
    css`
      :host {
        display: block;
        height: 100%;
        container: mediatile / inline-size;
      }
      .host {
        height: 100%;
      }
      .frame {
        position: relative;
        box-sizing: border-box;
        height: 100%;
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 12px;
        border-radius: var(--g-radius);
        overflow: hidden;
        isolation: isolate;
      }
      /* the tile: just the pill, the blurred art inside its round shape */
      .frame.tilef {
        height: auto;
        padding: 0;
        border-radius: 999px;
        justify-content: center;
      }
      :host([layout="tile"]) {
        height: auto;
      }
      :host([nested][glass]:not([own-tile])) .frame.surface {
        background: none !important;
        border: none !important;
        box-shadow: none !important;
        -webkit-backdrop-filter: none !important;
        backdrop-filter: none !important;
      }
      :host([nested]:not([own-tile])) .frame::before,
      :host([nested]:not([own-tile])) .frame::after {
        display: none;
      }
      /* a tile of its own, as a room card's photo tile: its hairline edge and a soft deep shadow,
         without the inner rim of the glass (with it the edge read as a double white line) */
      :host([on-bare]) .frame.surface,
      :host(:not([nested])) .frame.surface {
        /* the edge of a room card's photo tile: a light hairline all round (a border – an inset
           shadow would lie under the WebGL glass) */
        /* a metallic grey hairline, one colour all round */
        border: 0.5px solid var(--glass-media-edge-color, rgba(160, 166, 176, 0.8)) !important;
        box-shadow:
          0 16px 40px rgba(0, 0, 0, 0.22),
          0 3px 10px rgba(0, 0, 0, 0.12) !important;
      }
      :host([dark][on-bare]) .frame.surface,
      :host([dark]:not([nested])) .frame.surface {
        border-color: var(--glass-media-edge-color-dark, rgba(118, 124, 136, 0.65)) !important;
      }
      :host([on-bare]) .frame.surface::after,
      :host(:not([nested])) .frame.surface::after {
        display: none;
      }
      :host([nested]:not([on-bare])) .frame.surface {
        --g-text: inherit;
        --g-text-2: inherit;
        color: inherit;
      }
      /* the art as the tile's light: blurred under the glass, brighter while it plays */
      .bg {
        position: absolute;
        inset: -30%;
        z-index: -1;
        background-size: cover;
        background-position: center;
        filter: blur(36px) saturate(1.5);
        opacity: 0.55;
        pointer-events: none;
        transition: opacity 0.6s ease;
      }
      .bg.idle {
        opacity: 0.25;
      }
      :host([dark]) .bg {
        opacity: 0.4;
        filter: blur(36px) saturate(1.4) brightness(0.7);
      }
      :host([dark]) .bg.idle {
        opacity: 0.18;
      }
      /* art_glass: the cover's colours over light liquid glass, or dark, whatever the hour */
      :host([art-glass="light"]) .bg {
        opacity: 0.55;
        filter: blur(36px) saturate(1.5);
      }
      :host([art-glass="light"]) .bg.idle {
        opacity: 0.25;
      }
      :host([art-glass="dark"]) .bg {
        opacity: 0.4;
        filter: blur(36px) saturate(1.4) brightness(0.7);
      }
      :host([art-glass="dark"]) .bg.idle {
        opacity: 0.18;
      }
      :host([art-glass="light"]:not([in-panel])) .frame.surface {
        background: rgba(250, 250, 252, 0.62) !important;
        --g-text: #1c1c1e;
        --g-text-2: rgba(28, 28, 30, 0.62);
        color: var(--g-text);
      }
      :host([art-glass="dark"]:not([in-panel])) .frame.surface {
        background: rgba(26, 26, 30, 0.62) !important;
        --g-text: #fff;
        --g-text-2: rgba(255, 255, 255, 0.7);
        color: var(--g-text);
      }
      /* in a panel: the panel's glass turned light or dark under the cover */
      :host([art-glass="light"]) .bgclip {
        background: rgba(250, 250, 252, 0.55);
      }
      :host([art-glass="dark"]) .bgclip {
        background: rgba(20, 20, 24, 0.45);
      }
      :host([art-glass="light"][in-panel]) .frame.cardf {
        --g-text: #1c1c1e;
        --g-text-2: rgba(28, 28, 30, 0.62);
        color: var(--g-text);
      }
      :host([art-glass="dark"][in-panel]) .frame.cardf {
        --g-text: #fff;
        --g-text-2: rgba(255, 255, 255, 0.7);
        color: var(--g-text);
      }

      /* the text in the colour that reads over the art: dark on a light one, white on a dark one */
      /* (over every look's text colour: the art decides) */
      .frame.ink-dark {
        --g-text: #1c1c1e !important;
        --g-text-2: rgba(28, 28, 30, 0.68) !important;
        --g-icon-shadow: none !important;
        color: #1c1c1e !important;
      }
      .frame.ink-light {
        --g-text: #fff !important;
        --g-text-2: rgba(255, 255, 255, 0.82) !important;
        color: #fff !important;
      }
      .frame.ink-light .txt,
      .frame.ink-light .times,
      .frame.ink-light .vval {
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.28);
      }

      .art {
        position: relative;
        background-size: cover;
        background-position: center;
        display: grid;
        place-items: center;
        color: var(--g-text-2);
        background-color: color-mix(in srgb, var(--g-text) 8%, transparent);
      }
      .art.fit {
        position: relative;
        overflow: hidden;
        isolation: isolate;
      }
      .art.fit::before,
      .art.fit::after {
        content: "";
        position: absolute;
        background: var(--art) center / cover no-repeat;
      }
      .art.fit::before {
        inset: -20%;
        filter: blur(18px) saturate(1.3) brightness(0.8);
      }
      .art.fit::after {
        inset: 0;
        background-size: contain;
      }
      /* YouTube's 4:3 thumbnail: its 16:9 frame (black bars above and below) cut to the square –
         the frame as tall as the square */
      .art.yt {
        background-size: 177.78% auto;
        background-position: center;
      }
      .art .chlogo {
        position: absolute;
        left: 8%;
        bottom: 8%;
        z-index: 1;
        max-width: 34%;
        max-height: 16%;
        padding: 6px 9px;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.88);
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
        object-fit: contain;
      }
      .art.logoplate {
        background: linear-gradient(160deg, #fff, #e9edf2);
      }
      .art .chlogo.big {
        position: static;
        max-width: 62%;
        max-height: 40%;
        padding: 0;
        background: none;
        box-shadow: none;
      }
      .art .spin {
        width: clamp(22px, 14cqw, 40px);
        aspect-ratio: 1;
        border-radius: 50%;
        border: 3px solid color-mix(in srgb, var(--g-text) 22%, transparent);
        border-top-color: var(--g-text);
        animation: artspin 0.9s linear infinite;
      }
      .art.round .spin {
        width: 18px;
        border-width: 2px;
      }
      @keyframes artspin {
        to {
          transform: rotate(360deg);
        }
      }
      .art.square {
        aspect-ratio: 1;
        border-radius: 14px;
        box-shadow:
          0 8px 24px rgba(0, 0, 0, 0.22),
          inset 0 0 0 0.5px rgba(255, 255, 255, 0.25);
      }
      .art.round {
        width: 42px;
        height: 42px;
        border-radius: 50%;
        box-shadow: inset 0 0 0 0.5px rgba(255, 255, 255, 0.3);
      }
      .art ha-icon {
        --mdc-icon-size: clamp(28px, 38cqw, 96px);
        display: flex;
        opacity: 0.8;
      }
      .art.round ha-icon {
        --mdc-icon-size: 22px;
      }
      .artbtn {
        flex: none;
        display: flex;
        justify-content: center;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }
      /* the cover and the visualizer in its place: a tap switches them, a swipe picks another look */
      .artwrap {
        position: relative;
        display: flex;
        justify-content: center;
        width: 100%;
        touch-action: pan-y;
      }
      .artwrap .art.square {
        transition:
          opacity 0.35s ease,
          transform 0.45s cubic-bezier(0.2, 0.8, 0.2, 1);
      }
      .vizon .art.square {
        opacity: 0;
        transform: scale(0.9);
      }
      canvas.viz {
        position: absolute;
        inset: -4%;
        width: 108%;
        height: 108%;
        pointer-events: none;
        animation: vizin 0.5s cubic-bezier(0.2, 0.8, 0.2, 1);
      }
      @keyframes vizin {
        from {
          opacity: 0;
          transform: scale(0.85);
        }
      }
      .vdots {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 2px;
        display: flex;
        justify-content: center;
        gap: 6px;
        opacity: 0;
        transition: opacity 0.4s ease;
        pointer-events: none;
      }
      .vdots.show {
        opacity: 1;
      }
      .vdots i {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: currentColor;
        color: var(--g-text);
        opacity: 0.35;
        transition:
          opacity 0.2s,
          transform 0.2s;
      }
      .vdots i.on {
        opacity: 0.95;
        transform: scale(1.2);
      }
      @media (prefers-reduced-motion: reduce) {
        canvas.viz {
          animation: none;
        }
      }

      .top {
        display: flex;
        gap: 14px;
        align-items: stretch;
        min-width: 0;
      }
      .info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 8px;
      }
      .txt {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .title {
        font-size: 16px;
        font-weight: 600;
        letter-spacing: -0.01em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .mq {
        text-overflow: clip !important;
      }
      .sub {
        font-size: 13px;
        color: var(--g-text-2);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-variant-numeric: tabular-nums;
      }

      /* the position: a thin groove filled in the text's colour (it reads over any art); a touch
         thickens it, a tap glides the fill to the new place, a drag follows the finger */
      .prog {
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .track {
        position: relative;
        height: 6px;
        margin: 2px 0;
        border-radius: 999px;
        background: color-mix(in srgb, var(--g-text) 18%, transparent);
        touch-action: pan-y;
        transition:
          height 0.2s ease,
          margin 0.2s ease;
      }
      .track.seek:active,
      .track.dragging {
        height: 10px;
        margin: 0;
      }
      .track.seek {
        cursor: pointer;
      }
      /* a taller hit area than the groove */
      .track.seek::before {
        content: "";
        position: absolute;
        inset: -10px 0;
      }
      .track i {
        position: absolute;
        inset: 0 auto 0 0;
        width: calc(var(--f) * 100%);
        border-radius: inherit;
        background: color-mix(in srgb, var(--g-text) 82%, transparent);
        transition: width 0.35s cubic-bezier(0.2, 0.8, 0.2, 1);
      }
      .track.dragging i {
        transition: none;
      }
      .times {
        display: flex;
        justify-content: space-between;
        font-size: 11px;
        color: var(--g-text-2);
        font-variant-numeric: tabular-nums;
      }

      .ctrls {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 4px;
        max-width: 300px;
      }
      .cbtn {
        position: relative;
        flex: none;
        width: 40px;
        height: 40px;
        padding: 0;
        display: grid;
        place-items: center;
        -webkit-tap-highlight-color: transparent;
      }
      .cbtn ha-icon {
        --mdc-icon-size: 22px;
        display: flex;
        filter: var(--g-icon-shadow);
      }
      .cbtn.small {
        width: 34px;
        height: 34px;
      }
      .cbtn.small ha-icon {
        --mdc-icon-size: 18px;
      }
      /* pressed: a ring inside the button – dark over a light background, light over a dark
         one (the text's tone: ink-dark / ink-light; else by the time of day) */
      .cbtn .press {
        position: absolute;
        inset: 3px;
        z-index: 1;
        border-radius: 50%;
        background: var(--press, rgba(0, 0, 0, 0.22));
        opacity: 0;
        transform: scale(0.7);
        transition:
          opacity 0.25s ease,
          transform 0.25s ease;
        pointer-events: none;
      }
      .cbtn ha-icon {
        position: relative;
        z-index: 2;
      }
      .cbtn:active .press,
      .cbtn.tap .press {
        opacity: 1;
        transform: scale(1);
        transition-duration: 0s;
      }
      :host([dark]) .frame,
      .frame.ink-light {
        --press: rgba(255, 255, 255, 0.3);
      }
      .frame.ink-dark {
        --press: rgba(0, 0, 0, 0.22);
      }
      /* play / pause is solid: no ring in it – the whole button lightens (by day) or darkens
         (at night) a little and gives way */
      .cbtn.main .press {
        inset: 0;
        transform: none;
        background: rgba(255, 255, 255, 0.16);
      }
      :host([dark]) .cbtn.main .press {
        background: rgba(0, 0, 0, 0.12);
      }
      .cbtn.main:active .press,
      .cbtn.main.tap .press {
        transform: none;
      }
      .cbtn.main:active,
      .cbtn.main.tap {
        transform: translateZ(0) scale(0.93);
      }
      .cbtn.main {
        transition:
          transform 0.18s ease,
          background 0.3s ease;
      }
      .spk:active {
        background: var(--press, rgba(0, 0, 0, 0.22));
      }
      /* round whatever their material */
      .cbtn,
      .lbar,
      .spk {
        border-radius: 999px;
      }
      .cbtn.mat,
      .spk.mat {
        position: relative;
        border: 0;
        cursor: pointer;
        color: var(--g-text);
      }
      /* shuffle, repeat: off faded, on as the other buttons – with a dot under it */
      .cbtn.small:not(.toggled):not(.mute) ha-icon {
        opacity: 0.42;
      }
      .cbtn .dot {
        position: absolute;
        left: 50%;
        bottom: 3px;
        width: 4px;
        height: 4px;
        margin-left: -2px;
        border-radius: 50%;
        background: currentColor;
      }
      /* nowhere to go (one song alone): greyed, not pressable */
      .cbtn:disabled {
        cursor: default;
        pointer-events: none;
      }
      .cbtn:disabled ha-icon {
        opacity: 0.3;
      }
      /* the volume icon: no material of its own, just the symbol on the bar */
      .cbtn.plain {
        position: relative;
        border: 0;
        padding: 0;
        background: none;
        box-shadow: none;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }
      .cbtn.plain ha-icon {
        --mdc-icon-size: 20px;
      }
      /* the volume icon: the text's colour over any background, muted or not */
      .cbtn.mute,
      .cbtn.mute.toggled {
        color: var(--g-text);
      }
      /* play / pause: the solid picked pill of the glass switches – graphite by day, light at night */
      .cbtn.main,
      :host([control-glass]) .cbtn.control.main {
        width: 48px;
        height: 48px;
        background: var(--glass-media-play, rgba(28, 28, 30, 0.86)) !important;
        color: #fff !important;
        border: 0 !important;
        box-shadow:
          0 6px 18px rgba(0, 0, 0, 0.22),
          inset 0 1px 0 rgba(255, 255, 255, 0.18) !important;
      }
      :host([dark]) .cbtn.main,
      :host([dark][control-glass]) .cbtn.control.main {
        background: var(--glass-media-play-dark, rgba(255, 255, 255, 0.9)) !important;
        color: #1c1c1e !important;
      }
      .cbtn.main::before {
        display: none;
      }
      .cbtn.main ha-icon {
        --mdc-icon-size: 26px;
        filter: none;
      }

      /* volume: the liquid glass bar of the lights, filled in the art's colour */
      .volrow {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .lbar {
        position: relative;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 4px;
        min-height: 42px;
        box-sizing: border-box;
        isolation: isolate;
      }
      .lbar.slides {
        cursor: ew-resize;
        touch-action: pan-y;
        user-select: none;
        -webkit-user-select: none;
      }
      .lbar.vol {
        flex: 1;
        min-width: 0;
      }
      .fill {
        position: absolute;
        inset: 0;
        z-index: -1;
        border-radius: inherit;
        pointer-events: none;
        background: linear-gradient(90deg, color-mix(in srgb, var(--art) 42%, transparent), color-mix(in srgb, var(--art) 26%, transparent));
        clip-path: inset(0 calc(100% - 100% * var(--pct) / 100) 0 0 round 999px);
        transition: clip-path 0.2s ease;
      }
      .vicon {
        --mdc-icon-size: 18px;
        margin-left: 8px;
        color: var(--g-text-2);
      }
      .vval {
        white-space: nowrap;
        margin-left: auto;
        padding-right: 12px;
        font-size: 13px;
        color: var(--g-text-2);
        font-variant-numeric: tabular-nums;
      }
      .spk {
        flex: none;
        height: 42px;
        min-width: 42px;
        padding: 0 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        font: inherit;
        font-size: 13px;
        font-weight: 600;
      }
      .spk ha-icon {
        --mdc-icon-size: 20px;
        display: flex;
      }
      .spk.on {
        background: color-mix(in srgb, var(--g-text) 18%, transparent);
      }

      /* the speakers: a drop-up over the card, above the volume row – never taller than
         the card (it scrolls inside); a tap beside it closes it */
      .scrim {
        position: absolute;
        inset: 0;
        z-index: 4;
      }
      .spks {
        position: absolute;
        left: 12px;
        right: 12px;
        bottom: calc(12px + 42px + 8px);
        z-index: 5;
        max-height: calc(100% - 12px - 42px - 8px - 12px);
        overflow-y: auto;
        overscroll-behavior: contain;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 8px;
        border-radius: 22px;
        color: var(--g-text);
        background: var(--glass-media-sheet, rgba(250, 250, 252, 0.78));
        border: 0.5px solid rgba(255, 255, 255, 0.5);
        box-shadow:
          0 12px 36px rgba(0, 0, 0, 0.22),
          inset 0 1px 0 rgba(255, 255, 255, 0.7);
        -webkit-backdrop-filter: blur(calc(28px * var(--glass-blur-scale, 1))) saturate(170%);
        backdrop-filter: blur(calc(28px * var(--glass-blur-scale, 1))) saturate(170%);
        animation: spks-in 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
        transform-origin: 100% 100%;
      }
      :host([dark]) .spks {
        background: var(--glass-media-sheet-dark, rgba(36, 36, 40, 0.78));
        border-color: rgba(255, 255, 255, 0.12);
        box-shadow:
          0 12px 36px rgba(0, 0, 0, 0.45),
          inset 0 1px 0 rgba(255, 255, 255, 0.12);
      }
      @keyframes spks-in {
        from {
          opacity: 0;
          transform: translateY(8px) scale(0.97);
        }
      }
      .srow {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .tick {
        flex: none;
        width: 34px;
        height: 34px;
        padding: 0;
        border: 0;
        background: none;
        color: var(--g-text-2);
        display: grid;
        place-items: center;
        cursor: pointer;
      }
      .tick[disabled] {
        cursor: default;
      }
      .srow.in .tick {
        color: var(--g-text);
      }
      .tick ha-icon {
        --mdc-icon-size: 22px;
        display: flex;
      }
      .lbar.svol {
        flex: 1;
        min-width: 0;
        min-height: 36px;
      }
      /* the drawer is its own sheet: its text dark by day, white at night, whatever the art */
      .spks {
        --g-text: #1c1c1e;
        --g-text-2: rgba(28, 28, 30, 0.62);
      }
      :host([dark]) .spks {
        --g-text: #fff;
        --g-text-2: rgba(255, 255, 255, 0.7);
      }
      .spks .sname,
      .spks .vval {
        text-shadow: none;
      }
      /* a speaker's volume: a clear fill – the art's colour, else the text's */
      .spks .fill {
        background: linear-gradient(90deg, color-mix(in srgb, var(--art-c, var(--g-text)) 50%, transparent), color-mix(in srgb, var(--art-c, var(--g-text)) 34%, transparent));
      }
      .srow:not(.in) .lbar.svol {
        opacity: 0.7;
      }

      /* in a panel (a pop-up's side): the player lies on the panel's own glass, the blurred
         cover spread over the whole panel to its rounded edges – not a card's shape inside it */
      :host([in-panel]) .frame.cardf {
        overflow: visible;
      }
      .bgclip {
        position: absolute;
        left: calc(var(--pl, 0px) * -1);
        top: calc(var(--pt, 0px) * -1);
        right: calc(var(--pr, 0px) * -1);
        bottom: calc(var(--pb, 0px) * -1);
        z-index: -1;
        border-radius: var(--g-radius-lg);
        overflow: hidden;
        pointer-events: none;
      }

      /* starting what was tapped: a spinner on its cover and on play, till it plays */
      .spin {
        position: absolute;
        inset: 0;
        margin: auto;
        width: 26px;
        height: 26px;
        border-radius: 50%;
        border: 2.5px solid currentColor;
        border-right-color: transparent;
        animation: media-spin 0.8s linear infinite;
        pointer-events: none;
      }
      @keyframes media-spin {
        to {
          transform: rotate(360deg);
        }
      }
      .cbtn.busy ha-icon {
        opacity: 0;
      }
      .it.loading .cov {
        color: #fff;
      }
      .it.loading .cov::after {
        content: "";
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.38);
      }
      .it.loading .spin {
        z-index: 1;
        width: 30px;
        height: 30px;
        border-width: 3px;
      }
      @media (prefers-reduced-motion: reduce) {
        .spin {
          animation-duration: 2.4s;
        }
      }

      /* show: player – the player alone fills its side: the cover and controls on top, the volume
         at the bottom */
      :host([show="player"]) .cardf .volrow {
        margin-top: auto;
      }
      :host([show="player"]) .art.square {
        width: min(100%, 380px);
      }

      /* show: library – the library as a card of its own, filling the room it gets */
      .frame.libf {
        padding: 0;
        gap: 0;
        --glass-media-cover: 118px;
      }
      @container mediatile (min-width: 640px) {
        .frame.libf {
          --glass-media-cover: 138px;
        }
        .libf .grid {
          grid-template-columns: repeat(auto-fill, minmax(128px, 1fr));
        }
      }
      .lib-head {
        flex: none;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 16px 18px 6px;
        min-width: 0;
      }
      .lib-head .who.title,
      .lib-head .title {
        font-size: 20px;
        font-weight: 700;
      }
      .lib-head .eq {
        flex: none;
        width: 16px;
        height: 14px;
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
      }
      .libf .sec-head {
        padding-left: 18px;
      }
      .libf .row {
        padding: 0 18px 4px;
        scroll-padding: 0 18px;
        gap: 14px;
      }
      .libf .sheet-head {
        padding: 6px 18px 8px 12px;
      }
      .libf .grid {
        padding: 0 18px 18px;
      }
      /* search results: covers in a grid, under their heading */
      .sgrid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(var(--glass-media-cover, 92px), 1fr));
        gap: 12px 10px;
        padding: 0 14px 8px;
      }
      .libf .sgrid {
        padding: 0 18px 8px;
        gap: 14px 14px;
      }
      .none {
        padding: 8px 18px 16px;
        font-size: 14px;
        color: var(--g-text-2);
      }
      .lib-empty {
        flex: 1;
        display: grid;
        place-items: center;
        color: var(--g-text-2);
        font-size: 14px;
      }
      .libf .spks.plist {
        left: 12px;
        right: auto;
        width: min(340px, calc(100% - 24px));
        top: 56px;
      }

      /* the player's name: a tap lists the card's players */
      .who {
        all: unset;
        display: inline-flex;
        align-items: center;
        gap: 2px;
        min-width: 0;
        max-width: 100%;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }
      .who > span {
        min-width: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .who ha-icon {
        flex: none;
        --mdc-icon-size: 18px;
        display: flex;
        opacity: 0.7;
        transition: transform 0.2s ease;
      }
      .who.title {
        font-size: 16px;
        font-weight: 600;
        letter-spacing: -0.01em;
      }
      .who[aria-expanded="true"] ha-icon {
        transform: rotate(180deg);
      }
      .who:focus-visible {
        outline: 2px solid var(--g-text-2);
        outline-offset: 2px;
        border-radius: 6px;
      }
      .sub.subw {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .subw .by {
        min-width: 0;
        flex: 0 1 auto;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .subw .who {
        flex: 0 1 auto;
      }
      .subw .who ha-icon {
        --mdc-icon-size: 16px;
      }
      .sheet-who {
        flex: none;
        display: flex;
        padding: 10px 14px 2px;
        font-size: 15px;
        font-weight: 600;
      }
      /* the players: a drop-down from the top of the card */
      .spks.plist {
        top: 12px;
        bottom: auto;
        max-height: calc(100% - 24px);
        gap: 2px;
        z-index: 7;
        transform-origin: 50% 0;
        animation-name: plist-in;
      }
      @keyframes plist-in {
        from {
          opacity: 0;
          transform: translateY(-8px) scale(0.97);
        }
      }
      .prow {
        all: unset;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 8px;
        border-radius: 14px;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }
      .prow:active,
      .prow.in {
        background: color-mix(in srgb, var(--g-text) 8%, transparent);
      }
      .prow .pic {
        flex: none;
        width: 40px;
        height: 40px;
        border-radius: 10px;
        background: color-mix(in srgb, var(--g-text) 8%, transparent) center / cover no-repeat;
        display: grid;
        place-items: center;
        color: var(--g-text-2);
      }
      .prow .pic ha-icon {
        --mdc-icon-size: 22px;
        display: flex;
      }
      .ptxt {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
      }
      .ptxt > span {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .ptxt .sname {
        font-size: 15px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .ptxt .sname .nm {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      /* the player's kind (Sonos, Chromecast… Home Assistant): a small mark after its name */
      .pkind {
        flex: none;
        display: inline-flex;
        width: 14px;
        height: 14px;
        color: var(--g-text-2);
        opacity: 0.8;
      }
      .pkind.word {
        width: auto;
        height: auto;
        font: 800 9px/1 system-ui, sans-serif;
        font-style: normal;
        letter-spacing: 0.14em;
      }
      .pkind b {
        width: 100%;
        height: 100%;
        background: currentColor;
        -webkit-mask: center / contain no-repeat;
        mask: center / contain no-repeat;
      }
      .pkind ha-icon {
        --mdc-icon-size: 14px;
        display: flex;
      }
      .ptxt .psub {
        font-size: 12px;
        color: var(--g-text-2);
      }
      .prow .chk {
        flex: none;
        --mdc-icon-size: 20px;
        display: flex;
      }
      /* what plays: three bars rising and falling, each at its own pace */
      .prow .eq {
        flex: none;
        width: 16px;
        height: 14px;
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        margin: 0 2px;
      }
      .eq b {
        width: 4px;
        height: 100%;
        border-radius: 1.5px;
        background: var(--g-text-2);
        transform-origin: 50% 100%;
        animation: eq-bar 1s ease-in-out infinite alternate;
      }
      .eq b:nth-child(1) {
        animation-duration: 0.82s;
        animation-delay: -0.3s;
      }
      .eq b:nth-child(2) {
        animation-duration: 1.07s;
        animation-delay: -0.7s;
      }
      .eq b:nth-child(3) {
        animation-duration: 0.93s;
        animation-delay: -0.15s;
      }
      @keyframes eq-bar {
        0% {
          transform: scaleY(0.25);
        }
        35% {
          transform: scaleY(0.9);
        }
        60% {
          transform: scaleY(0.45);
        }
        100% {
          transform: scaleY(1);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .eq b {
          animation: none;
          transform: scaleY(0.7);
        }
      }
      /* a narrow card: the tick says enough on the picked one */
      @container mediatile (max-width: 220px) {
        .prow .eq.main {
          display: none;
        }
      }
      .prow .chk {
        color: var(--g-text);
      }
      .sname {
        padding-left: 10px;
        font-size: 14px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* layout: tile */
      .lbar.tile {
        gap: 10px;
        padding: 4px 4px 4px 4px;
      }
      /* the tile: the pill itself is the glass, over the blurred art – no second glass on it
         (that would wash the art out to white) */
      .lbar.tile {
        background: none;
        border: 0;
        box-shadow: none;
      }
      .frame.tilef .bg.idle {
        opacity: 0.42;
      }
      :host([dark]) .frame.tilef .bg.idle {
        opacity: 0.3;
      }
      .lbar.tile .txt {
        flex: 1;
        min-width: 0;
        align-items: flex-start;
        text-align: left;
      }
      .lbar.tile .artbtn {
        align-self: center;
      }
      /* the volume fills from the cover's edge (as a light's brightness from its bulb),
         only while it plays or is dragged – idle, the pill stays clear */
      .lbar.tile .fill {
        clip-path: inset(0 calc(100% - 50px - (100% - 50px) * var(--pct) / 100) 0 0 round 999px);
      }
      .lbar.tile:not(.lit) .fill {
        opacity: 0;
      }
      .lbar.tile .title {
        font-size: 14px;
      }
      /* long titles end in … before the play button, never under it */
      .lbar.tile .title,
      .lbar.tile .sub {
        max-width: 100%;
        box-sizing: border-box;
      }
      .lbar.tile .sub {
        font-size: 12px;
      }
      .lbar.tile .cbtn.main {
        width: 42px;
        height: 42px;
      }
      .lbar.tile .cbtn.main ha-icon {
        --mdc-icon-size: 22px;
      }

      /* at rest: the player's icon on the glass, its name, what to start – no empty cover */
      .rest-top {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 12px;
        text-align: center;
        animation: rest-in 0.35s ease;
      }
      @keyframes rest-in {
        from {
          opacity: 0;
          transform: translateY(6px);
        }
      }
      .rest-icon {
        flex: none;
        width: clamp(64px, 24cqw, 108px);
        aspect-ratio: 1;
        border-radius: 50%;
        display: grid;
        place-items: center;
        color: var(--g-text-2);
        background: color-mix(in srgb, var(--g-text) 7%, transparent);
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.55),
          inset 0 0 0 0.5px rgba(255, 255, 255, 0.4);
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }
      .rest-icon ha-icon {
        --mdc-icon-size: clamp(30px, 11cqw, 50px);
        display: flex;
      }
      .rest-top .txt {
        align-items: center;
        max-width: 100%;
      }
      .rest-top .txt .title,
      .rest-top .txt .sub {
        max-width: 100%;
      }
      .rest-ctrls {
        justify-content: center;
        max-width: none;
      }
      /* music elsewhere: join it */
      .sheet-join .joins {
        align-items: stretch;
        padding: 0 0 10px;
      }
      .sheet-join .joinbar {
        max-width: none;
      }
      .joins {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        width: 100%;
      }
      .joinbar {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 10px;
        max-width: min(100%, 360px);
        padding: 6px 6px 6px 6px;
        border: 0;
        border-radius: 999px;
        font: inherit;
        color: var(--g-text);
        text-align: left;
        background: color-mix(in srgb, var(--g-text) 8%, transparent);
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.45),
          inset 0 0 0 0.5px rgba(255, 255, 255, 0.35);
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        animation: rest-in 0.35s ease;
      }
      .joinbar img,
      .joinbar > ha-icon {
        flex: none;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        object-fit: cover;
        display: grid;
        place-items: center;
        --mdc-icon-size: 20px;
        color: var(--g-text-2);
      }
      .joinbar .jt {
        min-width: 0;
        display: flex;
        flex-direction: column;
        line-height: 1.2;
      }
      .joinbar .jn {
        font-size: 13px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .joinbar .js {
        font-size: 12px;
        color: var(--g-text-2);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .joinbar .jgo {
        flex: none;
        display: grid;
        place-items: center;
        min-width: 64px;
        height: 32px;
        padding: 0 14px;
        border-radius: 999px;
        font-size: 13px;
        font-weight: 600;
        color: #fff;
        background: var(--glass-media-play, rgba(28, 28, 30, 0.86));
      }
      :host([dark]) .joinbar .jgo {
        color: #000;
        background: var(--glass-media-play-dark, rgba(255, 255, 255, 0.9));
      }
      .joinbar .jgo .spin {
        position: static;
        width: 14px;
        height: 14px;
        border-width: 2px;
      }

      /* show: all on a phone – the library below the player, its own light glass panel */
      .frame.stacked {
        height: auto;
      }
      /* fill_height: the player fills the screen – the cover as big as fits, the volume at the bottom */
      .frame.filled:not(.stacked) .volrow {
        margin-top: auto;
      }
      .frame.filled:not(.stacked) .top {
        flex: 1;
        min-height: 0;
        justify-content: center;
      }
      /* tall: the cover on top, the rest centred under it – as on a phone, whatever the width */
      .frame.filled:not(.stacked) .top {
        flex-direction: column;
        align-items: center;
        gap: 18px;
      }
      .frame.filled:not(.stacked) .artbtn {
        align-self: stretch;
      }
      .frame.filled .art.square {
        width: min(100%, 420px, 46vh);
        border-radius: 18px;
      }
      .frame.filled:not(.stacked) .info {
        flex: none;
        width: 100%;
        max-width: 520px;
      }
      .frame.filled:not(.stacked) .txt {
        align-items: center;
        text-align: center;
      }
      .frame.filled:not(.stacked) .txt .title,
      .frame.filled:not(.stacked) .txt .sub {
        max-width: 100%;
      }
      .frame.filled:not(.stacked) .ctrls {
        max-width: none;
        justify-content: space-evenly;
      }
      .sheet.libf {
        --glass-media-cover: 118px;
      }
      .frame.stacked.filled {
        height: 100%;
      }
      .libpane {
        flex: none;
        height: var(--glass-media-library-height, 520px);
        min-height: 0;
        margin: 0 -4px -4px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border-radius: 16px 16px calc(var(--g-radius) - 8px) calc(var(--g-radius) - 8px);
        --glass-media-cover: 118px;
        --g-text: #1c1c1e;
        --g-text-2: rgba(28, 28, 30, 0.62);
        color: var(--g-text);
        background: var(--glass-media-sheet, rgba(250, 250, 252, 0.8));
        border: 0.5px solid rgba(255, 255, 255, 0.5);
        box-shadow:
          0 4px 16px rgba(0, 0, 0, 0.12),
          inset 0 1px 0 rgba(255, 255, 255, 0.7);
        -webkit-backdrop-filter: blur(calc(28px * var(--glass-blur-scale, 1))) saturate(170%);
        backdrop-filter: blur(calc(28px * var(--glass-blur-scale, 1))) saturate(170%);
        text-shadow: none;
      }
      .frame.filled .libpane {
        flex: 1;
        height: auto;
      }
      :host([dark]) .libpane {
        --g-text: #fff;
        --g-text-2: rgba(255, 255, 255, 0.7);
        background: var(--glass-media-sheet-dark, rgba(36, 36, 40, 0.8));
        border-color: rgba(255, 255, 255, 0.12);
      }
      .libpane .rows {
        padding-top: 4px;
      }
      /* the library: a sheet of covers over the card, slid down to its handle while it plays */
      .libwrap {
        position: absolute;
        left: 0;
        right: 0;
        top: 0;
        bottom: var(--below);
        z-index: 3;
        overflow: hidden;
        pointer-events: none;
      }
      .sheet {
        position: absolute;
        inset: 0 8px 4px;
        display: flex;
        flex-direction: column;
        border-radius: 16px 16px 22px 22px;
        --g-text: #1c1c1e;
        --g-text-2: rgba(28, 28, 30, 0.62);
        color: var(--g-text);
        background: var(--glass-media-sheet, rgba(250, 250, 252, 0.8));
        border: 0.5px solid rgba(255, 255, 255, 0.5);
        box-shadow:
          0 8px 24px rgba(0, 0, 0, 0.16),
          inset 0 1px 0 rgba(255, 255, 255, 0.7);
        -webkit-backdrop-filter: blur(calc(28px * var(--glass-blur-scale, 1))) saturate(170%);
        backdrop-filter: blur(calc(28px * var(--glass-blur-scale, 1))) saturate(170%);
        transform: translateY(calc(-100% - 12px));
        transition: transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
        pointer-events: auto;
        text-shadow: none;
      }
      .libwrap:not(.open) .sheet {
        visibility: hidden;
        transition:
          transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1),
          visibility 0s 0.4s;
      }
      .libwrap.open .sheet {
        transform: none;
      }
      :host([dark]) .sheet {
        --g-text: #fff;
        --g-text-2: rgba(255, 255, 255, 0.7);
        background: var(--glass-media-sheet-dark, rgba(36, 36, 40, 0.8));
        border-color: rgba(255, 255, 255, 0.12);
        box-shadow:
          0 8px 24px rgba(0, 0, 0, 0.4),
          inset 0 1px 0 rgba(255, 255, 255, 0.12);
      }
      .grab,
      .handle {
        flex: none;
        border: 0;
        padding: 0;
        background: none;
        display: grid;
        place-items: center;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }
      .grab {
        height: 22px;
      }
      .grab i,
      .handle i {
        width: 38px;
        height: 5px;
        border-radius: 3px;
        background: color-mix(in srgb, var(--g-text) 32%, transparent);
        transition: background 0.2s ease;
      }
      .grab:active i,
      .handle:active i {
        background: color-mix(in srgb, var(--g-text) 55%, transparent);
      }
      /* on top of the card, away from play: the way back to the sheet */
      .handle {
        align-self: center;
        width: 72px;
        height: 18px;
        margin: -8px 0 -8px;
      }
      /* it shows once the sheet is down (after its slide), and goes at once when it rises */
      .handle {
        transition: opacity 0.2s ease 0.36s;
      }
      .handle.open {
        opacity: 0;
        pointer-events: none;
        transition-delay: 0s;
        transition-duration: 0.1s;
      }
      .sheet-title {
        flex: none;
        padding: 12px 14px 8px;
        font-size: 13px;
        font-weight: 600;
        color: var(--g-text-2);
      }
      /* the library in rows, as in Plexamp: the sheet scrolls up and down, each row sideways –
         both on their own, never the page or the pop-up around it */
      .rows {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
        touch-action: pan-y;
        padding: 6px 0 10px;
        scrollbar-width: none;
      }
      .rows::-webkit-scrollbar,
      .row::-webkit-scrollbar {
        display: none;
      }
      .sec + .sec {
        margin-top: 10px;
      }
      .sec-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 4px 10px 8px 14px;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--g-text-2);
      }
      .sec-head > span {
        min-width: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .ghost-t {
        display: block;
        width: 110px;
        height: 10px;
        border-radius: 4px;
        background: color-mix(in srgb, var(--g-text) 8%, transparent);
      }
      .all {
        flex: none;
        padding: 0 0 0 6px;
        border: 0;
        background: none;
        display: inline-flex;
        align-items: center;
        font: inherit;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0;
        text-transform: none;
        color: var(--g-text-2);
        cursor: pointer;
      }
      .all ha-icon {
        --mdc-icon-size: 16px;
        display: flex;
      }
      .row {
        display: flex;
        gap: 10px;
        overflow-x: auto;
        overscroll-behavior-x: contain;
        touch-action: pan-x pan-y;
        scroll-snap-type: x proximity;
        scroll-padding: 0 14px;
        padding: 0 14px 4px;
        scrollbar-width: none;
      }
      /* dragged with the mouse: no snapping while it moves, a grabbing hand */
      .row.dragging,
      .rows.dragging,
      .grid.dragging {
        scroll-snap-type: none;
        cursor: grabbing;
        user-select: none;
        -webkit-user-select: none;
      }
      .row .it,
      .grid .it {
        -webkit-user-drag: none;
      }
      .row .it {
        flex: 0 0 var(--glass-media-cover, 92px);
        scroll-snap-align: start;
      }
      /* an artist round (a person), an album or playlist square, a radio or a cover-less one a
         colour tile with its icon */
      .it.round .cov {
        border-radius: 50%;
      }
      .it.round span {
        text-align: center;
      }
      .it .cov.tile {
        color: #fff;
        background: linear-gradient(135deg, hsl(var(--h) 52% 50%), hsl(calc(var(--h) + 40) 58% 32%));
      }
      .it .cov.tile ha-icon {
        filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.25));
      }
      /* opened (an artist, a whole row): its title with a way back, a grid */
      .sheet-head {
        flex: none;
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 10px 14px 8px 8px;
        font-size: 14px;
        font-weight: 700;
        min-width: 0;
      }
      .sheet-head span {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .back {
        flex: none;
        width: 32px;
        height: 32px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        display: grid;
        place-items: center;
        color: var(--g-text);
        background: color-mix(in srgb, var(--g-text) 8%, transparent);
        cursor: pointer;
      }
      .back ha-icon {
        --mdc-icon-size: 22px;
        display: flex;
      }
      /* the covers: it scrolls on its own – never the page or the pop-up around it */
      .grid {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
        touch-action: pan-y;
        -webkit-overflow-scrolling: touch;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
        align-content: start;
        gap: 12px 10px;
        padding: 0 12px 14px;
        scrollbar-width: none;
      }
      .grid::-webkit-scrollbar {
        display: none;
      }
      .it {
        min-width: 0;
        padding: 0;
        border: 0;
        background: none;
        display: flex;
        flex-direction: column;
        gap: 5px;
        text-align: left;
        font: inherit;
        color: var(--g-text);
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }
      .it .cov {
        width: 100%;
        aspect-ratio: 1;
        display: grid;
        place-items: center;
        border-radius: 12px;
        background-size: cover;
        background-position: center;
        background-color: color-mix(in srgb, var(--g-text) 8%, transparent);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.16);
        color: var(--g-text-2);
        transition:
          transform 0.15s ease,
          filter 0.15s ease;
      }
      .it .cov {
        position: relative;
        overflow: hidden;
      }
      .it .cov ha-icon {
        --mdc-icon-size: 30px;
        display: flex;
      }
      /* the cover over its icon: a picture that can't load leaves the icon */
      .it .cov img {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .it:active .cov,
      .it.tap .cov {
        transform: scale(0.94);
        filter: brightness(0.85);
      }
      .it span {
        font-size: 12px;
        font-weight: 600;
        line-height: 1.25;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      /* Music Assistant's rows, as its own app draws them: a title, covers with a line under the
         name, a badge for what comes from YouTube Music */
      .sec.ma .sec-head {
        font-size: 15px;
        letter-spacing: 0;
        text-transform: none;
        color: var(--g-text);
        padding-bottom: 10px;
      }
      .sec.ma .row .it {
        flex-basis: calc(var(--glass-media-cover, 92px) * 1.12);
      }
      .sec.ma .it > span:not(.sub) {
        -webkit-line-clamp: 1;
      }
      .it span.sub {
        margin-top: -3px;
        font-size: 11px;
        font-weight: 500;
        color: var(--g-text-2);
        -webkit-line-clamp: 1;
      }
      .src-yt {
        position: absolute;
        top: 6px;
        left: 6px;
        z-index: 1;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
        background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='8' fill='%23ff0000'/%3E%3Ccircle cx='8' cy='8' r='4.6' fill='none' stroke='%23fff' stroke-width='1.1'/%3E%3Cpath d='M6.9 6.2v3.6L9.9 8z' fill='%23fff'/%3E%3C/svg%3E")
          center / cover;
      }
      .sec.ma .sec-t {
        display: flex;
        flex-direction: column;
        gap: 1px;
        min-width: 0;
        margin-right: auto;
      }
      .sec-t small {
        font-size: 11px;
        font-weight: 500;
        color: var(--g-text-2);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .src-yt.head {
        position: static;
        flex: none;
        width: 18px;
        height: 18px;
      }
      /* the top picks: a big tile, then smaller wide ones in two rows */
      .picks {
        --pk-h: clamp(84px, calc(var(--glass-media-cover, 92px) * 1.05), 150px);
        align-items: flex-start;
      }
      .pk-grid {
        flex: none;
        display: grid;
        grid-auto-flow: column;
        grid-template-rows: repeat(2, var(--pk-h));
        grid-auto-columns: calc(var(--pk-h) * 2.4);
        gap: 10px;
      }
      .pk {
        position: relative;
        flex: none;
        width: 100%;
        height: 100%;
        padding: 0;
        border: 0;
        border-radius: 14px;
        overflow: hidden;
        text-align: left;
        font: inherit;
        color: #fff;
        cursor: pointer;
        background: linear-gradient(135deg, hsl(var(--h) 45% 45%), hsl(calc(var(--h) + 40) 50% 28%));
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.16);
        scroll-snap-align: start;
        -webkit-tap-highlight-color: transparent;
        transition:
          transform 0.15s ease,
          filter 0.15s ease;
      }
      .pk.big {
        width: calc(var(--pk-h) * 3.4);
        height: calc(var(--pk-h) * 2 + 10px);
      }
      .pk:active,
      .pk.tap {
        transform: scale(0.97);
        filter: brightness(0.88);
      }
      .pk img {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .pk-shade {
        position: absolute;
        inset: 0;
        background: linear-gradient(180deg, rgba(0, 0, 0, 0.4) 0%, rgba(0, 0, 0, 0) 34%, rgba(0, 0, 0, 0.12) 52%, rgba(0, 0, 0, 0.72) 100%);
      }
      .pk.loading .pk-shade {
        background: rgba(0, 0, 0, 0.45);
      }
      .pk-from {
        position: absolute;
        top: 9px;
        left: 11px;
        right: 11px;
        display: flex;
        align-items: center;
        gap: 5px;
        font-size: 9.5px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
      }
      .pk-from ha-icon {
        --mdc-icon-size: 12px;
        flex: none;
        display: flex;
      }
      .pk-txt {
        position: absolute;
        left: 11px;
        right: 11px;
        bottom: 9px;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 1px;
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
      }
      .pk-kind {
        font-size: 10px;
        font-weight: 600;
        opacity: 0.85;
      }
      .pk-name {
        font-size: 14px;
        font-weight: 800;
        line-height: 1.2;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .pk-sub {
        font-size: 11px;
        opacity: 0.82;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .pk.big .pk-from {
        top: 14px;
        left: 16px;
      }
      .pk.big .pk-txt {
        left: 16px;
        right: 16px;
        bottom: 14px;
      }
      .pk.big .pk-name {
        font-size: 22px;
        white-space: normal;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }
      /* a phone (a narrow card): as Music Assistant's app there – the picks one row of tiles alike,
         about one to a screen; the covers bigger, two and a bit across */
      /* a cover held to open it: no callout, no text selection */
      .it,
      .pk {
        -webkit-touch-callout: none;
        user-select: none;
      }
      /* an opened playlist / album: its cover, name, play – then its tracks */
      .det {
        padding-top: 0;
      }
      .det-hero {
        position: relative;
        display: flex;
        align-items: center;
        gap: 18px;
        padding: 14px 16px 18px;
        overflow: hidden;
      }
      .det-bg {
        position: absolute;
        inset: -30px;
        background: center / cover;
        filter: blur(28px) saturate(1.3);
        opacity: 0.35;
        pointer-events: none;
      }
      .det-cov {
        position: relative;
        flex: none;
        width: 168px;
        aspect-ratio: 1;
        display: grid;
        place-items: center;
        overflow: hidden;
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
        background-color: color-mix(in srgb, var(--g-text) 8%, transparent);
        color: var(--g-text-2);
      }
      .det-cov.tile {
        color: #fff;
        background: linear-gradient(135deg, hsl(var(--h) 52% 50%), hsl(calc(var(--h) + 40) 58% 32%));
      }
      .det-cov ha-icon {
        --mdc-icon-size: 44px;
        display: flex;
      }
      .det-cov img {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .det-info {
        position: relative;
        min-width: 0;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 6px;
      }
      .det-name {
        font-size: 22px;
        font-weight: 700;
        line-height: 1.2;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .det-meta {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        color: var(--g-text-2);
      }
      .det-meta .src-yt {
        position: static;
        flex: none;
        width: 14px;
        height: 14px;
        box-shadow: none;
      }
      .det-play {
        margin-top: 6px;
        max-width: 100%;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 9px 18px 9px 14px;
        border: 0;
        border-radius: 999px;
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        color: #fff;
        background: var(--primary-color, #3b82f6);
        box-shadow: 0 4px 14px color-mix(in srgb, var(--primary-color, #3b82f6) 40%, transparent);
        cursor: pointer;
      }
      .det-play span {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .det-play ha-icon {
        --mdc-icon-size: 20px;
        display: flex;
      }
      .det-play:active {
        transform: scale(0.96);
      }
      .det-list {
        display: flex;
        flex-direction: column;
        padding: 0 8px;
      }
      .trk {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
        padding: 7px 8px;
        border: 0;
        border-radius: 10px;
        background: none;
        font: inherit;
        color: var(--g-text);
        text-align: left;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }
      .trk:hover {
        background: color-mix(in srgb, var(--g-text) 6%, transparent);
      }
      .trk:active {
        background: color-mix(in srgb, var(--g-text) 12%, transparent);
      }
      .tcov {
        flex: none;
        width: 44px;
        height: 44px;
        border-radius: 6px;
        background: center / cover color-mix(in srgb, var(--g-text) 8%, transparent);
      }
      .ttxt {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .ttxt > span {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .tn {
        font-size: 14px;
        font-weight: 600;
      }
      .ts {
        font-size: 12px;
        color: var(--g-text-2);
      }
      .td {
        flex: none;
        font-size: 12px;
        color: var(--g-text-2);
        font-variant-numeric: tabular-nums;
      }
      .trk.ghost .tcov,
      .trk.ghost .ttxt span {
        background: color-mix(in srgb, var(--g-text) 8%, transparent);
      }
      .trk.ghost .ttxt span {
        height: 12px;
        width: 60%;
        border-radius: 6px;
      }
      /* a phone: the cover behind, faded; name and play over it */
      @container mediatile (max-width: 520px) {
        .det-hero {
          min-height: 170px;
          align-items: flex-end;
          padding: 18px 16px;
        }
        .det-cov {
          position: absolute;
          inset: 0;
          width: auto;
          aspect-ratio: auto;
          border-radius: 0;
          box-shadow: none;
          opacity: 0.4;
          -webkit-mask-image: linear-gradient(to bottom, #000 40%, transparent);
          mask-image: linear-gradient(to bottom, #000 40%, transparent);
        }
        .det-bg {
          display: none;
        }
        .det-name {
          font-size: 20px;
        }
        .td {
          display: none;
        }
      }
      @container mediatile (max-width: 520px) {
        .picks {
          --pk-w: 78cqw;
          align-items: stretch;
        }
        .pk.big,
        .pk-grid > .pk {
          width: var(--pk-w);
          height: calc(var(--pk-w) * 0.5);
        }
        .pk-grid {
          display: contents;
        }
        .pk.big .pk-name {
          font-size: 17px;
          -webkit-line-clamp: 1;
        }
        .sec.ma .row .it {
          flex-basis: 40cqw;
        }
        .sec.ma .it > span:not(.sub) {
          font-size: 13px;
        }
        .sec.ma .sec-head {
          font-size: 17px;
        }
      }
      .pk .spin {
        z-index: 1;
        width: 30px;
        height: 30px;
        border-width: 3px;
      }
      .it.ghost .cov {
        box-shadow: none;
        animation: ghost 1.2s ease-in-out infinite alternate;
      }
      .it.ghost span {
        height: 10px;
        width: 70%;
        border-radius: 4px;
        background: color-mix(in srgb, var(--g-text) 8%, transparent);
      }
      @keyframes ghost {
        to {
          opacity: 0.45;
        }
      }

      /* the art grows with the card: a tablet's wide card gets a big cover */
      .art.square {
        width: clamp(96px, 30cqw, 240px);
      }
      /* very narrow: no room for shuffle and repeat */
      @container mediatile (max-width: 250px) {
        .ctrls .cbtn.small {
          display: none;
        }
        .ctrls {
          justify-content: center;
          gap: 8px;
        }
      }
      /* the narrowest: play / pause alone */
      @container mediatile (max-width: 130px) {
        .ctrls .cbtn:not(.main) {
          display: none !important;
        }
        .ctrls {
          justify-content: center !important;
        }
      }
      /* a sliver (a phone's three columns): smaller buttons, the volume without its number */
      @container mediatile (max-width: 180px) {
        .frame.cardf {
          padding: 8px;
          gap: 8px;
        }
        .ctrls {
          gap: 0;
          justify-content: space-between;
        }
        .ctrls .cbtn:not(.main) {
          width: 30px;
          height: 30px;
        }
        .ctrls .cbtn:not(.main) ha-icon {
          --mdc-icon-size: 17px;
        }
        .cardf .cbtn.main,
        :host([control-glass]) .cardf .cbtn.control.main {
          width: 42px !important;
          height: 42px !important;
        }
        .volrow {
          gap: 4px;
        }
        .lbar.vol .vval {
          display: none;
        }
        .lbar.vol {
          min-height: 36px;
        }
        .spk {
          height: 36px;
          min-width: 36px;
          padding: 0 8px;
        }
        .title {
          font-size: 14px;
        }
        .sub {
          font-size: 12px;
        }
        /* the tile: the cover and play only */
        .lbar.tile .txt {
          display: none;
        }
        .lbar.tile {
          justify-content: space-between;
        }
      }
      /* a phone (a narrow card): the cover on top, as big as fits, the rest centred under it */
      @container mediatile (max-width: 420px) {
        .top {
          flex-direction: column;
          align-items: center;
          gap: 14px;
        }
        .cardf .artbtn {
          align-self: stretch;
        }
        .art.square {
          width: min(100%, 300px);
          border-radius: 18px;
        }
        .info {
          width: 100%;
        }
        .cardf .txt {
          align-items: center;
          text-align: center;
        }
        .cardf .txt .title,
        .cardf .txt .sub {
          max-width: 100%;
        }
        .ctrls {
          max-width: none;
          justify-content: space-evenly;
        }
        .cardf .cbtn.main,
        :host([control-glass]) .cardf .cbtn.control.main {
          width: 56px;
          height: 56px;
        }
      }

      /* layout: screen – the whole screen, for the effect: the cover big over itself blurred and
         drifting, the song in large type, the time; untouched a while, the buttons fade away */
      :host([layout="screen"]) {
        height: 100%;
      }
      .screen {
        position: relative;
        box-sizing: border-box;
        height: 100%;
        min-height: 320px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        isolation: isolate;
        border-radius: var(--g-radius);
        background: #07080c;
        color: #fff;
        --g-text: #fff;
        --g-text-2: rgba(255, 255, 255, 0.68);
        container: mscreen / size;
        -webkit-user-select: none;
        user-select: none;
      }
      .sbg {
        position: absolute;
        inset: -15%;
        z-index: -2;
      }
      /* blurred small and scaled up (a quarter of the size, a quarter of the blur): the same look
         for a sixteenth of the work – a phone or a kiosk tablet keeps it smooth while it drifts */
      .sbgi {
        position: absolute;
        left: 0;
        top: 0;
        width: 25%;
        height: 25%;
        transform-origin: 0 0;
        transform: scale(4);
        background: center / cover no-repeat;
        filter: blur(18px) saturate(1.7) brightness(0.78);
        will-change: transform;
        animation:
          scrFade 1.4s ease both,
          scrDrift 50s ease-in-out infinite alternate;
      }
      .sbgi.none {
        filter: none;
        background:
          radial-gradient(60% 50% at 25% 30%, rgba(90, 110, 190, 0.45), transparent 70%),
          radial-gradient(55% 55% at 80% 75%, rgba(150, 70, 140, 0.35), transparent 70%), #0b0d14;
      }
      @keyframes scrFade {
        from {
          opacity: 0;
        }
      }
      @keyframes scrDrift {
        0% {
          transform: scale(4) translate(0, 0) rotate(0deg);
        }
        50% {
          transform: scale(4.5) translate(-5%, 2%) rotate(4deg);
        }
        100% {
          transform: scale(4.3) translate(-1%, -5%) rotate(-3deg);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .sbgi,
        .screen.playing .scov {
          animation: none;
        }
      }
      .sshade {
        position: absolute;
        inset: 0;
        z-index: -1;
        background:
          radial-gradient(120% 95% at 35% 45%, transparent 0%, rgba(0, 0, 0, 0.38) 75%),
          linear-gradient(180deg, rgba(0, 0, 0, 0.28), transparent 28%, transparent 62%, rgba(0, 0, 0, 0.5));
      }
      .shead {
        flex: none;
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        padding: clamp(16px, 4.5cqh, 44px) clamp(20px, 4.5cqw, 60px) 0;
      }
      .sclock b {
        display: block;
        font-size: clamp(28px, 7.5cqh, 80px);
        font-weight: 300;
        line-height: 1;
        letter-spacing: -0.02em;
        font-variant-numeric: tabular-nums;
      }
      .sclock span,
      .sdate {
        display: block;
        margin-top: 0.4em;
        font-size: clamp(13px, 2.2cqh, 22px);
        color: var(--g-text-2);
      }
      .sclock span::first-letter,
      .sdate::first-letter {
        text-transform: uppercase;
      }
      .sbody {
        flex: 1;
        min-height: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: clamp(24px, 6cqw, 110px);
        padding: clamp(12px, 3cqh, 40px) clamp(20px, 6cqw, 110px) clamp(24px, 8cqh, 90px);
      }
      .scov {
        --cs: min(62cqh, 42cqw);
        flex: none;
        width: var(--cs);
        height: var(--cs);
      }
      .screen.playing .scov {
        animation: scrBreath 8s ease-in-out infinite;
      }
      @keyframes scrBreath {
        50% {
          transform: scale(1.018);
        }
      }
      .scovin {
        width: 100%;
        height: 100%;
        animation: scrCov 0.9s cubic-bezier(0.2, 0.8, 0.2, 1) both;
      }
      @keyframes scrCov {
        from {
          opacity: 0;
          transform: scale(0.93);
        }
      }
      .screen .artbtn,
      .screen .artwrap {
        width: 100%;
        height: 100%;
      }
      .screen .artwrap .art.square {
        width: 100%;
        height: 100%;
        max-width: none;
        max-height: none;
        border-radius: clamp(12px, 2.6cqh, 30px);
        box-shadow:
          0 34px 90px rgba(0, 0, 0, 0.5),
          0 10px 28px rgba(0, 0, 0, 0.35),
          inset 0 0 0 0.5px rgba(255, 255, 255, 0.22);
      }
      .screen .art.none {
        background: rgba(255, 255, 255, 0.08);
        color: rgba(255, 255, 255, 0.5);
      }
      .screen .art ha-icon {
        --mdc-icon-size: calc(var(--cs) * 0.35);
      }
      .sinfo {
        flex: 0 1 min(46cqw, 680px);
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: clamp(12px, 3cqh, 30px);
      }
      .splayer,
      .snow {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: clamp(12px, 1.9cqh, 17px);
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--g-text-2);
      }
      .snow .dim {
        font-weight: 400;
        letter-spacing: 0.02em;
        text-transform: none;
      }
      .screen .pkind {
        color: inherit;
      }
      .stxt {
        animation: scrTxt 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) both;
      }
      @keyframes scrTxt {
        from {
          opacity: 0;
          transform: translateY(14px);
        }
      }
      .stitle {
        font-size: clamp(26px, 7.6cqh, 84px);
        font-weight: 700;
        line-height: 1.04;
        letter-spacing: -0.025em;
        text-wrap: balance;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
        text-shadow: 0 2px 30px rgba(0, 0, 0, 0.25);
      }
      .sartist {
        margin-top: 0.35em;
        font-size: clamp(16px, 3.8cqh, 38px);
        font-weight: 500;
        color: rgba(255, 255, 255, 0.86);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .salbum {
        margin-top: 0.3em;
        font-size: clamp(13px, 2.4cqh, 24px);
        color: rgba(255, 255, 255, 0.55);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .sctl {
        display: flex;
        flex-direction: column;
        gap: clamp(10px, 2.4cqh, 24px);
      }
      .screen .times {
        font-size: clamp(11px, 1.7cqh, 15px);
      }
      .screen .ctrls {
        max-width: 380px;
        transition: opacity 0.8s ease;
      }
      .screen .cbtn {
        width: clamp(40px, 7cqh, 54px);
        height: clamp(40px, 7cqh, 54px);
      }
      .screen .cbtn ha-icon {
        --mdc-icon-size: clamp(22px, 3.6cqh, 30px);
      }
      .screen .cbtn.small {
        width: clamp(34px, 5.6cqh, 44px);
        height: clamp(34px, 5.6cqh, 44px);
      }
      .screen .cbtn.small ha-icon {
        --mdc-icon-size: clamp(18px, 2.8cqh, 24px);
      }
      /* play / pause: the biggest, light on the dark screen */
      .screen .cbtn.main,
      :host([control-glass]) .screen .cbtn.control.main {
        width: clamp(64px, 11cqh, 88px);
        height: clamp(64px, 11cqh, 88px);
        background: rgba(255, 255, 255, 0.92) !important;
        color: #111 !important;
      }
      .screen .cbtn.main ha-icon {
        filter: none;
      }
      .screen .cbtn.main ha-icon {
        --mdc-icon-size: clamp(30px, 5.2cqh, 42px);
      }
      /* untouched: the buttons and the cursor go, the song, its bar and the time stay */
      .screen.calm {
        cursor: none;
      }
      .screen.calm .ctrls {
        opacity: 0;
        pointer-events: none;
      }
      .sidle {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: clamp(8px, 2cqh, 20px);
        padding: 0 24px clamp(24px, 8cqh, 90px);
        text-align: center;
      }
      .sbig {
        font-size: clamp(48px, min(27cqh, 21cqw), 280px);
        white-space: nowrap;
        font-weight: 200;
        line-height: 0.95;
        letter-spacing: -0.045em;
        font-variant-numeric: tabular-nums;
      }
      .sidle .snow {
        margin-top: clamp(8px, 3cqh, 32px);
      }
      .sidle .ctrls {
        justify-content: center;
        margin-top: clamp(8px, 2cqh, 20px);
      }
      /* a phone, a tablet upright: the cover above, the song under it, all centred */
      @container mscreen (max-aspect-ratio: 21/20) {
        .sbody {
          flex-direction: column;
          gap: clamp(18px, 4cqh, 48px);
          padding-top: 0;
        }
        .scov {
          --cs: min(78cqw, 44cqh);
        }
        .sinfo {
          flex: none;
          width: min(88cqw, 640px);
          align-items: center;
          text-align: center;
        }
        .sctl {
          width: 100%;
        }
        .stitle {
          font-size: clamp(22px, 4.4cqh, 54px);
          -webkit-line-clamp: 2;
        }
        .sartist {
          font-size: clamp(15px, 2.6cqh, 28px);
        }
        .screen .ctrls {
          margin: 0 auto;
          width: 100%;
          justify-content: space-evenly;
        }
      }
    `,
    materials,
  ];
}

registerCard("glass-media", GlassMedia, {
  name: "Glass – media player",
  description: "What plays with its album art, the controls, a liquid glass volume bar and the speakers to group.",
});
