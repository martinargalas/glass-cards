# Layout

## The dashboard and its areas

A glass dashboard ([`glass-dashboard`](cards/dashboard.md)) fills the whole screen and divides it
into **areas**: `header`, `top`, `left`, `main` (and `right` for three columns). Each area holds a
list of cards. Pick a **preset** in Glass Studio and drag the lines between areas to size them.

| Preset | Areas |
| --- | --- |
| Side column, full height (`sidebar`) | `left` + `main` |
| Classic – column left (`classic`) | `header` `top` / `left` `main` |
| Column right (`right`) | `top` `header` / `main` `left` |
| Three columns (`three`) | `header` `top` / `left` `main` `right` |
| No side column (`stacked`) | `header` / `top` / `main` |
| Main area only (`single`) | `main` |

Or describe your own grid under `grid:` (CSS grid areas). Put the dashboard in a view of type
**Panel (single card)** so it gets the whole screen.

## Panels

A [panel](cards/panel.md) is a glass frame that arranges cards:

| `layout` | |
| --- | --- |
| `column` (default) | under each other |
| `row` | side by side; `wrap: true` to wrap, `scroll: true` to swipe sideways |
| `grid` | `columns` × `rows`; or `min_column_width` for as many columns as fit; `masonry` for no gaps |

How much room a card takes is its `view_layout`:

```yaml
view_layout:
  grow: 1          # share of the free space (row / column)
  basis: 0px       # start from nothing, then grow – equal columns
  shrink: 0        # never smaller than its content
  span: 2          # grid: two columns wide
  row_span: 2      # grid: two rows tall
  align: start     # cross-axis alignment of this card
```

In Glass Studio you set all of this under the card's **Placement**, or drag a card's corner.

Panels nest: a row of two columns, each a column of cards, is a row panel with two column
panels. `glass: none` makes a panel invisible – just arrangement.

## Phones, tablets and computers

One configuration serves every screen. The dashboard switches mode by its width:

| Mode | Width (default) |
| --- | --- |
| `mobile` | under 700 px |
| `tablet` | 700 – 1499 px |
| `desktop` | 1500 px and wider |

Change the limits with `breakpoints: { mobile: 700, desktop: 1500 }`.

Three tools adapt the dashboard:

**1. Show a card only on some screens** – `visible_on`:

```yaml
- type: custom:glass-calendar
  visible_on: [tablet, desktop]
```

**2. Different settings on a phone** – `responsive`, on any card, panel or the dashboard:

```yaml
- type: custom:glass-panel
  layout: grid
  columns: 3
  responsive:
    mobile:
      layout: row       # a swipeable strip on phones
      scroll: true
      columns: null     # null removes a setting
```

**3. A different arrangement of areas** – `responsive.mobile` on the dashboard can replace whole
areas (`left: null` hides the side column on phones, `main: [...]` gives phones their own cards).
YAML anchors keep it short – the [demo](../examples/demo.yaml) reuses its pages on phones with `*pages`.

Glass Studio's **Phone / Tablet** switch previews each mode. A card's order and **Shown on** can
differ per mode right there; for other differences add a `responsive.mobile` block in the card's YAML.

## Pages without pop-ups

A single dashboard can have several **pages** that a [dock](cards/dock.md) or [tabs](cards/tabs.md)
switch – no Bubble Card needed, nothing reloads:

```yaml
overlay:
  - type: custom:glass-dock
    group: page
    items:
      - { icon: mdi:home-outline, id: home }
      - { icon: mdi:lightbulb-group-outline, id: lights }

main:
  - type: custom:glass-panel
    glass: none
    cards:
      - type: custom:glass-panel            # the "home" page
        visibility:
          - { condition: select, group: page, id: home }
        cards: [...]
      - type: custom:glass-panel            # the "lights" page
        visibility:
          - { condition: select, group: page, id: lights }
        cards: [...]
```

The picked page is remembered per browser tab. Any card in a panel can listen to a group –
[appliance](cards/appliance.md) bars use the same mechanism to pick what a panel shows next to them.

## Pop-ups

With [Bubble Card](https://github.com/Clooos/Bubble-Card), the dashboard's `overlay` holds
pop-ups that open over everything by their `#link` (a dock button, a room card's tap, a menu).
Keep them on a separate, hidden dashboard and load them with `overlay_source` to share them
between a tablet and a phone dashboard. Glass Studio creates, previews and edits them – see
[Glass Studio → Pop-ups](studio.md#pop-ups).

## Showing cards only sometimes

Any card inside a panel takes Home Assistant's `visibility` conditions, plus a few of its own:

```yaml
visibility:
  - condition: state
    entity: lawn_mower.garden_mower
    state: mowing
  - condition: select          # a page / tab / appliance picked on this screen
    group: page
    id: devices
```

See [Actions and conditions](actions-and-conditions.md#conditions).
