import { useContext } from "react";

import { ThemeContext } from "./theme-context-value";

import type { ThemeContextValue } from "./theme-context-value";

export type { Theme } from "./theme";

export const useTheme = (): ThemeContextValue => {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // eslint-disable-next-line functional/no-throw-statements -- React context guard pattern
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
};
