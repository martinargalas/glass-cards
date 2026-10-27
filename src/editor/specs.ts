import { PRESETS, knownPopups, trackList } from "../core/layout";
import { t } from "./i18n";
import { MATERIALS } from "../core/materials";
import { AIR_QUALITY_PARTS, AUTOMATION_PARTS, BLIND_PARTS, CALENDAR_PARTS, CLOCK_WEATHER_PARTS, DATE_HEADER_PARTS, DIVIDER_PARTS, DOCK_PARTS, HEAT_PUMP_PARTS, LIGHT_PARTS, NOTIFICATIONS_PARTS, NOW_PARTS, PANEL_PARTS, PEOPLE_PARTS, CHART_PARTS, PERIOD_PARTS, POPUP_HEADER_PARTS, RADAR_PARTS, ROOM_PARTS, STATUS_PARTS, THERMOSTAT_PARTS } from "../core/card-parts";
import { ANIMATION_FIELD, COLOR_FIELD, CONTROL_GLASS_FIELD, ICON_FIELD, TEXT_FIELD, TINT_FIELD, GLASS_FIELD, YAML, actionFields, expandable, grid, part, select, type Credit, type EditorSpec, type Schema, foreignCards, hasDock } from "./editor";

const ALIGN: [string, string][] = [
  ["start", "Left / top"],
  ["center", "Center"],
  ["end", "Right / bottom"],
];

const shortId = (id?: string) => (id ? id.split(".")[1] : "");

/** A "#pop-up" link: picked from the pop-ups known on this page, or typed. */
const POPUP_LINK = (name: string): Schema => ({
  name,
  selector: {
    select: {
      mode: "dropdown",
      custom_value: true,
      options: [...knownPopups].map(([hash, p]) => ({ value: hash, label: `${p.name ?? hash} (${hash})` })),
    },
  },
});

const LAYOUT_MODES: [string, string][] = [
  ["auto", "Automatic by width"],
  ["tablet", "Always tablet"],
  ["mobile", "Always mobile"],
];
const APPEARANCES: [string, string][] = [
  ["sun", "By the sun (dark at night)"],
  ["auto", "Follow the HA theme"],
  ["light", "Always light"],
  ["dark", "Always dark"],
];
const LOOK_NAMES: Record<string, string> = { liquid: "Liquid glass", "apple-home": "Apple Home", frosted: "Frosted glass", light: "Light glass", solid: "Solid" };

/** A section's line: how many of its settings are set (a default counts as not set). */
function setCount(c: Record<string, any>, keys: string[], defaults: Record<string, unknown> = {}, extra = 0): string {
  const n = keys.filter((k) => c[k] !== undefined && c[k] !== "").length + Object.entries(defaults).filter(([k, d]) => c[k] !== undefined && c[k] !== d).length + extra;
  return n ? `${n} ${t(n === 1 ? "setting" : "settings")}` : t("Default");
}

/* Other people's work the cards are built on (each card's "Credits" tab; all of it in CREDITS.md). */
const APEXCHARTS: Credit = {
  kind: "wraps",
  name: "apexcharts-card",
  url: "https://github.com/RomRider/apexcharts-card",
  author: "RomRider",
  author_url: "https://github.com/RomRider",
  note: "Draws the chart; this card sets its span for the period and its look.",
};
const BUBBLE: Credit = {
  kind: "requires",
  name: "Bubble Card",
  url: "https://github.com/Clooos/Bubble-Card",
  author: "Clooos",
  author_url: "https://github.com/Clooos",
  note: "The pop-ups are Bubble Card's; the glass cards place and open them.",
};
const LIQUID_GLASS_JS: Credit = {
  kind: "inspired",
  name: "liquid-glass-js",
  url: "https://github.com/dashersw/liquid-glass-js",
  author: "dashersw",
  author_url: "https://github.com/dashersw",
  note: "The liquid glass refraction model and its defaults.",
};
const CLOCK_WEATHER_CARD: Credit = {
  kind: "inspired",
  name: "clock-weather-card",
  url: "https://github.com/pkissling/clock-weather-card",
  author: "pkissling",
  author_url: "https://github.com/pkissling",
  note: "The clock above the forecast with temperature bars.",
};

export const dateHeaderSpec: EditorSpec = {
  parts: DATE_HEADER_PARTS,
  defaults: { align: "center" },
  form: [
    select("align", ALIGN),
    {
      name: "holidays",
      label: "Public holidays",
      helper: "A calendar from HA's Holiday integration (Settings → Devices & services → Add → Holiday) for your country; today's holiday shows under the date.",
      selector: { entity: { domain: "calendar" } },
    },
    {
      name: "nameday",
      label: "Name day",
      helper: "A sensor whose state is today's names – from a name day integration (HACS) or a template of your own. Shown as “Name day: …”.",
      selector: { entity: {} },
    },
    grid({ name: "title", selector: { text: {} } }, { name: "join", selector: { text: {} } }),
    expandable("Advanced", [YAML("date_format"), YAML("styles")]),
  ],
  lists: [
    {
      name: "lines",
      title: "Lines under the date",
      label: (l) => l.text ?? shortId(l.entity) ?? "Line",
      create: () => ({ entity: "", text: "{state}" }),
      item: () => [
        { name: "entity", selector: { entity: {} } },
        { name: "text", selector: { text: {} } },
        grid({ name: "icon", selector: { icon: {} } }, { name: "precision", selector: { number: { min: 0, max: 4, mode: "box" } } }),
        YAML("visible"),
      ],
    },
  ],
};

export const statusBarSpec: EditorSpec = {
  parts: STATUS_PARTS,
  defaults: { size: 36, gap: 8, wrap: true, align: "start", pack: false, pack_animation: true, layout: "chips" },
  form: (c) => {
    const layout = c.layout ?? "chips";
    return [
      {
        custom: "section",
        key: "layout",
        title: "Layout",
        open: true,
        schema: [
          {
            ...select("layout", [
              ["chips", "Chips (default)"],
              ["list", "List – icon and text"],
              ["pills", "Pills – equal, in a grid"],
              ["figures", "Figures – name over value"],
            ]),
            label: "Look",
          },
          ...(layout === "pills" || layout === "figures" ? [{ name: "columns", label: "Columns", selector: { number: { min: 1, max: 4, mode: "box" } } }] : []),
          ...(layout === "pills"
            ? [
                { name: "detail", label: "Attribute on the right", helper: "e.g. last_changed – times are shown relative", selector: { text: {} } },
              ]
            : []),
          grid(
            { name: "size", label: "Size", selector: { number: { min: 24, max: 64, mode: "box", unit_of_measurement: "px" } } },
            { name: "gap", label: "Gap", selector: { number: { min: 0, max: 40, mode: "box", unit_of_measurement: "px" } } },
          ),
          grid({ ...select("align", ALIGN), label: "Alignment" }, { name: "wrap", label: "Wrap to more rows", selector: { boolean: {} } }),
          ...(c.wrap !== false
            ? [grid({ name: "pack", label: "Fill the rows", selector: { boolean: {} } }, { name: "pack_animation", label: "Animate", selector: { boolean: {} } })]
            : []),
        ],
      },
      { custom: "section", key: "items", title: "Chips", open: true, schema: [{ custom: "list", list: "items" }] },
      ...(layout === "figures"
        ? [
            {
              custom: "section",
              key: "graph",
              title: "History line",
              secondary: c.graph?.entity ? "" : "Optional",
              schema: [
                { custom: "hint", text: "A soft line of one entity's history under the figures." },
                {
                  type: "expandable",
                  name: "graph",
                  title: "Line",
                  expanded: true,
                  schema: [
                    { name: "entity", selector: { entity: {} } },
                    grid(
                      { name: "hours", label: "Hours", selector: { number: { min: 1, max: 168, mode: "box", unit_of_measurement: "h" } } },
                      { name: "smoothing", label: "Smoothing", selector: { number: { min: 0, max: 12, mode: "box" } } },
                    ),
                    COLOR_FIELD("color"),
                  ],
                },
              ],
            },
          ]
        : []),
      {
        custom: "section",
        key: "look",
        title: "Look",
        schema: [
          { ...GLASS_FIELD, group: "Card" },
          { ...TINT_FIELD("glass_tint", "Glass color"), group: "Card" },
          { ...CONTROL_GLASS_FIELD, group: "Buttons" },
          ...(layout === "pills"
            ? [
                ...part(
                  "Pill",
                  grid({ ...select("pill_glass", [["", "Control glass (default)"], ...MATERIALS]), label: "Pill material" }, { ...COLOR_FIELD("pill_color"), label: "Pill colour" }),
                  { name: "pill_height", label: "Pill height", selector: { number: { min: 32, max: 80, mode: "box", unit_of_measurement: "px" } } },
                ),
                ...part(
                  "Icon",
                  grid(
                    { ...select("icon_glass", [["", "Control glass (default)"], ...MATERIALS]), label: "Icon material when off" },
                    { ...select("icon_on_glass", [["", "Same as when off"], ...MATERIALS]), label: "Icon material when on" },
                  ),
                  { ...COLOR_FIELD("icon_background"), label: "Icon background" },
                ),
              ]
            : []),
        ],
      },
      { custom: "section", key: "advanced", title: "Advanced", schema: [YAML("styles")] },
    ];
  },
  lists: [
    {
      name: "items",
      title: "Chips",
      label: (it) => it.text ?? shortId(it.entity) ?? (it.entities ? it.entities.map(shortId).join(" + ") : "Chip"),
      create: () => ({ entity: "" }),
      defaults: { hide_unavailable: true, format: "state" },
      item: (it) => [
        { name: "entity", selector: { entity: {} } },
        grid(
          { name: "icon", selector: { icon: {} } },
          select("format", [
            ["state", "State (default)"],
            ["number", "Number"],
            ["power", "Power W/kW"],
            ["energy", "Energy Wh/kWh"],
            ["data_rate", "Speed kB/s, MB/s"],
            ["duration", "Duration"],
            ["none", "Icon only"],
          ]),
        ),
        { name: "text", selector: { text: {} } },
        grid(
          { name: "precision", selector: { number: { min: 0, max: 4, mode: "box" } } },
          { name: "unit", selector: { text: {} } },
        ),
        grid(COLOR_FIELD("color"), ANIMATION_FIELD),
        grid({ name: "abs", selector: { boolean: {} } }, { name: "hide_unavailable", selector: { boolean: {} } }),
        expandable("Several entities at once", [
          { name: "entities", selector: { entity: { multiple: true } } },
          select("aggregate", [
            ["sum", "Sum"],
            ["min", "Minimum"],
            ["max", "Maximum"],
            ["avg", "Average"],
          ]),
        ]),
        expandable("Pills and figures", [
          { name: "dropdown", label: "Tap opens the options", helper: "Pills of a select / input_select", selector: { boolean: {} } },
          {
            type: "expandable",
            name: "secondary",
            title: "Second value under it (figures)",
            schema: [
              { name: "entity", selector: { entity: {} } },
              grid({ name: "text", selector: { text: {} } }, { name: "unit", selector: { text: {} } }),
              { name: "precision", selector: { number: { min: 0, max: 4, mode: "box" } } },
            ],
          },
          YAML("option_names"),
        ]),
        expandable("Actions", actionFields(it)),
        expandable("Visibility and rules", [YAML("visible"), YAML("rules")]),
      ],
    },
  ],
};

export const peopleSpec: EditorSpec = {
  parts: PEOPLE_PARTS,
  defaults: { size: 44, gap: 12, show_location: "away", align: "end", show_battery: true, show_name: false, battery_style: "ring" },
  form: [
    grid(
      { name: "size", selector: { number: { min: 28, max: 80, mode: "box", unit_of_measurement: "px" } } },
      { name: "gap", selector: { number: { min: 0, max: 40, mode: "box", unit_of_measurement: "px" } } },
    ),
    grid(
      select("show_location", [
        ["away", "Only when away"],
        ["always", "Always"],
        ["never", "Never"],
      ]),
      select("align", ALIGN),
    ),
    grid({ name: "show_name", selector: { boolean: {} } }, { name: "show_battery", selector: { boolean: {} } }),
    select("battery_style", [
      ["text", "Icon and percent"],
      ["ring", "Ring around the photo"],
    ]),
    expandable("Advanced", [GLASS_FIELD, TINT_FIELD("glass_tint", "Glass color"), CONTROL_GLASS_FIELD, YAML("styles")]),
  ],
  lists: [
    {
      name: "people",
      title: "People",
      label: (p) => p.name ?? shortId(p.entity) ?? "Osoba",
      create: () => ({ entity: "" }),
      item: (p) => [
        { name: "entity", selector: { entity: { filter: { domain: "person" } } } },
        { name: "name", selector: { text: {} } },
        grid(
          { name: "battery", selector: { entity: { filter: { domain: "sensor" } } } },
          { name: "battery_state", selector: { entity: { filter: { domain: "sensor" } } } },
        ),
        { name: "driving", selector: { entity: { filter: { domain: "binary_sensor" } } } },
        YAML("zone_icons"),
        expandable("Actions", actionFields(p, ["tap_action", "hold_action"])),
      ],
    },
  ],
};

const ROOM_TILE = ["image-full", "compact"];
const ROOM_SIDE = ["image-left", "image-right"];

