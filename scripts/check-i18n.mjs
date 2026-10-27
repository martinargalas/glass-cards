// The cards ship in English: any text in another language belongs in a pack (src/i18n/<lang>.ts).
// Fails the build when code outside src/i18n has letters with diacritics outside comments.
// A line that has to match the user's own words (e.g. their dropdown's options) is marked `i18n-ok`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../src/", import.meta.url));
// letters with diacritics (not × ÷)
const FOREIGN = /[À-ÖØ-öø-ɏ]/;
const hits = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "i18n") walk(p);
    } else if (p.endsWith(".ts")) check(p);
  }
}

function check(file) {
  let block = false;
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      let code = line;
      if (block) {
        const end = code.indexOf("*/");
        if (end < 0) return;
        code = code.slice(end + 2);
        block = false;
      }
      code = code.replace(/\/\*.*?\*\//g, "");
      const open = code.indexOf("/*");
      if (open >= 0) {
        block = true;
        code = code.slice(0, open);
      }
      code = code.replace(/(^|[^:"'`])\/\/.*$/, "$1");
      if (FOREIGN.test(code) && !line.includes("i18n-ok")) hits.push(`${file.slice(ROOT.length)}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
}

walk(ROOT);
if (hits.length) {
  console.error(`check-i18n: ${hits.length} non-English text(s) outside src/i18n – move them to a language pack:\n${hits.join("\n")}`);
  process.exit(1);
}
