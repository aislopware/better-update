import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";

import { isValidTheme } from "./theme";

import type { Theme } from "./theme";

export const getServerTheme = createServerFn({ method: "GET" }).handler((): Theme => {
  const value = getCookie("theme");
  return value !== undefined && isValidTheme(value) ? value : "system";
});
