import { defineConfig } from "vite";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  define: { __VERSION__: JSON.stringify(pkg.version) },
  build: {
    target: "es2021",
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: false,
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "glass-cards.js",
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
