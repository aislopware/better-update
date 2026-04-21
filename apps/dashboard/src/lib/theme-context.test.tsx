import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";

import type { ReactNode } from "react";

import { THEME_COOKIE_NAME } from "./theme";
import { ThemeProvider } from "./theme-context";
import { useTheme } from "./use-theme";

const createWrapper = (initialTheme?: "light" | "dark" | "system") => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient()}>
      {initialTheme ? (
        <ThemeProvider initialTheme={initialTheme}>{children}</ThemeProvider>
      ) : (
        <ThemeProvider>{children}</ThemeProvider>
      )}
    </QueryClientProvider>
  );
  return Wrapper;
};

const wrapper = createWrapper();

type MqlListener = (event: MediaQueryListEvent) => void;

const stubMatchMedia = (isDark: boolean) => {
  const listeners: MqlListener[] = [];
  const state = { matches: isDark };
  Object.defineProperty(globalThis, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn<(query: string) => MediaQueryList>().mockImplementation(
      () =>
        ({
          get matches() {
            return state.matches;
          },
          addEventListener: (_type: string, listener: MqlListener) => listeners.push(listener),
          removeEventListener: (_type: string, listener: MqlListener) => {
            const idx = listeners.indexOf(listener);
            if (idx !== -1) {
              listeners.splice(idx, 1);
            }
          },
        }) as unknown as MediaQueryList,
    ),
  });
  return {
    fire: (nextIsDark: boolean) => {
      state.matches = nextIsDark;
      for (const listener of listeners) {
        listener({ matches: nextIsDark } as MediaQueryListEvent);
      }
    },
  };
};

beforeEach(() => {
  Object.defineProperty(document, "cookie", { writable: true, configurable: true, value: "" });
  document.documentElement.classList.remove("dark");
  stubMatchMedia(false);
});

describe(ThemeProvider, () => {
  it('provides default theme as "system"', () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme).toBe("system");
  });

  it('updateTheme("dark") updates context and applies dark class', () => {
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => result.current.updateTheme("dark"));

    expect(result.current.theme).toBe("dark");
    expect(result.current.resolvedTheme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it('updateTheme("light") updates context and removes dark class', () => {
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => result.current.updateTheme("dark"));
    act(() => result.current.updateTheme("light"));

    expect(result.current.theme).toBe("light");
    expect(result.current.resolvedTheme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("persists theme to cookie on change", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => result.current.updateTheme("dark"));

    expect(document.cookie).toContain(`${THEME_COOKIE_NAME}=dark`);
  });

  it("uses initialTheme prop for initial state", () => {
    const { result } = renderHook(() => useTheme(), { wrapper: createWrapper("dark") });

    expect(result.current.theme).toBe("dark");
    expect(result.current.resolvedTheme).toBe("dark");
  });

  it("resolves system theme based on matchMedia", () => {
    stubMatchMedia(true);

    const { result } = renderHook(() => useTheme(), { wrapper });

    expect(result.current.theme).toBe("system");
    expect(result.current.resolvedTheme).toBe("dark");
  });

  it("responds to system preference changes when theme is system", () => {
    const mql = stubMatchMedia(false);

    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.resolvedTheme).toBe("light");

    act(() => mql.fire(true));
    expect(result.current.resolvedTheme).toBe("dark");
  });
});

describe(useTheme, () => {
  it("throws when used without ThemeProvider", () => {
    const errorWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
    );
    expect(() => renderHook(() => useTheme(), { wrapper: errorWrapper })).toThrow(
      "useTheme must be used within a ThemeProvider",
    );
  });
});
