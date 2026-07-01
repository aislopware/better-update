import { EnvVar } from "@better-update/api";
import { render, screen } from "@testing-library/react";

import { EnvVarRow } from "./-env-var-row";

// The row renders inside a table; wrap it so TableRow/TableCell have valid ancestors.
const renderRow = (envVar: EnvVar) =>
  render(
    <table>
      <tbody>
        <EnvVarRow envVar={envVar} />
      </tbody>
    </table>,
  );

const baseEnvVar = (overrides: Partial<ConstructorParameters<typeof EnvVar>[0]>) =>
  new EnvVar({
    id: "ev-1",
    organizationId: "org-1",
    projectId: null,
    scope: "global",
    environment: "production",
    key: "API_URL",
    visibility: "plaintext",
    currentRevisionId: "rev-1",
    revisionNumber: 1,
    revisionCount: 1,
    label: null,
    description: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  });

describe("EnvVarRow documentation", () => {
  it("shows the label and description when set", () => {
    renderRow(
      baseEnvVar({ label: "Payment API URL", description: "Base URL for the payments API" }),
    );

    expect(screen.getByText("Payment API URL")).toBeInTheDocument();
    expect(screen.getByText("Base URL for the payments API")).toBeInTheDocument();
  });

  it("omits documentation nodes when unset", () => {
    renderRow(baseEnvVar({ label: null, description: null }));

    // Only the key text is present; no label/description rows are rendered.
    expect(screen.getByText("API_URL")).toBeInTheDocument();
    expect(screen.queryByText("Payment API URL")).not.toBeInTheDocument();
  });
});
