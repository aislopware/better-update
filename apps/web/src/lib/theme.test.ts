// @vitest-environment jsdom
import {
  THEME_COOKIE_NAME,
  THEME_INIT_SCRIPT,
  getThemeFromCookie,
  resolveTheme,
  setThemeCookie,
} from "./theme";

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
  const stubCookie = (value: string) => {
    Object.defineProperty(document, "cookie", { writable: true, configurable: true, value });
  };

  beforeEach(() => stubCookie(""));

  it('returns "system" when no theme cookie exists', () => {
    expect(getThemeFromCookie()).toBe("system");
  });

  it('returns "dark" when cookie is "theme=dark"', () => {
    stubCookie("theme=dark");
    expect(getThemeFromCookie()).toBe("dark");
  });

  it('returns "light" when cookie is "theme=light"', () => {
    stubCookie("theme=light");
    expect(getThemeFromCookie()).toBe("light");
  });

  it('returns "system" for invalid cookie values', () => {
    stubCookie("theme=invalid");
    expect(getThemeFromCookie()).toBe("system");
  });

  it("parses theme from among other cookies", () => {
    stubCookie("session=abc; theme=dark; other=xyz");
    expect(getThemeFromCookie()).toBe("dark");
  });
});

describe(setThemeCookie, () => {
  it("writes cookie with correct format", () => {
    let written = "";
    Object.defineProperty(document, "cookie", {
      set: (value: string) => {
        written = value;
      },
      get: () => written,
      configurable: true,
    });

    setThemeCookie("dark");

    expect(written).toBe(`${THEME_COOKIE_NAME}=dark; path=/; max-age=31536000; SameSite=Lax`);
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

  it("does not contain HTML tags", () => {
    expect(THEME_INIT_SCRIPT).not.toMatch(/<[a-z]/i);
  });
});
