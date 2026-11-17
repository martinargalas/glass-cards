# Install Glass Cards

Glass Cards need Home Assistant **2025.1 or newer** and a browser from the last few years
(Chrome, Edge, Safari, Firefox; the Home Assistant app on phones and tablets).

## From the Marketplace (recommended)

Glass Cards aren't listed in the Marketplace yet – you add them from their GitHub page, once:

1. In Home Assistant open **Settings → Marketplace**.
2. Click the **link icon** in the top right (**Add from a GitHub link**).
3. Paste `https://github.com/martinargalas/glass-cards` and click **Add**.
4. Open **Glass Cards** and click **Download**. Reload the browser (or the app) when asked.

The Marketplace adds the resource for you, and updates arrive the same way.

> **An older Home Assistant with HACS?** The same in HACS: **⋮ → Custom repositories**,
> repository `https://github.com/martinargalas/glass-cards`, type **Dashboard**, then
> **Download**.

## By hand

1. Download the source code of the
   [latest release](https://github.com/martinargalas/glass-cards/releases/latest) (**Source code (zip)**).
2. Copy everything in its `dist` folder into `config/www/glass-cards/` in your Home Assistant
   configuration – the cards, the wallpapers (`wallpaper-*.jpg`) and the demo's pictures
   (`demo-*`) lie side by side in that one folder.
3. **Settings → Dashboards → ⋮ → Resources → Add resource**:
   URL `/local/glass-cards/glass-cards.js`, type **JavaScript module**.
4. Reload the browser.

> **Tip:** register the loader
> (`/local/glass-cards/glass-cards-loader.js`) instead. It always loads the newest copy, so
> after an update you never have to clear the browser's cache.

## Optional companions

Most cards need nothing else. A few build on other community cards (from the Marketplace too):

| You want | Install | Used by |
| --- | --- | --- |
| Pop-up windows (a room's lights, the energy page…) | [Bubble Card](https://github.com/Clooos/Bubble-Card) | Dashboard, Dock, Pop-up header |
| Energy and history charts | [apexcharts-card](https://github.com/RomRider/apexcharts-card) | Chart |

You can do without both: the dock can switch **pages** instead of opening pop-ups – see
[Layout → Pages](layout.md#pages-without-pop-ups).

## Your first Glass dashboard

After the install, reload the page. If you're an administrator, a bar at the bottom offers the
**demo home**: every card on a made-up home – a tour of everything Glass Cards can do, which
never touches your devices. It appears in the sidebar as **Glass demo**
([the demo dashboard](demo.md)), and it's yours to change: open it in Dashboard Studio, swap in
your own devices and keep what you like.

Nothing is created until you click. The bar asks once per install – **No, thanks** hides it,
and it doesn't come while you have a Glass dashboard. To see it any time, add `?glass-setup` to
the address of a dashboard.

### A dashboard from your own rooms

Dashboard Studio (`?glass-studio`) builds one more: **From your rooms** – the demo's layout on
your own home, as **Glass** in the sidebar:

- **Rooms are your areas.** Each area with lights, blinds, a thermostat, a TV or speaker or a
  temperature sensor gets a room card with them (devices count too: an entity is in its
  device's area). Living room, kitchen, bedroom and other common rooms get a photo; an area's
  own picture wins.
- **No areas yet?** Then the rooms are guessed from the names – `light.kitchen_ceiling` goes to
  the kitchen – and what no name places is shared out among the demo's rooms. Sort your
  devices into areas first for the real thing.
- **The left column** shows the time, your people, the weather and your calendars – whatever
  your home has.
- **One pop-up as an example**: the weather, opened from the dock – only with
  [Bubble Card](https://github.com/Clooos/Bubble-Card) installed.

## Check it works

Open any dashboard, add a card and search for **Glass** – you'll see the glass cards in the
list. Or go straight to [the demo dashboard](demo.md).

## Language

The cards follow your Home Assistant profile's language (**Profile → Language**). English,
Czech and German are included; anything not translated stays in English. Dashboard Studio can be set to a
different language than the cards – handy when you share a dashboard.
