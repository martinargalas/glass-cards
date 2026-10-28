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

1. Download `glass-cards.zip` from the
   [latest release](https://github.com/martinargalas/glass-cards/releases/latest) (or take the repository's `dist` folder).
2. Unpack it into `config/www/glass-cards/` in your Home Assistant configuration – the cards, the
   wallpapers and the demo's pictures stay together in that folder.
3. **Settings → Dashboards → ⋮ → Resources → Add resource**:
   URL `/local/glass-cards/glass-cards.js`, type **JavaScript module**.
4. Reload the browser.

> **Tip:** register the loader
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

## Your first Glass dashboard

After the install, reload the page. If you're an administrator, a bar at the bottom offers to
**create a Glass dashboard from your rooms** – the demo's layout on your own home:

- **Rooms are your areas.** Each area with lights, blinds, a thermostat or a temperature sensor
  gets a room card with them (devices count too: an entity is in its device's area). Living
  room, kitchen, bedroom and other common rooms get a photo; an area's own picture wins.
- **The left column** shows the time, your people, the weather and your calendars – whatever
  your home has.
- **One pop-up as an example**: the weather, opened from the dock – only with
  [Bubble Card](https://github.com/Clooos/Bubble-Card) installed.

It appears in the sidebar as **Glass**. Nothing is created until you click, and the bar is asked
once: **No, thanks** hides it for good. You can add the dashboard later in Dashboard Studio
(**From your rooms**), e.g. after you've sorted your devices into areas.

## Check it works

Open any dashboard, add a card and search for **Glass** – you'll see the glass cards in the
list. Or go straight to [the demo dashboard](demo.md).

## Language

The cards follow your Home Assistant profile's language (**Profile → Language**). English and
Czech are included; anything not translated stays in English. Dashboard Studio can be set to a
different language than the cards – handy when you share a dashboard.
