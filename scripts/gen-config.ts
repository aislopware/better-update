/**
 * Renders every deployment-specific config artifact from the resolved deploy
 * config (`.env.deploy` + `process.env` — see `scripts/deploy-config.ts`).
 *
 * Outputs are git-ignored — never edit them by hand:
 *   apps/server/wrangler.jsonc
 *   apps/web/wrangler.jsonc
 *   apps/web/src/lib/site-config.generated.ts
 *   apps/cli/src/services/service-defaults.generated.ts
 *
 * Two modes:
 *   default    — a clone with no identity configured still gets a runnable
 *                placeholder config, so install / typecheck / test / dev work
 *   `--strict` — refuses placeholders; used by every path that reaches
 *                Cloudflare (`deploy`, remote D1 migrations)
 */
import fs from "node:fs";
import path from "node:path";

import { serverWranglerConfig } from "../config/wrangler/server";
import { webWranglerConfig } from "../config/wrangler/web";
import { DeployConfigError, loadDeployConfig, placeholderKeys, REPO_ROOT } from "./deploy-config";

import type { DeployConfig } from "./deploy-config";

const strict = process.argv.includes("--strict");

const BANNER = [
  "// GENERATED FILE — do not edit.",
  "// Rendered by `bun run config:gen`; change values in `.env.deploy`",
  "// (see `.env.deploy.example`) or the template under `config/`.",
].join("\n");

/** Skips the write when content is unchanged so dev servers do not reload. */
const writeIfChanged = (file: string, content: string): boolean => {
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
  if (current === content) {
    return false;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return true;
};

const renderWrangler = (config: Record<string, unknown>): string =>
  `${BANNER}\n${JSON.stringify(config, undefined, 2)}\n`;

/**
 * `@cloudflare/vite-plugin` writes `.wrangler/deploy/config.json`, a redirect
 * that makes every later `wrangler` command read the config emitted by the LAST
 * build instead of `wrangler.jsonc`. After a config change that redirect points
 * at stale identity (old database id, old routes), so drop it — the next
 * `vite build` recreates it, and until then wrangler reads the fresh source.
 */
const dropStaleRedirect = (wranglerFile: string): void => {
  const redirect = path.join(path.dirname(wranglerFile), ".wrangler", "deploy", "config.json");
  if (fs.existsSync(redirect)) {
    fs.rmSync(redirect);
  }
};

const renderConstants = (entries: readonly (readonly [string, string])[]): string =>
  `${BANNER}\n\n${entries
    .map(([name, value]) => `export const ${name} = ${JSON.stringify(value)};`)
    .join("\n")}\n`;

const artifacts = (config: DeployConfig): readonly (readonly [string, string])[] => [
  ["apps/server/wrangler.jsonc", renderWrangler(serverWranglerConfig(config))],
  ["apps/web/wrangler.jsonc", renderWrangler(webWranglerConfig(config))],
  [
    "apps/web/src/lib/site-config.generated.ts",
    renderConstants([
      ["SITE_APP_HOST", config.appHost],
      ["SITE_APP_URL", config.appUrl],
      // Empty when the isolated env-vault origin is disabled — `isVaultHost()`
      // then matches local development hosts only.
      ["SITE_VAULT_HOST", config.vaultHost],
      ["SITE_LEGAL_EMAIL", config.legalEmail],
    ]),
  ],
  [
    "apps/cli/src/services/service-defaults.generated.ts",
    renderConstants([
      ["DEFAULT_BASE_URL", config.appUrl],
      ["DEFAULT_WEB_URL", config.appUrl],
      ["DEFAULT_ASSET_CDN_URL", config.assetCdnUrl],
    ]),
  ],
];

const main = (): void => {
  const config = loadDeployConfig({ strict });
  const placeholders = strict ? [] : placeholderKeys();
  const written = artifacts(config)
    .map(([relativePath, content]) => {
      const file = path.join(REPO_ROOT, relativePath);
      if (!writeIfChanged(file, content)) {
        return undefined;
      }
      if (relativePath.endsWith("wrangler.jsonc")) {
        dropStaleRedirect(file);
      }
      return relativePath;
    })
    .filter((entry) => entry !== undefined);

  console.log(
    written.length === 0
      ? `config:gen — up to date (${config.appHost})`
      : `config:gen — wrote ${written.length} file(s) for ${config.appHost}:\n  ${written.join("\n  ")}`,
  );

  if (placeholders.length > 0) {
    console.warn(
      `config:gen — NO deployment identity configured, using placeholders for ${placeholders.join(", ")}.\n` +
        "  Local dev and tests work; deploying does NOT. Run `cp .env.deploy.example .env.deploy` " +
        "and `bun run bootstrap` when you are ready to ship.",
    );
  }
};

try {
  main();
} catch (error) {
  if (error instanceof DeployConfigError) {
    console.error(`config:gen failed — ${error.message}`);
    process.exit(1);
  }
  throw error;
}
