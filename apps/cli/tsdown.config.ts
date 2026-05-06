import { defineConfig } from "tsdown";

export default defineConfig({
  entry: "src/index.ts",
  outDir: "dist",
  format: "esm",
  platform: "node",
  target: "node22",
  shims: true,
  clean: true,
  sourcemap: true,
  minify: false,
  dts: false,
  noExternal: [/^@better-update\//u],
});
