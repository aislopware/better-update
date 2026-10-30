// A Bun macro: `bun build` runs `cliServiceDefaults()` at bundle time and
// inlines the object, so the published binary points at the deployment it was
// built for (BU_* env, else `.env.deploy`) and never reads either at runtime.
// Vitest and `bun src/index.ts` evaluate the same call when the module loads.
import { cliServiceDefaults } from "@better-update/deploy-config" with { type: "macro" };

export const SERVICE_DEFAULTS = cliServiceDefaults();
