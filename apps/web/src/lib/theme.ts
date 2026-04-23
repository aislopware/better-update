export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_COOKIE_NAME = "theme";

export const VALID_THEMES = new Set<string>(["light", "dark", "system"]);

export const isValidTheme = (value: string): value is Theme => VALID_THEMES.has(value);

/** Client-only — parses `document.cookie` for the theme value. */
export const getThemeFromCookie = (): Theme => {
  const match = /(?:^|;\s*)theme=([\w]+)/.exec(document.cookie);
  const value = match?.[1];
  return value !== undefined && isValidTheme(value) ? value : "system";
};

export const setThemeCookie = (theme: Theme): void => {
  // eslint-disable-next-line unicorn/no-document-cookie -- synchronous write needed; Cookie Store API is async
  document.cookie = `${THEME_COOKIE_NAME}=${theme}; path=/; max-age=31536000; SameSite=Lax`;
};

export const getSystemPreference = (): ResolvedTheme =>
  globalThis.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

export const resolveTheme = (theme: Theme, systemIsDark?: boolean): ResolvedTheme => {
  if (theme !== "system") {
    return theme;
  }
  return (systemIsDark ?? getSystemPreference() === "dark") ? "dark" : "light";
};

export const applyTheme = (resolved: ResolvedTheme): void => {
  document.documentElement.classList.toggle("dark", resolved === "dark");
};

export const THEME_INIT_SCRIPT = `(function(){var c=document.cookie.match(/(?:^|;\\s*)theme=([\\w]+)/);var t=c&&c[1];var d=document.documentElement;if(t==="dark"||(!t||t==="system")&&matchMedia("(prefers-color-scheme:dark)").matches){d.classList.add("dark")}else{d.classList.remove("dark")}})();`;
