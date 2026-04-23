import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import type { ReactNode } from "react";

import {
  applyTheme,
  getSystemPreference,
  getThemeFromCookie,
  resolveTheme,
  setThemeCookie,
} from "./theme";
import { ThemeContext } from "./theme-context-value";

import type { Theme } from "./theme";

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
    () => (initialTheme === "dark" ? "dark" : ("light" as const)),
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
