import {
  adoptionQueryOptions,
  channelsQueryOptions,
  deliveryAnalyticsQueryOptions,
  platformAnalyticsQueryOptions,
  updatesQueryOptions,
} from "@better-update/api-client/react";
import { screen } from "@testing-library/react";

import { renderWithQuery } from "../../../../../../tests/helpers/render-with-query";
import { ThemeContext } from "../../../../../lib/theme-context-value";
import { AnalyticsTab } from "./-analytics-tab";

// ECharts draws to a canvas jsdom does not have, and these tests are about
// which of the two section shapes renders — not about what the charts draw.
// The module path is hoisted so the partial factory takes vi.mock's loose
// overload, as elsewhere in this suite.
const { chartModule } = vi.hoisted(() => ({
  chartModule: "@better-update/ui/components/chart",
}));

vi.mock(chartModule, async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Chart: () => <div data-testid="chart" />,
  TimeseriesChart: () => <div data-testid="chart" />,
}));

const ORG_ID = "org-analytics";
const PROJECT_ID = "proj-analytics";
const PERIOD = "7d";
const SEARCH = { period: PERIOD, channel: undefined, update: undefined } as const;

const DROPDOWN_LIMIT = { limit: 100 };

const seed = (
  adoption: { readonly updates: readonly unknown[]; readonly unavailable?: boolean },
  platforms: { readonly platforms: readonly unknown[]; readonly unavailable?: boolean },
): [readonly unknown[], unknown][] => [
  [adoptionQueryOptions(ORG_ID, PROJECT_ID, PERIOD).queryKey, { unavailable: false, ...adoption }],
  [
    platformAnalyticsQueryOptions(ORG_ID, PROJECT_ID, PERIOD).queryKey,
    { unavailable: false, ...platforms },
  ],
  // The delivery card reads its own dataset; nothing here asserts on it.
  [
    deliveryAnalyticsQueryOptions(ORG_ID, PROJECT_ID, PERIOD).queryKey,
    {
      downloads: 0,
      patchDownloads: 0,
      fullDownloads: 0,
      notFound: 0,
      bytesServed: 0,
      patchEligibleRequests: 0,
      unavailable: false,
    },
  ],
  // The pickers in the channel and traffic cards suspend on their own lists.
  [channelsQueryOptions(ORG_ID, PROJECT_ID, DROPDOWN_LIMIT).queryKey, { items: [], total: 0 }],
  [updatesQueryOptions(ORG_ID, PROJECT_ID, DROPDOWN_LIMIT).queryKey, { items: [], total: 0 }],
];

// The charts read the resolved theme; nothing here asserts on colour, so a
// fixed light theme stands in for the provider the app mounts.
const THEME = { theme: "light", resolvedTheme: "light", updateTheme: () => {} } as const;

const renderTab = (seedCache: [readonly unknown[], unknown][]) =>
  renderWithQuery(
    <ThemeContext value={THEME}>
      <AnalyticsTab
        orgId={ORG_ID}
        projectId={PROJECT_ID}
        search={SEARCH}
        onSearchChange={() => {}}
      />
    </ThemeContext>,
    { seedCache },
  );

describe(AnalyticsTab, () => {
  it("says it once for the whole section when no device has reported", async () => {
    renderTab(seed({ updates: [] }, { platforms: [] }));

    await expect(screen.findByText("No analytics in this period")).resolves.toBeInTheDocument();
    expect(screen.queryByText("Update adoption")).not.toBeInTheDocument();
    expect(screen.queryByText("Channel health")).not.toBeInTheDocument();
  });

  // Zeros because the server could not ask read identically to zeros because
  // nobody has run the app — telling them apart is the point of the flag.
  it("distinguishes a telemetry outage from a project with no traffic", async () => {
    renderTab(seed({ updates: [], unavailable: true }, { platforms: [], unavailable: true }));

    await expect(screen.findByText("Analytics unavailable")).resolves.toBeInTheDocument();
    expect(screen.queryByText("No analytics in this period")).not.toBeInTheDocument();
  });

  it("shows the cards when either source has something to plot", async () => {
    renderTab(
      seed({ updates: [] }, { platforms: [{ platform: "ios", devices: 12, requests: 40 }] }),
    );

    await expect(screen.findByText("Platform split")).resolves.toBeInTheDocument();
    expect(screen.getByText("Channel health")).toBeInTheDocument();
    expect(screen.queryByText("No analytics in this period")).not.toBeInTheDocument();
  });
});