/** One room button (entity, icon, colours, conditions, actions) – also the contextual ones. */
const roomButton = (e: Record<string, any>): Schema[] => [
        { name: "entity", selector: { entity: {} } },
        grid({ name: "icon", selector: { icon: {} } }, { name: "icon_active", selector: { icon: {} } }),
        grid(COLOR_FIELD("active_color"), ANIMATION_FIELD),
        { name: "active_states", selector: { text: { multiple: true } } },
        { name: "label", selector: { text: {} } },
        grid({ name: "badge", selector: { text: {} } }, COLOR_FIELD("badge_color")),
        YAML("state_icons"),
        YAML("active"),
        YAML("washer"),
        { name: "count", selector: { entity: { multiple: true } } },
        YAML("visible"),
        YAML("rules"),
        expandable("Actions", actionFields(e)),
];

const BTN = "Icon or photo with buttons";
const BAR = "With a glass bar (name, status, buttons)";
const ROOM_LAYOUTS = [
  { group: BTN, value: "stacked", label: "Icon on top", rows: [["p"], ["b"]] },
  { group: BTN, value: "image-bottom", label: "Icon below", rows: [["b"], ["p"]] },
  { group: BTN, value: "image-right", label: "Icon right", rows: [["b", "p"]] },
  { group: BTN, value: "image-left", label: "Icon left", rows: [["p", "b"]] },
  { group: BTN, value: "image-background", label: "Photo, buttons below", rows: [["p"], ["p"], ["b"]] },
  { group: BAR, value: "image-full", label: "Photo with a bar", rows: [["p", "p"], ["p", "p"], ["n", "b"]] },
  { group: BAR, value: "compact", label: "Low strip", rows: [["p", "n", "n", "b"]] },
];

export const roomSpec: EditorSpec = {
  parts: ROOM_PARTS,
  defaults: { layout: "stacked", show_icon: true, image_opacity: 1, image_fade: 50, image_position: "center", status: "auto" },
  form: (c) => {
    const layout = c.layout ?? "stacked";
    const tile = ROOM_TILE.includes(layout);
    const side = ROOM_SIDE.includes(layout);
    const bg = layout === "image-background";
    const n = (name: string, min: number, max: number, label: string, unit?: string): Schema => ({
      name,
      label,
      selector: { number: { min, max, mode: "box", ...(unit ? { unit_of_measurement: unit } : {}) } },
    });
    const compact = layout === "compact";
    // what each layout shows when the field is empty
    const maxDefault = compact ? 2 : tile ? 3 : 6;
    const buttons = (c.entities ?? []).length;
    const values = (c.info ?? []).length;
    const tap = c.tap_action?.action;
    return [
      {
        custom: "section",
        key: "room",
        title: "Room",
        open: true,
        schema: [
          grid({ name: "name", selector: { text: {} } }, { name: "icon", selector: { icon: {} } }),
          // the tiles with a bar always show the name; the others only when asked
          ...(tile ? [] : [grid({ name: "show_name", label: "Show the name", selector: { boolean: {} } }, ...(c.image && !bg ? [] : [{ name: "show_icon", label: "Show the icon", selector: { boolean: {} } }]))]),
          {
            name: "fill_area",
            label: "Fill in from an area",
            helper: "Takes the area's name, icon and its lights, players, blinds, fans and thermostats as buttons.",
            selector: { area: {} },
          },
        ],
      },
      {
        custom: "section",
        key: "layout",
        title: "Layout",
        secondary: ROOM_LAYOUTS.find((o) => o.value === layout)?.label,
        open: true,
        schema: [
          { custom: "tiles", name: "layout", default: "stacked", options: ROOM_LAYOUTS },
          ...(layout === "image-full"
            ? [
                grid(
                  { ...select("bar", [
                    ["full", "One bar"],
                    ["split", "Name and buttons apart"],
                  ]), label: "Bar" },
                  { ...select("buttons", [
                    ["bar", "In the bar"],
                    ["top-center", "Top, centred"],
                    ["top-end", "Top right"],
                  ]), label: "Buttons" },
                ),
                { name: "status_below", label: "Status under the name", selector: { boolean: {} } },
              ]
            : []),
          ...(bg
            ? [
                { ...select("button_align", [
                  ["spread", "Over the full width"],
                  ["start", "Left"],
                  ["center", "Centred"],
                  ["end", "Right"],
                ]), label: "Buttons" },
              ]
            : []),
          ...(side ? [grid(n("rows", 1, 6, "Rows of buttons"), n("button_gap", 0, 40, "Gap", "px"))] : []),
          ...(!tile && !side && !bg ? [grid(n("columns", 1, 6, "Buttons in a row"), n("button_gap", 0, 40, "Gap", "px"))] : []),
        ],
      },
      {
        custom: "section",
        key: "buttons",
        title: "Buttons",
        secondary: `${buttons} · ${t("at most")} ${c.max_entities ?? maxDefault}`,
        open: true,
        schema: [
          { custom: "list", list: "entities" },
          grid(n("max_entities", 1, 8, `${t("At most")} (${t("empty")} = ${maxDefault})`), n("button_size", 24, 80, "Button size (empty = automatic)", "px")),
          { name: "active_color", label: "Colour when on", helper: "For every button that doesn't set its own.", selector: { ui_color: { include_none: true } } },
          ...(tile ? [{ custom: "hint", text: "Contextual buttons appear left of the others only while they are on – music, a player." }, { custom: "list", list: "contextual" }] : []),
        ],
      },
      {
        custom: "section",
        key: "photo",
        title: "Photo",
        secondary: c.image ? String(c.image).split("/").pop()!.split("?")[0] : "Instead of the icon",
        open: !!c.image,
        schema: [
          { name: "image", label: "Image", helper: "URL (e.g. /local/rooms/kitchen.jpg) or an image. / camera. entity", selector: { text: {} } },
          ...(c.image
            ? [
                {
                  name: "image_position",
                  label: "Position",
                  selector: {
                    select: {
                      mode: "dropdown",
                      custom_value: true,
                      options: [
                        { value: "center", label: "Center" },
                        { value: "top", label: "Top" },
                        { value: "bottom", label: "Bottom" },
                        { value: "left", label: "Left" },
                        { value: "right", label: "Right" },
                      ],
                    },
                  },
                },
                ...(tile
                  ? []
                  : [
                      grid(
                        { name: "image_opacity", label: "Opacity", selector: { number: { min: 0.1, max: 1, step: 0.05, mode: "slider" } } },
                        { name: "image_fade", label: "Fade-out", selector: { number: { min: 0, max: 100, step: 5, mode: "slider", unit_of_measurement: "%" } } },
                      ),
                    ]),
                {
                  name: "image_color",
                  label: "In colour",
                  // the tiles with a bar are grey while the room is off, the others always in colour
                  helper: tile ? "Empty = only while something in the room is on." : "Empty = always.",
                  selector: {
                    select: {
                      mode: "dropdown",
                      options: [
                        { value: "always", label: "Always" },
                        { value: "active", label: "Only while something in the room is on" },
                      ],
                    },
                  },
                },
                ...(c.image_color === "active" || (tile && c.image_color !== "always")
                  ? [{ name: "image_entities", label: "On means", helper: "Empty = any of the buttons", selector: { entity: { multiple: true } } }]
                  : []),
                YAML("image_on"),
              ]
            : []),
        ],
      },
      {
        custom: "section",
        key: "status",
        title: tile ? "Status line" : "Values in the corner",
        secondary: values ? `${values} ${t(values === 1 ? "value" : "values")}` : "",
        schema: [
          ...(tile
            ? [
                { ...select("status", [
                  ["auto", "Values and what is on"],
                  ["info", "Values only"],
                  ["none", "Nothing"],
                ]), label: "Shows" },
              ]
            : [{ custom: "hint", text: "Small values in the card's corner, e.g. temperature and humidity." }]),
          { custom: "list", list: "info" },
        ],
      },
      { custom: "section", key: "actions", title: "Actions", secondary: tap ?? "", schema: actionFields(c, ["tap_action", "hold_action", "double_tap_action"]) },
      {
        custom: "section",
        key: "advanced",
        title: "Advanced",
        schema: [
          // the low strip is all bar: its material is the bar's, below
          ...(layout === "compact" ? [] : [GLASS_FIELD, TINT_FIELD("glass_tint", "Glass color")]),
          ...(tile
            ? [
                {
                  helper: "Empty = as set on the panel or the dashboard (liquid glass).",
                  ...select("bar_glass", [
                    ["liquid", "Liquid glass"],
                    ["frosted", "Frosted glass"],
                    ["solid", "Smoky, no blur (fastest)"],
                    ["none", "None (text on the photo)"],
                  ]),
                  label: "Bar material",
                },
                TINT_FIELD("bar_tint", "Bar color"),
              ]
            : []),
          { ...CONTROL_GLASS_FIELD, label: "Button material" },
          TINT_FIELD("control_tint", "Button color"),
          YAML("rules"),
          YAML("styles"),
        ],
      },
    ];
  },
  adjust: (next, prev, hass) => {
    const out = { ...next };
    const area = out.fill_area;
    delete out.fill_area;
    if (area && area !== prev.fill_area && hass) return { ...out, ...roomFromArea(hass, area) };
    return out;
  },
  lists: [
    {
      name: "entities",
      title: "Entity buttons",
      label: (e) => e.name ?? shortId(e.entity) ?? "Entity",
      create: () => ({ entity: "" }),
      item: roomButton,
    },
    {
      name: "contextual",
      title: "Contextual buttons",
      label: (e) => e.name ?? shortId(e.entity) ?? "Entity",
      create: () => ({ entity: "" }),
      item: roomButton,
    },
    {
      name: "info",
      title: "Values",
      label: (i) => i.name ?? shortId(i.entity) ?? i.text ?? "Value",
      create: () => ({ entity: "" }),
      item: () => [
        { name: "entity", selector: { entity: {} } },
        grid({ name: "icon", selector: { icon: {} } }, { name: "attribute", selector: { text: {} } }),
        grid({ name: "unit", selector: { text: {} } }, { name: "precision", selector: { number: { min: 0, max: 4, mode: "box" } } }),
        { name: "text", selector: { text: {} } },
        YAML("visible"),
      ],
    },
  ],
};

/** A room's name, icon and buttons from a Home Assistant area. */
function roomFromArea(hass: any, areaId: string): Record<string, any> {
  const area = hass.areas?.[areaId];
  const out: Record<string, any> = {};
  if (area?.name) out.name = area.name;
  if (area?.icon) out.icon = area.icon;
  const order = ["light", "media_player", "cover", "fan", "climate"];
  const ids = Object.values(hass.entities ?? {})
    .filter((e: any) => !e.hidden && !e.entity_category && (e.area_id ?? hass.devices?.[e.device_id]?.area_id) === areaId)
    .map((e: any) => e.entity_id as string)
    .filter((id) => order.includes(id.split(".")[0]) && hass.states[id])
    .sort((a, b) => order.indexOf(a.split(".")[0]) - order.indexOf(b.split(".")[0]));
  if (ids.length) out.entities = ids.slice(0, 6).map((entity) => ({ entity }));
  return out;
}

export const clockWeatherSpec: EditorSpec = {
  credits: [CLOCK_WEATHER_CARD],
  parts: CLOCK_WEATHER_PARTS,
  defaults: {
    variant: "full",
    show_clock: true,
    show_weather: true,
    show_condition: true,
    show_icon: true,
    show_temperature: true,
    show_seconds: false,
    show_date: false,
    clock_align: "center",
    forecast_type: "hourly",
    forecast_rows: 5,
    show_precipitation: false,
    animated_icons: true,
    icon_style: "flat",
    bar_style: "temperature",
  },
  form: (c) => [
    {
      custom: "section",
      key: "weather",
      title: "Weather",
      open: true,
      schema: [
        { name: "weather", selector: { entity: { filter: { domain: "weather" } } } },
        { name: "temperature_entity", selector: { entity: { filter: { domain: "sensor", device_class: "temperature" } } } },
        select("variant", [
          ["full", "Full (clock, weather, forecast)"],
          ["compact", "Compact (icon and temperature)"],
        ]),
      ],
    },
    {
      custom: "section",
      key: "show",
      title: "Show",
      schema: [
        grid(
          { name: "show_clock", selector: { boolean: {} } },
          { name: "show_weather", selector: { boolean: {} } },
          { name: "show_icon", selector: { boolean: {} } },
          { name: "show_temperature", selector: { boolean: {} } },
          { name: "show_condition", selector: { boolean: {} } },
        ),
        grid(
          select("now_style", [
            ["block", "Big icon and temperature"],
            ["line", "One line"],
          ]),
          select("now_align", ALIGN),
        ),
        { name: "temperature_decimals", selector: { number: { min: 0, max: 2, mode: "box" } } },
      ],
    },
    {
      custom: "section",
      key: "clock",
      title: "Clock",
      secondary: c.show_clock === false ? "Hidden" : "",
      schema: [
        select("clock_align", ALIGN),
        grid({ name: "show_seconds", selector: { boolean: {} } }, { name: "show_date", selector: { boolean: {} } }),
      ],
    },
    {
      custom: "section",
      key: "forecast",
      title: "Forecast",
      schema: [
        grid(
          { name: "hourly_forecast", selector: { number: { min: 0, max: 24, mode: "box", unit_of_measurement: "h" } } },
          { name: "daily_forecast", selector: { number: { min: 0, max: 10, mode: "box" } } },
        ),
        select("forecast_style", [
          ["bars", "Rows with temperature bars"],
          ["text", "Plain text"],
          ["columns", "Columns"],
        ]),
        { name: "show_precipitation", selector: { boolean: {} } },
        grid({ name: "rain_nowcast", label: "Rain in the next two hours", selector: { boolean: {} } }, { name: "rain_bars", selector: { boolean: {} } }),
      ],
    },
    {
      custom: "section",
      key: "details",
      title: "Details",
      secondary: (c.details ?? []).length ? "" : "None",
      schema: [
        {
          name: "details",
          selector: {
            select: {
              multiple: true,
              options: [
                { value: "humidity", label: "Humidity" },
                { value: "wind_speed", label: "Wind" },
                { value: "pressure", label: "Pressure" },
                { value: "precipitation", label: "Precipitation" },
                { value: "apparent_temperature", label: "Feels like" },
                { value: "uv_index", label: "UV index" },
                { value: "cloud_coverage", label: "Cloud cover" },
                { value: "visibility", label: "Visibility" },
              ],
            },
          },
        },
        { name: "details_columns", selector: { number: { min: 0, max: 4, mode: "box" } } },
      ],
    },
    {
      custom: "section",
      key: "look",
      title: "Look",
      schema: [
        { ...GLASS_FIELD, group: "Card" },
        ...(c.glass === "none" ? [] : [{ ...TINT_FIELD("glass_tint", "Glass color"), group: "Card" }]),
        ...part(
          "Icon",
          grid(
            select("icon_style", [
              ["flat", "Original"],
              ["realistic", "Realistic (experimental)"],
              ["mdi", "MDI icons"],
            ]),
          ),
          { name: "animated_icons", selector: { boolean: {} } },
        ),
        ...part(
          "Forecast",
          grid(
            {
              ...select("bar_style", [
                ["temperature", "By temperature"],
                ["single", "One colour"],
              ]),
              label: "Temperature bars",
            },
            { ...COLOR_FIELD("bar_color"), label: "Bar colour" },
          ),
          grid({ ...COLOR_FIELD("track_color"), label: "Track colour" }, { ...COLOR_FIELD("precip_color"), label: "Precipitation colour" }),
        ),
        ...part("Rain", { ...COLOR_FIELD("rain_color"), label: "Rain bars colour" }),
        ...part(
          "Dividers",
          { name: "dividers", selector: { boolean: {} } },
          grid({ ...COLOR_FIELD("divider_color"), label: "Divider colour" }, { name: "divider_size", label: "Divider thickness", selector: { number: { min: 1, max: 6, mode: "box", unit_of_measurement: "px" } } }),
        ),
      ],
    },
    { custom: "section", key: "actions", title: "Actions", schema: actionFields(c, ["tap_action"]) },
    { custom: "section", key: "advanced", title: "Advanced", schema: [YAML("styles")] },
  ],
};

