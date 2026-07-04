import { projectsQueryOptions } from "@better-update/api-client/react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithQuery } from "../../../../tests/helpers/render-with-query";
import { DROPDOWN_FETCH_LIMIT } from "../../../queries/constants";
import { BoundProjectChips, BoundProjectsCell } from "./-credential-bindings";

const PROJECTS = [
  { id: "project-1", name: "My App" },
  { id: "project-2", name: "Other App" },
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
      <BoundProjectChips boundProjectIds={["project-1", "project-2"]} projects={PROJECTS} />,
    );

    expect(screen.getByText("My App")).toBeInTheDocument();
    expect(screen.getByText("Other App")).toBeInTheDocument();
    expect(screen.queryByText("project-1")).not.toBeInTheDocument();
  });

  it("shows a muted hint when the credential is bound to no project", () => {
    renderWithQuery(<BoundProjectChips boundProjectIds={[]} projects={PROJECTS} />);

    expect(screen.getByText("Not bound to any project")).toBeInTheDocument();
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
        canManage
      />,
      { seedCache: seedProjects() },
    );

    await user.click(await screen.findByRole("button", { name: "Manage projects" }));

    const checkboxes = await screen.findAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]).toHaveAttribute("aria-checked", "true");
    expect(checkboxes[1]).toHaveAttribute("aria-checked", "false");
  });
});
