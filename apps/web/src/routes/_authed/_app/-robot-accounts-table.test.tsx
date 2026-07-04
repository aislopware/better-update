import { render, screen } from "@testing-library/react";

import type { RobotAccountItem } from "@better-update/api-client/react";

import { RobotAccountsTable } from "./-robot-accounts-table";

const makeRobot = (overrides?: Partial<RobotAccountItem>): RobotAccountItem => ({
  id: "robot-1",
  organizationId: "org-1",
  name: "ci-bot",
  bearerStart: "bu_rob_abc",
  hasBearer: true,
  userEncryptionKeyId: null,
  projectId: "project-1",
  role: "developer",
  createdAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

const PROJECT_NAMES = new Map([["project-1", "My App"]]);

describe(RobotAccountsTable, () => {
  it("resolves the project name and capitalizes the role", () => {
    render(<RobotAccountsTable items={[makeRobot()]} projectNamesById={PROJECT_NAMES} />);

    expect(screen.getByText("My App")).toBeInTheDocument();
    expect(screen.getByText("Developer")).toBeInTheDocument();
    expect(screen.queryByText("project-1")).not.toBeInTheDocument();
  });

  it("flags legacy pre-v2 robots (null project) and shows no role", () => {
    render(
      <RobotAccountsTable
        items={[makeRobot({ id: "robot-2", projectId: null, role: null })]}
        projectNamesById={PROJECT_NAMES}
      />,
    );

    expect(screen.getByText("Legacy — recreate from CLI")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
