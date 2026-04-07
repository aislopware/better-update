import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import type { ReactNode } from "react";

import {
  applyTheme,
  getSystemPreference,
  getThemeFromCookie,
  resolveTheme,
  setThemeCookie,
} from "./theme";

import type { ResolvedTheme, Theme } from "./theme";

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  updateTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// eslint-disable-next-line react-refresh/only-export-components -- co-exporting provider + hook is standard React context pattern
export const useTheme = (): ThemeContextValue => {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // eslint-disable-next-line functional/no-throw-statements -- React context guard pattern
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
};

const subscribeSystemPreference = (onStoreChange: () => void) => {
  const mql = globalThis.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => {
    applyTheme(resolveTheme(getThemeFromCookie(), mql.matches));
    onStoreChange();
  };
  mql.addEventListener("change", handler);
  return () => {
    mql.removeEventListener("change", handler);
  };
};

const getServerSnapshot = (): ResolvedTheme => "light";

export const ThemeProvider = ({
  initialTheme,
  children,
}: {
  initialTheme?: Theme;
  children: ReactNode;
}) => {
  const queryClient = useQueryClient();

  const [theme, setTheme] = useState<Theme>(initialTheme ?? "system");

  const systemPreference = useSyncExternalStore(
    subscribeSystemPreference,
    getSystemPreference,
    getServerSnapshot,
  );

  const resolvedTheme = resolveTheme(theme, systemPreference === "dark");

  const updateTheme = useCallback(
    (next: Theme) => {
      setTheme(next);
      setThemeCookie(next);
      queryClient.setQueryData(["theme"], next);
      applyTheme(resolveTheme(next, getSystemPreference() === "dark"));
    },
    [queryClient],
  );

  const value = useMemo(
    () => ({ theme, resolvedTheme, updateTheme }),
    [theme, resolvedTheme, updateTheme],
  );

  return <ThemeContext value={value}>{children}</ThemeContext>;
};
