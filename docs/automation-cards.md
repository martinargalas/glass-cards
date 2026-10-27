# Automation cards

Three cards for the side panel of an automation – built for blinds, usable for anything:

| Card | Shows |
| --- | --- |
| `custom:glass-automation` | An automation on / off, and for how long a switch-off lasts |
| `custom:glass-sun-shading` | The sun over a compass with the shading azimuth, the light outside, what the automation decided |
| `custom:glass-value-grid` | Numbers in a table with − / + on each, a column per season (or any mode) |

Put them under each other in a panel (or a vertical stack). Each draws a thin line above
itself, except the first one.

Colours (the switch, the shading azimuth, the light ring, the current column) are set in each
card's **Appearance** tab; the defaults follow the glass palette.

**The cards never decide anything.** They show and change helpers (`input_number`,
`input_select`, `input_datetime`) and an automation. What happens with those values is your
automation's job. This page shows how to set that up.

---

## Value grid – seasons (summer / winter) explained

The typical use: the blinds' slats are tilted differently when the sun is strong (summer)
than when it is weak (winter), and each has a few levels (Min / Medium / Max).

```
                 Strong sun   Weak sun        ← columns = modes (seasons)
        Min        [− 40 +]   [− 20 +]
        Medium     [− 60 +]   [− 45 +]        ← rows = levels
        Max        [− 85 +]   [− 70 +]        ← every cell = one input_number
```

The column of the current season is highlighted. You decide what "summer" is:

### 1. Create the helpers (Settings → Devices & services → Helpers → Create helper → Number)

| Helper | Min – Max | Step | What for |
| --- | --- | --- | --- |
| `input_number.blinds_summer_from` | 1 – 12 | 1 | first month of strong sun (e.g. 6 = June) |
| `input_number.blinds_summer_to` | 1 – 12 | 1 | last month of strong sun (e.g. 9 = September) |
| `input_number.blinds_summer_min` … `_max` | 0 – 100 | 5 | the tilts in summer |
| `input_number.blinds_winter_min` … `_max` | 0 – 100 | 5 | the tilts in winter |

Don't need to change the months on the dashboard? Skip the two month helpers and type fixed
months into the column instead (**Or fixed: from month / to month**).

A range over New Year works too: from 10 to 3 = October to March.

### 2. Set up the card

In the card editor:

- **Columns** – *Strong sun* with *From month* / *To month* (the helpers or fixed months);
  *Weak sun* without months – it is the rest of the year.
- **Rows** – *Min*, *Medium*, *Max*; each with its numbers, **one per column in the columns'
  order** (summer first, then winter).

```yaml
type: custom:glass-value-grid
title: Slat tilt
unit: "%"
columns:
  - name: Strong sun
    icon: mdi:white-balance-sunny
    months_from: input_number.blinds_summer_from
    months_to: input_number.blinds_summer_to
  - name: Weak sun
    icon: mdi:weather-sunny-off
rows:
  - name: Min
    entities: [input_number.blinds_summer_min, input_number.blinds_winter_min]
  - name: Medium
    entities: [input_number.blinds_summer_medium, input_number.blinds_winter_medium]
  - name: Max
    entities: [input_number.blinds_summer_max, input_number.blinds_winter_max]
```

When the months are helpers, the card shows them above the table with − / +, so the
season can be moved right on the dashboard.

### 3. Let the automation use the current season's values

The card only marks the current column. The automation needs the same answer – a template
sensor gives it (Settings → Helpers → Create helper → Template → Template sensor):

```jinja
{% set od = states('input_number.blinds_summer_from') | int(6) %}
{% set do = states('input_number.blinds_summer_to') | int(9) %}
{% set m = now().month %}
{{ 'summer' if ((od <= m <= do) if od <= do else (m >= od or m <= do)) else 'winter' }}
```

Name it `blinds_season`. The tilt for a level is then, in the automation:

```yaml
action: cover.set_cover_tilt_position
target:
  entity_id: cover.office
data:
  tilt_position: "{{ states('input_number.blinds_' ~ states('sensor.blinds_season') ~ '_max') | int }}"
```

### Mode by a state instead of months

Already have a sensor that says the mode (`summer` / `winter`, `home` / `away`, …)? Set
**Current column by a state** to it and give each column its **State**:

