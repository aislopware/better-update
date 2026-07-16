import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ProjectMemberItem } from "@better-update/api-client/react";
import type { SortingState } from "@tanstack/react-table";

import { renderWithQuery } from "../../../../../../tests/helpers/render-with-query";
import { ProjectMembersTableView } from "./-project-members-table";

const noopSorting: SortingState = [];
const noopOnSortingChange = () => {};

const makeProjectMember = (overrides?: Partial<ProjectMemberItem>): ProjectMemberItem => ({
  id: "pm-1",
  projectId: "proj-1",
  principalType: "member",
  principalId: "member-1",
  role: "developer",
  allProjects: false,
  displayName: "Alice Dev",
  email: "alice@example.com",
  createdAt: "2026-06-01T00:00:00Z",
  updatedAt: null,
  ...overrides,
});

const developerRow = makeProjectMember();
const maintainerRow = makeProjectMember({
  id: "pm-2",
  principalId: "member-2",
  role: "maintainer",
  displayName: "Bob Lead",
  email: "bob@example.com",
});

describe(ProjectMembersTableView, () => {
  const onRoleChange =
    vi.fn<(row: ProjectMemberItem, role: "maintainer" | "developer" | "reporter") => void>();
  const onRemove = vi.fn<(target: { principalId: string; name: string }) => void>();

  it("renders member rows with name, email, and role", () => {
    renderWithQuery(
      <ProjectMembersTableView
        items={[developerRow, maintainerRow]}
        canManage={false}
        sorting={noopSorting}
        onSortingChange={noopOnSortingChange}
        onRoleChange={onRoleChange}
        onRemove={onRemove}
      />,
    );

    expect(screen.getByText("Alice Dev")).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("Bob Lead")).toBeInTheDocument();
    // Read-only roles render as badges, not selects.
    expect(screen.getByText("Developer")).toBeInTheDocument();
    expect(screen.getByText("Maintainer")).toBeInTheDocument();
    expect(screen.queryByLabelText(/change role for/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Project member actions")).not.toBeInTheDocument();
  });

  it("with canManage renders role selects and a remove action per row", () => {
    renderWithQuery(
      <ProjectMembersTableView
        items={[developerRow, maintainerRow]}
        canManage
        sorting={noopSorting}
        onSortingChange={noopOnSortingChange}
        onRoleChange={onRoleChange}
        onRemove={onRemove}
      />,
    );

    expect(screen.getByLabelText("Change role for Alice Dev")).toBeInTheDocument();
    expect(screen.getByLabelText("Change role for Bob Lead")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Project member actions")).toHaveLength(2);
  });

  it("org-wide rows are read-only even for managers: badges, no select, no remove", () => {
    const orgWideRow = makeProjectMember({
      id: "opm-1",
      principalId: "member-3",
      role: "developer",
      allProjects: true,
      displayName: "Org Wide",
      email: "orgwide@example.com",
    });

    renderWithQuery(
      <ProjectMembersTableView
        items={[orgWideRow]}
        canManage
        sorting={noopSorting}
        onSortingChange={noopOnSortingChange}
        onRoleChange={onRoleChange}
        onRemove={onRemove}
      />,
    );

    // Managed on the org Members screen, not per project.
    expect(screen.getByText("All projects")).toBeInTheDocument();
    expect(screen.getByText("Developer")).toBeInTheDocument();
    expect(screen.queryByLabelText("Change role for Org Wide")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Project member actions")).not.toBeInTheDocument();
  });

  it("selecting a new role calls onRoleChange with the row and role", async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <ProjectMembersTableView
        items={[developerRow]}
        canManage
        sorting={noopSorting}
        onSortingChange={noopOnSortingChange}
        onRoleChange={onRoleChange}
        onRemove={onRemove}
      />,
    );

    await user.click(screen.getByLabelText("Change role for Alice Dev"));
    await user.click(await screen.findByRole("option", { name: "Reporter" }));

    expect(onRoleChange).toHaveBeenCalledWith(developerRow, "reporter");
  });

  it("remove menu item hands the principal to onRemove", async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <ProjectMembersTableView
        items={[maintainerRow]}
        canManage
        sorting={noopSorting}
        onSortingChange={noopOnSortingChange}
        onRoleChange={onRoleChange}
        onRemove={onRemove}
      />,
    );

    await user.click(screen.getByLabelText("Project member actions"));
    await user.click(await screen.findByRole("menuitem", { name: /remove from project/i }));

    expect(onRemove).toHaveBeenCalledWith({
      principalId: "member-2",
      name: "Bob Lead",
    });
  });
});
