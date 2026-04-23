import { createContext } from "react";

import type { ResolvedTheme, Theme } from "./theme";

export interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  updateTheme: (theme: Theme) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);
