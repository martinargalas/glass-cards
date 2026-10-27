# Install Glass Cards

Glass Cards need Home Assistant **2025.1 or newer** and a browser from the last few years
(Chrome, Edge, Safari, Firefox; the Home Assistant app on phones and tablets).

## Through HACS, as a custom repository (recommended)

Glass Cards are not in the HACS store (yet) – you add the repository to HACS yourself, once:

1. Open **HACS** in Home Assistant.
2. **⋮** (top right) → **Custom repositories**.
3. Repository `https://github.com/martinargalas/glass-cards`, type **Dashboard** → **Add**.
4. Find **Glass Cards** in HACS, open it and click **Download**. Reload the browser (or the
   app) when HACS asks you to.

HACS adds the resource for you, and updates arrive the same way.

## By hand

1. Download `glass-cards.js` and the `wallpapers` folder from the
   [latest release](https://github.com/martinargalas/glass-cards/releases) (or the repository's `dist` folder).
2. Copy them to `config/www/glass-cards/` in your Home Assistant configuration.
3. **Settings → Dashboards → ⋮ → Resources → Add resource**:
   URL `/local/glass-cards/glass-cards.js`, type **JavaScript module**.
4. Reload the browser.

> **Tip:** copy `glass-cards-loader.js` and `version.json` as well and register the loader
> (`/local/glass-cards/glass-cards-loader.js`) instead. It always loads the newest copy, so
> after an update you never have to clear the browser's cache.

## Optional companions

Most cards need nothing else. A few build on other HACS cards:

| You want | Install | Used by |
| --- | --- | --- |
| Pop-up windows (a room's lights, the energy page…) | [Bubble Card](https://github.com/Clooos/Bubble-Card) | Dashboard, Dock, Pop-up header |
| Energy and history charts | [apexcharts-card](https://github.com/RomRider/apexcharts-card) | Chart |

You can do without both: the dock can switch **pages** instead of opening pop-ups – see
[Layout → Pages](layout.md#pages-without-pop-ups).

## Check it works

Open any dashboard, add a card and search for **Glass** – you'll see the glass cards in the
list. Or go straight to [the demo dashboard](demo.md).

## Language

The cards follow your Home Assistant profile's language (**Profile → Language**). English and
Czech are included; anything not translated stays in English. Dashboard Studio can be set to a
different language than the cards – handy when you share a dashboard.
