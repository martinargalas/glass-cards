# Alarms

`custom:glass-alarms`

Your alarms in one card: when the next one rings, and for each alarm its time, days, speaker and an on / off switch. You add and change alarms right in the card – it sets up everything they need in Home Assistant.

![The Alarms card with three alarms](../images/cards/alarms.webp "phone")

## Add an alarm

1. Add the card: in the Dashboard Studio (or *Add card* in Home Assistant) pick **Glass – alarms**. It needs no settings.
2. Tap **+** in the top right corner, set the alarm up and tap **Done**.

Only administrators see **+**, because a new alarm creates helpers and an automation (see [What the card creates](#what-the-card-creates)). Everyone can turn alarms on and off and change them.

## The card

- **Top line** – when the next alarm rings, e.g. *Alarm in 8 h 15 min*, with its day and time.
- **Each alarm** – the days it rings are highlighted (an alarm set to ring once shows its date). A calendar icon means a day off changes its next ring.
- **Switch** – turns the alarm on or off; it keeps its settings.

`layout: carousel` shows one alarm at a time; swipe to the others.

![Carousel layout](../images/alarms/carousel.webp "phone")

## Change an alarm

Tap an alarm. On a phone the settings slide up from the bottom, on a tablet they open in the middle. **Done** saves, **Cancel** or a tap outside leaves the alarm as it was.

![The settings of an alarm](../images/alarms/settings.webp "phone")

- **Time** – scroll the wheels or tap a number. 12 or 24 hours, as your Home Assistant profile sets it.
- **Repeat** – *Once*, *Weekdays*, *Every day*, *Weekends*, or single days. *Once* rings the next time it reaches the time, then turns itself off.
- **Days off** – how the alarm treats holidays, see [Days off](#days-off).
- **Rings on** and **Sound** – the speakers and what they play, see [Speakers and sounds](#speakers-and-sounds).
- **Delete the alarm** – tap twice; it removes the alarm with its helpers and automation.

![Choosing speakers and the sound](../images/alarms/speakers.webp "phone")

## Days off

A day off is an **all-day event** in a calendar set in the card (Studio → the card → **Days off**): public holidays from Home Assistant's **Holiday** integration (*Settings → Devices & services → Add integration → Holiday*), or any calendar with your vacation. Events with a start time don't count.

On a day off the alarms behave as on a weekend:

- an alarm on weekdays (or every day) doesn't ring – the switch reads **Not on days off**;
- an alarm with Saturday or Sunday rings – the switch reads **On days off, ring as on a weekend**.

Example: *Kids' room* at 6:45 on weekdays, *Weekend* at 9:00 on Saturday and Sunday. On a public holiday on Wednesday only the 9:00 alarm rings. Turn the switch off for an alarm that should follow just its days of the week; an alarm set to *Once* ignores days off.

```yaml
type: custom:glass-alarms
skip_calendars:
  - calendar.czech_holidays   # the Holiday integration
  - calendar.vacation         # your own
```

## Speakers and sounds

**Rings on** lists all media players; tick one or more. With none ticked the alarm only runs its automation's actions. **Sound** is *Birds*, a quiet melody that comes with the cards, or **Your own**: an address such as `https://…/wake-up.mp3`, `/local/sounds/wake-up.mp3` (a file in `config/www/sounds/`) or `media-source://…`.

To offer only some speakers, and sounds of your own next to *Birds*:

```yaml
type: custom:glass-alarms
players:
  - media_player.kids_room
  - media_player.bedroom
sounds:
  - { name: Radio, url: https://ice.example.com/stream.mp3 }
  - { name: Rooster, url: /local/sounds/rooster.mp3 }
```

The speaker downloads the sound from Home Assistant. For sounds from `/local/…` (Birds included) set the *local network* address in *Settings → System → Network*.

## Actions when it rings

Every alarm has an automation, **Glass alarm 1**, **Glass alarm 2**… (*Settings → Automations & scenes*). Add your own **Actions** there – open the blinds, turn on the lights – and set **Volume**, **Getting louder** and **Stop after**.

## What the card creates

For each new alarm: **helpers** named *Glass alarm 1 …* that store its settings, and **an automation** that rings it, made from the **Glass alarm** blueprint. The card adds the blueprint to Home Assistant itself and updates it with new versions of the cards. **Delete the alarm** removes all of it. Don't rename the helpers – the card finds its alarms by their names.

## Troubleshooting

**The alarm didn't ring.** Check its switch, its days, the days off and that a speaker is ticked. Then open its automation → **Traces** to see where it stopped.

**It rang but nothing played.** The speaker couldn't download the sound – check the network address (see [Speakers and sounds](#speakers-and-sounds)) or try an `https://` address.

## Look

Every part – the list, the highlighted days, the switches, **+**, the settings window and its controls – has its material and colour in the Studio's **Appearance** tab, or in the options below.

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
