import { useMountEffect } from "@better-update/react-hooks";
import { useQueryClient } from "@tanstack/react-query";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useRouterState,
} from "@tanstack/react-router";

import type { QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { subscribeToSignoutBroadcast } from "../lib/logout";
import { THEME_INIT_SCRIPT, getThemeSnapshotFromCookie, isResolvedTheme } from "../lib/theme";
import { ThemeProvider } from "../lib/theme-context";
import { getServerThemeSnapshot } from "../lib/theme-server";
import { ThemedToaster } from "../lib/themed-toaster";

import type { ResolvedTheme, ThemeSnapshot } from "../lib/theme";

interface RouteMatch {
  readonly routeId: string;
  readonly context: unknown;
}

const isThemeSnapshot = (value: unknown): value is ThemeSnapshot => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { theme } = value as { theme?: unknown };
  if (theme !== "light" && theme !== "dark" && theme !== "system") {
    return false;
  }
  const { resolvedTheme } = value as { resolvedTheme?: unknown };
  return typeof resolvedTheme === "string" && isResolvedTheme(resolvedTheme);
};

const readRootTheme = (matches: readonly RouteMatch[]): ThemeSnapshot | undefined => {
  const rootMatch = matches.find((match) => match.routeId === "__root__");
  if (!rootMatch || typeof rootMatch.context !== "object" || rootMatch.context === null) {
    return undefined;
  }
  const { theme } = rootMatch.context as { theme?: unknown };
  return isThemeSnapshot(theme) ? theme : undefined;
};

const getShellResolvedTheme = (matches: readonly RouteMatch[]): ResolvedTheme =>
  readRootTheme(matches)?.resolvedTheme ?? "light";

const loadTheme = async (): Promise<ThemeSnapshot> => {
  if (typeof document !== "undefined") {
    return getThemeSnapshotFromCookie();
  }
  return getServerThemeSnapshot();
};

const RootShell = ({ children }: Readonly<{ children: ReactNode }>) => {
  const resolvedTheme = useRouterState({
    select: (state) => getShellResolvedTheme(state.matches as readonly RouteMatch[]),
  });
  return (
    <html
      lang="en"
      className={resolvedTheme === "dark" ? "dark" : undefined}
      style={{ colorScheme: resolvedTheme }}
      suppressHydrationWarning
    >
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="color-scheme" content="light dark" />
        <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#0a0a0a" media="(prefers-color-scheme: dark)" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <title>Better Update</title>
        <meta
          name="description"
          content="Deploy, monitor, and roll back over-the-air updates for your React Native apps with Better Update."
        />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Better Update" />
        <meta property="og:title" content="Better Update" />
        <meta
          property="og:description"
          content="Deploy, monitor, and roll back over-the-air updates for your React Native apps."
        />
        <meta property="og:url" content="https://better-update.dev" />
        <meta property="og:image" content="https://better-update.dev/og-image.svg" />
        <meta property="og:image:type" content="image/svg+xml" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content="Better Update — React Native OTA command center" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Better Update" />
        <meta
          name="twitter:description"
          content="Deploy, monitor, and roll back over-the-air updates for your React Native apps."
        />
        <meta name="twitter:image" content="https://better-update.dev/og-image.svg" />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
};

const RootComponent = () => {
  const { theme } = Route.useRouteContext();
  const queryClient = useQueryClient();
  useMountEffect(() => subscribeToSignoutBroadcast(queryClient));
  return (
    <ThemeProvider initialTheme={theme.theme} initialResolvedTheme={theme.resolvedTheme}>
      <ThemedToaster>
        <Outlet />
      </ThemedToaster>
    </ThemeProvider>
  );
};

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  beforeLoad: async () => {
    const theme = await loadTheme();
    return { theme };
  },
  head: () => ({
    scripts: [{ id: "theme-init", children: THEME_INIT_SCRIPT }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
});
