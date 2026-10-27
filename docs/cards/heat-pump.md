# Heat pump

`custom:glass-heat-pump`

A heat pump drawn like Home Assistant's energy card: glowing nodes and beams of light along the pipes – outside air → the pump → the heating and / or the hot water tank. Under it the heating mode, the hot water's set point and a settings drawer with the heating curve and the service counters.

**Good for:** a climate or energy page.

## Quick start

```yaml
type: custom:glass-heat-pump
entities:
  climate: climate.heat_pump
  water_heater: water_heater.hot_water
  compressor: binary_sensor.heat_pump_compressor
  outside: sensor.outdoor_temperature
  supply: sensor.heat_pump_supply_temperature
  return: sensor.heat_pump_return_temperature
  dhw: sensor.hot_water_temperature
  curve_shift: number.heating_curve_shift
  curve_slope: number.heating_curve_slope
```

**Viessmann ViCare:** `device: <the pump's device id>` finds all of its entities by name – no list needed.

Whatever has no entity is left out and the rest closes up. Where the heat goes: `heating_active` / `dhw_active` when given (binary sensors), otherwise the climate's `heating` state decides. `rod:` (the electric heating rod) turns the pump red while it runs.

## Tips

- `show_modes: false`, `show_settings: false`, `show_dhw_setpoint: false` – a calmer card.
- `show_animation: false` – no beams or breathing.

## Options

<!-- options -->
| Option | Type | What it does |
| --- | --- | --- |
| `device` | string | Device |
| `entities` | Partial<Record<Role, string>> | Entities |
| `name` | string | Name |
| `show_dhw_setpoint` | boolean | The hot water set point (− / +) under the scheme; false hides it. |
| `show_animation` | boolean | Animation |
| `show_modes` | boolean | Heating mode |
| `show_settings` | boolean | Settings drawer |

#### Look

Materials and colours of the card's parts – set them in the card's **Appearance** tab, or here.

| Option | Type | What it does |
| --- | --- | --- |
| `modes_glass` | material | Material of the picked mode – see [Materials](../appearance.md#materials). |
| `modes_color` | string | Colour of the picked mode (a tint of its material). |
| `active_glass` | material | Material of the active one – see [Materials](../appearance.md#materials). |
| `active_color` | string | Color when on |
| `buttons_glass` | material | Material of the buttons – see [Materials](../appearance.md#materials). |
| `buttons_color` | string | Colour of the buttons (a tint of its material). |
| `outside_color` | string | Colour of the outside (a tint of its material). |
| `heating_color` | string | Colour of the heating (a tint of its material). |
| `dhw_color` | string | Colour of the dhw (a tint of its material). |
| `rod_color` | string | Colour of the rod (a tint of its material). |
| `idle_color` | string | Colour of the idle (a tint of its material). |
<!-- /options -->

---

[All cards](../README.md#the-cards) · [Look and feel](../appearance.md) · [Actions and conditions](../actions-and-conditions.md)
