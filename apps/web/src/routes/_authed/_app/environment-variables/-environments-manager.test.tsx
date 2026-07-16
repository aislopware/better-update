import { environmentsQueryOptions } from "@better-update/api-client/react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithQuery } from "../../../../../tests/helpers/render-with-query";
import { EnvironmentsManager } from "./-environments-manager";

const makeEnvironment = (name: string, index: number) => ({
  id: `env-${index}`,
  organizationId: "org-1",
  name,
  isBuiltin: false,
  protected: false,
  createdAt: "2026-07-01T00:00:00.000Z",
});

const seedEnvironments = (
  environments: readonly ReturnType<typeof makeEnvironment>[],
): [readonly unknown[], unknown][] => [
  [environmentsQueryOptions("org-1").queryKey, { items: environments }],
];

describe(EnvironmentsManager, () => {
  it("keeps the filter box hidden while the list is scannable at a glance", () => {
    const environments = ["development", "preview", "production"].map(makeEnvironment);
    renderWithQuery(<EnvironmentsManager orgId="org-1" />, {
      seedCache: seedEnvironments(environments),
    });

    expect(screen.getByText("development")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Filter environments…")).not.toBeInTheDocument();
  });

  it("bounds a long list to one page and narrows it through the filter", async () => {
    const environments = [
      makeEnvironment("needle-env", 0),
      ...Array.from({ length: 24 }, (_, index) =>
        makeEnvironment(`haystack-${index + 1}`, index + 1),
      ),
    ];
    const user = userEvent.setup();
    renderWithQuery(<EnvironmentsManager orgId="org-1" />, {
      seedCache: seedEnvironments(environments),
    });

    // One ProtectionSwitch per row: 25 environments render only PAGE_SIZE rows.
    expect(screen.getAllByRole("switch")).toHaveLength(20);

    await user.type(screen.getByPlaceholderText("Filter environments…"), "NEEDLE");

    expect(screen.getAllByRole("switch")).toHaveLength(1);
    expect(screen.getByText("needle-env")).toBeInTheDocument();

    await user.clear(screen.getByPlaceholderText("Filter environments…"));
    await user.type(screen.getByPlaceholderText("Filter environments…"), "no such env");

    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(screen.getByText("No environments match “no such env”.")).toBeInTheDocument();
  });
});
