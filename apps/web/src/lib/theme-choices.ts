import { MonitorIcon, MoonIcon, SunIcon } from "@phosphor-icons/react";

import type { Icon } from "@phosphor-icons/react";

import type { Theme } from "./use-theme";

export interface ThemeChoice {
  readonly value: Theme;
  readonly label: string;
  readonly icon: Icon;
}

/**
 * The three themes, in the order every picker lists them.
 *
 * There are three places to change the theme — the account menu, the palette
 * and the Appearance page — and the first two had their own copy of this list.
 * A fourth option or a renamed one would have had to be found in each; here it
 * is one array. The Appearance page keeps its own, because it picks by picture
 * rather than by name and a thumbnail is not an icon.
 */
export const THEME_CHOICES: readonly ThemeChoice[] = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
];
