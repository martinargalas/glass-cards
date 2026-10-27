# Room map

`custom:glass-room-map`

A robot's map: the rooms of a robot vacuum or the zones of a robotic lawn mower. Pick them on the map or in the list and clean or mow just those – with the robot's own options (suction power, passes) as drop-downs.

**Good for:** next to the robot's [appliance](appliance.md) bar, shown with a select condition.

## Quick start

```yaml
type: custom:glass-room-map
entity: vacuum.robot_vacuum
map: image.robot_vacuum_rooms_map
room_names:
  Living Room: Living room
options:
  - entity: select.robot_vacuum_suction
    name: Suction
    icon: mdi:fan
```

Works with **Roomba+** (rooms from its `image.*_rooms_map`, cleaned with `roomba_plus.clean_room` – or your own `service`) and **Mammotion** mowers (zones from `mammotion.get_geojson`, mowed with `mammotion.start_mow`). For mowers `tiles: cuzk` gives sharp orthophoto under Czech gardens; elsewhere the default satellite map is used.


## Options

<!-- options -->
| Option | Type | What it does |
| --- | --- | --- |
| `entity` **required** | string | Entity |
| `map` | string | Map image |
| `tracker` | string | Mower on the map (device tracker) |
| `room_names` | map of string | Room names |
| `service` | string | Clean-rooms service |
| `satellite` | boolean | Aerial picture under the zones |
| `picture` | boolean | vacuum: show the robot's own (dark) map picture instead of drawing the rooms |
| `tiles` | string | the aerial picture: `esri` (world), `cuzk` (Czech orthophoto, sharper) or a `{z}/{y}/{x}` URL |
| `max_zoom` | number | Sharpest satellite zoom |
| `settings` | { angle?: string; height?: string; speed?: string; spacing?: string } | Before mowing (angle, height, speed, spacing entities) |
| `current` | string | where it works now – default `sensor.<name>_work_area` (mower) / `sensor.<name>_mission_progress` (its `current_room`) |
| `charging` | string | mower: charging (default `binary_sensor.<name>_charging`) – during a job, the button then resumes it |
| `live` | { height?: string; speed?: string } | during a job, the values it mows with (default `sensor.<name>_blade_height` / `_mowing_speed`) |
| `options` | { entity: string; name?: string; icon?: string; option_names?: map of string }[] | Choices under the map (select entities) |
| `title` | string | Title |

#### Look

Materials and colours of the card's parts – set them in the card's **Appearance** tab, or here.

| Option | Type | What it does |
| --- | --- | --- |
| `accent_color` | string | Colour of the accent (a tint of its material). |
| `settings_glass` | material | Material of the settings – see [Materials](../appearance.md#materials). |
| `settings_color` | string | Colour of the settings (a tint of its material). |
| `settings_fill_color` | string | Colour of the settings fill (a tint of its material). |
| `options_glass` | material | Material of the options – see [Materials](../appearance.md#materials). |
| `options_color` | string | Colour of the options (a tint of its material). |
| `rooms_glass` | material | Material of the rooms – see [Materials](../appearance.md#materials). |
| `rooms_color` | string | Colour of the rooms (a tint of its material). |
| `picked_glass` | material | Material of the picked one – see [Materials](../appearance.md#materials). |
| `picked_color` | string | Colour of the picked one (a tint of its material). |
| `button_glass` | material | Material of the button – see [Materials](../appearance.md#materials). |
| `button_color` | string | Colour of the button (a tint of its material). |
<!-- /options -->

---

[All cards](../README.md#the-cards) · [Look and feel](../appearance.md) · [Actions and conditions](../actions-and-conditions.md)
