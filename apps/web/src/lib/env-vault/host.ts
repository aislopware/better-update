// The env-vault unlock + CRUD UI is served only from a dedicated origin, isolated
// from the main dashboard origin so the unlock JS — which handles the raw vault
// key and the account passphrase — runs under its own CSP and never shares
// storage (the sessionStorage key cache) with the rest of the app. In production
// that origin is `updates-vault.jmango360.dev`; any `*.localhost` is also allowed
// so the flow can be exercised in local development without a second hostname.
export const VAULT_HOST = "updates-vault.jmango360.dev";

const isLocalDevHost = (hostname: string): boolean =>
  hostname === "localhost" || hostname.endsWith(".localhost");

/**
 * Whether env-vault mutations are exposed on the current origin. The `_authed`
 * route tree is client-only (`ssr: false`), so `globalThis.location` is always
 * present where this runs; the `document` guard keeps it safe if it is ever
 * imported into code that can execute during SSR.
 */
export const isVaultHost = (): boolean => {
  if (typeof document === "undefined") {
    return false;
  }
  const { hostname } = globalThis.location;
  return hostname === VAULT_HOST || isLocalDevHost(hostname);
};
