import cli from "@better-update/oxlint-config/cli";
import { defineConfig } from "oxlint";

// Node tooling, not app code: it reads files and `process.env` by design.
export default defineConfig({
  extends: [cli],
});
