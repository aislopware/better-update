import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import type { Theme } from "../lib/theme";

const isValidTheme = (value: string): value is Theme =>
  value === "light" || value === "dark" || value === "system";

export const getThemeFn = createServerFn({ method: "GET" }).handler(() => {
  const request = getRequest();
  const cookies = request.headers.get("cookie") ?? "";
  const match = /(?:^|;\s*)theme=([\w]+)/.exec(cookies);
  const value = match?.[1] ?? "";

  return isValidTheme(value) ? value : ("system" as const);
});
