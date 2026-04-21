// eslint-disable-next-line eslint-js/no-restricted-syntax -- Vite build-time env; empty fallback means stay on current origin (dev convenience when console URL is unset).
const consoleBaseUrl: string = import.meta.env.VITE_CONSOLE_URL ?? "";

export const consoleUrl = (path = "/"): string => `${consoleBaseUrl}${path}`;

/**
 * Hard-navigates the browser to the Console SPA on its own subdomain.
 * Used after auth success and when signed-in users hit an accounts page.
 */
export const redirectToConsole = (path = "/"): void => {
  globalThis.location.assign(consoleUrl(path));
};
