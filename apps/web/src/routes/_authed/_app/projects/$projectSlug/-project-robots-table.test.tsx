import { render, screen } from "@testing-library/react";

import type { RobotAccountItem } from "@better-update/api-client/react";

import { ProjectRobotsTable } from "./-project-robots-table";

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

describe(ProjectRobotsTable, () => {
  it("renders the robot with a capitalized role and its bearer prefix", () => {
    render(<ProjectRobotsTable items={[makeRobot()]} />);

    expect(screen.getByText("ci-bot")).toBeInTheDocument();
    expect(screen.getByText("Developer")).toBeInTheDocument();
    expect(screen.getByText("bu_rob_abc···")).toBeInTheDocument();
  });

  it("marks a vault-only robot's bearer as not minted", () => {
    render(<ProjectRobotsTable items={[makeRobot({ bearerStart: null, hasBearer: false })]} />);

    expect(screen.getByText("— not minted —")).toBeInTheDocument();
  });
});
