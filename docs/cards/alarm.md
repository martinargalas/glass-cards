# Alarm

`custom:glass-alarm`

An alarm clock: its time – set with the card's own picker, 12 or 24 hours – on and off, the days it rings and days off skipped – public holidays, a holiday, anything in your calendars. Under the time it says when it rings next.

**Good for:** a wake-up alarm in a child's room or the bedroom, a morning routine, anything that should happen at a time on some days.

Several alarms in one list, created right in the card – each with its own speakers and sound: [Alarms](alarms.md).

## How it works

The card keeps nothing itself: it shows and sets helpers of your own, and an automation rings the alarm at the time. The repository ships one ready to use – the [Glass alarm blueprint](#the-blueprint).

| Helper | What for | The card's option |
| --- | --- | --- |
| Date and/or time (`input_datetime`), **time only** | the alarm's time | `entity` |
| Toggle (`input_boolean`) | on / off | `switch` |
| Text (`input_text`) | the days it rings | `days` |
| Toggle (`input_boolean`) | days off skipped – on / off | `skip_holidays` |
| Text (`input_text`, max. 255) | the speakers it rings on | `player` |
| Text (`input_text`, max. 255) | the sound's address | `sound` |

Create them in **Settings → Devices & services → Helpers → Create helper**. Only the time is needed; without the others the alarm is always on and rings every day.

## Quick start

```yaml
type: custom:glass-alarm
entity: input_datetime.kids_alarm_time
switch: input_boolean.kids_alarm
days: input_text.kids_alarm_days
skip_calendars:                                # days off: all-day events in these calendars
  - calendar.czechia                           #   public holidays (the Holiday integration)
  - calendar.holidays                          #   your own holidays
skip_holidays: input_boolean.kids_alarm_holidays
name: Kids' room
```

- **The time** – tap it: wheels for the hours and minutes come up over the dashboard (scroll, drag, tap a number or use the arrow keys). In English with AM / PM, in Czech and German 24 hours – or as your Home Assistant profile sets the time format. `minute_step: 5` offers 0, 5, 10… minutes. A new time turns the alarm on.
- **The bell** – turns the alarm on and off.
- **The bar under it** – says how it repeats (*Weekdays*, *Every day*, *Mon, Wed, Fri*…); a tap opens the alarm's settings – on a phone a sheet from the bottom, on a tablet a dialog: *Once*, *Weekdays*, *Every day*, *Weekends*, the seven days one by one (the week starts on Monday in Europe), *Not on days off* and – with the `player` and `sound` helpers – the speakers it rings on and what plays. *Done* saves it.
- **Under the time** – when it rings next: *Tomorrow 6:30*, *Monday 6:30*, *Off*; with a day off on the way *Monday 6:30* and under it *Christmas Day skipped*.

### The days

The card writes the days into the text helper as their short English names, `mon,tue,wed,thu,fri`, or `once`: the alarm rings the next time the clock gets there, then the automation turns it off. Set the helper's maximum length to 100 (the default).

### Days off

`skip_calendars` – one or more calendars whose **all-day** events are days off: the alarm doesn't ring on them and the card says which one it skips. Events with a time (a meeting at 6:00) don't count.

- Public holidays: add the **Holiday** integration (Settings → Devices & services → Add integration → Holiday) for your country – it brings a calendar of them.
- Your holidays, days without an alarm: any calendar – a local one, Google, CalDAV… – with all-day events.

With `skip_holidays` (a toggle) the skipping can be turned on and off in the alarm's settings; without it days off are always skipped.

### Speakers and sound

With the `player` and `sound` helpers the settings list your media players – tick the ones it rings on – and the sounds: *Birds*, the calm melody that comes with the cards, or *Your own*: an address such as `https://…/wake-up.mp3`, `/local/sounds/wake-up.mp3` (a file in `config/www/sounds/`) or `media-source://…`. The blueprint plays them instead of the ones picked in the automation.

## The blueprint

[![Import the blueprint](https://my.home-assistant.io/badges/blueprint_import.svg)](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https%3A%2F%2Fgithub.com%2Fmartinargalas%2Fglass-cards%2Fblob%2Fmain%2Fblueprints%2Fautomation%2Fglass_alarm.yaml)

Or **Settings → Automations & scenes → Blueprints → Import blueprint** with
`https://github.com/martinargalas/glass-cards/blob/main/blueprints/automation/glass_alarm.yaml`.

Then **Create automation** from it and pick the same helpers as in the card, and:

- **Speakers** – one or more media players it rings on (or **Speakers from a helper** – the card's `player`),
- **Sound** – what plays there: a sound, a radio, a playlist (or **Sound from a helper** – the card's `sound`),
- **Volume** and **Getting louder** – from quiet to the volume over this many seconds,
- **Stop after** – minutes, 0 = until it's stopped,
- **Actions** – your own, at the same time: open the blinds, turn on the lights…

One automation per alarm. It checks the switch, the day and the calendars, turns a *once* alarm off, then plays the sound and runs your actions.

## Options

<!-- options -->
| Option | Type | What it does |
| --- | --- | --- |
| `entity` **required** | string | Time (input_datetime, time only) |
| `switch` | string | on / off: an input_boolean (or a switch) – the bell button turns it |
| `days` | string | the days it rings: an input_text the card writes ("mon,tue,wed,thu,fri", "once") |
| `skip_calendars` | string[] | days off: calendars whose all-day events it skips – public holidays (the Holiday integration), your holidays… |
| `skip_holidays` | string | skipping days off on / off: an input_boolean (none: always skipped when `skip_calendars` is set) |
| `player` | string | where it rings: an input_text with the media players (comma separated) – picked in the settings |
| `sound` | string | what plays: an input_text with the sound's address – picked in the settings |
| `name` | string | Name |
| `icon` | string | Icon – Empty = a bell, crossed out while off |
| `show_next` | boolean | when it rings next under the time (default shown) |
| `show_days` | boolean | the bar with the days (default shown when `days` is set) |
| `minute_step` | number | the picker's minutes: every 1 (default), 5, 10, 15 or 30 |

#### Look

Materials and colours of the card's parts – set them in the card's **Appearance** tab, or here.

| Option | Type | What it does |
| --- | --- | --- |
| `active_color` | string | the alarm on: the bell, the picked days, the picker's button – default blue |
| `icon_glass` | material | Material of the icon – see [Materials](../appearance.md#materials). |
| `icon_on_glass` | material | Material of the icon while on – see [Materials](../appearance.md#materials). |
| `icon_background` | string |  |
| `days_glass` | material | the bar with the days: its material and a tint over it |
| `days_color` | string | Colour of the days (a tint of its material). |
| `button_glass` | material | the round button on the bar that opens the settings: its material and a tint |
| `button_color` | string | Colour of the button (a tint of its material). |
| `sheet_glass` | GlassMode | the settings' and the time picker's window: its glass, as a card's background (liquid, dark-liquid, frosted, light, flat, solid, home, none; default its own dark or light glass) and a tint |
| `sheet_color` | string | Colour of the sheet (a tint of its material). |
| `controls_glass` | material | the window's controls – quick choices, days, fields, lists: their material and a tint |
| `controls_color` | string | Colour of the controls (a tint of its material). |
<!-- /options -->

---

[All cards](../README.md#the-cards) · [Look and feel](../appearance.md) · [Actions and conditions](../actions-and-conditions.md)