/** A panel's layout settings – only those its layout uses (a grid's columns, a line's wrapping…). */
const PANEL_LAYOUT = (c: Record<string, any>): Schema[] => {
  const layout = c.layout ?? "column";
  return [
    grid(
      select("layout", [
        ["column", "Column"],
        ["row", "Line"],
        ["grid", "Grid"],
      ]),
      { name: "gap", selector: { number: { min: 0, max: 60, mode: "box", unit_of_measurement: "px" } } },
    ),
    ...(layout === "grid"
      ? [
          // own widths / heights set the count themselves: the plain count only without them
          ...(trackList(c.column_widths).length && trackList(c.row_heights).length
            ? []
            : [
                grid(
                  ...([
                    trackList(c.column_widths).length ? undefined : { name: "columns", selector: { number: { min: 1, max: 8, mode: "box" } } },
                    trackList(c.row_heights).length || c.masonry ? undefined : { name: "rows", selector: { number: { min: 1, max: 8, mode: "box" } } },
                  ].filter(Boolean) as Schema[]),
                ),
              ]),
          // masonry: rows come from the cards' heights – no row settings
          { name: "masonry", selector: { boolean: {} } },
          grid(
            ...([
              { name: "column_widths", label: "Column widths", helper: "e.g. 2 1 (shares), 60% 40% or 300px 1 – sets the number of columns; empty = Columns, all the same", selector: { text: {} } },
              c.masonry ? undefined : { name: "row_heights", label: "Row heights", helper: "as the columns, e.g. 1 2 or 200px 1 – sets the number of rows", selector: { text: {} } },
            ].filter(Boolean) as Schema[]),
          ),
          ...(c.masonry
            ? []
            : [
                select("equal_rows", [
                  ["", "Automatic (same on tablets, by content on phones)"],
                  ["true", "Every card the same height"],
                  ["false", "Each row as tall as its cards need"],
                ]),
              ]),
          ...(c.masonry
            ? [{ name: "masonry_fill", label: "Stretch the cards to the panel's height", helper: "Each column's cards share the room left below them", selector: { boolean: {} } }]
            : []),
          { name: "min_column_width", selector: { number: { min: 80, max: 800, mode: "box", unit_of_measurement: "px" } } },
        ]
      : []),
    ...(layout === "row"
      ? [{ name: "wrap", selector: { boolean: {} } }, grid({ name: "scroll", selector: { boolean: {} } }, { name: "item_width", selector: { text: {} } })]
      : []),
    grid(
      select("align", [
        ["stretch", "Stretch"],
        ["start", "Start"],
        ["center", "Center"],
        ["end", "End"],
      ]),
      select("justify", [
        ["start", "Start"],
        ["center", "Center"],
        ["end", "End"],
        ["space-between", "Space between"],
        ["space-evenly", "Space evenly"],
      ]),
    ),
    expandable("More", [
      grid({ name: "title", selector: { text: {} } }, { name: "icon", selector: { icon: {} } }),
      { name: "padding", selector: { text: {} } },
      select("role", [
        ["", "Normal (inside another panel: a tile)"],
        ["panel", "Panel of the look"],
        ["sidebar", "Side column of the look (Apple Home: dark glass)"],
      ]),
      YAML("styles"),
    ]),
  ];
};

export const panelSpec: EditorSpec = {
  parts: PANEL_PARTS,
  // columns: 3 – what a grid without the setting uses, shown in the field
  defaults: { layout: "column", gap: 16, align: "stretch", justify: "start", wrap: false, columns: 3 },
  // own column widths / row heights: the count follows them
  adjust: (n, p) => {
    const out = { ...n };
    const cw = trackList(out.column_widths);
    const rh = trackList(out.row_heights);
    if (out.column_widths !== p.column_widths && cw.length) out.columns = cw.length;
    if (out.row_heights !== p.row_heights && rh.length) out.rows = rh.length;
    return out;
  },
  form: PANEL_LAYOUT,
  cards: [{ name: "cards", title: "Cards in the panel", hint: "Arranged by the panel layout (column, row or grid)." }],
  tabs: [
    { id: "cards", label: "Cards", icon: "mdi:card-multiple-outline", cards: ["cards"] },
    { id: "layout", label: "Layout", icon: "mdi:view-grid-outline", form: (c) => [...PANEL_LAYOUT(c), { custom: "size" }] },
    {
      id: "look",
      label: "Appearance",
      icon: "mdi:palette-outline",
      dayNight: true,
      sections: [
        { key: "panel-glass", title: "Glass", open: true, blocks: ["levels"] },
        {
          key: "panel-foreign",
          title: "Cards that are not glass",
          blocks: ["foreign"],
          summary: (c) => {
            const n = foreignCards(c);
            return n ? `${n} ${t(n === 1 ? "card" : "cards")}` : t("None");
          },
        },
      ],
    },
  ],
};

export const dashboardSpec: EditorSpec = {
  credits: [BUBBLE, LIQUID_GLASS_JS],
  previewSwitch: true,
  looks: true,
  defaults: {
    glass: "liquid",
    layout: "auto",
    breakpoint: 700,
    gap: 22,
    appearance: "auto",
    time_tint: true,
    // shown on the sliders; keys mirror GLASS_DEFAULTS in core/liquid-gl.ts
    liquid: {
      edge_intensity: 0.06,
      rim_intensity: 0.06,
      base_intensity: 0,
      edge_distance: 0.12,
      rim_distance: 0.3,
      base_distance: 0.1,
      corner_boost: 0.03,
      ripple: 0,
      blur: 6,
      tint: 0.3,
      dispersion: 0.45,
      specular: 0.3,
      rim_light: 0.45,
      rim_width: 1.25,
    },
  },
  form: [],
  tabs: [
    {
      id: "layout",
      label: "Layout",
      icon: "mdi:view-dashboard-edit-outline",
      sections: [
        {
          key: "device",
          title: "Devices",
          open: true,
          form: [grid(select("layout", LAYOUT_MODES), { name: "breakpoint", selector: { number: { min: 300, max: 2000, mode: "box", unit_of_measurement: "px" } } })],
          summary: (c) => `${t(LAYOUT_MODES.find(([v]) => v === (c.layout ?? "auto"))![1])} · ${t("mobile below")} ${c.breakpoint ?? 700} px`,
        },
        {
          key: "screen",
          title: "Screen layout",
          open: true,
          blocks: ["layout"],
          summary: (c) => t(c.grid?.areas ? "Custom" : (PRESETS[(c.preset ?? "classic") as keyof typeof PRESETS]?.label ?? c.preset)),
        },
        {
          key: "sizes",
          title: "Sizes and spacing",
          form: [
            grid({ name: "left_width", selector: { text: {} } }, { name: "gap", selector: { number: { min: 0, max: 60, mode: "box", unit_of_measurement: "px" } } }),
            grid(
              { name: "column_widths", label: "Column widths", helper: "Each layout column from the left, e.g. 340px 1 (1 = the rest), 30% 1 or 300px 1 300px – or drag the lines between areas in the preview", selector: { text: {} } },
              { name: "row_heights", label: "Row heights", helper: "Each layout row from the top, e.g. 120px 1 – rows left out keep their own height", selector: { text: {} } },
            ),
            grid({ name: "padding", selector: { text: {} } }, { name: "offset", selector: { text: {} } }),
            { name: "dock_space", selector: { number: { min: 0, max: 200, mode: "box", unit_of_measurement: "px" } } },
          ],
          summary: (c) => setCount(c, ["left_width", "column_widths", "row_heights", "padding", "offset", "dock_space"], { gap: 22 }),
        },
        {
          key: "demo",
          title: "Demo home",
          form: [{ name: "demo", label: "Run on the made-up demo home", helper: "Every card here shows invented devices; switching them changes nothing in your home. Off: the cards use your entities.", selector: { boolean: {} } }],
          summary: (c) => t(c.demo ? "On" : "Off"),
        },
        // both need Bubble Card: without it they are not offered, unless already set up
        { key: "dock", title: "Bottom bar (dock)", blocks: ["dock"], requires: "bubble-card", keep: hasDock, summary: (c) => t(hasDock(c) ? "On" : "Off") },
        {
          key: "popups",
          title: "Pop-ups",
          blocks: ["popups"],
          requires: "bubble-card",
          keep: (c) => !!(c.overlay_source || c.responsive?.mobile?.overlay_source || JSON.stringify(c.overlay ?? []).includes('"pop-up"')),
          summary: (c) =>
            [c.overlay_source?.dashboard ? `${t("from")} ${c.overlay_source.dashboard}` : t("from this dashboard"), c.responsive?.mobile?.overlay_source ? t("other on mobile") : ""]
              .filter(Boolean)
              .join(" · "),
        },
      ],
    },
    {
      id: "look",
      label: "Appearance",
      icon: "mdi:palette-outline",
      dayNight: true,
      sections: [
        {
          key: "night",
          title: "Day and night",
          open: true,
          day: true,
          form: [grid(select("appearance", APPEARANCES), { name: "time_tint", selector: { boolean: {} } })],
          summary: (c) => t(APPEARANCES.find(([v]) => v === (c.appearance ?? "auto"))![1]),
        },
        { key: "background", title: "Background", open: true, blocks: ["wallpaper"], summary: (c) => (c.wallpaper ? String(c.wallpaper).split("/").pop()! : t("HA theme")) },
        { key: "glass", title: "Glass", open: true, blocks: ["looks", "levels"], summary: (c) => t(LOOK_NAMES[c.look ?? "liquid"] ?? c.look) },
        {
          key: "foreign",
          title: "Cards that are not glass",
          blocks: ["foreign", "popupTheme"],
          summary: (c) => {
            const n = foreignCards(c);
            return n ? `${n} ${t(n === 1 ? "card" : "cards")}` : t("None");
          },
        },
        {
          key: "advanced",
          title: "For advanced users",
          blocks: ["tuning"],
          form: [YAML("styles")],
          summary: (c) => setCount(c, ["styles"], {}, Object.keys(c.liquid ?? {}).length),
        },
      ],
    },
  ],
  tuning: {
    name: "liquid",
    title: "Liquid glass – tuning",
    fields: [
      ["edge_intensity", 0, 0.1, 0.005],
      ["rim_intensity", 0, 0.2, 0.005],
      ["base_intensity", 0, 0.05, 0.005],
      ["edge_distance", 0.05, 0.5, 0.01],
      ["rim_distance", 0.1, 2, 0.05],
      ["base_distance", 0.05, 0.3, 0.01],
      ["corner_boost", 0, 0.1, 0.005],
      ["ripple", 0, 0.5, 0.01],
      ["blur", 1, 15, 0.5],
      ["tint", 0, 1, 0.05],
      ["dispersion", 0, 0.6, 0.01],
      ["specular", 0, 1.5, 0.05],
      ["rim_light", 0, 1, 0.05],
      ["rim_width", 0.5, 6, 0.25],
    ],
  },
  cards: [
    { name: "header", title: "Header (top left)", hint: "Usually the date and name day." },
    { name: "top", title: "Top bar", hint: "Status chips and people next to the header." },
    { name: "left", title: "Left column", hint: "Clock, weather, calendar…" },
    { name: "main", title: "Main area", hint: "Mostly room cards." },
    {
      name: "overlay",
      grouped: true,
      title: "Floating items – navigation and pop-ups",
      hint: "Not part of the layout: the bottom navigation bar and pop-ups opened by a button linking to #name. The Tablet / Mobile badge says where an item is used.",
    },
  ],
};

