# Date header

`custom:glass-date-header`

Today's date – or a greeting (“Good afternoon”) – with one-line facts under it: today's holiday, name day, the power use, anything a sensor knows. Date format and language follow your profile.

**Good for:** the top of the side column or the header.

## Quick start

```yaml
type: custom:glass-date-header
greeting: true                     # "Good morning" instead of the date
holidays: calendar.holidays        # HA's Holiday integration
lines:
  - entity: sensor.grid_power
    text: "{state} from the grid"
  - entity: alarm_control_panel.home_alarm
    icon: mdi:shield-check-outline
    text: Secured
    visible: { state_not: [disarmed] }
```

## Tips

- `join: " · "` puts all lines on one: *Home 2 · 1.2 kW · secured*.
- Each line takes `visible:` – it shows only while its condition holds.

## Options

<!-- options -->
| Option | Type | What it does |
| --- | --- | --- |
| `align` | "start" \| "center" \| "end" | Alignment |
| `date_format` | Intl.DateTimeFormatOptions | Date format (Intl, YAML) |
| `title` | string | Title |
| `lines` | Line[] | Lines |
| `holidays` | string | A calendar of public holidays (HA's Holiday integration): today's one, while it is on. |
| `nameday` | string | A sensor whose state is today's names (from a name day integration or a template). |
| `greeting` | boolean | A greeting by the time of day instead of the date. |
| `join` | string | The lines as one, joined by this. |

<!-- /options -->

---

[All cards](../README.md#the-cards) · [Look and feel](../appearance.md) · [Actions and conditions](../actions-and-conditions.md)
