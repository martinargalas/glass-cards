# People

`custom:glass-people`

The people of the household as round avatars: a badge for home or away, where they are (the zone's name and icon), and their phone's battery as a ring.

**Good for:** the side column or the top bar.

## Quick start

```yaml
type: custom:glass-people
people:
  - entity: person.alex
    battery: sensor.alex_phone_battery
    battery_state: sensor.alex_phone_battery_state   # shows charging
  - entity: person.sam
    battery: sensor.sam_phone_battery
show_location: away        # always | away | never
```

## Tips

- `battery_style: text` shows the battery as a number instead of a ring.
- `zone_icons: { Work: mdi:briefcase }` – your own icon for a zone.
- `driving: binary_sensor.alex_driving` – a car badge while driving.

## Options

<!-- options -->
| Option | Type | What it does |
| --- | --- | --- |
| `people` **required** | PersonConfig[] |  |
| `size` | number | Size (px) |
| `show_name` | boolean | Show name |
| `show_location` | "always" \| "away" \| "never" | Show location |
| `show_battery` | boolean | Show battery |
| `battery_style` | "text" \| "ring" | `text` – icon + % next to the avatar; `ring` – progress ring around the avatar. |
| `gap` | number | Gap (px) |
| `align` | "start" \| "center" \| "end" | Alignment |
| `liquid` | boolean | Liquid glass (WebGL) around each person even inside a panel – over the wallpaper. |

<!-- /options -->

---

[All cards](../README.md#the-cards) · [Look and feel](../appearance.md) · [Actions and conditions](../actions-and-conditions.md)
