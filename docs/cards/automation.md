# Automation switch

`custom:glass-automation`

An automation on or off – and, when you switch it off, for how long: an hour, until tonight, until a time. It comes back on by itself.

**Good for:** blinds, lights by motion, anything you sometimes want to pause.

## Quick start

```yaml
type: custom:glass-automation
entity: automation.blinds_by_sun
title: Blinds follow the sun
pause_for: input_select.blinds_pause          # optional: the choices of how long
resume_at: input_datetime.blinds_resume       # optional: when it comes back
```

The card only switches the automation and sets the helpers – bringing it back is a small automation of yours. The whole setup, with the helpers and that automation, is in [Blinds that follow the sun](../automation-cards.md#automation-switch--switching-off-for-a-while).


## Options

<!-- options -->
| Option | Type | What it does |
| --- | --- | --- |
| `entity` | string | Automation – Or any switch / input_boolean |
| `icon` | string | Icon |
| `show_state` | boolean | On / Off beside the switch |
| `color` | string | Color |
| `pause_for` | string | How long (input_select) |
| `resume_at` | string | Comes back at (input_datetime) |
| `pause_until` | string | Time for “until” (input_datetime) |
| `title` | string | Title |
| `show_title` | boolean | false: no title line |

#### Look

Materials and colours of the card's parts – set them in the card's **Appearance** tab, or here.

| Option | Type | What it does |
| --- | --- | --- |
| `switch_glass` | material | the switch's track: a material (on: tinted with color); unset = the plain track |
<!-- /options -->

---

[All cards](../README.md#the-cards) · [Look and feel](../appearance.md) · [Actions and conditions](../actions-and-conditions.md)
