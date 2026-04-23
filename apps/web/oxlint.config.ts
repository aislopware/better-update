import react from "@better-update/oxlint-config/react";
import { defineConfig } from "oxlint";

export default defineConfig({
  extends: [react],
  ignorePatterns: ["src/vite-env.d.ts"],
});