export const dividerSpec: EditorSpec = {
  parts: DIVIDER_PARTS,
  defaults: { width: "92%", thickness: 4, opacity: 0.55, margin: 8, line: true },
  form: [
    grid({ name: "name", selector: { text: {} } }, { name: "icon", selector: { icon: {} } }),
    { name: "line", selector: { boolean: {} } },
    grid({ name: "width", selector: { text: {} } }, { name: "thickness", selector: { number: { min: 1, max: 12, mode: "box", unit_of_measurement: "px" } } }),
    grid(
      { name: "opacity", selector: { number: { min: 0, max: 1, step: 0.05, mode: "slider" } } },
      { name: "margin", selector: { number: { min: 0, max: 40, mode: "box", unit_of_measurement: "px" } } },
    ),
  ],
};

export const calendarSpec: EditorSpec = {
  parts: CALENDAR_PARTS,
  defaults: { days: 5, max_events: 6, show_location: false, show_title: false, hide_empty: false },
  form: [
    grid(
      { name: "days", selector: { number: { min: 1, max: 31, mode: "box" } } },
      { name: "max_events", selector: { number: { min: 1, max: 30, mode: "box" } } },
    ),
    grid({ name: "show_location", selector: { boolean: {} } }, { name: "hide_empty", selector: { boolean: {} } }),
    { name: "fit", selector: { boolean: {} } },
    grid({ name: "show_title", selector: { boolean: {} } }, { name: "title", selector: { text: {} } }),
    expandable("Actions and advanced", [{ name: "tap_action", selector: { ui_action: {} } }, GLASS_FIELD, YAML("styles")]),
  ],
  lists: [
    {
      name: "calendars",
      title: "Calendars",
      label: (l) => l.name ?? shortId(l.entity) ?? "Calendar",
      create: () => ({ entity: "" }),
      item: () => [{ name: "entity", selector: { entity: { domain: "calendar" } } }, COLOR_FIELD()],
    },
  ],
};

export const radarSpec: EditorSpec = {
  parts: RADAR_PARTS,
  defaults: {
    zoom: 7,
    frames: 7,
    style: "satellite",
    satellite: true,
    radar: true,
    labels: true,
    marker: true,
    autoplay: false,
    show_forecast: true,
    radar_provider: "rainviewer",
    map_provider: "esri",
  },
  form: (c) => [
    {
      custom: "section",
      key: "map",
      title: "Map",
      open: true,
      schema: [
        select("style", [
          ["satellite", "Satellite picture (real colours)"],
          ["clouds", "Clouds by density on a dark map"],
          ["rain", "Precipitation only on a dark map"],
        ]),
        grid({ name: "zoom", selector: { number: { min: 3, max: 10, mode: "box" } } }, { name: "height", selector: { number: { min: 120, max: 900, mode: "box", unit_of_measurement: "px" } } }),
        { name: "title", selector: { text: {} } },
        grid({ name: "satellite", selector: { boolean: {} } }, { name: "radar", selector: { boolean: {} } }),
        grid({ name: "labels", selector: { boolean: {} } }, { name: "borders", label: "Country borders", selector: { boolean: {} } }),
      ],
    },
    {
      custom: "section",
      key: "providers",
      title: "Providers",
      schema: [
        { custom: "hint", text: "The satellite is EUMETSAT, the forecast DWD ICON-EU. DWD radar covers Germany and its borders only." },
        grid(
          {
            ...select("radar_provider", [
              ["rainviewer", "RainViewer (worldwide)"],
              ["dwd", "DWD (Germany and its borders)"],
            ]),
            label: "Radar provider",
          },
          {
            ...select("map_provider", [
              ["esri", "Esri (grey)"],
              ["carto", "CARTO (clean)"],
              ["osm", "OpenStreetMap (in colour)"],
            ]),
            label: "Map provider",
          },
        ),
      ],
    },
    {
      custom: "section",
      key: "animation",
      title: "Animation and forecast",
      schema: [
        grid({ name: "frames", selector: { number: { min: 1, max: 13, mode: "box" } } }, { name: "speed", selector: { number: { min: 250, max: 3000, mode: "box", unit_of_measurement: "ms" } } }),
        grid({ name: "autoplay", selector: { boolean: {} } }, { name: "show_forecast", label: "Show the forecast", selector: { boolean: {} } }),
        ...(c.show_forecast === false ? [] : [{ name: "forecast", label: "Forecast hours", selector: { number: { min: 0, max: 12, mode: "box", unit_of_measurement: "h" } } }]),
        { name: "satellite_delay", selector: { number: { min: 0, max: 120, mode: "box", unit_of_measurement: "min" } } },
      ],
    },
    {
      custom: "section",
      key: "place",
      title: "Place",
      schema: [
        { custom: "hint", text: "Empty = home from Home Assistant." },
        grid({ name: "latitude", selector: { number: { step: "any", mode: "box" } } }, { name: "longitude", selector: { number: { step: "any", mode: "box" } } }),
        { name: "marker", selector: { boolean: {} } },
      ],
    },
    {
      custom: "section",
      key: "look",
      title: "Look",
      schema: [
        { ...GLASS_FIELD, group: "Card" },
        ...part("Controls", grid({ ...select("controls_glass", [["", "Default"], ...MATERIALS]), label: "Controls material" }, { ...COLOR_FIELD("controls_color"), label: "Controls colour" })),
        ...part("Controls", grid({ ...select("play_glass", [["", "Default"], ...MATERIALS]), label: "Play button material" }, { ...COLOR_FIELD("play_color"), label: "Play button colour" })),
        ...part("Controls", grid({ ...select("tab_glass", [["", "Default"], ...MATERIALS]), label: "Chosen tab material" }, { ...COLOR_FIELD("tab_color"), label: "Chosen tab colour" })),
        ...part("Timeline", { ...COLOR_FIELD("timeline_color"), label: "Timeline colour" }),
        ...part("Radar", { name: "radar_opacity", selector: { number: { min: 0.2, max: 1, step: 0.05, mode: "slider" } } }),
        ...part("Home marker", { ...COLOR_FIELD("marker_color"), label: "Marker colour" }),
      ],
    },
    { custom: "section", key: "advanced", title: "Advanced", schema: [YAML("styles")] },
  ],
};

export const airQualitySpec: EditorSpec = {
  parts: AIR_QUALITY_PARTS,
  defaults: { image_color: "active", image_fade: true, edge_fade: true, name_backdrop: true, level_style: "dot" },
  form: (c) => [
    {
      custom: "section",
      key: "sensor",
      title: "Sensor",
      open: true,
      schema: [
        { name: "entity", selector: { entity: { domain: "sensor" } } },
        grid({ name: "name", selector: { text: {} } }, { name: "title", selector: { text: {} } }),
      ],
    },
    {
      custom: "section",
      key: "pollutants",
      title: "Pollutants",
      secondary: (c.pollutants ?? []).length ? "" : "Automatic",
      schema: [{ custom: "hint", text: "Empty = the other sensors of the same device." }, { custom: "list", list: "pollutants" }],
    },
    {
      custom: "section",
      key: "images",
      title: "Pictures",
      secondary: c.image || (c.images ?? []).length ? "" : "Animated landscape",
      schema: [
        { custom: "hint", text: "Empty = an animated landscape for each level. One picture for all, or six (good … hazardous) in YAML." },
        { name: "image", selector: { text: {} } },
        YAML("images"),
        {
          ...select("image_color", [
            ["active", "Grey while the air is fine"],
            ["always", "Always in colour"],
            ["never", "Always grey"],
          ]),
          label: "Picture in colour",
        },
      ],
    },
    {
      custom: "section",
      key: "limits",
      title: "Levels",
      schema: [
        { custom: "hint", text: "Upper bounds of the first five levels, e.g. 50, 100, 150, 200, 300 (US EPA AQI, the default)." },
        { name: "limits", selector: { text: {} } },
      ],
    },
    {
      custom: "section",
      key: "look",
      title: "Look",
      schema: [
        { ...GLASS_FIELD, group: "Card" },
        ...part("Index tile", grid({ ...select("hero_glass", [["", "Default"], ...MATERIALS]), label: "Index tile material" }, { ...COLOR_FIELD("hero_color"), label: "Index tile colour" })),
        ...part(
          "Index tile",
          grid(
            { name: "image_fade", label: "Picture fading into the tile", selector: { boolean: {} } },
            { name: "edge_fade", label: "Soft edges top, left and right", selector: { boolean: {} } },
            { name: "name_backdrop", label: "Band under the name", selector: { boolean: {} } },
          ),
        ),
        ...part("Pollutant tiles", grid({ ...select("tiles_glass", [["", "Default"], ...MATERIALS]), label: "Pollutant tiles material" }, { ...COLOR_FIELD("tiles_color"), label: "Pollutant tiles colour" })),
        ...part(
          "Levels",
          {
            ...select("level_style", [
              ["dot", "A coloured dot"],
              ["tile", "The tile in the level's colour"],
              ["none", "No colour"],
            ]),
            label: "Level shown as",
          },
          { custom: "hint", text: "Own colours of the six levels (good … hazardous), e.g. [green, yellow, orange, red, purple, \"#a2324a\"]." },
          YAML("level_colors"),
        ),
      ],
    },
    { custom: "section", key: "advanced", title: "Advanced", schema: [YAML("styles")] },
  ],
  lists: [
    {
      name: "pollutants",
      title: "Pollutants (empty = automatic)",
      label: (l) => l.name ?? shortId(l.entity) ?? "Pollutant",
      create: () => ({ entity: "" }),
      item: () => [
        { name: "entity", selector: { entity: { domain: "sensor" } } },
        { name: "name", selector: { text: {} } },
        { name: "limits", selector: { text: {} } },
      ],
    },
  ],
};

/** without helpers: which bar (and its charts) – only for two independent bars on one screen */
const GROUP_FIELD: Schema = {
  name: "group",
  label: "Period group (without helpers)",
  helper: "Only for two independent period bars on one screen; the bar and its charts share it. Not used with helpers.",
  selector: { text: {} },
};

const PERIOD_KINDS_FIELD: Schema = grid(
  {
    name: "periods",
    selector: { select: { multiple: true, options: [{ value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }, { value: "year", label: "Year" }] } },
  },
  GROUP_FIELD,
);

export const periodBarSpec: EditorSpec = {
  parts: PERIOD_PARTS,
  form: [
    { custom: "hint", text: "Charts follow the period in a glass-chart (period on). Without helpers the bar keeps the period itself; with them automations and templates can follow it." },
    PERIOD_KINDS_FIELD,
    expandable("Home Assistant helpers", [
      { name: "offset_entity", selector: { entity: { domain: "input_number" } } },
      { name: "select_entity", selector: { entity: { domain: "input_select" } } },
      { name: "label_entity", selector: { entity: {} } },
      { name: "current_entity", selector: { entity: { domain: "input_boolean" } } },
      YAML("kinds"),
    ]),
    grid({ name: "now_label", selector: { text: {} } }, { name: "compact", selector: { boolean: {} } }),
    { name: "spread", selector: { boolean: {} } },
    {
      name: "parts",
      selector: { select: { multiple: true, options: [{ value: "now", label: "Now" }, { value: "nav", label: "‹ period ›" }, { value: "kind", label: "Day / month / year" }] } },
    },
    {
      custom: "section",
      key: "look",
      title: "Look",
      schema: [
        ...part("Bar", grid({ ...select("bar_glass", [["", "Default"], ...MATERIALS]), label: "Bar material" }, { ...COLOR_FIELD("bar_color"), label: "Bar colour" })),
        ...part(
          "Buttons",
          grid({ ...select("buttons_glass", [["", "Default"], ...MATERIALS]), label: "Arrows and drop-down material" }, { ...COLOR_FIELD("buttons_color"), label: "Arrows and drop-down colour" }),
          grid({ ...select("now_glass", [["", "Default"], ...MATERIALS]), label: "\"Now\" button material" }, { ...COLOR_FIELD("now_color"), label: "\"Now\" button colour" }),
        ),
      ],
    },
    expandable("Advanced", [YAML("styles")]),
  ],
};

export const chartSpec: EditorSpec = {
  credits: [APEXCHARTS],
  parts: CHART_PARTS,
  defaults: { values: true, gradient: true, glow: true, zero_line: true, column_width: 62, radius: 5 },
  form: [
    { custom: "hint", text: "Shows the chart for the period picked in the period bar. Shared look: what all periods have in common (colours, height, tooltip…), without graph_span and span – they are set here. Day / week / month / year: that period's own data (series, update_interval…), added to the shared look; an empty one shows the shared look as it is." },
    YAML("card"),
    expandable("Data per period", [YAML("day"), YAML("week"), YAML("month"), YAML("year")]),
    {
      custom: "section",
      key: "look",
      title: "Look",
      schema: [
        grid(select("look", [["glass", "Glass"], ["apex", "apexcharts as it is"]]), { ...COLOR_FIELD("color"), label: "Column colour" }),
        grid({ name: "height", selector: { number: { min: 60, max: 600, step: 2, unit_of_measurement: "px", mode: "box" } } }, { name: "column_width", selector: { number: { min: 10, max: 100, unit_of_measurement: "%", mode: "slider" } } }),
        grid({ name: "radius", selector: { number: { min: 0, max: 20, unit_of_measurement: "px", mode: "slider" } } }, { name: "gradient", selector: { boolean: {} } }),
        grid({ name: "glow", selector: { boolean: {} } }, { name: "zero_line", selector: { boolean: {} } }),
        grid({ name: "values", selector: { boolean: {} } }, { name: "time", selector: { boolean: {} } }),
        { name: "grid", selector: { boolean: {} } },
      ],
    },
    expandable("Period", [
      { name: "period", selector: { boolean: {} } },
      GROUP_FIELD,
      { name: "offset_entity", selector: { entity: { domain: "input_number" } } },
      { name: "select_entity", selector: { entity: { domain: "input_select" } } },
      YAML("kinds"),
    ]),
  ],
};

