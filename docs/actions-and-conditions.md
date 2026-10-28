# Actions and conditions

## What a tap does

Cards take Home Assistant's usual actions – `tap_action`, `hold_action`, `double_tap_action`:

```yaml
tap_action:
  action: toggle                      # more-info, navigate, url, perform-action, none…
hold_action:
  action: more-info
```

```yaml
tap_action:
  action: perform-action
  perform_action: script.goodnight
  data: { room: bedroom }
```

Lights, switches, fans and similar toggle on a tap by default; everything else opens its
more-info dialog on a hold.

### Menus

`action: menu` opens a small glass menu next to the button – a few related choices without a
pop-up. Each item can show whether it is the current one (`active`), hide itself (`visible`)
and count down a timer. The idea follows [honeycomb-menu](https://github.com/Sian-Lee-SA/honeycomb-menu)
by [Sian-Lee-SA](https://github.com/Sian-Lee-SA).

```yaml
- entity: cover.office_blind
  icon: mdi:blinds-horizontal
  tap_action:
    action: menu
    labels: true                      # names under the icons
    items:
      - icon: mdi:window-shutter-open
        name: Open
        perform_action: cover.open_cover
        target: { entity_id: cover.office_blind }
        active: { state: open }
      - icon: mdi:window-shutter
        name: Close
        perform_action: cover.close_cover
        target: { entity_id: cover.office_blind }
        active: { state: closed }
      - icon: mdi:timer-pause-outline
        name: Pause the automation for an hour
        perform_action: switch.toggle
        target: { entity_id: switch.office_blind_pause }
        active: { entity: switch.office_blind_pause, state: "on" }
        countdown: { entity: switch.office_blind_pause, duration: 3600 }
```

## Conditions

Conditions decide when something is lit, coloured, shown or hidden – without templates.
They read like a sentence:

```yaml
state: "on"                     # the card's entity is on
state: [heat, heating]          # … is one of these
state_not: [off, unavailable]   # … is none of these
above: 45                       # a number above 45 (or above another sensor: above: sensor.limit)
below: 0
entity: sensor.washer_job_state # look at another entity
attribute: current_position     # look at an attribute instead of the state
```

Combine them with `and`, `or` and `not`; a plain list means *all of these*:

```yaml
visible:
  or:
    - entity: media_player.kitchen_speaker
      state: playing
    - entity: media_player.bathroom_speaker
      state: playing
```

Home Assistant's own conditions (`condition: state`, `numeric_state`, `screen`, `user`, `and`,
`or`, `not`) work too – copy them from a conditional card. Glass adds
`condition: select` (a page, tab or appliance picked on this screen).

### Where conditions are used

| Key | Meaning |
| --- | --- |
| `visible` | an item (a chip, a button, a menu item) shows only while it holds |
| `active` | the item counts as *on*: lit, coloured, counted in "Running now" |
| `rules` | a list of conditions with what changes while each holds (below) |
| `visibility` | a whole card in a panel shows only while it holds |
| `image_on` | a room card's photo is in colour while it holds |

### Rules

Rules change an item's look while their condition holds. Later rules win.

```yaml
- entity: sensor.hot_water_temperature
  icon: dot
  text: Hot water {value}°
  color: blue
  rules:
    - above: 43
      color: yellow
    - above: 45
      color: red
    - entity: binary_sensor.hot_water_heating
      state: "on"
      animation: glow
```

A rule can set `color`, `icon`, `text`, `badge` (a small mark: `"!"`) and `animation`:
`glow`, `pulse`, `shake`, `bounce`, `spin`.

## Text with values

Texts can include values:

| | |
| --- | --- |
| `{state}` | the state, formatted as Home Assistant does |
| `{value}` `{unit}` | the number and its unit separately (`precision: 1` for decimals) |
| `{attr:message}` | an attribute |
| `{changed}` | when it last changed – "5 min ago", "today 18:12" |

```yaml
text: "Plex: {value} streams"
```
