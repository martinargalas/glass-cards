import { defineConfig } from "vite";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

// The web site's live demo: `npm run web` (dev) / `npm run build:web` → dist-web/
// (copied to the site under /glass/demo/). Relative paths: it runs from any folder.
export default defineConfig({
  root: __dirname,
  base: "./",
  publicDir: false,
  define: { __VERSION__: JSON.stringify(pkg.version) },
  server: { port: 5174, fs: { allow: [".."] } },
  build: { outDir: "../dist-web", emptyOutDir: true, target: "es2021" },
});
