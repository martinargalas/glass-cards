# Recipes

Short, complete examples to start from. Each one works in the [demo](demo.md) – put
`demo: true` on the dashboard to try it before swapping in your entities.

## A wall tablet

A side column with the essentials, the rooms in the middle, a dock for the rest. Kiosk apps
(Fully Kiosk, WallPanel) hide Home Assistant's own bars; the dashboard measures the space
above itself, so nothing is cut off.

```yaml
type: custom:glass-dashboard
preset: sidebar
look: light                  # nearly free on weak tablets; liquid on a strong one
appearance: sun
wallpaper: glass:hills-day
dark:
  wallpaper: glass:hills-night-blue-soft
left:
  - type: custom:glass-panel
    cards:
      - type: custom:glass-date-header
        greeting: true
      - type: custom:glass-clock-weather
        weather: weather.home
        hourly_forecast: 5
      - type: custom:glass-calendar
        fit: true
        calendars:
          - entity: calendar.family
main:
  - type: custom:glass-panel
    layout: grid
    columns: 3
    cards: []                # your room cards
overlay:
  - type: custom:glass-dock
    group: page
    items:
      - { icon: mdi:home-outline, id: home }
      - { icon: mdi:lightbulb-group-outline, id: lights }
```

## A phone dashboard

On a phone you want to know what's on and switch it off – not a shrunken tablet. Give the
dashboard a `responsive.mobile` block:

```yaml
responsive:
  mobile:
    left: null                       # no side column
    main:
      - type: custom:glass-panel
        glass: none
        layout: row
        cards:
          - type: custom:glass-clock-weather
            weather: weather.home
            show_clock: false
            hourly_forecast: 0
            daily_forecast: 0
            now_style: line
            view_layout: { grow: 1 }
          - type: custom:glass-people
            people: [{ entity: person.alex }, { entity: person.sam }]
            show_location: never
      - type: custom:glass-panel     # rooms as a swipeable strip
        glass: none
        layout: row
        scroll: true
        item_width: 46vw
        height: 220px
        cards: []                    # your room cards
      - type: custom:glass-now       # what's on, with an off button each
        title: Running now
```

## Energy with charts

A [period bar](cards/period-bar.md) and [charts](cards/chart.md) that follow it. Needs
apexcharts-card.

```yaml
type: custom:glass-panel
cards:
  - type: custom:glass-period-bar
    periods: [day, week, month, year]
  - type: custom:glass-divider
    name: Production and use
    icon: mdi:home-lightning-bolt-outline
    line: false
  - type: custom:glass-chart
    period: true
    color: "#ff9f0a"
    card:
      type: custom:apexcharts-card
      series:
        - entity: sensor.solar_energy
          name: Solar
          type: column
          statistics: { type: change }
        - entity: sensor.grid_energy
          name: Grid
          type: column
          statistics: { type: change }
```

## A quiet night

At night the dashboard on the wall shouldn't light up the room. On the dashboard:

```yaml
appearance: sun
dark:
  wallpaper: glass:hills-night-blue-soft
```

…and on room cards whose photos are too bright:

```yaml
dark:
  image_color: never         # grey photos at night, even with a light on
```

## Blinds that follow the sun

A whole page with the automation switch, the sun over the compass and the season's slat
tilts: [Blinds that follow the sun](automation-cards.md).
