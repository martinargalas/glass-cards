# Look and feel

Everything about how the dashboard looks is set in three places, from broad to fine:

1. the dashboard's **look** – one choice that sets the whole style,
2. a panel's **material** – overrides the look for that panel and what's in it,
3. a card's **Appearance** tab – the material, colour, font and icon of each of its parts.

Leave something empty and it follows the level above. Most dashboards only ever set the look.

## Looks

Dashboard settings → **Appearance → Look**.

| Look | What it is | Speed |
| --- | --- | --- |
| **Liquid** (default) | Panels of liquid glass that bend and refract the wallpaper, with bright rims. Cards and buttons inside are soft matte tiles. | Heaviest – fine on recent phones, tablets and computers |
| **Frosted** | Panels of blurred glass, blurred live by the browser. | Medium |
| **Apple Home** | Tiles straight on the wallpaper, like the Home app. The side column becomes a dark glass sidebar (on phones: the header and the top bar). | Medium |
| **Light** | Looks frosted, but the wallpaper is blurred once in advance – nearly free. Shows the wallpaper, not what moves behind it. | Fast – older tablets |
| **Solid** | Opaque slate panels, no blur or transparency. | Fastest – the weakest devices |

> **A wall tablet with a weak GPU** (Galaxy Tab A, Fire HD…): start with **Light**. It looks almost
> the same as Frosted and costs nearly nothing.

## Materials

A panel, and any part of a card, can have its own material:

| Material | |
| --- | --- |
| `liquid` | Liquid glass – refracts the wallpaper |
| `frosted` | Frosted glass – blurred |
| `light` | Light glass – the pre-blurred wallpaper, no live blur |
| `flat` | No blur – a translucent tint only |
| `solid` | Opaque |
| `home` | Matte light-grey tile, as in Apple Home |
| `dark` | Dark glass, as Apple Home's controls |
| `none` | Nothing – no tile, border or shadow; just the content |

Every material can be tinted with a colour: set the part's `_color` (e.g. `bar_glass: liquid`,
`bar_color: blue`). A colour alone tints the part's default material.

**Where blur happens.** Only panels blur. Glass cards inside a panel are drawn flat on the
panel's glass – that is what keeps a full dashboard fast. A card gets a tile of its own only
if you give it a material.

## Colours

Colours can be Home Assistant's names (`red`, `light-blue`, `amber`, `primary`…), any CSS
colour (`#ff9f0a`, `rgb(…)`) or `none`. Cards with something "on" use an **active colour**
(`active_color`) – a lit bulb, a heating radiator, a running washer.

## Fonts and icons

In a card's **Appearance**, each text and icon of the card has its own group: the name, the
state, the value, the icon off and the icon on… Set size, weight, colour or opacity:

```yaml
fonts:
  name: { size: 15px, weight: 600 }
  state: { color: secondary }
icons:
  icon: { color: grey }
  icon_on: { color: white }      # the same icon while on
```

## Day and night

Dashboard settings → **Appearance → Day and night**:

| | |
| --- | --- |
| **By the sun** | Dark from sunset to sunrise (`sun.sun`) |
| **Follow the HA theme** | Dark when Home Assistant is in dark mode |
| **Always light / Always dark** | |

Any card (and the dashboard) can have a different look at night. In the **Appearance** tab
switch to **At night**: what you change there is used only at night, the rest stays as by
day. In YAML it's the `dark:` key:

```yaml
type: custom:glass-room-card
image_color: active
dark:
  image_color: never      # a calm, grey photo at night
```

**Time tint** (`time_tint: true`) gives every glass surface a faint warm tint at sunrise and
sunset, like macOS wallpapers.

## Wallpapers

Set the dashboard's `wallpaper` – and the night one under `dark:`:

```yaml
wallpaper: glass:hills-day
dark:
  wallpaper: glass:hills-night-blue-soft
```

`glass:<name>` is a wallpaper that comes with the cards; any image URL works too
(`/local/wallpapers/my-day.jpg`). Empty = your Home Assistant theme's background.

| Bundled | Day | Night |
| --- | --- | --- |
| Blue hills | `glass:hills-day` | `glass:hills-night-blue-soft`, `glass:hills-night-amber` |
| Green hills | `glass:green-hills-day` | |
| Dunes | `glass:dunes-day` | `glass:dunes-night` |
| Calm sea | `glass:sea-day` | |
| Steel waves | `glass:steel-waves-day` | `glass:steel-waves-night` |
| Grey waves | `glass:grey-waves-day` | `glass:grey-waves-night` |
| Pastel waves | `glass:pastel-waves-day` | `glass:pastel-waves-night` |

The wallpaper is set by the glass dashboard and remembered by the browser, so a reload at night
doesn't flash the day picture. Calm pictures work best: glass refracts what's behind it, and
busy detail makes text harder to read.

## Fine-tuning

The dashboard's `styles` adjust the whole system – corner radius, button sizes, the liquid
glass itself:

```yaml
styles:
  radius: 32px                 # corners of panels and tiles
  room_button_size: 46px       # the round buttons on room cards
  corner_shape: squircle       # Apple-style continuous corners (where the browser supports it)
liquid:
  rim_width: 1.25              # the bright edge of liquid glass
```

Glass Studio shows the liquid glass knobs among the dashboard's **Appearance** settings, with a live preview.
