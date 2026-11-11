/// <reference types="vite/client" />

interface ViteTypeOptions {
  strictImportMetaEnv: unknown;
}

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  // Deployment identity, defined at build time by `site-defines.ts`.
  readonly SITE_APP_HOST: string;
  readonly SITE_APP_URL: string;
  readonly SITE_VAULT_HOST: string;
  readonly SITE_LEGAL_EMAIL: string;
  readonly SITE_ORG_CREATION: string;
}
