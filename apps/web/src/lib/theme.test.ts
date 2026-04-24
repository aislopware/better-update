// @vitest-environment jsdom
import {
  RESOLVED_THEME_COOKIE_NAME,
  THEME_COOKIE_NAME,
  THEME_INIT_SCRIPT,
  getResolvedThemeFromCookie,
  getServerThemeSnapshotFromCookieValues,
  getThemeFromCookie,
  resolveTheme,
  setThemeCookie,
} from "./theme";

const stubCookieJar = (initialValue = "") => {
  const cookies = new Map<string, string>();
  const writeCookie = (cookie: string) => {
    const [pair] = cookie.split(";");
    const [name, value] = pair?.split("=") ?? [];
    if (name && value !== undefined) {
      cookies.set(name.trim(), value.trim());
    }
  };
  for (const cookie of initialValue.split(";")) {
    writeCookie(cookie);
  }
  Object.defineProperty(document, "cookie", {
    set: writeCookie,
    get: () => [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; "),
    configurable: true,
  });
};

describe(resolveTheme, () => {
  it('returns "light" for light theme', () => {
    expect(resolveTheme("light")).toBe("light");
  });

  it('returns "dark" for dark theme', () => {
    expect(resolveTheme("dark")).toBe("dark");
  });

  it('returns "dark" for system when systemIsDark is true', () => {
    expect(resolveTheme("system", true)).toBe("dark");
  });

  it('returns "light" for system when systemIsDark is false', () => {
    expect(resolveTheme("system", false)).toBe("light");
  });
});

describe(getThemeFromCookie, () => {
  beforeEach(() => stubCookieJar());

  it('returns "system" when no theme cookie exists', () => {
    expect(getThemeFromCookie()).toBe("system");
  });

  it('returns "dark" when cookie is "theme=dark"', () => {
    stubCookieJar("theme=dark");
    expect(getThemeFromCookie()).toBe("dark");
  });

  it('returns "light" when cookie is "theme=light"', () => {
    stubCookieJar("theme=light");
    expect(getThemeFromCookie()).toBe("light");
  });

  it('returns "system" for invalid cookie values', () => {
    stubCookieJar("theme=invalid");
    expect(getThemeFromCookie()).toBe("system");
  });

  it("parses theme from among other cookies", () => {
    stubCookieJar("session=abc; theme=dark; other=xyz");
    expect(getThemeFromCookie()).toBe("dark");
  });
});

describe(getResolvedThemeFromCookie, () => {
  beforeEach(() => stubCookieJar());

  it("returns undefined when no resolved theme cookie exists", () => {
    expect(getResolvedThemeFromCookie()).toBeUndefined();
  });

  it("returns the persisted resolved theme", () => {
    stubCookieJar("resolved-theme=dark");
    expect(getResolvedThemeFromCookie()).toBe("dark");
  });
});

describe(getServerThemeSnapshotFromCookieValues, () => {
  it("uses explicit dark theme as the resolved theme", () => {
    expect(getServerThemeSnapshotFromCookieValues("dark", undefined)).toStrictEqual({
      theme: "dark",
      resolvedTheme: "dark",
    });
  });

  it("uses resolved-theme cookie for system theme on the server", () => {
    expect(getServerThemeSnapshotFromCookieValues("system", "dark")).toStrictEqual({
      theme: "system",
      resolvedTheme: "dark",
    });
  });

  it("falls back to light for system theme when the server has no resolved cookie", () => {
    expect(getServerThemeSnapshotFromCookieValues("system", undefined)).toStrictEqual({
      theme: "system",
      resolvedTheme: "light",
    });
  });
});

describe(setThemeCookie, () => {
  it("writes theme and resolved theme cookies", () => {
    stubCookieJar();

    setThemeCookie("dark");

    expect(document.cookie).toContain(`${THEME_COOKIE_NAME}=dark`);
    expect(document.cookie).toContain(`${RESOLVED_THEME_COOKIE_NAME}=dark`);
  });
});

describe(THEME_INIT_SCRIPT, () => {
  it("is a non-empty string", () => {
    expect(THEME_INIT_SCRIPT.length).toBeGreaterThan(0);
    expectTypeOf(THEME_INIT_SCRIPT).toBeString();
  });

  it("reads from document.cookie", () => {
    expect(THEME_INIT_SCRIPT).toContain("cookie");
  });

  it("references prefers-color-scheme", () => {
    expect(THEME_INIT_SCRIPT).toContain("prefers-color-scheme");
  });

  it("persists the resolved theme cookie", () => {
    expect(THEME_INIT_SCRIPT).toContain(RESOLVED_THEME_COOKIE_NAME);
  });

  it("does not contain HTML tags", () => {
    expect(THEME_INIT_SCRIPT).not.toMatch(/<[a-z]/i);
  });
});
