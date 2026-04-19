import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";

import type { QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { getThemeFromCookie } from "../lib/theme";
import { ThemeProvider } from "../lib/theme-context";
import { ThemedToaster } from "../lib/themed-toaster";
import { sessionQueryOptions } from "../queries/auth";
import { configQueryOptions } from "../queries/config";

import type { Theme } from "../lib/theme";

const RootDocument = ({
  children,
  initialTheme,
}: Readonly<{ children: ReactNode; initialTheme: Theme }>) => (
  <ThemeProvider initialTheme={initialTheme}>
    {children}
    <ThemedToaster />
  </ThemeProvider>
);

const RootComponent = () => {
  const { theme } = Route.useRouteContext();
  return (
    <RootDocument initialTheme={theme}>
      <Outlet />
    </RootDocument>
  );
};

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  beforeLoad: async ({ context: { queryClient } }) => {
    const [session, config] = await Promise.all([
      queryClient.ensureQueryData(sessionQueryOptions),
      queryClient.ensureQueryData(configQueryOptions),
    ]);
    const theme = getThemeFromCookie();
    return { session, theme, config };
  },
  component: RootComponent,
});