export const popupHeaderSpec: EditorSpec = {
  credits: [BUBBLE],
  parts: POPUP_HEADER_PARTS,
  defaults: { close: true },
  form: (c) => [
    {
      custom: "section",
      key: "header",
      title: "Header",
      open: true,
      schema: [
        grid({ name: "name", selector: { text: {} } }, { name: "icon", selector: { icon: {} } }),
        { name: "close", label: "Close button", selector: { boolean: {} } },
        { name: "title_width", label: "Where the cards start", helper: "e.g. 352px or 30cqw – in line with the content under a side panel", selector: { text: {} } },
      ],
    },
    {
      custom: "section",
      key: "buttons",
      title: "Buttons",
      open: true,
      schema: [{ custom: "hint", text: "Dark pill buttons in the header, e.g. Vacuum everywhere." }, { custom: "list", list: "buttons" }],
    },
    {
      custom: "section",
      key: "look",
      title: "Look",
      schema: [
        ...part("Bar", grid({ ...select("bar_glass", [["", "Default"], ...MATERIALS]), label: "Background material" }, { ...COLOR_FIELD("bar_color"), label: "Bar colour" })),
        ...part("Icon", grid({ ...select("icon_glass", [["", "Default"], ...MATERIALS]), label: "Icon material" }, { ...COLOR_FIELD("icon_background"), label: "Icon background" })),
        ...part("Buttons", grid({ ...select("buttons_glass", [["", "Default"], ...MATERIALS]), label: "Chosen buttons material" }, { ...COLOR_FIELD("buttons_color"), label: "Chosen buttons colour" })),
        // "not chosen": only buttons with an `active` condition are ever chosen or not
        ...((c.buttons ?? []).some((b: any) => b?.active !== undefined) ? part("Buttons", grid({ ...select("off_glass", [["", "Default"], ...MATERIALS]), label: "Not chosen buttons material" }, { ...COLOR_FIELD("off_color"), label: "Not chosen buttons colour" })) : []),
        ...part("Close button", grid({ ...select("close_glass", [["", "Default"], ...MATERIALS]), label: "Close button material" }, { ...COLOR_FIELD("close_color"), label: "Close button colour" })),
      ],
    },
    { custom: "section", key: "advanced", title: "Advanced", schema: [YAML("styles")] },
  ],
  lists: [
    {
      name: "buttons",
      title: "Buttons",
      label: (b) => b.name ?? b.icon ?? "Button",
      create: () => ({ name: "", icon: "mdi:gesture-tap" }),
      defaults: { align: "end" },
      item: (b) => [
        grid({ name: "name", selector: { text: {} } }, { name: "icon", selector: { icon: {} } }),
        grid(
          {
            ...select("align", [
              ["end", "Right"],
              ["start", "Left, after the name"],
            ]),
            label: "Place",
          },
          { name: "confirm", label: "Ask first", helper: "The button turns into ✕ and ✓ for a few seconds", selector: { boolean: {} } },
        ),
        ...actionFields(b, ["tap_action"]),
        expandable("Shown as chosen while", [{ custom: "hint", text: "A condition, e.g. { entity: input_boolean.camera_1, state: \"on\" } – dark while it holds." }, YAML("active")]),
      ],
    },
  ],
  cards: [{ name: "cards", title: "Cards in the header", hint: "Between the name and the close button, e.g. a period bar." }],
};

export const applianceSpec: EditorSpec = {
  defaults: { active_color: "orange", fill_style: "fade", fill_strength: 34 },
  form: (c) => {
    const e = String(c.entity ?? "");
    const kind = c.kind ?? (e.startsWith("lawn_mower.") ? "mower" : e.startsWith("vacuum.") ? "vacuum" : "washer");
    const sensor = (name: string, label: string, domain: string | string[] = "sensor") => ({ name, label, selector: { entity: { domain } } });
    const action = (name: string, label: string, helper: string) => ({ name, label, helper, selector: { ui_action: {} } });
    return [
    {
      custom: "section",
      key: "appliance",
      title: "Appliance",
      open: true,
      schema: [
        { name: "entity", selector: { entity: { domain: ["vacuum", "lawn_mower", "sensor", "binary_sensor", "switch"] } } },
        grid(
          {
            ...select("kind", [
              ["", "From the entity"],
              ["vacuum", "Vacuum"],
              ["mower", "Mower"],
              ["washer", "Washer"],
            ]),
            label: "Kind",
          },
          { name: "name", selector: { text: {} } },
        ),
        { name: "icon", selector: { icon: {} } },
      ],
    },
    {
      custom: "section",
      key: "status",
      title: "Status",
      schema:
        kind === "washer"
          ? [
              grid(sensor("machine", "Machine state"), sensor("remaining", "Time left")),
              grid(sensor("completion", "Ends at"), sensor("power", "Power", ["switch", "binary_sensor", "sensor"])),
            ]
          : [
              grid(sensor("battery", "Battery"), sensor("progress", "Progress")),
              sensor("charging", "Charging", ["binary_sensor", "sensor"]),
              ...(kind === "vacuum" ? [YAML("room_names")] : []),
            ],
    },
    ...(kind === "washer"
      ? []
      : [
          {
            custom: "section",
            key: "controls",
            title: "Controls",
            secondary: "Optional",
            schema:
              kind === "vacuum"
                ? [action("start", "Start", "Instead of vacuum.start (e.g. a script)")]
                : [
                    grid(action("pause", "Pause", "Instead of lawn_mower.pause"), action("resume", "Resume", "Instead of lawn_mower.start_mowing")),
                    action("stop", "End the job", "Instead of mammotion.cancel_job"),
                    { custom: "hint", text: "Nudge buttons: shown while it stands paused out on the lawn; held, they keep pressing." },
                    {
                      type: "grid",
                      name: "nudge",
                      schema: [
                        { name: "up", label: "Forward", selector: { entity: { domain: "button" } } },
                        { name: "down", label: "Back", selector: { entity: { domain: "button" } } },
                        { name: "left", label: "Left", selector: { entity: { domain: "button" } } },
                        { name: "right", label: "Right", selector: { entity: { domain: "button" } } },
                      ],
                    },
                  ],
          },
        ]),
    {
      custom: "section",
      key: "picking",
      title: "Picking",
      secondary: c.select_group ? "" : "Optional",
      schema: [
        { custom: "hint", text: "A tap on the bar picks its id in the group: cards in a panel show for it with the visibility condition \"Picked in a group\"." },
        grid({ name: "select_group", label: "Group", selector: { text: {} } }, { name: "select", label: "Id", selector: { text: {} } }),
        { name: "picked_first", label: "Picked at first", selector: { boolean: {} } },
      ],
    },
    {
      custom: "section",
      key: "actions",
      title: "Actions",
      schema: [{ name: "hold_action", selector: { ui_action: {} } }],
    },
    {
      custom: "section",
      key: "look",
      title: "Look",
      schema: [
        ...part("Bars", { ...CONTROL_GLASS_FIELD, label: "Material of the controls" }),
        ...part("Bars", grid({ ...select("bar_glass", [["", "Default"], ...MATERIALS]), label: "Bar material" }, { ...COLOR_FIELD("bar_color"), label: "Bar colour" })),
        ...part("Bars", grid({ ...select("picked_glass", [["", "Default"], ...MATERIALS]), label: "Picked bar material" }, { ...COLOR_FIELD("picked_color"), label: "Picked bar colour" })),
        ...part("Bars", grid({ ...COLOR_FIELD("active_color"), label: "Colour at work" }, { ...COLOR_FIELD("fill_color"), label: "Fill colour" })),
        ...part(
          "Bars",
          grid(
            {
              ...select("fill_style", [
                ["fade", "Fading"],
                ["solid", "Solid"],
                ["glow", "Glowing towards the value"],
                ["none", "None"],
              ]),
              label: "Fill",
            },
            { name: "fill_strength", label: "Fill strength (%)", selector: { number: { min: 5, max: 100, step: 1, mode: "slider" } } },
          ),
        ),
        ...part("Icon", grid({ ...select("icon_glass", [["", "Default"], ...MATERIALS]), label: "Icon material when idle" }, { ...select("icon_on_glass", [["", "Default"], ...MATERIALS]), label: "Icon material at work" })),
        ...part("Icon", { ...COLOR_FIELD("icon_background"), label: "Icon background" }),
        ...part("Icon", ICON_FIELD("bar", "Icon colour and size (idle / at work)", true)),
        ...part("Drawer", grid({ ...select("tray_glass", [["", "Default"], ...MATERIALS]), label: "Drawer material" }, { ...COLOR_FIELD("tray_color"), label: "Drawer colour" })),
        ...part("Drawer", grid({ ...select("buttons_glass", [["", "Default"], ...MATERIALS]), label: "Buttons material" }, { ...COLOR_FIELD("buttons_color"), label: "Buttons colour" })),
        ...part("Drawer", grid({ ...select("current_glass", [["", "Default"], ...MATERIALS]), label: "Lit button material" }, { ...COLOR_FIELD("current_color"), label: "Lit button colour" })),
        ...part("Drawer", ICON_FIELD("buttons", "Button icons (lit = active)", true)),
        ...part("Text", TEXT_FIELD("name", "Name (picked bar = active)", true), TEXT_FIELD("state", "State (picked bar = active)", true)),
        ...part("Battery", TEXT_FIELD("battery", "Battery text"), ICON_FIELD("battery", "Battery icon")),
      ],
    },
    {
      custom: "section",
      key: "advanced",
      title: "Advanced",
      schema: [
        ...(kind === "washer"
          ? [
              { custom: "hint", text: "An integration whose states aren't known: the states that mean each phase. A power sensor as the entity: running above this many W." },
              { name: "run_states", label: "Running states", selector: { text: { multiple: true } } },
              { name: "pause_states", label: "Paused states", selector: { text: { multiple: true } } },
              { name: "done_states", label: "Done states", selector: { text: { multiple: true } } },
              { name: "run_above", label: "Running above", selector: { number: { min: 0, max: 3000, mode: "box", unit_of_measurement: "W" } } },
              YAML("stages"),
            ]
          : []),
        { ...GLASS_FIELD, group: "Card" },
        YAML("styles"),
      ],
    },
  ];
  },

};

export const tabsSpec: EditorSpec = {
  noGlass: true,
  form: [
    {
      custom: "section",
      key: "tabs",
      title: "Tabs",
      open: true,
      schema: [
        { custom: "hint", text: "Picks one id in the group. Cards in a panel show for it with the visibility condition \"Picked in a group\"." },
        grid({ name: "group", label: "Group", selector: { text: {} } }, { name: "default", label: "Picked at first", selector: { text: {} } }),
        { custom: "list", list: "tabs" },
      ],
    },
    {
      custom: "section",
      key: "look",
      title: "Look",
      schema: [
        ...part("Tabs", grid({ ...select("tabs_glass", [["", "Default"], ...MATERIALS]), label: "Tabs material" }, { ...COLOR_FIELD("tabs_color"), label: "Tabs colour" })),
        ...part("Tabs", grid({ ...select("tab_glass", [["", "Default"], ...MATERIALS]), label: "Chosen tab material" }, { ...COLOR_FIELD("tab_color"), label: "Chosen tab colour" })),
        ...part("Tabs", TEXT_FIELD("tab", "Tab text", true), ICON_FIELD("tab", "Tab icons", true)),
      ],
    },
  ],
  lists: [
    {
      name: "tabs",
      title: "Tabs",
      label: (t) => t.name ?? t.id ?? "Tab",
      create: () => ({ id: "" }),
      item: () => [{ name: "id", selector: { text: {} } }, grid({ name: "name", selector: { text: {} } }, { name: "icon", selector: { icon: {} } })],
    },
  ],
};

