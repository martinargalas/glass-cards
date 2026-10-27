import { always, glyph, icon, text, type PartDef } from "./parts";

/**
 * Each card's texts and icons for its Appearance (see core/parts): the card sets them as
 * `static parts`, its editor spec builds the fields from the same list (PARTS_LOOK).
 * `on` = the part in its active / picked / on state (`fonts.<key>_on`, `icons.<key>_on`).
 */

const BTN_ICON = ".btn ha-icon, .btn ha-state-icon";
const on = (scope: string) => `${scope} .btn ha-icon, ${scope} .btn ha-state-icon`;

export const LIGHT_PARTS: PartDef[] = [
  text("name", ".name", "Room name", "Room"),
  icon("room_icon", ".ricon", "Room icon", "Room"),
  text("light", ".lname", "Light name", "Bars", ".lbar.on .lname"),
  text("state", ".lstate", "Light state", "Bars", ".lbar.on .lstate"),
  text("label", ".slabel", "Button label", "Bars", ".bitem:has(.btn[aria-pressed='true']) .slabel"),
  icon("icon", BTN_ICON, "Icon", "Icon", `${on(".lbar.on")}, .btn[aria-pressed='true'] ha-icon, .btn[aria-pressed='true'] ha-state-icon`),
  icon("modes", ".mode ha-icon", "Mode icons", "Modes", ".mode.cur ha-icon"),
  icon("presets", ".segb ha-icon", "Preset icons", "Presets", ".segb.cur ha-icon"),
  icon("scenes", ".sbtn ha-icon", "Scene icons", "Scenes", ".sbtn.cur ha-icon"),
];

export const BLIND_PARTS: PartDef[] = [
  text("name", ".name", "Room name", "Room"),
  text("sub", ".sub", "Room subtitle", "Room"),
  icon("room_icon", ".ricon", "Room icon", "Room"),
  text("position", ".bar.lbar .blabel", "Position text", "Bars", ".bar.lbar.on .blabel"),
  text("slats", ".bar.thin .blabel, .bval", "Slats text", "Bars"),
  icon("glyph", ".bicon", "Bar glyphs", "Bars"),
  glyph("icon", ".btn svg.glyph", "Icon", "Icon", ".bar.lbar.on .btn svg.glyph"),
  icon("positions", ".mode ha-icon", "Position button icons", "Quick choices"),
  glyph("tilts", ".round.side svg.glyph", "Tilt button icons", "Quick choices", ".round.side.cur svg.glyph"),
  icon("pause", ".round.pause ha-icon", "Pause icon", "Pause button"),
];

export const THERMOSTAT_PARTS: PartDef[] = [
  text("name", ".name", "Name", "Text"),
  text("value", ".val, .val small", "Temperature", "Text"),
  text("hilo", ".hilo", "Min / max", "Text"),
  text("inline", ".ival, .ival small", "Value on the name's line", "Text"),
  text("setpoint", ".sp", "Setpoint", "− / + buttons"),
  icon("icon", BTN_ICON, "Icon", "Icon", on(".frame.on")),
  icon("steps", ".set ha-icon", "− / + icons", "− / + buttons"),
];

export const ROOM_PARTS: PartDef[] = [
  text("name", ".name", "Name", "Text"),
  text("info", ".info", "Info line", "Text"),
  text("badge", ".badge", "Badges", "Text"),
  text("label", ".label", "Button labels", "Text"),
  text("tile_name", ".tile .nm", "Tile name", "Text", ".tile.lit .nm"),
  text("tile_state", ".tile .st, .txt.stack .st", "Tile state", "Text", ".tile.lit .st"),
  // the room icon: above the buttons, or in place of the photo on a tile without one
  icon("icon", ".room-icon, .pic.none ha-icon", "Room icon", "Icons"),
  icon("info", ".info ha-icon", "Info icons", "Icons"),
  icon("badge", ".badge ha-icon", "Badge icons", "Icons"),
  icon("buttons", BTN_ICON, "Button icons", "Icons", ".btn.active ha-icon, .btn.active ha-state-icon, .btn.mat.on ha-icon, .btn.mat.on ha-state-icon"),
];

