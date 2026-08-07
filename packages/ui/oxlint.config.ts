import react from "@better-update/oxlint-config/react";
import { defineConfig } from "oxlint";

export default defineConfig({
  extends: [react],
  // src/components/ mixes generated Kumo pass-throughs with hand-written
  // compositions over them. Only the pass-throughs are excluded — a granular
  // `export *` trips `no-barrel-file` (it counts the modules behind the
  // re-export, though a bundler pulls only the one component) and `import/export`
  // (oxlint cannot follow Kumo's `.d.ts` re-export chain). Every hand-written
  // neighbour is negated back in, so it stays under type-aware lint; add new
  // ones here.
  ignorePatterns: [
    "src/components/*.tsx",
    "!src/components/avatar.tsx",
    "!src/components/card.tsx",
    "!src/components/date-range-picker.tsx",
    "!src/components/dialog.tsx",
    "!src/components/field.tsx",
    "!src/components/field-layout.tsx",
    "!src/components/inline-code.tsx",
    "!src/components/item.tsx",
    "!src/components/kbd.tsx",
    "!src/components/overlay-portal.tsx",
    "!src/components/separator.tsx",
    "!src/components/skeleton.tsx",
    "!src/components/table.tsx",
    "!src/components/toast.tsx",
  ],
});
