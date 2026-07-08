import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { RobotAccountItem, RobotAccountRoleValue } from "@better-update/api-client/react";

import { renderWithQuery } from "../../../../../../tests/helpers/render-with-query";
import { ProjectRobotsTableView } from "./-project-robots-table";

import type { RenameTarget } from "./-project-robots-mutations";

const makeRobot = (overrides?: Partial<RobotAccountItem>): RobotAccountItem => ({
  id: "robot-1",
  organizationId: "org-1",
  name: "ci-bot",
  bearerStart: "bu_rob_abc",
  userEncryptionKeyId: null,
  projectId: "project-1",
  role: "developer",
  createdAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

describe(ProjectRobotsTableView, () => {
  const onRoleChange = vi.fn<(robot: RobotAccountItem, role: RobotAccountRoleValue) => void>();
  const onRename = vi.fn<(target: RenameTarget) => void>();

  it("renders the robot with an editable role and its copyable id", () => {
    renderWithQuery(
      <ProjectRobotsTableView
        items={[makeRobot()]}
        onRoleChange={onRoleChange}
        onRename={onRename}
      />,
    );

    expect(screen.getByText("ci-bot")).toBeInTheDocument();
    expect(screen.getByLabelText("Change role for ci-bot")).toBeInTheDocument();
    // CopyableId shows the (truncated) id and copies the full value.
    expect(screen.getByText("robot-1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy robot id/i })).toBeInTheDocument();
  });

  it("selecting a new role calls onRoleChange with the robot and role", async () => {
    const user = userEvent.setup();
    const robot = makeRobot();
    renderWithQuery(
      <ProjectRobotsTableView items={[robot]} onRoleChange={onRoleChange} onRename={onRename} />,
    );

    await user.click(screen.getByLabelText("Change role for ci-bot"));
    await user.click(await screen.findByRole("option", { name: "Maintainer" }));

    expect(onRoleChange).toHaveBeenCalledWith(robot, "maintainer");
  });

  it("the rename menu item hands the robot to onRename", async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <ProjectRobotsTableView
        items={[makeRobot()]}
        onRoleChange={onRoleChange}
        onRename={onRename}
      />,
    );

    await user.click(screen.getByLabelText("Robot account actions"));
    await user.click(await screen.findByRole("menuitem", { name: /rename/i }));

    expect(onRename).toHaveBeenCalledWith({ id: "robot-1", name: "ci-bot" });
  });
});
