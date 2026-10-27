# Your first glass dashboard

Ten minutes, no YAML. You'll end up with a full-screen dashboard: a side column with the
weather and the calendar, your rooms in the middle, and a look that fits your wallpaper.

## 1. Make a place for it

1. **Settings → Dashboards → Add dashboard → New dashboard from scratch.** Name it, e.g. *Home*.
2. Open it, click the pencil (**Edit dashboard**), then the view's pencil and set
   **View type** to **Panel (single card)**. A glass dashboard fills the whole screen, so it
   wants the whole view.

## 2. Open Glass Studio

Add a card and pick **Glass – dashboard**. On a computer or tablet Glass Studio opens right
away: the structure on the left, a live preview in the middle, the settings on the right.

> Already have a dashboard? Add `?glass-studio` to its address instead – Glass Studio lists your
> dashboards in its top bar and saves straight to Home Assistant.

## 3. Pick a layout

In the settings on the right, under **Layout**, pick a preset. **Side column, full height**
is a good start for a tablet: a column on the left and a big main area. Phones get their own
arrangement automatically – you'll fine-tune that later.

## 4. Add cards

Hover the preview and click **+** where you want a card, or use **+ Add card into this panel**
in the structure. A good first set:

| Where | Card | Why |
| --- | --- | --- |
| Left column | [Date header](cards/date-header.md) with *greeting* on | "Good morning" at the top |
| Left column | [Clock and weather](cards/clock-weather.md) | The weather now and the next hours |
| Left column | [Calendar](cards/calendar.md) | What's coming |
| Main area | a [Panel](cards/panel.md) with layout **Grid**, 3 columns | Holds the rooms |
| In that panel | a [Room](cards/room-card.md) card per room | A photo and buttons for its lights and devices |

Each card's settings open when you click it. Entity fields have a picker; you don't need to
know the ids.

**Moving things:** drag a card in the preview or in the structure. A line shows where it
lands; drop it onto a panel to put it inside.

## 5. Make it yours

- **Look** (dashboard settings → *Appearance*): *liquid* bends the wallpaper like real glass;
  *frosted* blurs it; *Apple Home* puts tiles straight on the wallpaper with a dark sidebar;
  *light* and *solid* are for older tablets. See [Look and feel](appearance.md).
- **Wallpaper**: `glass:hills-day` for the bundled one, or your own picture. Set a different
  one for the night in the *At night* switch.
- **Room photos**: a room card can show a photo that is grey while everything in the room is
  off and turns to colour when something is on.

## 6. Check the phone

Switch the preview to **phone** in the top bar. Cards can hide on phones (**Shown on** in a
card's *Placement*) or change their layout there – see [Layout](layout.md#phones-tablets-and-computers).

## 7. Save

Click **Save**. Glass Studio checks that nobody changed the dashboard meanwhile and keeps
the previous version in your browser: **Undo the last save** (the clock-arrow button) puts it
back if you change your mind.

---

**Next:** [Glass Studio in depth](studio.md) · [all the cards](README.md#the-cards) · [recipes](recipes.md)
