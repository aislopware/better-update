/**
 * The web Worker's configuration, read by `cf` and the Cloudflare Vite plugin.
 * Deployment identity is resolved at load time by `@better-update/deploy-config`
 * from `BU_*` environment variables (CI/CD), else the untracked `.env.deploy`.
 */
import { loadDeployConfig } from "@better-update/deploy-config";
import { defineConfig, triggers } from "cf/config";

import type { DeployConfig } from "@better-update/deploy-config";

// Catch-all per origin: /api/* is claimed by the server worker (a more
// specific route), everything else serves the SPA shell. The vault origin
// renders the same app, host-gated in app code.
const routes = (config: DeployConfig) => {
  if (config.zoneId.length === 0) {
    return [];
  }
  const hosts =
    config.vaultHost.length === 0 ? [config.appHost] : [config.appHost, config.vaultHost];
  return hosts.map((host) => triggers.fetch({ pattern: `${host}/*`, zone: config.zoneId }));
};

export default defineConfig(() => {
  const config = loadDeployConfig();
  return {
    accountId: config.accountId,
    worker: {
      name: config.webWorkerName,
      // The newest date the bundled workerd supports. Node.js compatibility has
      // been on by default since 2026-08-04, so it needs no flag.
      compatibilityDate: "2026-10-23",
      entrypoint: "@tanstack/react-start/server-entry",
      observability: { enabled: true, issues: { enabled: true } },
      // Same default Wrangler applied: workers.dev only when there are no routes.
      workersDev: config.zoneId.length === 0,
      triggers: routes(config),
    },
  };
});
