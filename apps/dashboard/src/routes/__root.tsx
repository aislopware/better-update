import "../app.css";

import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from "@tanstack/react-router";

import type { QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { THEME_INIT_SCRIPT, resolveTheme } from "../lib/theme";
import { ThemeProvider } from "../lib/theme-context";
import { ThemedToaster } from "../lib/themed-toaster";
import { sessionQueryOptions } from "../queries/auth";
import { themeQueryOptions } from "../queries/theme";

import type { ResolvedTheme, Theme } from "../lib/theme";

const RootDocument = ({
  children,
  initialTheme,
  resolvedTheme,
}: Readonly<{ children: ReactNode; initialTheme: Theme; resolvedTheme: ResolvedTheme }>) => (
  <html
    lang="en"
    className={resolvedTheme === "dark" ? "dark" : undefined}
    suppressHydrationWarning
  >
    <head>
      <HeadContent />
    </head>
    <body>
      <ThemeProvider initialTheme={initialTheme}>
        {children}
        <ThemedToaster />
      </ThemeProvider>
      <Scripts />
    </body>
  </html>
);

const RootComponent = () => {
  const { theme } = Route.useRouteContext();
  const resolved = resolveTheme(theme, false);

  return (
    <RootDocument initialTheme={theme} resolvedTheme={resolved}>
      <Outlet />
    </RootDocument>
  );
};

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  beforeLoad: async ({ context: { queryClient } }) => {
    const [session, theme] = await Promise.all([
      queryClient.ensureQueryData(sessionQueryOptions),
      queryClient.ensureQueryData(themeQueryOptions),
    ]);
    return { session, theme };
  },
  component: RootComponent,
  head: () => ({
    meta: [
      { charSet: "utf8" },
      { content: "width=device-width, initial-scale=1", name: "viewport" },
      { title: "Dashboard" },
    ],
    scripts: [{ children: THEME_INIT_SCRIPT }],
  }),
});
