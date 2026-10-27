# Dashboard

`custom:glass-dashboard`

The full-screen layout every other glass card lives in. It divides the screen into areas (a side column, a header, the main area…), picks the look, the wallpaper and day or night, and rearranges itself for phones, tablets and computers. Dashboard Studio opens when you edit it.

![Dashboard](../images/tablet-day.webp)

**Good for:** the one card of a full-screen dashboard view.

## Quick start

```yaml
type: custom:glass-dashboard
preset: sidebar              # a side column and a main area
look: liquid
appearance: sun              # dark from sunset to sunrise
wallpaper: glass:hills-day
dark:
  wallpaper: glass:hills-night-blue-soft
left:
  - type: custom:glass-panel
    cards:
      - type: custom:glass-clock-weather
        weather: weather.home
main:
  - type: custom:glass-panel
    layout: grid
    columns: 3
    cards:
      - type: custom:glass-room-card
        name: Living room
        entities:
          - entity: light.living_room
```

Put it in a view of type **Panel (single card)** – it needs the whole screen. Everything about areas, presets and phones is in [Layout](../layout.md); looks and wallpapers in [Look and feel](../appearance.md).

### Demo mode

`demo: true` runs every card inside on the made-up home of the [demo dashboard](../demo.md): invented devices, made-up history and forecast. Switching anything changes nothing in your home. Handy for trying a card before you have the device for it.

## Tips

- `overlay:` holds what floats over everything – the dock, notifications, Bubble Card pop-ups.
- `left_width` sets the side column's width, e.g. `minmax(340px, 0.34fr)`; or drag the line in Dashboard Studio's Schematic.
- `dock_space: auto` keeps room at the bottom for a floating dock.

## Options

<!-- options -->
| Option | Type | What it does |
| --- | --- | --- |
| `look` | Look |  |
| `layout` | "auto" \| "mobile" \| "tablet" \| "desktop" | Layout |
| `breakpoint` | number | Legacy single breakpoint = breakpoints.mobile. |
| `breakpoints` | { mobile?: number; desktop?: number } |  |
| `left_width` | string | Left panel width (CSS) |
| `column_widths` | string \| (string \| number)[] | Exact width of each layout column, as a panel's: "340px 1" (1 = the rest), "30% 1", "300px 1 300px". |
| `row_heights` | string \| (string \| number)[] | Height of each layout row, as column_widths: "120px 1". Rows not given keep the layout's own. |
| `gap` | number | Gap (px) |
| `padding` | string | Margin |
| `max_width` | string | Max. width |
| `offset` | string | Subtract header height |
| `dock_space` | number \| "auto" | Space kept free at the bottom for a floating dock (bubble navigation). |
| `appearance` | "auto" \| "light" \| "dark" \| "sun" | Light / dark mode |
| `wallpaper` | string | Wallpaper over the HA theme's; the night one in `dark: { wallpaper }`, switched with the appearance. |
| `liquid` | map of number | Liquid glass shader parameters (edge_intensity, rim_intensity, blur, tint, dispersion…). |
| `preset` | Preset |  |
| `grid` | { columns?: string; rows?: string; areas?: string \| string[] } | Lines at values |
| `areas` | Record<string, BaseCardConfig[]> |  |
| `header` | BaseCardConfig[] | Header (YAML) |
| `top` | BaseCardConfig[] | Top panel (YAML) |
| `left` | BaseCardConfig[] | Left panel (YAML) |
| `main` | BaseCardConfig[] | Main panel (YAML) |
| `overlay` | BaseCardConfig[] | Overlay – pop-ups (YAML) |
| `overlay_source` | OverlaySource \| OverlaySource[] | Load pop-ups / navigation from another dashboard instead of listing them here. |
| `overlay_theme` | string | HA theme whose variables the pop-ups get (their card_mod styles usually read theme variables), independent of the theme the user has selected. A name, or { light, dark } following the dashboard's appearance. |
| `demo` | boolean | Run every card on the made-up demo home instead of this Home Assistant's devices (src/demo). |

#### Look

Materials and colours of the card's parts – set them in the card's **Appearance** tab, or here.

| Option | Type | What it does |
| --- | --- | --- |
| `glass` | GlassMode | Background material |
| `tile_glass` | GlassMode | Material of cards inside panels |
| `control_glass` | GlassMode | Material of the items inside |
| `fill_height` | boolean | Full height |
| `time_tint` | boolean | Time-of-day tint |
<!-- /options -->

---

[All cards](../README.md#the-cards) · [Look and feel](../appearance.md) · [Actions and conditions](../actions-and-conditions.md)
