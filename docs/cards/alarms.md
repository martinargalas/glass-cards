# Alarms

`custom:glass-alarms`

A list of alarms. Each alarm shows its name, time, the days it rings, the speaker it plays on and an on / off switch. Above the list the card shows when the next alarm rings. You add and change alarms in the card – it creates the helpers and the automation in Home Assistant for you.

![The Alarms card with three alarms](../images/cards/alarms.webp "phone")

## Add an alarm

1. Add the card: in the Dashboard Studio (or *Add card* in Home Assistant) pick **Glass – alarms**. It needs no settings.
2. Tap **+** in the top right corner.
3. Fill in the name, the time and the days, pick a speaker and tap **Done**.

The alarm appears in the list and rings at that time.

![A new alarm](../images/alarms/new-alarm.webp "phone")

Only Home Assistant administrators see **+**, because adding an alarm creates helpers and an automation (see [What the card creates](#what-the-card-creates)). Other users can turn alarms on and off and change them.

## The list

- **Top line** – when the next alarm rings, e.g. *Alarm in 8 h 15 min*, and its day and time. When every alarm is off, it says so.
- **Each alarm** – name and time; the days of the week, with the days it rings highlighted (an alarm set to ring once shows its date instead); the speaker and the sound. A small calendar icon means the alarm skips a day off this week.
- **Switch** – turns the alarm on or off. An alarm that is off is greyed out and keeps its settings.

With `layout: carousel` the card shows one alarm at a time; swipe to see the others.

![Carousel layout](../images/alarms/carousel.webp "phone")

## Change an alarm

Tap an alarm to open its settings. On a phone they slide up from the bottom, on a tablet they open in the middle of the screen. Changes are saved when you tap **Done**; **Cancel** or a tap outside discards them.

![The settings of an alarm](../images/alarms/settings.webp "phone")

- **Name** – shown above the time.
- **Time** – scroll the wheels or tap a number (arrow keys work too). The card uses the time format from your Home Assistant profile: 12 hours with AM / PM in English, 24 hours in Czech and German by default.
- **Repeat** – *Once*, *Weekdays*, *Every day*, *Weekends*, or tap single days. In Europe the week starts on Monday. An alarm set to *Once* rings the next time it reaches the time and then turns itself off.
- **Not on days off** – the alarm doesn't ring on public holidays and other days off (see [Days off](#days-off)). Turn it off for an alarm that should always ring.
- **Rings on** – tick one or more speakers. With no speaker ticked the alarm plays nothing and only runs the actions in its automation (see [Actions when it rings](#actions-when-it-rings)).
- **Sound** – *Birds*, a quiet melody included with the cards, or **Your own**: the address of a sound or stream, e.g. `https://…/wake-up.mp3`, `/local/sounds/wake-up.mp3` for a file in `config/www/sounds/`, or `media-source://…`.
- **Delete the alarm** – tap twice. The second tap deletes the alarm together with its helpers and automation.

![Choosing speakers and the sound](../images/alarms/speakers.webp "phone")

## Days off

A day off is an **all-day event** in one of the calendars set in the card (Studio → the card → **Days off**). Events with a start time, such as a meeting at 6:00, are ignored. The top line takes days off into account, so it always shows the alarm that will actually ring.

- **Public holidays** – add the **Holiday** integration for your country (*Settings → Devices & services → Add integration → Holiday*). It creates a calendar with the public holidays.
- **Your own days off** – any calendar works: a local calendar, Google, CalDAV… Add your holidays to it as all-day events.

```yaml
type: custom:glass-alarms
skip_calendars:
  - calendar.czechia      # public holidays (the Holiday integration)
  - calendar.holidays     # your own
```

## Actions when it rings

Every alarm has its own automation, **Glass alarm 1**, **Glass alarm 2**… (*Settings → Automations & scenes*). Open it to add actions that run when the alarm rings – open the blinds, turn on the lights – under **Actions**. There you can also set the **Volume**, how long it takes to get louder (**Getting louder**) and when it stops (**Stop after**).

## Speakers and sounds

By default **Rings on** lists all media players. To show only some of them, and to add your own sounds next to *Birds*, set them in YAML:

```yaml
type: custom:glass-alarms
players:
  - media_player.kids_room
  - media_player.bedroom
sounds:
  - { name: Radio, url: https://ice.example.com/stream.mp3 }
  - { name: Rooster, url: /local/sounds/rooster.mp3 }
```

The speaker downloads the sound from Home Assistant. For sounds from `/local/…` (Birds included) set Home Assistant's *local network* address in *Settings → System → Network*, otherwise the speaker can't reach it.

## Look

In the Studio's **Appearance** tab you can set the material and colour of each part: the list of alarms, the highlighted days, the switches, the **+** button, the settings window and its controls.

## What the card creates

When you save a new alarm, the card creates:

- **Helpers** named *Glass alarm 1 …* (*Settings → Devices & services → Helpers*): time, on / off, days, name, speakers, sound and days off on / off. The alarm's settings are stored in them.
- **An automation** named *Glass alarm 1* that rings the alarm. It uses the **Glass alarm** blueprint, which the card adds to Home Assistant itself.

**Delete the alarm** removes both. Don't rename the helpers – the card finds its alarms by their names.

## Troubleshooting

**The alarm didn't ring.** Check that its switch is on, that today is one of its days and not a day off, and that a speaker is ticked. Then open its automation (*Glass alarm …*) → **Traces** to see whether it ran and where it stopped.

**There's no + in the card.** Only Home Assistant administrators see it.

**It rang but nothing played.** The speaker couldn't download the sound. Check the network address as described in [Speakers and sounds](#speakers-and-sounds), or try a sound with an `https://` address.

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
