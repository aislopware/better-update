export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export interface ThemeSnapshot {
  readonly theme: Theme;
  readonly resolvedTheme: ResolvedTheme;
}

export const THEME_COOKIE_NAME = "theme";
export const RESOLVED_THEME_COOKIE_NAME = "resolved-theme";

const COOKIE_MAX_AGE_SECONDS = 31_536_000;
const COOKIE_ATTRIBUTES = `path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;

const THEME_COOKIE_PATTERN = /(?:^|;\s*)theme=([\w]+)/;
const RESOLVED_THEME_COOKIE_PATTERN = /(?:^|;\s*)resolved-theme=([\w]+)/;

export const VALID_THEMES = new Set<string>(["light", "dark", "system"]);
export const VALID_RESOLVED_THEMES = new Set<string>(["light", "dark"]);

export const isValidTheme = (value: string): value is Theme => VALID_THEMES.has(value);

export const isResolvedTheme = (value: string): value is ResolvedTheme =>
  VALID_RESOLVED_THEMES.has(value);

export const getThemeFromCookieValue = (value: string | undefined): Theme =>
  value !== undefined && isValidTheme(value) ? value : "system";

export const getResolvedThemeFromCookieValue = (
  value: string | undefined,
): ResolvedTheme | undefined => (value !== undefined && isResolvedTheme(value) ? value : undefined);

export const getSystemPreference = (): ResolvedTheme =>
  globalThis.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

export const resolveTheme = (theme: Theme, systemIsDark?: boolean): ResolvedTheme => {
  if (theme !== "system") {
    return theme;
  }
  return (systemIsDark ?? getSystemPreference() === "dark") ? "dark" : "light";
};

export const getThemeFromCookieString = (cookies: string): Theme =>
  getThemeFromCookieValue(THEME_COOKIE_PATTERN.exec(cookies)?.[1]);

export const getResolvedThemeFromCookieString = (cookies: string): ResolvedTheme | undefined =>
  getResolvedThemeFromCookieValue(RESOLVED_THEME_COOKIE_PATTERN.exec(cookies)?.[1]);

/** Client-only — parses `document.cookie` for the theme value. */
export const getThemeFromCookie = (): Theme => getThemeFromCookieString(document.cookie);

/** Client-only — parses `document.cookie` for the resolved light/dark value. */
export const getResolvedThemeFromCookie = (): ResolvedTheme | undefined =>
  getResolvedThemeFromCookieString(document.cookie);

export const getThemeSnapshotFromCookie = (): ThemeSnapshot => {
  const theme = getThemeFromCookie();
  return { theme, resolvedTheme: resolveTheme(theme, getSystemPreference() === "dark") };
};

export const getServerThemeSnapshotFromCookieValues = (
  themeValue: string | undefined,
  resolvedThemeValue: string | undefined,
): ThemeSnapshot => {
  const theme = getThemeFromCookieValue(themeValue);
  const resolvedTheme =
    theme === "system" ? (getResolvedThemeFromCookieValue(resolvedThemeValue) ?? "light") : theme;
  return { theme, resolvedTheme };
};

export const setResolvedThemeCookie = (resolvedTheme: ResolvedTheme): void => {
  // eslint-disable-next-line unicorn/no-document-cookie -- synchronous write needed before the next full reload can SSR the resolved theme
  document.cookie = `${RESOLVED_THEME_COOKIE_NAME}=${resolvedTheme}; ${COOKIE_ATTRIBUTES}`;
};

export const setThemeCookie = (theme: Theme, resolvedTheme = resolveTheme(theme)): void => {
  // eslint-disable-next-line unicorn/no-document-cookie -- synchronous write needed; Cookie Store API is async
  document.cookie = `${THEME_COOKIE_NAME}=${theme}; ${COOKIE_ATTRIBUTES}`;
  setResolvedThemeCookie(resolvedTheme);
};

export const applyTheme = (resolved: ResolvedTheme): void => {
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.style.colorScheme = resolved;
};

export const THEME_INIT_SCRIPT = `(function(){var d=document.documentElement;var c=document.cookie;var m=c.match(/(?:^|;\\s*)theme=([\\w]+)/);var t=m&&m[1];var v=t==="light"||t==="dark"||t==="system";var p=matchMedia("(prefers-color-scheme:dark)").matches;var r=t==="dark"||((!v||t==="system")&&p)?"dark":"light";d.classList.toggle("dark",r==="dark");d.style.colorScheme=r;document.cookie="${RESOLVED_THEME_COOKIE_NAME}="+r+"; ${COOKIE_ATTRIBUTES}"})();`;
