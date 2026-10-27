# Chart

`custom:glass-chart`

A chart in the dashboard's glass look – no card background, the glass font, columns with a soft gradient and glow, a glass tooltip – drawn by apexcharts-card. It follows the [period bar](period-bar.md): the span, the grouping and the date format change with day, week, month or year.

**Good for:** energy, temperatures, anything with history.

## Quick start

```yaml
type: custom:glass-chart
period: true                 # follow the period bar
color: "#ff9f0a"
card:
  type: custom:apexcharts-card
  series:
    - entity: sensor.energy_consumption
      statistics: { type: change }
```

Needs [apexcharts-card](https://github.com/RomRider/apexcharts-card) from HACS. The data stay apexcharts-card's – `series`, `group_by`, `data_generator`… Each period can have its own data:

```yaml
day:
  series: [ ... ]            # lists replace the card's, maps merge into it
month:
  series: [ ... ]
```

What a series leaves out follows the period: `statistics.period`, `group_by.duration` (day → hour, week / month → day, year → month) and the tooltip's date. `look: apex` keeps apexcharts-card's own look.


## Options

<!-- options -->
| Option | Type | What it does |
| --- | --- | --- |
| `card` **required** | BaseCardConfig | Shared look (all periods) |
| `period` | boolean | Follow the period bar |
| `look` | "glass" \| "apex" |  |
| `color` | string | Color |
| `height` | number | Height |
| `values` | boolean | Value labels |
| `time` | boolean | Time labels |
| `grid` | boolean | Lines at values |
| `column_width` | number | Column width |
| `radius` | number | Rounded ends |
| `gradient` | boolean | Gradient |
| `glow` | boolean | Glow |
| `zero_line` | boolean | Line at zero |
| `day` | map of unknown | Day |
| `week` | map of unknown | Week |
| `month` | map of unknown | Month |
| `year` | map of unknown | Year |

<!-- /options -->

---

[All cards](../README.md#the-cards) · [Look and feel](../appearance.md) · [Actions and conditions](../actions-and-conditions.md)
