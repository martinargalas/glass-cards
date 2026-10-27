# Clock and weather

`custom:glass-clock-weather`

A big clock, the weather now with an animated icon, and a forecast with temperature bars – hourly, daily or both. Details like humidity, wind or sunset fill a small grid under it.

**Good for:** the side column of a wall tablet; a one-line version for a phone's header.

## Quick start

```yaml
type: custom:glass-clock-weather
weather: weather.home
temperature_entity: sensor.outdoor_temperature   # optional: your own thermometer for "now"
hourly_forecast: 5          # hours (0 = off)
daily_forecast: 5           # days (0 = off)
details: [humidity, wind, pressure, sunrise, sunset]
details_columns: 2
```

### On a phone

```yaml
type: custom:glass-clock-weather
weather: weather.home
show_clock: false
hourly_forecast: 0
daily_forecast: 0
now_style: line            # the weather now on one line
```

## Tips

- Weather entities that only give an hourly forecast still get a daily one – the card builds it from the hours.
- `rain_nowcast: true` shows rain in the next hour where your location has the data.

## Options

<!-- options -->
| Option | Type | What it does |
| --- | --- | --- |
| `weather` **required** | string | Weather |
| `temperature_entity` | string | Temperature sensor |
| `variant` | "full" \| "compact" | `compact`: one line with icon, condition and temperature – for phone headers. |
| `show_clock` | boolean | Clock |
| `show_weather` | boolean | false = clock only (use with a separate glass-divider and a weather-only card). |
| `show_seconds` | boolean | Seconds |
| `show_date` | boolean | Date under the clock |
| `clock_align` | "start" \| "center" \| "end" | Clock alignment |
| `now_align` | "start" \| "center" \| "end" | now_style line: where the "12° Prší, přestane …" line sits |
| `forecast_type` | "hourly" \| "daily" \| "twice_daily" \| "none" | Legacy single forecast; use hourly_forecast / daily_forecast instead. |
| `forecast_rows` | number | Forecast rows |
| `hourly_forecast` | number | Hours of hourly forecast (0 = off). |
| `daily_forecast` | number | Days of daily forecast (0 = off). |
| `show_icon` | boolean | Weather icon |
| `show_temperature` | boolean | Temperature |
| `show_condition` | boolean | false: no condition text – icon and temperature line up side by side |
| `temperature_decimals` | number |  |
| `show_precipitation` | boolean | Precipitation in forecast |
| `rain_nowcast` | boolean | Rain in the next two hours (Open-Meteo, 15-minute steps, at the home's location rounded to ~1 km): "Rain from 11:15" with a bar per step – shown only when rain is coming. |
| `rain_bars` | boolean | rain_nowcast: the bars per 15 minutes (false: just the sentence) |
| `now_style` | "block" \| "line" | `line`: the current weather as one line – "7° Cloudy, rain from 11:20" – no big icon. |
| `forecast_style` | "bars" \| "text" \| "columns" | `text`: forecast rows as plain text – "Tue 3° / 9°" – no icons or bars. |
| `divider` | boolean | Legacy: line between clock and weather in one card – use a glass-divider card instead. |
| `dividers` | boolean | Divider lines under the current weather and above each forecast block. |
| `details` | string[] | Details |
| `details_columns` | number | Details as a grid with this many columns (default: one wrapping line). |
| `animated_icons` | boolean | Animated icons |
| `icon_style` | "realistic" \| "flat" \| "mdi" | Big icon: flat (default, the original set) \| realistic \| mdi. Forecast icons always stay flat. |
| `bar_style` | "temperature" \| "single" | forecast bars: temperature (default, warm to cold colours) or single (bar_color); track_color under them |
| `divider_size` | number | Divider thickness |
| `tap_action` | action | Tap |

#### Look

Materials and colours of the card's parts – set them in the card's **Appearance** tab, or here.

| Option | Type | What it does |
| --- | --- | --- |
| `bar_color` | string | Colour of the bar (a tint of its material). |
| `track_color` | string | Colour of the track (a tint of its material). |
| `precip_color` | string | the precipitation figures in the forecast and the rain bars of the next two hours |
| `rain_color` | string | Colour of the rain (a tint of its material). |
| `divider_color` | string | divider lines (dividers: true): colour and thickness in px |
<!-- /options -->

---

[All cards](../README.md#the-cards) · [Look and feel](../appearance.md) · [Actions and conditions](../actions-and-conditions.md)