```yaml
active: sensor.blinds_season
columns:
  - { name: Strong sun, state: summer }
  - { name: Weak sun, state: winter }
```

More than two columns work the same way (spring / summer / autumn, or a column per room).

---

## Automation switch – switching off for a while

On its own the card is an on / off switch for an automation (or any switch).

For "switch off for an hour / until tomorrow / until a time" create three helpers:

| Helper | Type | Example |
| --- | --- | --- |
| `input_select.blinds_auto_pause` | Dropdown | `1 hodina`, `3 hodiny`, `Do zítřka`, `Do času`, `Natrvalo` |
| `input_datetime.blinds_auto_resume` | Date and time | when it comes back (set by the automation below) |
| `input_datetime.blinds_auto_until` | Time | the time for the option containing `čas` / `time` |

The card shows the dropdown under the switch; while the automation is off it says when it
comes back. The option whose name contains `čas` or `time` gets a time field beside it.

Two small automations do the rest:

```yaml
# when switched off: work out when it comes back
triggers:
  - trigger: state
    entity_id: automation.blinds_auto
    to: "off"
actions:
  - action: input_datetime.set_datetime
    target: { entity_id: input_datetime.blinds_auto_resume }
    data:
      datetime: >-
        {% set p = states('input_select.blinds_auto_pause') %}
        {% if p == '1 hodina' %}{{ now() + timedelta(hours=1) }}
        {% elif p == '3 hodiny' %}{{ now() + timedelta(hours=3) }}
        {% elif p == 'Do zítřka' %}{{ today_at('06:00') + timedelta(days=1) }}
        {% elif p == 'Do času' %}{{ today_at(states('input_datetime.blinds_auto_until')) }}
        {% else %}2099-01-01 00:00:00{% endif %}
---
# and turn it back on then
triggers:
  - trigger: time
    at: input_datetime.blinds_auto_resume
actions:
  - action: automation.turn_on
    target: { entity_id: automation.blinds_auto }
```

---

## Sun and shading

A compass seen from above, north up: the sun where it stands (nearer the middle the higher),
the shading azimuth as a sector, and around it the light outside.

- **Shading azimuth – From / To (°)**: the sun's directions in which it shines into the room
  (90° east, 180° south, 270° west). This is what your shading automation should use to decide
  that the sun is *on the windows*: inside the range it shades fully, and with a low sun it
  can't rely on the light sensor alone (the sensor loses the sun behind roofs long before the
  windows do), so the direction decides. Outside the range a little shading is enough.
  To find the values: when the sun just starts shining in, read `sun.sun`'s `azimuth`
  attribute (Developer tools → States); do the same when it stops.
- **When the sun is high**: a high sun only glances off the glass from the side (a roof
  overhang, a balcony) – give the narrower range and the height from which it applies.
- **Horizon (°)**: roofs or a hill – below this height the sun counts as set.
- **Shading decision**: a sensor of yours whose state is `open`, `min`, `mid` or `max`; the
  card says it in words (change them with `labels:`). **Target tilt**: the tilt it aims for.
- **Light outside**: a lux sensor; the ring fills on a square-root scale up to 100 000 lx.
  If the shading sensor has an attribute with lux per level (`thresholds_attribute`,
  e.g. `{min: 20000, mid: 40000, max: 60000}`), the ring marks them.

```yaml
type: custom:glass-sun-shading
sun: sun.sun
light: sensor.sun_sensor_luminance
shading: sensor.blinds_shading_level
target_tilt: sensor.blinds_target_tilt
azimuth_from: 195
azimuth_to: 305
azimuth_high_above: 20
azimuth_high_from: 215
horizon: 4
```

Look: compass on / off, text on / off, text beside or under the compass, compass size;
the shading azimuth's and the light ring's colours in **Appearance**.

---

## The whole blinds panel

```yaml
type: custom:glass-panel
cards:
  - type: custom:glass-automation
    entity: automation.blinds_auto
    title: Blinds automation
    pause_for: input_select.blinds_auto_pause
    resume_at: input_datetime.blinds_auto_resume
    pause_until: input_datetime.blinds_auto_until
  - type: custom:glass-sun-shading
    # … as above
  - type: custom:glass-value-grid
    # … as above
```
