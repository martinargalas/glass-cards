# Alarms

`custom:glass-alarms`

Several alarms in one card, as a phone's clock app shows them: on top when the soonest one rings – *Alarm in 3 days, Mon 16. 11. 6:30* – under it the alarms, each with its time, the days of the week (the ones it rings on lit) or its date, the speakers it rings on and a switch. A tap opens an alarm's settings, **+** adds one: the card creates its helpers and its automation itself.

`layout: carousel` shows one alarm at a time – swipe to the others (dots under it) – for a small tile.

**Good for:** a family's alarms – the kids' room on weekdays, the bedroom at the weekend – each ringing on its own speaker.

## Quick start

```yaml
type: custom:glass-alarms
skip_calendars:                   # optional: days off – all-day events in these calendars
  - calendar.czechia              #   public holidays (the Holiday integration)
  - calendar.holidays             #   your own holidays, days without an alarm
```

That's all: **+** (for administrators) opens a new alarm – its name, the time on wheels, the days, *Not on days off*, the speakers and the sound – and *Done* creates it:

- its helpers, named `glass_alarm_<n>_…` (time, on / off, days, name, speakers, sound, days off on / off),
- its automation, *Glass alarm &lt;n&gt;*, from the [Glass alarm blueprint](alarm.md#the-blueprint) – the card saves the blueprint into Home Assistant itself, no import needed.

A tap on an alarm opens the same settings; **Delete the alarm** (tapped twice) removes it with its helpers and automation. The list shows every alarm made this way, from any card.

Each alarm rings on the speakers ticked in its settings – none ticked, it only runs its automation (add your own actions there: lights, blinds…). The sound is *Birds*, the calm melody that comes with the cards, or your own address (`https://…`, `/local/…`, `media-source://…`).

## Speakers and sounds offered

```yaml
players: [media_player.kids_room, media_player.bedroom]   # default: every media player
sounds:                                                    # beside Birds
  - { name: Radio, url: https://ice.example.com/stream.mp3 }
```

## Look

In the card's **Appearance** tab in the Studio – or in YAML – every part has its material and colour: the alarms' group, the days it rings on, the switches, the **+** button, and the settings window with its controls (quick choices, days, fields, the speakers' list). The window takes the card's look: a material set for it is drawn with the dashboard's colours.

## Options

<!-- options -->
| Option | Type | What it does |
| --- | --- | --- |
| `title` | string | Title – Empty = none, only + |
| `skip_calendars` | string[] | days off: calendars whose all-day events the alarms skip – public holidays (the Holiday integration), your holidays… |
| `players` | string[] | the speakers offered (default: every media player) |
| `sounds` | { name: string; url: string }[] | sounds offered beside the cards' own melody: { name, url } |
| `minute_step` | number | the wheels' minutes: every 1 (default), 5, 10, 15 or 30 |
| `layout` | "list" \| "carousel" | list: every alarm under each other (default); carousel: one at a time, the others a swipe away |
| `show_next` | boolean | when the soonest alarm rings, above the list – "Alarm in 3 days" (default shown) |

#### Look

Materials and colours of the card's parts – set them in the card's **Appearance** tab, or here.

| Option | Type | What it does |
| --- | --- | --- |
| `active_color` | string | an alarm on: its switch, the picked days, the buttons – default blue |
| `add_glass` | material | the + button: its material (default a faint tint) and a tint over it |
| `add_color` | string | Colour of the add (a tint of its material). |
| `list_glass` | material | the alarms' group (the carousel too): its material and a tint over it |
| `list_color` | string | Colour of the list (a tint of its material). |
| `switch_glass` | material | the switches: the track's material when off, and their colour when on (default active_color) |
| `switch_color` | string | Colour of the switch (a tint of its material). |
| `days_color` | string | the days an alarm rings on, lit (default active_color) |
| `sheet_glass` | GlassMode | the settings' window: its glass, as a card's background (liquid – the real liquid glass, dark-liquid, frosted, light, flat, solid, home, none; default its own dark or light glass) and a tint over it |
| `sheet_color` | string | Colour of the sheet (a tint of its material). |
| `controls_glass` | material | the modal's controls – quick choices, days, fields, lists: their material and a tint |
| `controls_color` | string | Colour of the controls (a tint of its material). |
<!-- /options -->

---

[All cards](../README.md#the-cards) · [Look and feel](../appearance.md) · [Actions and conditions](../actions-and-conditions.md)
