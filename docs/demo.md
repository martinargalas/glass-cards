# The demo dashboard

The fastest way to see what Glass Cards and Glass Studio can do: a complete dashboard of a
made-up home – Alex and Sam, six rooms, a heat pump, solar panels, a washing machine, a robot
vacuum and a lawn mower.

**It doesn't touch your home.** Every card on it runs on invented devices. Switch the lights,
close the blinds, start the vacuum – it all happens in the demo only. Nothing is sent to your
devices and no entities are added to Home Assistant.

## Add it

1. Open Glass Studio: add `?glass-studio` to the address of any Home Assistant page, e.g.
   `http://homeassistant.local:8123/lovelace/0?glass-studio`.
2. Click **Demo dashboard** in the top bar.

The dashboard appears in the sidebar as **Glass demo** and opens in Glass Studio. Clicking the
button again later just opens it – your changes are kept.

> You need to be an administrator to add a dashboard.

## What to try

**On the dashboard**

- The **dock** at the bottom switches pages: rooms, lights and blinds, climate, weather, devices.
- Tap the light bulbs on the room cards. The photos turn from grey to colour when something is on.
- On **Lights and blinds**, pick the **Movie** scene – the lights dim and the blind closes.
- Drag a blind's bar, or the brightness bar of a light.
- **Running now** in the side column lists everything that is on. Switch one off from there.
- Open it on your phone: the same dashboard rearranges itself for the small screen.

**In Glass Studio**

- Switch the preview between **phone** and **tablet**, and between devices (iPhone, iPad, Galaxy Tab…).
- Click any card in the preview to see its settings on the right.
- Drag a room card to another place – in the preview or in the structure on the left.
- Open the dashboard's **Appearance** and try another look: *liquid*, *frosted*, *light*, *solid*.
- Use the day / night button above the preview to see the night look.
- Click **YAML** (the `{ }` button) to see the configuration change as you edit.

## Use it as a starting point

Every card on the demo is a regular glass card – only `demo: true` on the dashboard makes it
run on the made-up home. To build your own from it:

1. Copy a card (⌘C / Ctrl+C in Glass Studio) and paste it into your dashboard (⌘V / Ctrl+V).
2. Replace the entity ids with yours (`light.living_room` → your light) – in the card's settings
   every entity field has a picker.

Or turn the whole demo into yours: open the dashboard's settings, switch **Demo** off and
replace the entities card by card.

## Remove it

**Settings → Dashboards → Glass demo → Delete**. That's all there is to it.
