/**
 * What kind of player a media player is – the way Music Assistant names it (Sonos, Chromecast,
 * Sendspin, AirPlay…), or a Home Assistant player – with its small icon (Music Assistant's own).
 */

export type PlayerKind = "sonos" | "chromecast" | "sendspin" | "airplay" | "dlna" | "snapcast" | "squeezelite" | "bluesound" | "hass" | "ma";

/** A monochrome icon as a CSS mask (it takes the text's colour). */
const svg = (vb: string, d: string) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"><path d="${d}"/></svg>`)}")`;

/** Music Assistant's icons for its players (simplified): a mask, or an mdi icon. */
const MASKS: Partial<Record<PlayerKind, string>> = {
  chromecast: svg("0 0 21.97425 21.97425", "m0,17v3h3c0,-1.7-1.3,-3-3,-3zm0,-4v2c2.8,0 5,2.2 5,5h2c0,-3.9-3.1,-7-7,-7zM0,9V11c5,0 9,4 9,9h2C11,13.9 6.1,9 0,9ZM20,2H2c-1.1,0-2,0.9-2,2v3h2v-3H20V18h-7v2h7c1.1,0 2,-0.9 2,-2V4c0,-1.1-0.9,-2-2,-2z"),
  sendspin: svg("0 1 114.24 93.03", "M42.5 57.5C41.8 58.2 40.7 58.1 40.1 57.4C34.5 51.2 31.4 43.2 31.4 34.8C31.4 25.8 34.9 17.3 41.3 10.9C54.1-1.9 74.6-2.3 87.8 9.7C88.6 10.3 88.6 11.4 87.9 12.1L84.8 15.2C84.2 15.8 83.3 15.8 82.6 15.2C75.4 8.8 65.2 6.8 55.2 10.5C55.2 10.5 55.1 10.5 55 10.5C44.9 15.2 39 24.5 39 34.8C39 41.3 41.4 47.4 45.7 52.2C46.2 52.8 46.2 53.8 45.6 54.4L42.5 57.5V57.5ZM50.9 46.6C46.8 41.5 45.5 34.6 47.9 27.9C47.9 27.9 48 27.8 48 27.7C53.5 15.4 68 13 77 20.5C77.8 21.1 77.8 22.2 77.1 22.9L74 26C73.4 26.6 72.5 26.6 71.8 26.1C67.6 22.9 61.4 23.2 57.5 27.1C55.5 29.1 54.3 31.9 54.3 34.8C54.3 37.2 55.1 39.5 56.6 41.4C57.1 42.1 57 43 56.4 43.6L53.3 46.7C52.6 47.4 51.5 47.3 50.9 46.6H50.9ZM11.1 88.9C10.4 89.6 9.3 89.6 8.7 88.8C2.9 82.4 0 74.3 0 66.2C0 58.1 2.9 50 8.7 43.6C9.3 42.9 10.4 42.8 11.1 43.5L12.6 45L14.2 46.6C14.8 47.2 14.8 48.2 14.2 48.8C9.8 53.8 7.6 60 7.6 66.2C7.6 72.5 9.8 78.7 14.2 83.6C14.8 84.3 14.8 85.3 14.2 85.9L12.6 87.4L11.1 89V88.9ZM21.9 78.1C21.2 78.8 20.1 78.8 19.5 78C16.7 74.7 15.3 70.6 15.3 66.2C15.3 61.9 16.7 57.7 19.5 54.4C20.1 53.7 21.2 53.6 21.9 54.3L25 57.4C25.6 58 25.6 58.9 25.1 59.6C23.7 61.5 22.9 63.8 22.9 66.2C22.9 68.7 23.7 71 25.1 72.8C25.6 73.5 25.6 74.4 25 75L21.9 78.1V78.1ZM105.5 51.5C104.9 52.2 103.8 52.2 103.2 51.5L101.7 50L100.1 48.4C99.5 47.8 99.4 46.9 100 46.2C104.4 41.3 106.6 35 106.6 28.8C106.6 22.6 104.4 16.4 100 11.4C99.4 10.8 99.5 9.8 100.1 9.2L101.7 7.6L103.2 6.1C103.8 5.4 104.9 5.5 105.5 6.2C111.3 12.6 114.2 20.7 114.2 28.8C114.2 36.9 111.3 45 105.5 51.4V51.5ZM92.3 40.7L89.2 37.6C88.6 37 88.6 36.1 89.1 35.4C90.6 33.5 91.3 31.2 91.3 28.8C91.3 26.4 90.6 24.1 89.1 22.2C88.6 21.5 88.6 20.6 89.2 20L92.3 16.9C93 16.2 94.2 16.3 94.8 17C97.5 20.3 99 24.4 99 28.8C99 33.2 97.5 37.3 94.8 40.6C94.2 41.3 93 41.4 92.3 40.7V40.7ZM49 94C40.9 94 32.8 91.1 26.4 85.3C25.7 84.7 25.6 83.6 26.3 83L29.4 79.9C30 79.3 31 79.2 31.6 79.8C41.9 88.9 57.7 88.6 67.5 78.7C77.4 68.9 77.7 53.1 68.6 42.8C68 42.2 68.1 41.2 68.7 40.6L71.8 37.5C72.4 36.9 73.5 36.9 74.1 37.6C86.1 50.9 85.7 71.4 72.9 84.1C66.3 90.7 57.7 94 49 94H49ZM49 78.8C44.8 78.8 40.6 77.4 37.2 74.5C36.5 73.9 36.5 72.8 37.1 72.1L40.2 69C40.8 68.5 41.7 68.4 42.4 68.9C46.7 72.2 52.8 71.9 56.7 68C60.6 64 61 57.9 57.7 53.6C57.2 53 57.2 52 57.8 51.5L60.9 48.4C61.6 47.7 62.7 47.7 63.3 48.5C69.3 55.7 68.9 66.5 62.1 73.3C58.5 77 53.8 78.8 49 78.8V78.8Z"),
};
const MDI: Record<PlayerKind, string> = {
  sonos: "mdi:speaker",
  chromecast: "mdi:cast",
  sendspin: "mdi:speaker-wireless",
  airplay: "mdi:cast-variant",
  dlna: "mdi:dlna",
  snapcast: "mdi:speaker-multiple",
  squeezelite: "mdi:speaker",
  bluesound: "mdi:speaker",
  hass: "mdi:home-assistant",
  ma: "mdi:music-circle-outline",
};
export const KIND_LABEL: Record<PlayerKind, string> = {
  sonos: "Sonos",
  chromecast: "Chromecast",
  sendspin: "Sendspin",
  airplay: "AirPlay",
  dlna: "DLNA",
  snapcast: "Snapcast",
  squeezelite: "Squeezelite",
  bluesound: "BluOS",
  hass: "Home Assistant",
  ma: "Music Assistant",
};

/** Its icon: a mask, an mdi icon – or for Sonos its name, as Sonos writes it (its mark is a word). */
export function kindIcon(k: PlayerKind): { mask?: string; mdi: string; word?: string } {
  return { mask: MASKS[k], mdi: MDI[k], word: k === "sonos" ? "SONOS" : undefined };
}

/** A Music Assistant provider (its domain, or the protocol a universal player plays by) as a kind. */
export function kindOfProvider(p?: string): PlayerKind | undefined {
  if (!p) return undefined;
  if (p === "hass" || p === "hass_players") return "hass";
  if (p === "cast" || p === "google_cast") return "chromecast";
  if (p === "slimproto") return "squeezelite";
  return (KIND_LABEL as Record<string, string>)[p] ? (p as PlayerKind) : "ma";
}

/** A guess from the device's maker and model (no token for Music Assistant's own word). */
export function kindOfDevice(manufacturer?: string, model?: string): PlayerKind {
  const s = `${manufacturer ?? ""} ${model ?? ""}`;
  if (/sonos/i.test(s)) return "sonos";
  if (/web player|sendspin/i.test(s)) return "sendspin";
  if (/google|nvidia|chromecast|nest/i.test(s)) return "chromecast";
  if (/apple|airplay/i.test(s)) return "airplay";
  if (/bluesound|bluos/i.test(s)) return "bluesound";
  if (/squeeze|slim/i.test(s)) return "squeezelite";
  return "ma";
}
