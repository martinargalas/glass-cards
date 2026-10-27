// Writes dist/version.json with a content hash; the loader uses it for cache busting.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const js = readFileSync(new URL("../dist/glass-cards.js", import.meta.url));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const hash = createHash("sha256").update(js).digest("hex").slice(0, 10);
writeFileSync(new URL("../dist/version.json", import.meta.url), JSON.stringify({ version: pkg.version, hash }) + "\n");
console.log(`glass-cards ${pkg.version} (${hash}), ${(js.length / 1024).toFixed(1)} kB`);
