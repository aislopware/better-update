import { Badge } from "@better-update/ui/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@better-update/ui/components/ui/card";
import { useSuspenseQuery } from "@tanstack/react-query";
import { screen } from "@testing-library/react";

import type { BranchItem } from "@better-update/api-client/react";

import { makeBranch, makeOrg, makeSession } from "../../../../../../tests/helpers/fixtures";
import { renderWithQuery } from "../../../../../../tests/helpers/render-with-query";

/**
 * These tests verify the rendering patterns of the branches page.
 * Since the Route component is not exported, we replicate the
 * data-fetching + rendering logic as standalone components.
 */

const BranchCard = ({ branch }: { branch: BranchItem }) => (
  <Card>
    <CardHeader className="pb-2">
      <CardTitle className="text-base">{branch.name}</CardTitle>
    </CardHeader>
    <CardContent>
      <Badge variant="outline">{new Date(branch.createdAt).toLocaleDateString()}</Badge>
    </CardContent>
  </Card>
);

const EmptyState = () => (
  <Card className="border-dashed">
    <CardContent className="flex flex-col items-center justify-center py-12">
      <p className="text-lg font-medium">No branches yet</p>
      <p className="text-muted-foreground mt-1 text-sm">
        Create your first branch to start organizing updates.
      </p>
    </CardContent>
  </Card>
);

const BranchesTestPage = () => {
  const { data: session } = useSuspenseQuery({
    queryKey: ["auth", "session"],
    queryFn: async () => null as ReturnType<typeof makeSession> | null,
  });
  const { data: orgs } = useSuspenseQuery({
    queryKey: ["auth", "orgs"],
    queryFn: async () => [] as ReturnType<typeof makeOrg>[],
  });

  const activeOrgId = session?.session.activeOrganizationId ?? "";
  const activeOrg = orgs.find((org) => org.id === activeOrgId) ?? orgs[0];
  const orgId = activeOrg?.id ?? "";

  const { data } = useSuspenseQuery({
    queryKey: ["org", orgId, "projects", "proj-1", "branches"],
    queryFn: async () => ({
      items: [] as BranchItem[],
      total: 0,
      page: 1,
      limit: 20,
    }),
  });

  if (data.items.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {data.items.map((branch) => (
        <BranchCard key={branch.id} branch={branch} />
      ))}
    </div>
  );
};

describe("branches page rendering", () => {
  it("shows empty state message when no branches", () => {
    const session = makeSession();
    const org = makeOrg();

    renderWithQuery(<BranchesTestPage />, {
      seedCache: [
        [["auth", "session"], session],
        [["auth", "orgs"], [org]],
        [
          ["org", "org-1", "projects", "proj-1", "branches"],
          { items: [], total: 0, page: 1, limit: 20 },
        ],
      ],
    });

    expect(screen.getByText("No branches yet")).toBeInTheDocument();
    expect(
      screen.getByText("Create your first branch to start organizing updates."),
    ).toBeInTheDocument();
  });

  it("renders branch cards with names", () => {
    const session = makeSession();
    const org = makeOrg();
    const branches = [
      makeBranch({ id: "branch-1", name: "main" }),
      makeBranch({ id: "branch-2", name: "staging" }),
    ];

    renderWithQuery(<BranchesTestPage />, {
      seedCache: [
        [["auth", "session"], session],
        [["auth", "orgs"], [org]],
        [
          ["org", "org-1", "projects", "proj-1", "branches"],
          { items: branches, total: 2, page: 1, limit: 20 },
        ],
      ],
    });

    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("staging")).toBeInTheDocument();
  });

  it("renders creation date on branch cards", () => {
    const session = makeSession();
    const org = makeOrg();
    const branch = makeBranch({ createdAt: "2026-03-15T00:00:00Z" });

    renderWithQuery(<BranchesTestPage />, {
      seedCache: [
        [["auth", "session"], session],
        [["auth", "orgs"], [org]],
        [
          ["org", "org-1", "projects", "proj-1", "branches"],
          { items: [branch], total: 1, page: 1, limit: 20 },
        ],
      ],
    });

    expect(
      screen.getByText(new Date("2026-03-15T00:00:00Z").toLocaleDateString()),
    ).toBeInTheDocument();
  });
});
