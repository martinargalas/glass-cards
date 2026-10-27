// Fills every card page's option table (docs/cards/<card>.md, between
// <!-- options --> and <!-- /options -->) from the card's config interface and its
// comments in src/cards – so the reference never drifts from the code.
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import ts from "typescript";

const SRC = new URL("../src/cards/", import.meta.url);
const DOCS = new URL("../docs/cards/", import.meta.url);
// options every card has (BaseCardConfig) or that only the editor writes
const SKIP = new Set(["type", "view_layout", "dark", "visible_on", "responsive", "visibility", "styles", "fonts", "icons"]);

const clean = (s) => s.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();

// the editor's own wording of a field – a fallback for options without a comment in the card:
// the card's own spec in specs.ts (`name: "x", label: "…", helper: "…"`), then editor.ts LABELS
const specsText = readFileSync(new URL("../src/editor/specs.ts", import.meta.url), "utf8");
const specBlocks = new Map();
{
  const starts = [...specsText.matchAll(/export const (\w+): EditorSpec/g)];
  starts.forEach((m, i) => specBlocks.set(m[1], specsText.slice(m.index, starts[i + 1]?.index ?? specsText.length)));
}
const fieldTexts = (block) => {
  const out = new Map();
  for (const m of block.matchAll(/name: "([a-z_]+)", label: "([^"]+)"(?:, helper: "([^"]+)")?/g)) if (!out.has(m[1])) out.set(m[1], m[3] ? `${m[2]} – ${m[3]}` : m[2]);
  return out;
};
const generic = new Map();
{
  const editor = readFileSync(new URL("../src/editor/editor.ts", import.meta.url), "utf8");
  const labels = editor.slice(editor.indexOf("const LABELS"), editor.indexOf("};", editor.indexOf("const LABELS")));
  for (const m of labels.matchAll(/^\s+"?([a-z_]+)"?: "([^"]+)",/gm)) generic.set(m[1], m[2]);
}
const PARTS = { pill: "bar", icon_on: "icon while on", tray: "drawer under a bar", modes: "picked mode", presets: "picked preset", scenes: "scene buttons", buttons: "buttons", bar: "bar", tile: "tiles", tiles: "tiles", hero: "main tile", icon: "icon", picked: "picked one", current: "current one", active: "active one", tab: "picked tab", tabs: "tab bar", slats: "slats bar", control: "controls", switch: "switch" };
const partName = (k) => PARTS[k] ?? k.replace(/_/g, " ");
/** A material / colour option without words of its own: say which part it is for. */
function lookText(name) {
  let m = name.match(/^(.+)_glass$/);
  if (m) return `Material of the ${partName(m[1])} – see [Materials](../appearance.md#materials).`;
  m = name.match(/^(.+)_color$/);
  if (m) return `Colour of the ${partName(m[1])} (a tint of its material).`;
  if (name === "glass") return "The card's own material – see [Materials](../appearance.md#materials).";
  return "";
}
const isLook = (n) => /_(glass|color|background|tint)$/.test(n) || /^fill_/.test(n) || ["glass", "glass_tint", "button_size"].includes(n);

function cardsIn(file) {
  const text = readFileSync(new URL(file, SRC), "utf8");
  const specNames = [...(text.match(/import \{([^}]+)\} from "\.\.\/editor\/specs"/)?.[1] ?? "").matchAll(/(\w+Spec)\b/g)].map((m) => m[1]);
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const ifaces = new Map();
  const classes = new Map(); // class name → config interface
  const cards = []; // [tag, class]
  const visit = (n) => {
    if (ts.isInterfaceDeclaration(n)) ifaces.set(n.name.text, n);
    if (ts.isClassDeclaration(n) && n.name) {
      const ext = n.heritageClauses?.flatMap((h) => h.types).find((t) => t.expression.getText(sf) === "GlassElement");
      const arg = ext?.typeArguments?.[0]?.getText(sf);
      if (arg) classes.set(n.name.text, arg);
    }
    if (ts.isCallExpression(n) && n.expression.getText(sf) === "registerCard") {
      const [tag, cls] = n.arguments;
      if (tag && ts.isStringLiteral(tag) && cls) cards.push([tag.text, cls.getText(sf)]);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  const members = (name, seen = new Set()) => {
    const i = ifaces.get(name);
    if (!i || seen.has(name)) return [];
    seen.add(name);
    const own = i.members.filter(ts.isPropertySignature).map((m) => {
      const doc = ts.getJSDocCommentsAndTags(m).map((d) => (typeof d.comment === "string" ? d.comment : "")).join(" ");
      // a trailing // comment on the line before counts too
      const lead = ts.getLeadingCommentRanges(text, m.getFullStart()) ?? [];
      const line = lead.map((r) => text.slice(r.pos, r.end)).filter((c) => c.startsWith("//")).map((c) => c.slice(2)).join(" ");
      return { name: m.name.getText(sf), optional: !!m.questionToken, type: m.type?.getText(sf) ?? "", doc: clean(doc || line) };
    });
    const inherited = (i.heritageClauses ?? []).flatMap((h) => h.types.map((t) => t.expression.getText(sf))).flatMap((n) => members(n, seen));
    return [...own, ...inherited];
  };
  // the spec whose name matches the card best (glass-room-card → roomCardSpec), else the file's first
  const specFor = (tag) => {
    const want = tag.replace(/^glass-/, "").replace(/-(\w)/g, (_, c) => c.toUpperCase()).toLowerCase();
    return specNames.find((n) => n.toLowerCase().startsWith(want)) ?? specNames[0];
  };
  return cards.map(([tag, cls]) => ({ tag, options: members(classes.get(cls) ?? ""), texts: fieldTexts(specBlocks.get(specFor(tag)) ?? "") }));
}

const prettyType = (t) =>
  clean(
    t
      .replace(/\bMaterial\b/g, "material")
      .replace(/\bActionConfig\b/g, "action")
      .replace(/\bCondition\b/g, "condition")
      .replace(/Record<string, (\w+)>/g, "map of $1")
      .replace(/\(string \| \{ entity: string \}\)\[\]/g, "entity list"),
  );

let filled = 0;
for (const file of readdirSync(SRC).filter((f) => f.endsWith(".ts"))) {
  for (const { tag, options, texts } of cardsIn(file)) {
    const page = new URL(`${tag.replace(/^glass-/, "")}.md`, DOCS);
    if (!existsSync(page)) continue;
    const row = (o) => `| \`${o.name}\`${o.optional ? "" : " **required**"} | ${prettyType(o.type)} | ${o.doc || texts.get(o.name) || generic.get(o.name) || lookText(o.name)} |`;
    const head = ["| Option | Type | What it does |", "| --- | --- | --- |"];
    const list = options.filter((o) => !SKIP.has(o.name));
    const main = list.filter((o) => !isLook(o.name)).map(row);
    const look = list.filter((o) => isLook(o.name)).map(row);
    const table = [
      main.length ? [...head, ...main].join("\n") : "_This card has no options of its own._",
      look.length ? ["", "#### Look", "", "Materials and colours of the card's parts – set them in the card's **Appearance** tab, or here.", "", ...head, ...look].join("\n") : "",
    ].join("\n");
    const md = readFileSync(page, "utf8");
    const next = md.replace(/<!-- options -->[\s\S]*?<!-- \/options -->/, `<!-- options -->\n${table}\n<!-- /options -->`);
    if (next !== md) writeFileSync(page, next);
    filled++;
  }
}
console.log(`docs: option tables in ${filled} card pages`);
