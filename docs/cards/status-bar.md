# Status bar

`custom:glass-status-bar`

A row of small chips with values and icons: the hot water's temperature, the power from the grid, a running washer with its time left. Chips show only when they matter (`visible`), change colour by rules and can glow, pulse or shake.

**Good for:** the top bar: the home's state at a glance.

## Quick start

```yaml
type: custom:glass-status-bar
items:
  - entity: sensor.hot_water_temperature
    icon: dot                       # a coloured dot instead of an icon
    text: Hot water {value}°
    color: blue
    rules:
      - { above: 45, color: orange }
  - entity: sensor.grid_power
    format: power                   # 1240 W → 1.2 kW
    abs: true
    icon: mdi:arrow-up-bold
    rules:
      - { below: 0, icon: mdi:arrow-down-bold, color: green }
  - entity: sensor.washer_remaining_time
    icon: mdi:washing-machine
    animation: shake
    visible: { entity: sensor.washer_job_state, state_not: [none, finish] }
```

### Other layouts

| `layout` | |
| --- | --- |
| *(chips)* | the default row of chips |
| `list` | plain rows – icon and text – e.g. in a side column |
| `pills` | equal pills in a grid with a round icon button and a name over the text; `detail: last_triggered` adds "5 min ago" on the right – a neat automation list |
| `figures` | figures side by side, the name small over the value |

A `select` / `input_select` item with `dropdown: true` becomes a drop-down of its options.

## Tips

- `entities: [...]` with `aggregate: sum` adds several sensors into one chip.
- Rules and conditions are explained in [Actions and conditions](../actions-and-conditions.md).

## Options

<!-- options -->
| Option | Type | What it does |
| --- | --- | --- |
| `items` **required** | ChipConfig[] |  |
| `wrap` | boolean | Wrap to more rows |
| `pack` | boolean | wrap: reorder the chips so each row is as full as it can be (order kept within a row) |
| `pack_animation` | boolean | pack: chips glide to their new place (default true) |
| `gap` | number | Gap |
| `align` | "start" \| "center" \| "end" | Alignment |
| `size` | number | Size |
| `layout` | "chips" \| "list" \| "pills" \| "figures" | Layout |
| `detail` | string | Pills: an attribute of each item's entity on the right (times are shown relative). |
| `columns` | number | Columns |
| `pill_height` | number | Pill height |
| `graph` | GraphConfig | A soft history line under the items (figures). |

#### Look

Materials and colours of the card's parts – set them in the card's **Appearance** tab, or here.

| Option | Type | What it does |
| --- | --- | --- |
| `pill_glass` | material | Material of the bar – see [Materials](../appearance.md#materials). |
| `icon_glass` | material | Material of the icon – see [Materials](../appearance.md#materials). |
| `icon_background` | string |  |
| `pill_color` | string | pills: a tint over the pill (a colour alone gives it frosted glass), its height in px |
| `icon_on_glass` | material | pills: the icon's material while on (icon_glass is the one while off) |
<!-- /options -->

---

[All cards](../README.md#the-cards) · [Look and feel](../appearance.md) · [Actions and conditions](../actions-and-conditions.md)