export const roomMapSpec: EditorSpec = {
  defaults: { satellite: true },
  form: (c) => {
    const lawn = String(c.entity ?? "").startsWith("lawn_mower.");
    return [
      {
        custom: "section",
        key: "robot",
        title: "Robot",
        open: true,
        schema: [
          { name: "entity", selector: { entity: { domain: ["vacuum", "lawn_mower"] } } },
          lawn ? { name: "tracker", selector: { entity: { domain: "device_tracker" } } } : { name: "map", selector: { entity: { domain: "image" } } },
          YAML("room_names"),
        ],
      },
      {
        custom: "section",
        key: "controls",
        title: "Choices and settings",
        schema: [
          { custom: "hint", text: "Choices: select entities under the map. Settings (mower): its number entities, set before mowing." },
          YAML("options"),
          ...(lawn ? [YAML("settings")] : []),
        ],
      },
      {
        custom: "section",
        key: "mapview",
        title: "Map",
        schema: lawn
          ? [
              { name: "satellite", label: "Aerial picture under the zones", selector: { boolean: {} } },
              grid({ name: "tiles", label: "Aerial picture", helper: "esri (default), cuzk, or a {z}/{y}/{x} URL", selector: { text: {} } }, { name: "max_zoom", selector: { number: { min: 12, max: 21, mode: "box" } } }),
            ]
          : [{ name: "picture", label: "The robot's own map picture", selector: { boolean: {} } }],
      },
      {
        custom: "section",
        key: "look",
        title: "Look",
        schema: [
          ...part("Map", { ...COLOR_FIELD("accent_color"), label: "Picked rooms colour" }, TEXT_FIELD("map", "Room names on the map", true, false)),
          // the setting bars: a mower's (settings); the choices: only when there are some
          ...(lawn && c.settings
            ? part(
                "Settings",
                grid({ ...select("settings_glass", [["", "Default"], ...MATERIALS]), label: "Setting bars material" }, { ...COLOR_FIELD("settings_color"), label: "Setting bars colour" }),
                { ...COLOR_FIELD("settings_fill_color"), label: "Setting bars fill colour" },
                TEXT_FIELD("setting", "Setting value text"),
                ICON_FIELD("setting", "Setting icons"),
                ICON_FIELD("steps", "− / + icons"),
              )
            : []),
          ...(!c.options?.length ? [] : part(
            "Choices",
            grid({ ...select("options_glass", [["", "Default"], ...MATERIALS]), label: "Choices material" }, { ...COLOR_FIELD("options_color"), label: "Choices colour" }),
            TEXT_FIELD("option_name", "Choice name text"),
            TEXT_FIELD("option", "Choice value text"),
            ICON_FIELD("option", "Choice icons"),
            ICON_FIELD("chevron", "Chevron icon"),
            TEXT_FIELD("menu", "Menu text", true),
          )),
          ...part("Rooms", grid({ ...select("rooms_glass", [["", "Default"], ...MATERIALS]), label: "Room pills material" }, { ...COLOR_FIELD("rooms_color"), label: "Room pills colour" })),
          ...part("Rooms", grid({ ...select("picked_glass", [["", "Default"], ...MATERIALS]), label: "Picked pill material" }, { ...COLOR_FIELD("picked_color"), label: "Picked pill colour" })),
          ...part("Rooms", TEXT_FIELD("room", "Room pill text", true), ICON_FIELD("room", "Robot icon in a pill")),
          ...part("Button", grid({ ...select("button_glass", [["", "Default"], ...MATERIALS]), label: "Clean button material" }, { ...COLOR_FIELD("button_color"), label: "Clean button colour" })),
          ...part("Button", TEXT_FIELD("button", "Button text"), ICON_FIELD("button", "Button icon")),
        ],
      },
      { custom: "section", key: "advanced", title: "Advanced", schema: [{ name: "service", selector: { text: {} } }, { ...GLASS_FIELD, group: "Card" }] },
    ];
  },
};

export const thermostatSpec: EditorSpec = {
  parts: THERMOSTAT_PARTS,
  defaults: { hours: 24, graph: true, active_color: "orange", controls: "bottom", show_name: true },
  form: (c) => [
    {
      custom: "section",
      key: "thermostat",
      title: "Thermostat",
      open: true,
      schema: [
        { name: "entity", selector: { entity: { domain: ["climate", "sensor"] } } },
        { name: "temperature_entity", selector: { entity: { domain: "sensor" } } },
        grid({ name: "name", selector: { text: {} } }, { name: "icon", selector: { icon: {} } }),
        { name: "show_name", selector: { boolean: {} } },
      ],
    },
    {
      custom: "section",
      key: "layout",
      title: "Layout",
      open: true,
      schema: [
        grid(
          {
            ...select("controls", [
              ["bottom", "Controls under the graph"],
              ["top", "Controls above the graph"],
            ]),
            label: "Controls",
          },
          { name: "compact", selector: { boolean: {} } },
        ),
        ...(String(c.entity ?? "").startsWith("sensor.")
          ? [{ name: "inline_value", label: "Value on the name's line", helper: "A sensor: no icon, the graph right under the name", selector: { boolean: {} } }]
          : []),
        { name: "min_max", selector: { number: { min: 1, max: 168, mode: "box", unit_of_measurement: "h" } } },
      ],
    },
    {
      custom: "section",
      key: "graph",
      title: "Graph",
      open: c.graph !== false,
      schema: [
        grid(
          { name: "graph", selector: { boolean: {} } },
          { name: "hours", selector: { number: { min: 1, max: 168, mode: "box", unit_of_measurement: "h" } } },
        ),
        ...(c.graph === false
          ? []
          : [
              { name: "graph_entities", selector: { entity: { multiple: true } } },
              grid(
                { name: "min_range", selector: { number: { min: 0, max: 20, step: 0.5, mode: "box" } } },
                { name: "smoothing", selector: { number: { min: 0, max: 12, mode: "box" } } },
              ),
              ...part("Graph", { ...COLOR_FIELD("graph_color"), label: "Graph colour" }),
            ]),
      ],
    },
    {
      custom: "section",
      key: "colours",
      title: "Value and heating",
      schema: [
        { name: "precision", label: "Decimal places", selector: { number: { min: 0, max: 2, mode: "box" } } },
        { custom: "hint", text: "When the tile counts as heating (icon lit and glowing) – empty: as the thermostat says. Its colour is in Appearance." },
        YAML("active"),
        ...part("Icon", { ...COLOR_FIELD("active_color"), label: "Colour when heating" }),
      ],
    },
    {
      custom: "section",
      key: "look",
      title: "Look",
      schema: [
        GLASS_FIELD,
        ...part("Bar", grid({ ...select("pill_glass", [["", "Default"], ...MATERIALS]), label: "Bar (pill) material" }, { ...COLOR_FIELD("pill_color"), label: "Bar colour" })),
        ...part("Icon", grid({ ...select("icon_glass", [["", "Default"], ...MATERIALS]), label: "Icon material when off" }, { ...select("icon_on_glass", [["", "Default"], ...MATERIALS]), label: "Icon material when on" })),
        ...part("Icon", { ...COLOR_FIELD("icon_background"), label: "Icon background" }),
        ...part("− / + buttons", grid({ ...select("buttons_glass", [["", "Default"], ...MATERIALS]), label: "− / + buttons material" }, { ...COLOR_FIELD("buttons_color"), label: "Buttons colour" })),
      ],
    },
    { custom: "section", key: "actions", title: "Actions", schema: actionFields(c, ["tap_action", "hold_action", "double_tap_action"]) },
    { custom: "section", key: "advanced", title: "Advanced", schema: [CONTROL_GLASS_FIELD, YAML("styles")] },
  ],
};

export const lightSpec: EditorSpec = {
  parts: LIGHT_PARTS,
  defaults: { active_color: "yellow", show_name: true, layout: "bars", fill_style: "fade", fill_strength: 34, fill_source: "light" },
  form: (c) => [
    {
      custom: "section",
      key: "card",
      title: "Card",
      open: true,
      schema: [
        grid({ name: "name", selector: { text: {} } }, { name: "icon", selector: { icon: {} } }),
        grid(
          {
            ...select("layout", [
              ["bars", "Bars – brightness slider"],
              ["buttons", "Round buttons (switches)"],
            ]),
            label: "Look",
          },
          { name: "show_name", selector: { boolean: {} } },
        ),
      ],
    },
    {
      custom: "section",
      key: "lights",
      title: "Lights",
      open: true,
      schema: [{ custom: "list", list: "lights" }, { ...COLOR_FIELD("active_color"), label: "Colour when on", group: "Icon" }],
    },
    {
      custom: "section",
      key: "scenes",
      title: "Scenes",
      secondary: scenesOf(c) ? "" : "Optional",
      open: !!scenesOf(c),
      schema: [
        { custom: "hint", text: "Round buttons with a photo, in the drawer under a light's bar; under the whole card when not meant for one light." },
        // each light's own, then the card's
        ...(c.lights ?? []).map((l: any, i: number) => ({ custom: "list", list: "scenes", at: ["lights", i], title: l.name ?? shortId(l.entity) ?? `${i + 1}` })),
        { custom: "list", list: "scenes", title: "Under all the lights" },
      ],
    },
    {
      custom: "section",
      key: "look",
      title: "Look",
      schema: [
        ...part("Bar", grid({ ...select("pill_glass", [["", "Default"], ...MATERIALS]), label: "Bar (pill) material" }, { ...COLOR_FIELD("pill_color"), label: "Bar colour" })),
        ...part("Icon", grid({ ...select("icon_glass", [["", "Default"], ...MATERIALS]), label: "Icon material when off" }, { ...select("icon_on_glass", [["", "Default"], ...MATERIALS]), label: "Icon material when on" })),
        ...part(
          "Bar",
          grid(
            {
              ...select("fill_style", [
                ["fade", "Fading"],
                ["solid", "Solid"],
                ["glow", "Glowing towards the value"],
                ["none", "None"],
              ]),
              label: "Brightness fill",
            },
            { name: "fill_strength", label: "Fill strength (%)", selector: { number: { min: 5, max: 100, step: 1, mode: "slider" } } },
          ),
          grid(
            {
              ...select("fill_source", [
                ["light", "The light's own colour"],
                ["accent", "Colour when on"],
              ]),
              label: "Fill colour from",
            },
            { ...COLOR_FIELD("fill_color"), label: "Fill colour" },
          ),
        ),
        ...part("Icon", { ...COLOR_FIELD("icon_background"), label: "Icon background" }),
        ...part("Modes", grid({ ...select("modes_glass", [["", "Default"], ...MATERIALS]), label: "Picked mode material" }, { ...COLOR_FIELD("modes_color"), label: "Picked mode colour" })),
        ...part("Presets", grid({ ...select("presets_glass", [["", "Default"], ...MATERIALS]), label: "Picked preset material" }, { ...COLOR_FIELD("presets_color"), label: "Picked preset colour" })),
        // scene buttons: only when it has scenes (its own or a light's)
        ...(scenesOf(c)
          ? part("Scenes", grid({ ...select("scenes_glass", [["", "Default"], ...MATERIALS]), label: "Scene buttons material" }, { ...COLOR_FIELD("scenes_color"), label: "Scene buttons colour" }))
          : []),
        ...part("Drawer", grid({ ...select("tray_glass", [["", "Default"], ...MATERIALS]), label: "Drawer material" }, { ...COLOR_FIELD("tray_color"), label: "Drawer colour" })),
      ],
    },
    {
      custom: "section",
      key: "advanced",
      title: "Advanced",
      schema: [
        ...part("Card", { ...GLASS_FIELD, label: "Tile material" }),
        ...part("Buttons", { ...CONTROL_GLASS_FIELD, label: "Bars and buttons material" }),
        YAML("styles"),
      ],
    },
  ],
  lists: [
    {
      name: "lights",
      title: "Lights",
      label: (l) => l.name ?? shortId(l.entity) ?? "Light",
      create: () => ({ entity: "" }),
      item: (l) => [
        { name: "entity", selector: { entity: { domain: ["light", "switch", "scene"] } } },
        grid({ name: "name", selector: { text: {} } }, { name: "icon", selector: { icon: {} } }),
        { name: "presets", selector: { entity: { domain: "select" } } },
        expandable("Several lights as one", [
          { custom: "hint", text: "On while any is on; a tap switches all of them." },
          { name: "entities", selector: { entity: { domain: ["light", "switch"], multiple: true } } },
        ]),
        expandable("More", [
          { name: "off_scene", label: "Scene that switches it off", helper: "With a scene as the entity: together they act as one switch", selector: { entity: { domain: "scene" } } },
          YAML("levels"),
          YAML("preset_options"),
          ...actionFields(l, ["hold_action"]),
        ]),
      ],
    },
    {
      name: "scenes",
      title: "Scenes",
      label: (s) => s.name ?? shortId(s.entity) ?? "Scene",
      create: () => ({ entity: "" }),
      item: () => [
        { name: "entity", selector: { entity: { domain: "scene" } } },
        grid({ name: "name", selector: { text: {} } }, { name: "icon", selector: { icon: {} } }),
        { name: "image", label: "Photo", helper: "URL, e.g. /local/scenes/evening.jpg", selector: { text: {} } },
      ],
    },
  ],
};

/** How many scenes a light card has: its own and its lights'. */
function scenesOf(c: any): number {
  return (c.scenes ?? []).length + (c.lights ?? []).reduce((n: number, l: any) => n + (l.scenes ?? []).length, 0);
}

