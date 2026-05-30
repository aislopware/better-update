import { defineConfig } from "vitest/config";

// Unit run for @better-update/bsdiff. Scoped to the colocated pure-JS shim tests
// only (src/**/*.test.ts — the BSDIFF40 magic helpers). The conformance gate
// under conformance/ is DELIBERATELY excluded: it compiles C (libbz2) + drives
// the native addon and is a dedicated `bun run test:conformance` job, never part
// of `bun run test`. See conformance/README.md.
export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.test.ts"],
    exclude: ["conformance/**", "target/**", "npm/**", "node_modules/**"],
  },
});
