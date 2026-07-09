import { projectsQueryOptions } from "@better-update/api-client/react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithQuery } from "../../../../tests/helpers/render-with-query";
import { DROPDOWN_FETCH_LIMIT } from "../../../queries/constants";
import { BoundProjectChips, BoundProjectsCell } from "./-credential-bindings";

const PROJECTS = [
  { id: "project-1", name: "My App" },
  { id: "project-2", name: "Other App" },
  { id: "project-3", name: "Third App" },
  { id: "project-4", name: "Fourth App" },
  { id: "project-5", name: "Fifth App" },
];

const seedProjects = (): [readonly unknown[], unknown][] => [
  [
    projectsQueryOptions("org-1", { limit: DROPDOWN_FETCH_LIMIT, status: "all" }).queryKey,
    { items: PROJECTS },
  ],
];

describe(BoundProjectChips, () => {
  it("renders resolved project names as chips, never raw ids", () => {
    renderWithQuery(
      <BoundProjectChips
        boundProjectIds={["project-1", "project-2"]}
        boundToAllProjects={false}
        projects={PROJECTS}
      />,
    );

    expect(screen.getByText("My App")).toBeInTheDocument();
    expect(screen.getByText("Other App")).toBeInTheDocument();
    expect(screen.queryByText("project-1")).not.toBeInTheDocument();
  });

  it("shows a muted hint when the credential is bound to no project", () => {
    renderWithQuery(
      <BoundProjectChips boundProjectIds={[]} boundToAllProjects={false} projects={PROJECTS} />,
    );

    expect(screen.getByText("Not bound to any project")).toBeInTheDocument();
  });

  it("collapses to a single All projects chip when bound org-wide", () => {
    renderWithQuery(
      <BoundProjectChips
        boundProjectIds={PROJECTS.map((project) => project.id)}
        boundToAllProjects
        projects={PROJECTS}
      />,
    );

    expect(screen.getByText("All projects")).toBeInTheDocument();
    expect(screen.queryByText("My App")).not.toBeInTheDocument();
  });

  it("caps visible chips and reveals the rest in a popover", async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <BoundProjectChips
        boundProjectIds={PROJECTS.map((project) => project.id)}
        boundToAllProjects={false}
        projects={PROJECTS}
      />,
    );

    expect(screen.getByText("My App")).toBeInTheDocument();
    expect(screen.getByText("Third App")).toBeInTheDocument();
    expect(screen.queryByText("Fifth App")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show all 5 bound projects" }));

    await expect(screen.findByText("Fifth App")).resolves.toBeInTheDocument();
    expect(screen.getByText("Fourth App")).toBeInTheDocument();
  });
});

describe(BoundProjectsCell, () => {
  it("hides the manage affordance from non-admins", async () => {
    renderWithQuery(
      <BoundProjectsCell
        orgId="org-1"
        resourceType="googleServiceAccountKey"
        resourceId="gsa-1"
        resourceLabel="ci@example.iam.gserviceaccount.com"
        boundProjectIds={["project-1"]}
        boundToAllProjects={false}
        canManage={false}
      />,
      { seedCache: seedProjects() },
    );

    await expect(screen.findByText("My App")).resolves.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Manage projects" })).not.toBeInTheDocument();
  });

  it("opens a dialog for org admins listing every project with its bound state", async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <BoundProjectsCell
        orgId="org-1"
        resourceType="appleTeam"
        resourceId="team-1"
        resourceLabel="Acme Corp (ABCDE12345)"
        boundProjectIds={["project-1"]}
        boundToAllProjects={false}
        canManage
      />,
      { seedCache: seedProjects() },
    );

    await user.click(await screen.findByRole("button", { name: "Manage projects" }));

    const checkboxes = await screen.findAllByRole("checkbox");
    expect(checkboxes).toHaveLength(5);
    expect(checkboxes[0]).toHaveAttribute("aria-checked", "true");
    expect(checkboxes[1]).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });

  it("disables the per-project checklist while the org-wide binding is on", async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <BoundProjectsCell
        orgId="org-1"
        resourceType="androidUploadKeystore"
        resourceId="ks-1"
        resourceLabel="the upload keystore"
        boundProjectIds={PROJECTS.map((project) => project.id)}
        boundToAllProjects
        canManage
      />,
      { seedCache: seedProjects() },
    );

    await user.click(await screen.findByRole("button", { name: "Manage projects" }));

    await expect(screen.findByRole("switch")).resolves.toHaveAttribute("aria-checked", "true");
    for (const checkbox of screen.getAllByRole("checkbox")) {
      expect(checkbox).toHaveAttribute("aria-disabled", "true");
    }
  });
});
