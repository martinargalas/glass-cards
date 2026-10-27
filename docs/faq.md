# Questions and answers

## Is it fast enough for my wall tablet?

Glass costs graphics power, so Glass Cards are built to spend it carefully: only panels blur,
cards inside are drawn flat, nothing animates off screen. On a weak tablet pick the **Light**
look – it looks nearly frosted and costs almost nothing – or **Solid** for the oldest devices.
See [Looks](appearance.md#looks).

## Do I need card_mod?

No. Every colour, material, font and size is a setting of the card or the dashboard. Glass
Cards don't use card_mod and don't need it installed.

## Can I put other cards inside?

Yes – any card: Home Assistant's own, HACS cards, cameras. Panels and the dashboard hold them
like glass cards. In Glass Studio, pick **Home Assistant cards** or **Custom cards (HACS)** in the
card picker, or **Other card (YAML)**. They keep their own look; a panel's glass behind them
ties them in.

## Do my Home Assistant themes still work?

Yes. Without a glass dashboard around them, glass cards follow your theme and its dark mode.
Inside a glass dashboard, the dashboard's look, wallpaper and day / night take over – your theme
still applies to the rest of Home Assistant.

## Do I need Bubble Card?

Only for pop-up windows. Without it, use [pages](layout.md#pages-without-pop-ups): a dock or tabs
switch parts of one dashboard.

## The cards show "Custom element doesn't exist"

The resource isn't loaded. Check **Settings → Dashboards → ⋮ → Resources** for
`/hacsfiles/glass-cards/glass-cards.js` (HACS) or `/local/glass-cards/glass-cards.js` (by hand),
type *JavaScript module*, then reload the browser. On the phone app: **Settings → Companion app →
Debugging → Reset frontend cache**.

## I updated, but nothing changed

The browser holds the old file. Reload with the cache cleared (⇧⌘R / Ctrl+F5), or reset the
app's frontend cache. Installed by hand? Use the loader (see [Install](install.md#by-hand)) and
this never happens again.

## The liquid glass looks flat / blurry

Liquid glass needs WebGL. If the browser can't, the cards fall back to frosted glass. Turn on
hardware acceleration in the browser, or pick **Frosted** on purpose.

## Will the demo dashboard switch my lights?

No. With `demo: true` every card runs on invented devices, and actions on them never leave the
browser. See [The demo dashboard](demo.md).

## Where are my settings stored?

In the dashboard's configuration in Home Assistant, like any card's. The only things kept in
the browser are Glass Studio's own preferences (panel widths, the preview device), the last
wallpaper (so a reload doesn't flash) and the version before your last save.

## Something is wrong / I have an idea

Open an issue on [GitHub](https://github.com/martinargalas/glass-cards/issues) – with a screenshot
and the card's YAML if you can.
