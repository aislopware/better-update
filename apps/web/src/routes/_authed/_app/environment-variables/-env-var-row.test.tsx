import { render, screen } from "@testing-library/react";

import type { EnvVar } from "@better-update/api";

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

const baseEnvVar = (overrides: Partial<EnvVar>): EnvVar => ({
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

    // Label and description are merged into one truncating meta line.
    expect(screen.getByText("Payment API URL — Base URL for the payments API")).toBeInTheDocument();
  });

  it("omits documentation nodes when unset", () => {
    renderRow(baseEnvVar({ label: null, description: null }));

    // Only the key text is present; no label/description rows are rendered.
    expect(screen.getByText("API_URL")).toBeInTheDocument();
    expect(screen.queryByText(/Payment API URL/u)).not.toBeInTheDocument();
  });

  it("leaves the documentation to the row above when the key repeats", () => {
    render(
      <table>
        <tbody>
          <EnvVarRow
            envVar={baseEnvVar({ label: "Payment API URL", description: "Base URL" })}
            documentedAbove
          />
        </tbody>
      </table>,
    );

    // The same variable in another environment: its key still names it, but the
    // definition belongs to the run and is written once at the top of it.
    expect(screen.getByText("API_URL")).toBeInTheDocument();
    expect(screen.queryByText(/Payment API URL/u)).not.toBeInTheDocument();
  });
});
