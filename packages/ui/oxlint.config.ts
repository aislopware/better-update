import react from "@better-update/oxlint-config/react";
import { defineConfig } from "oxlint";

export default defineConfig({
  extends: [react],
  // src/components/ is shadcn-generated (base-nova) and gets clobbered by
  // `bunx shadcn add`; use-mobile.ts ships with the generated sidebar component
  // and is only consumed by it. Only hand-maintained code is linted.
  ignorePatterns: ["src/components/", "src/hooks/use-mobile.ts"],
});
