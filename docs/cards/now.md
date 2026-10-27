# Running now

`custom:glass-now`

Everything that is on in the whole home, one row each – the lights counted per room, the TV, the music, the PC – with a button to switch it off. Machines that work on their own (washer, mower, robot vacuum) show what they're doing instead. When nothing is on, the card disappears.

**Good for:** leaving the house; the phone dashboard; checking before bed.

## Quick start

```yaml
type: custom:glass-now
title: Running now
lights:                          # counted together: "3 lights · Living room 2 · Kitchen"
  - name: Living room
    icon: mdi:sofa
    entities: [light.living_room, light.living_room_lamp]
  - name: Kitchen
    icon: mdi:silverware-fork-knife
    entities: [light.kitchen_ceiling, light.kitchen_counter]
items:
  - entity: media_player.living_room_tv
    name: TV
    room: Living room
    icon: mdi:television
  - type: washer
    entity: sensor.washer_job_state
    name: Washing machine
    room: Laundry
  - type: mower
    entity: lawn_mower.garden_mower
    progress: sensor.garden_mower_progress
```

## Tips

- An item's `active:` says what counts as on (default: on, playing, heating…).
- `off_action:` – what the button does instead of `turn_off`; `false` hides it.
- `hide_empty: false` shows “Nothing on” instead of hiding.

## Options

<!-- options -->
| Option | Type | What it does |
| --- | --- | --- |
| `title` | string | Title – E.g. “Running now”; empty = no heading. |
| `lights` | LightGroup[] |  |
| `light_icon` | string | Icon |
| `items` | NowItem[] |  |
| `hide_empty` | boolean | Hide while nothing is on – Off: shows “Nothing on”. |
| `icon_size` | number | the coloured circle of each row, px (36) |
| `density` | "compact" \| "normal" \| "roomy" | row height: compact \| normal \| roomy |
| `dividers` | boolean | lines between the rows (true) |

#### Look

Materials and colours of the card's parts – set them in the card's **Appearance** tab, or here.

| Option | Type | What it does |
| --- | --- | --- |
| `light_color` | string | Lights color |
| `button_size` | number | the button on the right, px (36) |
<!-- /options -->

---

[All cards](../README.md#the-cards) · [Look and feel](../appearance.md) · [Actions and conditions](../actions-and-conditions.md)