export const STATUS_PARTS: PartDef[] = [
  text("chip", ".chip", "Chip text", "Text", ".chip.active"),
  text("name", ".primary", "Pill name", "Text"),
  text("value", ".secondary", "Pill value", "Text"),
  text("detail", ".detail", "Attribute on the right", "Text"),
  text("row", ".row", "Row text", "Text", ".row.lit"),
  text("figure_name", ".fname", "Figure name", "Text"),
  text("figure", ".fval", "Figure value", "Text"),
  text("figure_sub", ".fsub", "Figure note", "Text"),
  always(text("menu", ".menu button", "Menu text", "Text", ".menu button.cur")),
  icon("chip", ".chip ha-icon", "Chip icons", "Icons", ".chip.active ha-icon"),
  icon("icon", ".ico ha-icon", "Pill icons", "Icons", ".ico.on ha-icon, .ico.active ha-icon"),
  icon("row", ".row ha-icon", "Row icons", "Icons", ".row.lit ha-icon"),
];

export const HEAT_PUMP_PARTS: PartDef[] = [
  text("title", ".title", "Title", "Text"),
  text("node", ".nval", "Node values", "Text"),
  text("chip", ".chip", "Chips", "Text"),
  text("label", ".lbl, .gtitle", "Labels", "Text"),
  text("setpoint", ".sp", "Setpoint", "Text"),
  text("mode", ".segb", "Mode buttons", "Text", ".segb.cur"),
  text("summary", ".sum, .svc", "Summary", "Text"),
  icon("node", ".node ha-icon", "Node icons", "Icons", ".node.lit ha-icon"),
  icon("chip", ".chip ha-icon", "Chip icons", "Icons"),
  icon("label", ".lbl ha-icon, .gtitle ha-icon", "Label icons", "Icons"),
  icon("steps", ".set ha-icon", "− / + icons", "Icons"),
  icon("mode", ".segb ha-icon", "Mode icons", "Icons", ".segb.cur ha-icon"),
  icon("summary", ".sum ha-icon", "Summary icons", "Icons"),
];

export const AUTOMATION_PARTS: PartDef[] = [
  text("title", ".gtitle", "Title", "Text"),
  text("label", ".lbl", "Labels", "Text"),
  text("setpoint", ".sp", "Values", "Text"),
  text("hint", ".hint, .pnote", "Notes", "Text"),
  text("pause", ".pbtn, .ptime", "Pause", "Text"),
  always(text("menu", ".pmenu button", "Menu text", "Text", ".pmenu button.cur")),
  text("sky", ".skytext, .skytext .v2, .dec", "Sun", "Text"),
  text("head", ".head", "Column heads", "Text", ".head.cur"),
  text("level", ".lvl, .dash", "Values in the grid", "Text"),
  icon("label", ".lbl ha-icon, .head ha-icon", "Label icons", "Icons"),
  icon("steps", ".set ha-icon", "− / + icons", "Icons"),
  icon("pause", ".pbtn ha-icon, .pmenu ha-icon", "Pause icons", "Icons"),
];

export const DOCK_PARTS: PartDef[] = [icon("icon", ".btn ha-icon", "Icons", "Icons", ".btn.on ha-icon")];

export const NOW_PARTS: PartDef[] = [
  text("title", ".title", "Title", "Text"),
  text("what", ".a", "What runs", "Text"),
  text("detail", ".b", "Detail", "Text"),
  always(text("empty", ".empty", "Nothing running", "Text")),
  icon("icon", ".ic", "Icons", "Icons"),
  icon("button", ".end ha-icon, .end", "Button icons", "Icons"),
];

/** shown only while there are notifications: always offered */
export const NOTIFICATIONS_PARTS: PartDef[] = [
  text("title", ".title", "Title", "Text"),
  text("message", ".msg", "Message", "Text"),
  text("more", ".more", "More", "Text"),
  text("ago", ".ago", "Time", "Text"),
  icon("level", ".lvl", "Level icons", "Icons"),
  icon("close", ".x ha-icon", "Close icon", "Icons"),
].map(always);

export const PEOPLE_PARTS: PartDef[] = [
  text("name", ".name", "Name", "Text"),
  text("info", ".info, .loc", "Place", "Text"),
  text("initials", ".initials", "Initials", "Text"),
  icon("battery", ".battery ha-icon", "Battery icon", "Icons"),
  icon("badge", ".badge ha-icon", "Badge icon", "Icons"),
];

