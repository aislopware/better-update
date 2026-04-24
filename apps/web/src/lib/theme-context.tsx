import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import type { ReactNode } from "react";

import {
  applyTheme,
  getSystemPreference,
  getThemeFromCookie,
  resolveTheme,
  setResolvedThemeCookie,
  setThemeCookie,
} from "./theme";
import { ThemeContext } from "./theme-context-value";

import type { ResolvedTheme, Theme } from "./theme";

const subscribeSystemPreference = (onStoreChange: () => void) => {
  const mql = globalThis.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => {
    const resolvedTheme = resolveTheme(getThemeFromCookie(), mql.matches);
    applyTheme(resolvedTheme);
    setResolvedThemeCookie(resolvedTheme);
    onStoreChange();
  };
  mql.addEventListener("change", handler);
  return () => {
    mql.removeEventListener("change", handler);
  };
};

export const ThemeProvider = ({
  initialTheme,
  initialResolvedTheme,
  children,
}: {
  initialTheme?: Theme;
  initialResolvedTheme?: ResolvedTheme;
  children: ReactNode;
}) => {
  const queryClient = useQueryClient();

  const [theme, setTheme] = useState<Theme>(initialTheme ?? "system");

  const systemPreference = useSyncExternalStore(
    subscribeSystemPreference,
    getSystemPreference,
    () => initialResolvedTheme ?? resolveTheme(initialTheme ?? "system", false),
  );

  const resolvedTheme = resolveTheme(theme, systemPreference === "dark");

  const updateTheme = useCallback(
    (next: Theme) => {
      const nextResolvedTheme = resolveTheme(next, getSystemPreference() === "dark");
      setTheme(next);
      setThemeCookie(next, nextResolvedTheme);
      queryClient.setQueryData(["theme"], next);
      applyTheme(nextResolvedTheme);
    },
    [queryClient],
  );

  const value = useMemo(
    () => ({ theme, resolvedTheme, updateTheme }),
    [theme, resolvedTheme, updateTheme],
  );

  return <ThemeContext value={value}>{children}</ThemeContext>;
};
