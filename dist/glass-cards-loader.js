// Register THIS file as the dashboard resource (/local/glass-cards/glass-cards-loader.js).
// It loads glass-cards.js with a cache-busting hash, so a new deploy is picked up on the
// next page load without touching the resource URL.
const base = new URL(".", import.meta.url);
const hash = await fetch(new URL("version.json", base), { cache: "no-store" })
  .then((r) => r.json())
  .then((v) => v.hash)
  .catch(() => Date.now());
await import(new URL(`glass-cards.js?v=${hash}`, base).href);
