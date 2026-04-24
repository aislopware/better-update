import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";

import {
  RESOLVED_THEME_COOKIE_NAME,
  THEME_COOKIE_NAME,
  getServerThemeSnapshotFromCookieValues,
} from "./theme";

import type { ThemeSnapshot } from "./theme";

export const getServerThemeSnapshot = createServerFn({ method: "GET" }).handler(
  (): ThemeSnapshot =>
    getServerThemeSnapshotFromCookieValues(
      getCookie(THEME_COOKIE_NAME),
      getCookie(RESOLVED_THEME_COOKIE_NAME),
    ),
);
