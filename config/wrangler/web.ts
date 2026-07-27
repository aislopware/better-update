/**
 * Template for `apps/web/wrangler.jsonc`. See `config/wrangler/server.ts` for
 * the editing rules; run `bun run config:gen` to render.
 */
import type { DeployConfig } from "../../scripts/deploy-config";

export const webWranglerConfig = (config: DeployConfig): Record<string, unknown> => ({
  $schema: "./node_modules/wrangler/config-schema.json",
  name: config.webWorkerName,
  main: "@tanstack/react-start/server-entry",
  compatibility_flags: ["nodejs_compat"],
  compatibility_date: "2026-07-04",
  observability: { enabled: true },
  // Catch-all per origin: /api/* is claimed by the server worker (a more
  // specific route), everything else serves the SPA shell. The vault origin
  // renders the same app, host-gated in app code.
  ...(config.zoneId.length === 0
    ? { workers_dev: true }
    : {
        routes: [
          { pattern: `${config.appHost}/*`, zone_id: config.zoneId },
          ...(config.vaultHost.length === 0
            ? []
            : [{ pattern: `${config.vaultHost}/*`, zone_id: config.zoneId }]),
        ],
      }),
});
