# Value grid

`custom:glass-value-grid`

Numbers in a table, each with − and +, a column per mode – summer and winter, or anything else. The current column is highlighted, by the months or by a state.

**Good for:** settings your automations read: slat tilts by season, temperatures by mode.

## Quick start

```yaml
type: custom:glass-value-grid
title: Slat tilt
columns:
  - name: Summer
    icon: mdi:white-balance-sunny
  - name: Winter
    icon: mdi:snowflake
rows:
  - name: Low sun
    entities: [input_number.tilt_summer_low, input_number.tilt_winter_low]
  - name: High sun
    entities: [input_number.tilt_summer_high, input_number.tilt_winter_high]
```

Every cell is an `input_number` (or `number`). How to mark the current season, and how an automation uses the values: [Blinds that follow the sun → Value grid](../automation-cards.md#value-grid--seasons-summer--winter-explained).


## Options

<!-- options -->
| Option | Type | What it does |
| --- | --- | --- |
| `columns` | GridColumn[] | Columns |
| `rows` | GridRow[] | Rows |
| `active` | string | Sensor |
| `show_months` | boolean | false: the months' − / + are not shown (the column is still chosen by them) |
| `unit` | string | Unit – e.g. % |
| `title` | string | Title |
| `show_title` | boolean | false: no title line |

#### Look

Materials and colours of the card's parts – set them in the card's **Appearance** tab, or here.

| Option | Type | What it does |
| --- | --- | --- |
| `active_color` | string | the current column's cells and a value not sent yet; default the control glass / orange |
| `current_glass` | material | the fields' materials: the current column's (default Apple Home's dark glass) and the others' (default no blur) |
| `field_glass` | material | Material of the field – see [Materials](../appearance.md#materials). |
| `cell_color` | string | a tint over the other fields |
<!-- /options -->

---

[All cards](../README.md#the-cards) · [Look and feel](../appearance.md) · [Actions and conditions](../actions-and-conditions.md)
