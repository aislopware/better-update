import {
  SITE_APP_HOST,
  SITE_APP_URL,
  SITE_LEGAL_EMAIL,
  SITE_VAULT_HOST,
} from "./site-config.generated";

/**
 * Deployment identity baked in at build time. Values are rendered by
 * `bun run config:gen` from `.env.deploy` (or `BU_*` env), so a fork changes
 * its hostnames and contact address without touching source.
 */
export const SITE = {
  /** Dashboard host, e.g. `updates.example.com` (no scheme). */
  host: SITE_APP_HOST,
  /** Dashboard origin, e.g. `https://updates.example.com`. */
  url: SITE_APP_URL,
  /** Isolated env-vault origin host; empty when that origin is disabled. */
  vaultHost: SITE_VAULT_HOST,
  /** Contact address shown on the legal pages. */
  legalEmail: SITE_LEGAL_EMAIL,
} as const;