export const PERIOD_PARTS: PartDef[] = [
  text("label", ".label", "Period", "Text"),
  text("now", ".now", "Now button", "Text", ".now.on"),
  text("drop", ".drop span", "Period picker", "Text", ".drop.open span"),
  always(text("menu", ".menu button", "Menu text", "Text", ".menu button.cur")),
  icon("arrows", "ha-icon", "Icons", "Icons"),
  icon("now", ".now-icon", "Now icon", "Icons"),
  always(icon("menu", ".menu ha-icon", "Menu icons", "Icons")),
];

export const CALENDAR_PARTS: PartDef[] = [
  text("title", ".title", "Title", "Text"),
  text("day", ".label", "Day", "Text"),
  text("event", ".ev", "Event", "Text"),
  text("time", ".ev .time", "Event time", "Text"),
  text("place", ".loc", "Place", "Text"),
  text("more", ".more, .empty", "Notes", "Text"),
];

export const CLOCK_WEATHER_PARTS: PartDef[] = [
  text("time", ".time, .ampm", "Time", "Clock"),
  text("date", ".date", "Date under the time", "Clock"),
  text("temperature", ".temp, .c-temp", "Temperature", "Text"),
  text("condition", ".cond, .c-cond, .forecast-text", "Condition", "Text"),
  text("details", ".details span, .details small", "Details (humidity, wind…)", "Details"),
  text("forecast_time", ".when", "Forecast time", "Forecast"),
  text("forecast", ".forecast-cols .t, .forecast .t", "Forecast temperature", "Forecast"),
  text("hilo", ".hilo", "Min / max", "Text"),
  text("precip", ".precip, .rain", "Precipitation", "Text"),
  icon("weather", ".big-icon ha-icon.mdi, .c-icon ha-icon.mdi, .line-icon ha-icon", "Weather icon (MDI)", "Icons"),
  icon("forecast", ".mini-icon ha-icon.mdi", "Forecast icons (MDI)", "Icons"),
  icon("details", ".details ha-icon:not(.arrow)", "Details icons", "Details"),
];

export const DATE_HEADER_PARTS: PartDef[] = [
  text("title", ".title", "Date", "Text"),
  text("lines", ".line, .line span", "Lines (name day…)", "Text"),
  icon("lines", "ha-icon", "Line icons", "Icons"),
];

export const AIR_QUALITY_PARTS: PartDef[] = [
  text("title", ".title", "Title", "Text"),
  text("name", ".name", "Name", "Text"),
  text("index", ".big", "Index", "Text"),
  text("label", ".label", "Pollutant name", "Text"),
  text("value", ".val", "Pollutant value", "Text"),
  text("level", ".lvl", "Level", "Text"),
];

/** the map and its controls show once the frames are loaded: always offered */
export const RADAR_PARTS: PartDef[] = [
  text("title", ".title", "Title", "Text"),
  always(text("time", ".time", "Time", "Text")),
  always(text("tab", ".styles button", "Tab text", "Text", ".styles button.on")),
  always(icon("zoom", ".zoom button", "Zoom icons", "Icons")),
  always(icon("play", ".play", "Play icon", "Icons")),
];

export const PANEL_PARTS: PartDef[] = [text("title", ".title", "Title", "Text"), icon("title", ".title ha-icon", "Title icon", "Icons")];

export const DIVIDER_PARTS: PartDef[] = [text("head", ".head", "Heading", "Text"), icon("head", ".head ha-icon", "Heading icon", "Icons")];

export const POPUP_HEADER_PARTS: PartDef[] = [
  text("name", ".name", "Name", "Bar"),
  icon("icon", ".ico ha-icon", "Icon", "Icon"),
  text("buttons", ".act", "Button text", "Buttons", ".act:not(.off)"),
  icon("buttons", ".act ha-icon", "Button icons", "Buttons", ".act:not(.off) ha-icon"),
  icon("close", ".close ha-icon", "Close icon", "Close button"),
];

/** inside apexcharts' shadow root (glass-chart), where the editor doesn't look: always offered;
 *  SVG labels take their colour from `color` */
export const CHART_PARTS: PartDef[] = [
  text("axis", ".apexcharts-yaxis-label", "Value labels", "Text"),
  text("time", ".apexcharts-xaxis-label", "Time labels", "Text"),
  text("tooltip", ".apexcharts-tooltip, .apexcharts-tooltip-title", "Tooltip", "Text"),
].map(always);