export const heatPumpSpec: EditorSpec = {
  parts: HEAT_PUMP_PARTS,
  defaults: { show_animation: true, show_modes: true, show_dhw_setpoint: true, show_settings: true },
  form: [
    {
      custom: "section",
      key: "main",
      title: "Heat pump",
      open: true,
      schema: [
        { name: "device", helper: "Its entities are found by name (Viessmann); set others below.", selector: { device: {} } },
        { name: "name", selector: { text: {} } },
      ],
    },
    {
      custom: "section",
      key: "show",
      title: "Show",
      schema: [
        grid({ name: "show_animation", label: "Animation", selector: { boolean: {} } }, { name: "show_modes", label: "Heating mode", selector: { boolean: {} } }),
        grid({ name: "show_dhw_setpoint", label: "Hot water − / +", selector: { boolean: {} } }, { name: "show_settings", label: "Settings drawer", selector: { boolean: {} } }),
      ],
    },
    {
      custom: "section",
      key: "entities",
      title: "Entities",
      secondary: "Optional",
      schema: [
        { custom: "hint", text: "Any heat pump: pick what it has. What is found on the device is used unless set here; what has no entity is left out and the rest closes up." },
        {
          type: "expandable",
          name: "entities",
          title: "Scheme",
          schema: [
            { name: "outside", label: "Outside temperature", selector: { entity: { domain: "sensor" } } },
            { name: "supply", label: "Heating supply temperature", selector: { entity: { domain: "sensor" } } },
            { name: "return", label: "Return temperature", selector: { entity: { domain: "sensor" } } },
            { name: "dhw", label: "Hot water temperature", selector: { entity: { domain: "sensor" } } },
            { name: "compressor", label: "Compressor running", selector: { entity: { domain: ["binary_sensor", "switch", "input_boolean"] } } },
            { name: "pump", label: "Circulation pump", selector: { entity: { domain: ["binary_sensor", "switch"] } } },
            { name: "frost", label: "Frost protection", selector: { entity: { domain: ["binary_sensor", "switch"] } } },
            { name: "rod", label: "Heating rod running", selector: { entity: { domain: ["binary_sensor", "switch", "sensor"] } } },
            { name: "heating_active", label: "Heating the house", selector: { entity: { domain: ["binary_sensor", "sensor", "input_boolean"] } } },
            { name: "dhw_active", label: "Heating the water", selector: { entity: { domain: ["binary_sensor", "sensor", "input_boolean"] } } },
            { name: "phase", label: "Compressor phase", selector: { entity: { domain: "sensor" } } }
          ],
            },
        {
          type: "expandable",
          name: "entities",
          title: "Controls",
          schema: [
            { name: "climate", label: "Heating (climate)", selector: { entity: { domain: "climate" } } },
            { name: "water_heater", label: "Hot water (water heater)", selector: { entity: { domain: "water_heater" } } },
            { name: "dhw_mode", label: "Hot water mode", selector: { entity: { domain: ["select", "input_select"] } } },
            { name: "curve_shift", label: "Heating curve shift", selector: { entity: { domain: ["number", "input_number"] } } },
            { name: "curve_slope", label: "Heating curve slope", selector: { entity: { domain: ["number", "input_number"] } } }
          ],
            },
        {
          type: "expandable",
          name: "entities",
          title: "Service",
          schema: [
            { name: "compressor_starts", label: "Compressor starts", selector: { entity: { domain: "sensor" } } },
            { name: "compressor_hours", label: "Compressor hours", selector: { entity: { domain: "sensor" } } },
            { name: "rod_starts", label: "Heating rod starts", selector: { entity: { domain: "sensor" } } },
            { name: "rod_hours", label: "Heating rod hours", selector: { entity: { domain: "sensor" } } },
            { name: "pressure", label: "Pressure", selector: { entity: { domain: "sensor" } } },
            { name: "flow", label: "Flow", selector: { entity: { domain: "sensor" } } }
          ],
            },
      ],
    },
    {
      custom: "section",
      key: "look",
      title: "Look",
      schema: [
        ...part("Modes", grid({ ...select("modes_glass", [["", "Default"], ...MATERIALS]), label: "Modes' track material" }, { ...COLOR_FIELD("modes_color"), label: "Track colour" })),
        ...part("Modes", grid({ ...select("active_glass", [["", "Default"], ...MATERIALS]), label: "Picked mode material" }, { ...COLOR_FIELD("active_color"), label: "Picked mode colour" })),
        ...part("− / + buttons", grid({ ...select("buttons_glass", [["", "Default"], ...MATERIALS]), label: "− / + buttons material" }, { ...COLOR_FIELD("buttons_color"), label: "Buttons colour" })),
        ...part("Diagram", grid({ ...COLOR_FIELD("outside_color"), label: "Outside node" }, { ...COLOR_FIELD("heating_color"), label: "Heating node" })),
        ...part("Diagram", grid({ ...COLOR_FIELD("dhw_color"), label: "Hot water node" }, { ...COLOR_FIELD("rod_color"), label: "Heating rod" })),
        ...part("Diagram", { ...COLOR_FIELD("idle_color"), label: "Idle nodes" }),
        GLASS_FIELD,
      ],
    },
    expandable("Advanced", [YAML("styles")]),
  ],
};

export const blindSpec: EditorSpec = {
  parts: BLIND_PARTS,
  defaults: { pause_glass: "dark", positions_glass: "none", tilts_glass: "dark", fill_style: "fade", fill_strength: 34, show_icon: true },
  form: (c) => [
    {
      custom: "section",
      key: "blind",
      title: "Blind",
      open: true,
      schema: [
        { name: "entity", selector: { entity: { domain: "cover" } } },
        grid({ name: "name", selector: { text: {} } }, { name: "icon", selector: { icon: {} } }),
        ...part("Bars", grid({ ...COLOR_FIELD("active_color"), label: "Colour when down" })),
        ...part("Pause button", { ...COLOR_FIELD("pause_color"), label: "Pause ring colour" }),
      ],
    },
    {
      custom: "section",
      key: "positions",
      title: "Positions",
      secondary: (c.positions ?? []).length ? "" : "Up and Down",
      schema: [
        { custom: "hint", text: "Quick choices under the blind: a script is run, or a position 0–100 % set. None = Up and Down." },
        { custom: "list", list: "positions" },
      ],
    },
    {
      custom: "section",
      key: "tilts",
      title: "Slats",
      secondary: c.slats === "none" ? "Hidden" : c.slats === "bar" ? "Bar only" : (c.tilts ?? []).length ? "" : "Close, Half, Open",
      schema: [
        {
          ...select("slats", [
            ["full", "Bar and quick tilts"],
            ["bar", "Bar only"],
            ["none", "Hidden"],
          ]),
          label: "Slats",
        },
        ...(c.slats === "none" || c.slats === "bar"
          ? []
          : [
              { custom: "hint", text: "Tilts of the slats in the drawer: a script, or a value 0–100 %. None = Close, Half and Open." },
              { custom: "list", list: "tilts" },
            ]),
      ],
    },
    {
      custom: "section",
      key: "pause",
      title: "Automation pause",
      secondary: c.pause ? "" : "Optional",
      schema: [
        { custom: "hint", text: "The room's automation pause: shown with the time left as a ring." },
        grid(
          { name: "pause", selector: { entity: { domain: ["switch", "input_boolean"] } } },
          { name: "pause_duration", selector: { number: { min: 60, max: 86400, mode: "box", unit_of_measurement: "s" } } },
        ),
        { name: "hide_pause", label: "Hide the pause button", selector: { boolean: {} } },
      ],
    },
    {
      custom: "section",
      key: "look",
      title: "Look",
      schema: [
        ...part("Bars", { ...CONTROL_GLASS_FIELD, label: "Material of the bars" }),
        ...part("Bars", grid({ ...select("bar_glass", [["", "Default"], ...MATERIALS]), label: "Position bar material" }, { ...COLOR_FIELD("bar_color"), label: "Position bar colour" })),
        ...part("Bars", grid({ ...select("slats_glass", [["", "Default"], ...MATERIALS]), label: "Slats bar material" }, { ...COLOR_FIELD("slats_color"), label: "Slats bar colour" })),
        ...part(
          "Bars",
          grid(
            {
              ...select("fill_style", [
                ["fade", "Fading"],
                ["solid", "Solid"],
                ["glow", "Glowing towards the value"],
                ["none", "None"],
              ]),
              label: "Fill",
            },
            { name: "fill_strength", label: "Fill strength (%)", selector: { number: { min: 5, max: 100, step: 1, mode: "slider" } } },
          ),
          { ...COLOR_FIELD("fill_color"), label: "Fill colour" },
        ),
        ...part("Icon", { name: "show_icon", label: "Show the icon on the bar", selector: { boolean: {} } }),
        ...part("Icon", grid({ ...select("icon_glass", [["", "Default"], ...MATERIALS]), label: "Icon material when up" }, { ...select("icon_on_glass", [["", "Default"], ...MATERIALS]), label: "Icon material when down" })),
        ...part("Icon", { ...COLOR_FIELD("icon_background"), label: "Icon background" }),
        ...part("Drawer", grid({ ...select("tray_glass", [["", "Default"], ...MATERIALS]), label: "Drawer material" }, { ...COLOR_FIELD("tray_color"), label: "Drawer colour" })),
        ...part("Pause button", grid({ ...select("pause_glass", MATERIAL_OPTIONS), label: "Pause button material" }, { ...COLOR_FIELD("pause_button_color"), label: "Pause button colour" })),
        ...part("Quick choices", grid({ ...select("positions_glass", MATERIAL_OPTIONS), label: "Position buttons material" }, { ...select("tilts_glass", MATERIAL_OPTIONS), label: "Tilt buttons material" })),
        ...part("Quick choices", { ...COLOR_FIELD("choices_color"), label: "Quick choice buttons' colour" }),
      ],
    },
    { custom: "section", key: "advanced", title: "Advanced", schema: [{ ...GLASS_FIELD, group: "Card" }, YAML("styles")] },
  ],
  lists: [
    { name: "positions", title: "Positions", label: (p) => p.name ?? p.icon ?? "Position", create: () => ({ name: "", value: 50 }), item: () => CHOICE },
    { name: "tilts", title: "Slats", label: (p) => p.name ?? "Tilt", create: () => ({ name: "", value: 50 }), item: () => CHOICE },
  ],
};

/** A blind's quick choice: a script to run, or a position / tilt to set. */
const CHOICE: Schema[] = [
  grid({ name: "name", selector: { text: {} } }, { name: "icon", selector: { icon: {} } }),
  { name: "script", label: "Script", helper: "Run instead of setting a value", selector: { entity: { domain: "script" } } },
  { name: "value", label: "Value", selector: { number: { min: 0, max: 100, mode: "slider", unit_of_measurement: "%" } } },
];

/** An element's own material (core/materials). */
const MATERIAL_OPTIONS: [string, string][] = MATERIALS;

/* the three cards of an automation's side panel (glass-automation, glass-sun-shading, glass-value-grid) */
const PART_LOOK = (defTitle: string) => ({
  custom: "section",
  key: "titles",
  title: "Title",
  schema: [
    grid({ name: "title", label: "Title", helper: defTitle, selector: { text: {} } }, { name: "show_title", label: "Show the title", selector: { boolean: {} } }),
  ],
});

export const automationSpec: EditorSpec = {
  parts: AUTOMATION_PARTS,
  defaults: { show_title: true, show_state: true },
  form: (c) => [
    {
      custom: "section",
      key: "main",
      title: "Automation",
      open: true,
      schema: [
        { name: "entity", label: "Automation", helper: "Or any switch / input_boolean", selector: { entity: { domain: ["automation", "switch", "input_boolean"] } } },
        grid({ name: "icon", selector: { icon: {} } }, { name: "show_state", label: "On / Off beside the switch", selector: { boolean: {} } }),
        ...part("Switch", { ...COLOR_FIELD("color"), label: "Colour when on" }),
      ],
    },
    {
      custom: "section",
      key: "look",
      title: "Look",
      schema: [{ ...select("switch_glass", [["", "Plain track"], ...MATERIAL_OPTIONS]), label: "Switch material", group: "Switch" }],
    },
    {
      custom: "section",
      key: "pause",
      title: "Switching off for a while",
      secondary: c.pause_for ? "" : "Optional",
      schema: [
        {
          custom: "hint",
          text: "Three helpers of your own: a dropdown (input_select) with how long – e.g. 1 hour, Until tomorrow, Until a time, For good – a date and time when it comes back, and a time for “until a time”. The card shows and sets them; switching back on is a small automation in HA. See the documentation: Automation cards.",
        },
        { name: "pause_for", label: "How long (input_select)", selector: { entity: { domain: "input_select" } } },
        grid(
          { name: "resume_at", label: "Comes back at (input_datetime)", selector: { entity: { domain: "input_datetime" } } },
          { name: "pause_until", label: "Time for “until” (input_datetime)", selector: { entity: { domain: "input_datetime" } } },
        ),
      ],
    },
    PART_LOOK("Empty = the automation's name"),
    { custom: "section", key: "advanced", title: "Advanced", schema: [YAML("styles")] },
  ],
};

