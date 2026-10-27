# Thermostat

`custom:glass-thermostat`

A room's temperature as a tile: the last hours as a soft graph that fades out at the sides, over a glass bar with the room's icon (switches the heating), the temperature and the set point with − / +. With a plain sensor it shows the value and the graph only.

**Good for:** a climate page with a tile per room.

## Quick start

```yaml
type: custom:glass-thermostat
entity: climate.living_room
temperature_entity: sensor.living_room_temperature   # optional: the value shown and drawn
name: Living room
icon: mdi:sofa
hours: 12
```

### Extras in the graph

```yaml
graph_entities:
  - sensor.living_room_target      # a number: a thin line on the same scale
  - binary_sensor.heating          # on / off: shaded where it was on
active: { entity: binary_sensor.heating, state: "on" }   # when the icon lights
```

## Tips

- `min_max: 24` – the highest and lowest of the last 24 h in the bar.
- `smoothing: 0` … `6` – from every bump to a calm curve.
- `compact: true` – a low tile for long lists on phones.

## Options

<!-- options -->
| Option | Type | What it does |
| --- | --- | --- |
| `entity` **required** | string | Entity |
| `temperature_entity` | string | Temperature sensor |
| `name` | string | Name |
| `icon` | string | Icon |
| `hours` | number | Graph – hours |
| `graph` | boolean | Graph |
| `graph_entities` | entity list | More in the graph (numbers: line, on/off: shaded) |
| `active` | condition | On when (condition, YAML) |
| `precision` | number | Decimal places |
| `min_range` | number | Smallest temperature span the graph shows, so a steady room isn't drawn as a mountain range. |
| `smoothing` | number | Graph – smoothing |
| `controls` | "bottom" \| "top" | Where the bar with the icon and set point sits on a tile: bottom (default, like a room card with a photo) or top. |
| `compact` | boolean | A low tile for long lists (phones): the graph behind the name instead of above the bar. |
| `inline_value` | boolean | A sensor (no set point): the value on the name's line, no icon – the graph right under them. |
| `show_name` | boolean | Show name |
| `min_max` | boolean \| number | Highest and lowest value in the bar (↑ 12,4° ↓ 3,1°): true = over the graph's hours, a number = over that many hours. |
| `tap_action` | action | Tap |
| `hold_action` | action | Hold |
| `double_tap_action` | action | Double tap |

#### Look

Materials and colours of the card's parts – set them in the card's **Appearance** tab, or here.

| Option | Type | What it does |
| --- | --- | --- |
| `active_color` | string | Color when on |
| `graph_color` | string | Graph colour |
| `pill_glass` | material | Material of the bar – see [Materials](../appearance.md#materials). |
| `pill_color` | string | Colour of the bar (a tint of its material). |
| `icon_glass` | material | Material of the icon – see [Materials](../appearance.md#materials). |
| `icon_on_glass` | material | Material of the icon while on – see [Materials](../appearance.md#materials). |
| `icon_background` | string |  |
| `buttons_glass` | material | Material of the buttons – see [Materials](../appearance.md#materials). |
| `buttons_color` | string | Colour of the buttons (a tint of its material). |
<!-- /options -->

---

[All cards](../README.md#the-cards) · [Look and feel](../appearance.md) · [Actions and conditions](../actions-and-conditions.md)
