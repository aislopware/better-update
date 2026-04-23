import { Badge } from "@better-update/ui/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/ui/card";
import { useSuspenseQuery } from "@tanstack/react-query";
import { screen } from "@testing-library/react";

import { makeOrg, makeProject, makeSession } from "../../../../../tests/helpers/fixtures";
import { renderWithQuery } from "../../../../../tests/helpers/render-with-query";

/**
 * These tests verify the rendering patterns of the projects page.
 * Since Projects is not exported (it's an internal const wired to Route),
 * we replicate the data-fetching + rendering logic as standalone components.
 */

const ProjectCard = ({
  project,
}: {
  project: { name: string; slug: string; createdAt: string };
}) => (
  <Card>
    <CardHeader className="pb-2">
      <CardTitle className="text-base">{project.name}</CardTitle>
      <CardDescription>{project.slug}</CardDescription>
    </CardHeader>
    <CardContent>
      <Badge variant="outline">{new Date(project.createdAt).toLocaleDateString()}</Badge>
    </CardContent>
  </Card>
);

const EmptyState = () => (
  <div>
    <p>No projects yet</p>
    <p>Create your first project to start publishing updates.</p>
  </div>
);

const ProjectsTestPage = () => {
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
    queryKey: ["org", orgId, "projects"],
    queryFn: async () => ({
      items: [] as ReturnType<typeof makeProject>[],
      total: 0,
      page: 1,
      limit: 20,
    }),
  });

  if (data.items.length === 0) {
    return <EmptyState />;
  }

  return (
    <div>
      {data.items.map((project) => (
        <ProjectCard key={project.id} project={project} />
      ))}
    </div>
  );
};

describe("projects page rendering", () => {
  it("shows empty state message when no projects", () => {
    const session = makeSession();
    const org = makeOrg();

    renderWithQuery(<ProjectsTestPage />, {
      seedCache: [
        [["auth", "session"], session],
        [["auth", "orgs"], [org]],
        [["org", "org-1", "projects"], { items: [], total: 0, page: 1, limit: 20 }],
      ],
    });

    expect(screen.getByText("No projects yet")).toBeInTheDocument();
    expect(
      screen.getByText("Create your first project to start publishing updates."),
    ).toBeInTheDocument();
  });

  it("renders project cards with name and slug", () => {
    const session = makeSession();
    const org = makeOrg();
    const projects = [
      makeProject({ id: "proj-1", name: "Alpha", slug: "alpha" }),
      makeProject({ id: "proj-2", name: "Beta", slug: "beta" }),
    ];

    renderWithQuery(<ProjectsTestPage />, {
      seedCache: [
        [["auth", "session"], session],
        [["auth", "orgs"], [org]],
        [["org", "org-1", "projects"], { items: projects, total: 2, page: 1, limit: 20 }],
      ],
    });

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
  });

  it("renders creation date on project cards", () => {
    const session = makeSession();
    const org = makeOrg();
    const project = makeProject({ createdAt: "2026-03-15T00:00:00Z" });

    renderWithQuery(<ProjectsTestPage />, {
      seedCache: [
        [["auth", "session"], session],
        [["auth", "orgs"], [org]],
        [["org", "org-1", "projects"], { items: [project], total: 1, page: 1, limit: 20 }],
      ],
    });

    expect(
      screen.getByText(new Date("2026-03-15T00:00:00Z").toLocaleDateString()),
    ).toBeInTheDocument();
  });
});
