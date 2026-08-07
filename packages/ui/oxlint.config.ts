import react from "@better-update/oxlint-config/react";
import { defineConfig } from "oxlint";

export default defineConfig({
  extends: [react],
  // src/components/ mixes generated Kumo pass-throughs with hand-written
  // compositions over them; only the pass-throughs are excluded, so the
  // hand-written ones stay under type-aware lint. src/components/ui/ is the
  // shadcn (base-nova) surface still being retired, and use-mobile.ts ships
  // with its sidebar.
  ignorePatterns: [
    "src/components/*.tsx",
    "!src/components/card.tsx",
    "!src/components/dialog.tsx",
    "!src/components/field.tsx",
    "!src/components/field-layout.tsx",
    "!src/components/toast.tsx",
    "src/components/ui/",
    "src/hooks/use-mobile.ts",
  ],
});