export const sunShadingSpec: EditorSpec = {
  parts: AUTOMATION_PARTS,
  defaults: { show_title: true, show_compass: true, show_details: true, layout: "side", compass_glass: "watch", sun_style: "icon", show_letters: true, show_ticks: true, size: 124, ring_width: 9 },
  form: (c) => [
    {
      custom: "section",
      key: "main",
      title: "What it shows",
      open: true,
      schema: [
        grid({ name: "sun", label: "Sun", selector: { entity: { domain: "sun" } } }, { name: "light", label: "Light outside (lx)", selector: { entity: { domain: "sensor" } } }),
        grid(
          { name: "shading", label: "Shading decision", helper: "A sensor: open / min / mid / max", selector: { entity: {} } },
          { name: "target_tilt", label: "Target tilt", selector: { entity: {} } },
        ),
        grid({ name: "show_compass", label: "Compass", selector: { boolean: {} } }, { name: "show_details", label: "Text beside it", selector: { boolean: {} } }),
        grid({ name: "title", label: "Title", helper: "Empty = Current state", selector: { text: {} } }, { name: "show_title", label: "Show the title", selector: { boolean: {} } }),
      ],
    },
    {
      custom: "section",
      key: "azimuth",
      title: "Shading azimuth",
      secondary: c.azimuth_from !== undefined ? "" : "Optional",
      schema: [
        {
          custom: "hint",
          text: "The sun's directions (azimuth) in which it shines into the room: 90° east, 180° south, 270° west. Inside this range the automation shades fully – also with a low sun, when the light sensor alone can't be relied on. Drawn on the compass as a sector.",
        },
        grid(
          { name: "azimuth_from", label: "From (°)", selector: { number: { min: 0, max: 360, step: 1, mode: "slider", unit_of_measurement: "°" } } },
          { name: "azimuth_to", label: "To (°)", selector: { number: { min: 0, max: 360, step: 1, mode: "slider", unit_of_measurement: "°" } } },
        ),
        expandable("When the sun is high", [
          { custom: "hint", text: "A high sun only glances off the glass from the side (a roof overhang, a balcony): above this height a narrower range applies. Leave empty if not needed." },
          { name: "azimuth_high_above", label: "Above (° of height)", selector: { number: { min: 0, max: 90, mode: "slider", unit_of_measurement: "°" } } },
          grid(
            { name: "azimuth_high_from", label: "From (°)", selector: { number: { min: 0, max: 360, mode: "slider", unit_of_measurement: "°" } } },
            { name: "azimuth_high_to", label: "To (°)", selector: { number: { min: 0, max: 360, mode: "slider", unit_of_measurement: "°" } } },
          ),
        ]),
        { name: "horizon", label: "Horizon (°)", helper: "Roofs or a hill: below this height the sun counts as set", selector: { number: { min: 0, max: 30, mode: "slider", unit_of_measurement: "°" } } },
      ],
    },
    {
      custom: "section",
      key: "look",
      title: "Look",
      schema: [
        grid(
          ...part("Compass", { ...select("compass_glass", [["watch", "Watch face (glass, glare)"], ...MATERIAL_OPTIONS]), label: "Compass material" }),
          { ...select("sun_style", [["icon", "Realistic sun"], ["dot", "Dot"]]), label: "Sun" },
        ),
        grid({ name: "show_letters", label: "Cardinal points (N E S W)", selector: { boolean: {} } }, { name: "show_ticks", label: "Ticks", selector: { boolean: {} } }),
        grid(
          { ...select("layout", [["side", "Text beside the compass"], ["below", "Text under the compass"]]), label: "Layout" },
          { name: "size", label: "Compass size", selector: { number: { min: 80, max: 240, mode: "slider", unit_of_measurement: "px" } } },
        ),
        { name: "ring_width", label: "Light ring width", selector: { number: { min: 2, max: 14, mode: "slider" } } },
        ...part("Compass", grid({ ...COLOR_FIELD("band_color"), label: "Shading azimuth colour" }, { ...COLOR_FIELD("light_color"), label: "Light ring colour" })),
        ...part("Compass", { ...COLOR_FIELD("sun_color"), label: "Sun colour (dot)" }),
      ],
    },
    {
      custom: "section",
      key: "advanced",
      title: "Advanced",
      schema: [
        { custom: "hint", text: "labels: the shading states in your words, e.g. { open: No shading, max: Strong shading }. thresholds_attribute: an attribute of the shading sensor with lux per level – marks on the light ring." },
        YAML("labels"),
        { name: "thresholds_attribute", selector: { text: {} } },
        YAML("styles"),
      ],
    },
  ],
};

export const valueGridSpec: EditorSpec = {
  parts: AUTOMATION_PARTS,
  defaults: { show_title: true, show_months: true, current_glass: "dark", field_glass: "flat" },
  form: (c) => [
    {
      custom: "section",
      key: "main",
      title: "Table",
      open: true,
      schema: [
        {
          custom: "hint",
          text: "Numbers (input_number) in a table with − / + on each. Columns are modes – e.g. Strong sun and Weak sun – rows the levels (Min, Medium, Max). The current column is marked: by its months, or by a sensor's state. The automation reads the numbers itself; the card only shows and sets them. See the documentation: Automation cards.",
        },
        grid({ name: "title", label: "Title", selector: { text: {} } }, { name: "unit", label: "Unit", helper: "e.g. %", selector: { text: {} } }),
        grid({ name: "show_title", label: "Show the title", selector: { boolean: {} } }, { name: "show_months", label: "Months on the card", selector: { boolean: {} } }),
      ],
    },
    {
      custom: "section",
      key: "columns",
      title: "Columns (modes)",
      secondary: `${(c.columns ?? []).length}`,
      schema: [
        { custom: "hint", text: "Each column: its months (from – to, 1–12; over New Year works too). The column without months is the rest of the year. Months in input_numbers can be changed right on the card." },
        { custom: "list", list: "columns" },
      ],
    },
    {
      custom: "section",
      key: "rows",
      title: "Rows",
      secondary: `${(c.rows ?? []).length}`,
      schema: [{ custom: "hint", text: "Each row: its numbers, one per column in the columns' order." }, { custom: "list", list: "rows" }],
    },
    {
      custom: "section",
      key: "active",
      title: "Current column by a state",
      secondary: c.active ? "" : "Optional",
      schema: [
        { custom: "hint", text: "Instead of months: a sensor whose state says the mode (e.g. summer / winter); each column then has the state it stands for." },
        { name: "active", label: "Sensor", selector: { entity: {} } },
      ],
    },
    {
      custom: "section",
      key: "look",
      title: "Look",
      schema: [
        ...part("Fields", grid({ ...select("current_glass", MATERIAL_OPTIONS), label: "Current column's fields material" }, { ...select("field_glass", MATERIAL_OPTIONS), label: "Other fields material" })),
        ...part("Fields", grid({ ...COLOR_FIELD("active_color"), label: "Current column colour" }, { ...COLOR_FIELD("cell_color"), label: "Other fields' colour" })),
      ],
    },
    { custom: "section", key: "advanced", title: "Advanced", schema: [YAML("styles")] },
  ],
  lists: [
    {
      name: "columns",
      title: "Columns (modes)",
      label: (x) => x.name ?? "Column",
      create: () => ({ name: "" }),
      item: () => [
        grid({ name: "name", selector: { text: {} } }, { name: "icon", selector: { icon: {} } }),
        grid(
          { name: "months_from", label: "From month (input_number)", selector: { entity: { domain: ["input_number", "number"] } } },
          { name: "months_to", label: "To month (input_number)", selector: { entity: { domain: ["input_number", "number"] } } },
        ),
        grid(
          { name: "from_month", label: "Or fixed: from month", selector: { number: { min: 1, max: 12, mode: "box" } } },
          { name: "to_month", label: "to month", selector: { number: { min: 1, max: 12, mode: "box" } } },
        ),
        { name: "state", label: "State (with a sensor)", helper: "Only with “Current column by a state”", selector: { text: {} } },
      ],
    },
    {
      name: "rows",
      title: "Rows",
      label: (r) => r.name ?? "Row",
      create: () => ({ name: "", entities: [] }),
      item: () => [
        { name: "name", selector: { text: {} } },
        { name: "entities", label: "Numbers, one per column", selector: { entity: { multiple: true, domain: ["input_number", "number"] } } },
      ],
    },
  ],
};

export const dockSpec: EditorSpec = {
  noGlass: true,
  credits: [BUBBLE],
  parts: DOCK_PARTS,
  defaults: { indicator: "pill", inline: false, bare: false, scroll: false, fade: false },
  form: [
    grid(
      select("indicator", [
        ["pill", "Dark segment under the open one"],
        ["dot", "White dot under the open one"],
      ]),
      { name: "bare", selector: { boolean: {} } },
    ),
    grid({ name: "fade", selector: { boolean: {} } }, { name: "scroll", selector: { boolean: {} } }),
    grid({ name: "inline", selector: { boolean: {} } }, { name: "columns", selector: { number: { min: 1, max: 12, mode: "box" } } }),
    expandable("Advanced", [{ name: "group", label: "Page group (buttons with an id pick in it)", selector: { text: {} } }, { name: "align", selector: { text: {} } }, YAML("styles")]),
  ],
  lists: [
    {
      name: "items",
      title: "Buttons",
      label: (i) => i.name ?? i.id ?? i.link ?? i.icon ?? "Button",
      create: () => ({ icon: "mdi:circle-outline", link: "#" }),
      item: (i) => [
        grid({ name: "icon", selector: { icon: {} } }, { name: "name", selector: { text: {} } }),
        grid(POPUP_LINK("link"), { name: "home", selector: { boolean: {} } }),
        { name: "id", label: "Page id (with the dock's page group)", selector: { text: {} } },
        expandable("Actions", actionFields(i, ["tap_action"])),
      ],
    },
  ],
};

export const nowSpec: EditorSpec = {
  parts: NOW_PARTS,
  // the card hides itself while nothing is on unless told otherwise
  defaults: { hide_empty: true, density: "normal", dividers: true },
  form: (c) => {
    const lights = (c.lights ?? []).length;
    const items = (c.items ?? []).length;
    return [
      {
        custom: "section",
        key: "now-card",
        title: "Card",
        secondary: c.title ?? "",
        open: true,
        schema: [
          { name: "title", label: "Title", helper: "E.g. “Running now”; empty = no heading.", selector: { text: {} } },
          { name: "hide_empty", label: "Hide while nothing is on", helper: "Off: shows “Nothing on”.", selector: { boolean: {} } },
        ],
      },
      {
        custom: "section",
        key: "now-lights",
        title: "Lights",
        secondary: lights ? `${lights} ${t(lights === 1 ? "room" : "rooms")}` : "",
        open: true,
        schema: [
          { custom: "hint", text: "Lights that are on are counted in one row: “4 lights · Living room 2 · Bathroom”. Its button switches off one room or all." },
          { custom: "list", list: "lights" },
          grid({ name: "light_icon", label: "Icon", selector: { icon: {} } }, COLOR_FIELD("light_color")),
        ],
      },
      {
        custom: "section",
        key: "now-items",
        title: "Devices",
        secondary: items ? `${items}` : "",
        open: true,
        schema: [
          { custom: "hint", text: "One row each while it is on: players, consoles, machines – with a button to switch it off, or what a washer or robot is doing." },
          { custom: "list", list: "items" },
        ],
      },
      {
        custom: "section",
        key: "look",
        title: "Look",
        schema: [
          grid(
            { group: "Rows", ...select("density", [
              ["compact", "Compact"],
              ["normal", "Normal"],
              ["roomy", "Roomy"],
            ]), label: "Row height" },
            { group: "Rows", name: "dividers", label: "Lines between rows", selector: { boolean: {} } },
          ),
          { group: "Rows", name: "icon_size", label: "Icon circle (empty = 36)", selector: { number: { min: 24, max: 64, mode: "box", unit_of_measurement: "px" } } },
          { name: "button_size", label: "Button size (empty = 36)", selector: { number: { min: 24, max: 64, mode: "box", unit_of_measurement: "px" } } },
        ],
      },
      { custom: "section", key: "advanced", title: "Advanced", schema: [YAML("styles")] },
    ];
  },
  lists: [
    {
      name: "lights",
      title: "Lights by room",
      label: (l) => l.name ?? "Room",
      create: () => ({ name: "", entities: [] }),
      item: () => [
        grid({ name: "name", selector: { text: {} } }, { name: "icon", selector: { icon: {} } }),
        { name: "entities", label: "Lights", helper: "A light group counts its members.", selector: { entity: { multiple: true } } },
      ],
    },
    {
      name: "items",
      title: "Devices",
      label: (i) => i.name ?? shortId(i.entity) ?? "Device",
      create: () => ({ entity: "" }),
      item: (i) => {
        const type = i.type ?? "entity";
        const robot = type === "mower" || type === "vacuum";
        return [
          select("type", [
            ["entity", "On / off (switched off with the button)"],
            ["washer", "Washer or dryer"],
            ["mower", "Robot mower"],
            ["vacuum", "Robot vacuum"],
          ]),
          { name: "entity", selector: { entity: {} } },
          grid(
            { name: "name", selector: { text: {} } },
            { name: "room", helper: type === "vacuum" ? "Text, or the entity of the room it is in" : undefined, selector: { text: {} } },
          ),
          grid({ name: "icon", selector: { icon: {} } }, COLOR_FIELD("color")),
          ...(type === "entity" ? [{ name: "detail", helper: "A value after the room, e.g. a CPU load.", selector: { entity: {} } }] : []),
          ...(type === "washer" ? [{ name: "completion", helper: "Empty = found from the job state's name.", selector: { entity: {} } }] : []),
          ...(robot
            ? [grid({ name: "progress", selector: { entity: {} } }, { name: "time_left", selector: { entity: {} } }), ...(type === "mower" ? [{ name: "area", selector: { entity: {} } }] : [])]
            : []),
          ...(type === "entity"
            ? [expandable("When it counts as on and how it switches off", [YAML("active"), YAML("off_action")])]
            : []),
          expandable("Actions", actionFields(i, ["tap_action"])),
        ];
      },
    },
  ],
};

export const notificationsSpec: EditorSpec = {
  parts: NOTIFICATIONS_PARTS,
  defaults: { entity: "sensor.glass_notifications", place: "between", size: 36, snooze: 3600 },
  form: [
    { name: "entity", selector: { entity: { filter: { domain: "sensor" } } } },
    grid(
      select("place", [
        ["between", "In the row, after the status chips"],
        ["block", "A line of its own"],
        ["overlay", "Over its panel (phones)"],
      ]),
      { name: "size", selector: { number: { min: 24, max: 64, mode: "box", unit_of_measurement: "px" } } },
    ),
    { name: "snooze", selector: { number: { min: 60, max: 86400, step: 60, mode: "box", unit_of_measurement: "s" } } },
    expandable("Advanced", [YAML("styles")]),
  ],
  lists: [
    {
      name: "alerts",
      title: "Alerts shown while a condition holds",
      label: (a) => a.title ?? a.id ?? "Alert",
      create: () => ({ id: `alert_${Date.now().toString(36)}`, level: "warning", condition: { entity: "", state: "on" } }),
      item: () => [
        grid(
          { name: "id", selector: { text: {} } },
          select("level", [
            ["info", "Info"],
            ["warning", "Warning"],
            ["alert", "Alert"],
          ]),
        ),
        grid({ name: "title", selector: { text: {} } }, { name: "icon", selector: { icon: {} } }),
        { name: "message", selector: { text: {} } },
        YAML("condition"),
      ],
    },
  ],
};
