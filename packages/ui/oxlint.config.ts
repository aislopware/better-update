import react from "@better-update/oxlint-config/react";
import { defineConfig } from "oxlint";

export default defineConfig({
  extends: [react],
  // src/components/ is generated: the Kumo pass-throughs come from
  // scripts/gen-kumo-passthrough.ts, and src/components/ui/ is the shadcn
  // (base-nova) surface still being retired. use-mobile.ts ships with the
  // generated sidebar. Only hand-maintained code is linted.
  ignorePatterns: ["src/components/", "src/hooks/use-mobile.ts"],
});
