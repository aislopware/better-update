import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { RobotAccountItem } from "@better-update/api-client/react";

import { renderWithQuery } from "../../../../../../tests/helpers/render-with-query";
import { ProjectRobotsTableView } from "./-project-robots-table";

import type { EditTarget } from "./-project-robots-mutations";

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
  const onEdit = vi.fn<(target: EditTarget) => void>();

  it("renders the robot with its role in words and its copyable id", () => {
    renderWithQuery(<ProjectRobotsTableView items={[makeRobot()]} onEdit={onEdit} />);

    expect(screen.getByText("ci-bot")).toBeInTheDocument();
    expect(screen.getByText("Developer")).toBeInTheDocument();
    // The id is shown whole — it is what the CLI robot commands take.
    expect(screen.getByText("robot-1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy robot id/i })).toBeInTheDocument();
  });

  it("the edit menu item hands the robot's current name + role to onEdit", async () => {
    const user = userEvent.setup();
    renderWithQuery(<ProjectRobotsTableView items={[makeRobot()]} onEdit={onEdit} />);

    await user.click(screen.getByLabelText("Robot account actions"));
    await user.click(await screen.findByRole("menuitem", { name: /edit/i }));

    expect(onEdit).toHaveBeenCalledWith({ id: "robot-1", name: "ci-bot", role: "developer" });
  });
});
