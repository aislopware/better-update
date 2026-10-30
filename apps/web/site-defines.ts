import { loadDeployConfig } from "@better-update/deploy-config";

/**
 * The deployment identity the web app bakes in at build time, as Vite
 * `define` entries for `import.meta.env.SITE_*` (typed in `src/vite-env.d.ts`,
 * read through `src/lib/site-config.ts`). Shared by `vite.config.ts` and
 * `vitest.config.ts` so tests see the same values a build does.
 */
export const siteDefines = (): Record<string, string> => {
  const config = loadDeployConfig();
  return {
    "import.meta.env.SITE_APP_HOST": JSON.stringify(config.appHost),
    "import.meta.env.SITE_APP_URL": JSON.stringify(config.appUrl),
    // Empty when the isolated env-vault origin is disabled — `isVaultHost()`
    // then matches local development hosts only.
    "import.meta.env.SITE_VAULT_HOST": JSON.stringify(config.vaultHost),
    "import.meta.env.SITE_LEGAL_EMAIL": JSON.stringify(config.legalEmail),
  };
};
