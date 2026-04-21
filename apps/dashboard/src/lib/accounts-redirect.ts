// eslint-disable-next-line eslint-js/no-restricted-syntax -- Vite build-time env; empty fallback means stay on current origin (dev convenience when accounts URL is unset).
const accountsBaseUrl: string = import.meta.env.VITE_ACCOUNTS_URL ?? "";

export const accountsUrl = (path = "/"): string => `${accountsBaseUrl}${path}`;

/**
 * Hard-navigates the browser to the Accounts SPA on its own subdomain.
 * Used when this SPA needs an unauthenticated user to sign in, and when
 * signing out — both are state transitions that must cross origins.
 */
export const redirectToAccounts = (path = "/"): void => {
  globalThis.location.assign(accountsUrl(path));
};
