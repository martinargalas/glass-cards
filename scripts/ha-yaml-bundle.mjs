// Resolves Home Assistant YAML (!include, !include_dir_*, !secret) into plain JSON.
// Storage-mode dashboards can't use !include; this turns a YAML-mode dashboard
// (or part of it) into something that can be pasted / saved there.
//
//   node scripts/ha-yaml-bundle.mjs <config_dir> <file.yaml>   → JSON on stdout
//
// `/config/...` paths are mapped to <config_dir>. !secret resolves to null
// (dashboards never need secrets.yaml). Duplicate keys are allowed, last one wins, like HA.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve, isAbsolute } from "node:path";
import { parse } from "yaml";

export function loadHaYaml(configDir, file) {
  const mapPath = (p, base) => {
    if (p.startsWith("/config/")) return join(configDir, p.slice("/config/".length));
    return isAbsolute(p) ? p : resolve(base, p);
  };
  const yamlFiles = (dir) =>
    readdirSync(dir)
      .sort()
      .flatMap((n) => {
        const full = join(dir, n);
        if (n.startsWith(".")) return [];
        if (statSync(full).isDirectory()) return yamlFiles(full);
        return /\.ya?ml$/.test(n) ? [full] : [];
      });

  const load = (path) => {
    const base = dirname(path);
    const tag = (name, fn) => ({ tag: name, resolve: (str) => fn(mapPath(String(str).trim(), base)) });
    const customTags = [
      tag("!include", (p) => load(p)),
      tag("!include_dir_list", (p) => yamlFiles(p).map(load)),
      tag("!include_dir_merge_list", (p) => yamlFiles(p).flatMap((f) => load(f) ?? [])),
      tag("!include_dir_named", (p) => Object.fromEntries(yamlFiles(p).map((f) => [f.split("/").pop().replace(/\.ya?ml$/, ""), load(f)]))),
      tag("!include_dir_merge_named", (p) => Object.assign({}, ...yamlFiles(p).map((f) => load(f) ?? {}))),
      { tag: "!secret", resolve: () => null },
    ];
    return parse(readFileSync(path, "utf8"), { customTags, maxAliasCount: -1, merge: true, uniqueKeys: false });
  };
  return load(resolve(file));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , configDir, file] = process.argv;
  process.stdout.write(JSON.stringify(loadHaYaml(configDir, file), null, 2));
}
