/**
 * Deployment identity baked in at build time. `site-defines.ts` resolves it
 * from `BU_*` env (else `.env.deploy`) into Vite defines, so a fork changes its
 * hostnames and contact address without touching source.
 */
export const SITE = {
  /** Dashboard host, e.g. `updates.example.com` (no scheme). */
  host: import.meta.env.SITE_APP_HOST,
  /** Dashboard origin, e.g. `https://updates.example.com`. */
  url: import.meta.env.SITE_APP_URL,
  /** Isolated env-vault origin host; empty when that origin is disabled. */
  vaultHost: import.meta.env.SITE_VAULT_HOST,
  /** Contact address shown on the legal pages. */
  legalEmail: import.meta.env.SITE_LEGAL_EMAIL,
  /** Who may create an organization: `approved` or `superadmin`. */
  orgCreation: import.meta.env.SITE_ORG_CREATION,
} as const;
