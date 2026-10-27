# Period bar

`custom:glass-period-bar`

One bar of liquid glass for moving through time in charts: ‹ › step back and forth, “now” jumps to the current period, and a drop-down picks day, week, month or year. Charts follow it.

**Good for:** an energy page with [charts](chart.md).

## Quick start

```yaml
type: custom:glass-period-bar
periods: [day, week, month, year]
```

Without helpers the bar keeps the period itself (per browser tab) and [charts](chart.md) with `period: true` follow it. Want automations or templates to follow the period too? Use Home Assistant helpers:

```yaml
offset_entity: input_number.chart_offset        # 0 = now, −1 = the one before…
select_entity: input_select.chart_period        # options named Day / Month / Year
current_entity: input_boolean.chart_now         # optional: on with "now"
```

## Tips

- `group: water` – a second, independent bar on the same screen.
- `compact: true` on phones; `parts: [now]` – only some of it (e.g. in a pop-up header).

## Options

<!-- options -->
| Option | Type | What it does |
| --- | --- | --- |
| `periods` | PeriodKind[] | Periods to choose from |
| `label_entity` | string | Period name |
| `current_entity` | string | On while showing now |
| `now_label` | string | Now button text |
| `compact` | boolean | Compact (phones) |
| `spread` | boolean | Now left, kind right, period centred |
| `parts` | ("now" \| "nav" \| "kind")[] | Parts shown (empty = all) |

#### Look

Materials and colours of the card's parts – set them in the card's **Appearance** tab, or here.

| Option | Type | What it does |
| --- | --- | --- |
| `bar_glass` | material | own materials (core/materials), *_color tints them: the bar, the arrows / drop-down / "now" while current (buttons_*), "now" otherwise (now_*) |
| `bar_color` | string | Colour of the bar (a tint of its material). |
| `buttons_glass` | material | Material of the buttons – see [Materials](../appearance.md#materials). |
| `buttons_color` | string | Colour of the buttons (a tint of its material). |
| `now_glass` | material | Material of the now – see [Materials](../appearance.md#materials). |
| `now_color` | string | Colour of the now (a tint of its material). |
<!-- /options -->

---

[All cards](../README.md#the-cards) · [Look and feel](../appearance.md) · [Actions and conditions](../actions-and-conditions.md)
