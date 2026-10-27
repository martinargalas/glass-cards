# Glass Cards documentation

Glass Cards are cards for Home Assistant dashboards with a liquid glass look – and **Glass
Studio**, the editor you build the whole dashboard in, with a live preview on a phone, a
tablet or a wall display.

You don't need to know YAML. Everything on these pages can be done in Glass Studio; the
YAML is there for when you want to copy, share or fine-tune.

## Start here

1. [Install Glass Cards](install.md) – from HACS, in a minute.
2. [Try the demo dashboard](demo.md) – a made-up home with every card on it. Nothing it does reaches your devices.
3. [Build your first dashboard](first-dashboard.md) – in Glass Studio, step by step.

## Learn the parts

| | |
| --- | --- |
| [Glass Studio](studio.md) | The editor: structure, live preview, drag and drop, pop-ups, saving |
| [Look and feel](appearance.md) | Looks (liquid, frosted, Apple Home…), materials, colours, fonts, day and night, wallpapers |
| [Layout](layout.md) | Areas, phones vs. tablets, panels, pages, showing cards only sometimes |
| [Actions and conditions](actions-and-conditions.md) | What a tap does, menus, and the rules that colour, animate or hide things |

## The cards

**Overview** – what's going on at a glance

| Card | |
| --- | --- |
| [Date header](cards/date-header.md) | The date or a greeting, holidays, name days, one-line facts |
| [Clock and weather](cards/clock-weather.md) | Big clock, the weather now and a forecast with temperature bars |
| [Status bar](cards/status-bar.md) | Small chips with values: power, hot water, the alarm… |
| [People](cards/people.md) | Who is home, where the others are, their phones' battery |
| [Calendar](cards/calendar.md) | Upcoming events, grouped by day |
| [Running now](cards/now.md) | Everything that is on in the home, switched off with one tap |
| [Notifications](cards/notifications.md) | Messages from automations and alerts, in one pill |

**Rooms** – control

| Card | |
| --- | --- |
| [Room](cards/room-card.md) | A room's photo or icon with buttons for its devices |
| [Lights](cards/light.md) | Scenes and a brightness bar per light |
| [Thermostat](cards/thermostat.md) | Room temperature with a soft graph and the set point |
| [Blind](cards/blind.md) | Position and tilt bars, quick choices, the automation's pause |
| [Appliance](cards/appliance.md) | Washers, robot vacuums and mowers as bars with their controls |
| [Room map](cards/room-map.md) | Pick rooms or lawn zones on a robot's map and clean or mow just those |

**Climate and energy**

| Card | |
| --- | --- |
| [Heat pump](cards/heat-pump.md) | The heat flowing from outside to the house and the hot water tank |
| [Air quality](cards/air-quality.md) | The air quality index with a picture of the level and every pollutant |
| [Radar](cards/radar.md) | Satellite clouds and rain radar, animated over the last hour |
| [Period bar](cards/period-bar.md) | Day / week / month / year with back and forward, for charts |
| [Chart](cards/chart.md) | apexcharts-card in the glass look, following the period bar |
| [Automation switch](cards/automation.md) | An automation on or off, and for how long |
| [Sun and shading](cards/sun-shading.md) | The sun over a compass with your windows and the shading decision |
| [Value grid](cards/value-grid.md) | Numbers with − / + in a table, a column per season |

**Building blocks** – structure and navigation

| Card | |
| --- | --- |
| [Dashboard](cards/dashboard.md) | The full-screen layout every other card lives in |
| [Panel](cards/panel.md) | A glass frame that arranges cards in a row, column or grid |
| [Tabs](cards/tabs.md) | A switch that picks which cards of a panel show |
| [Dock](cards/dock.md) | The icon bar at the bottom that opens pages or pop-ups |
| [Pop-up header](cards/popup-header.md) | A glass header for Bubble Card pop-ups |
| [Divider](cards/divider.md) | A rounded line, or a small heading |

## Guides

- [Recipes](recipes.md) – a wall tablet, a phone dashboard, energy charts, a quiet night look
- [Blinds that follow the sun](automation-cards.md) – the automation cards, with the helpers and the automation behind them
- [Questions and answers](faq.md) – performance, themes, card_mod, other cards inside, troubleshooting
- [For developers: plugin API](plugin-api.md) – build your own glass cards on the same base
