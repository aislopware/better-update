import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { AppleTeamItem } from "@better-update/api-client/react";

import { ProtectionCell, TeamCell } from "./-credential-cells";

const makeTeam = (overrides?: Partial<AppleTeamItem>): AppleTeamItem =>
  ({
    id: "team-1",
    appleTeamId: "ABCDE12345",
    name: "Acme Corp",
    appleTeamType: "COMPANY_ORGANIZATION",
    protected: false,
    distributionCertificateCount: 0,
    pushKeyCount: 0,
    ascApiKeyCount: 0,
    provisioningProfileCount: 0,
    deviceCount: 0,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  }) as AppleTeamItem;

describe(TeamCell, () => {
  it("shows the inherited protection badge only when opted in AND the team is protected", () => {
    const { rerender } = render(<TeamCell team={makeTeam({ protected: true })} showProtected />);
    expect(screen.getByText("Protected (via team)")).toBeInTheDocument();

    rerender(<TeamCell team={makeTeam({ protected: true })} />);
    expect(screen.queryByText("Protected (via team)")).not.toBeInTheDocument();

    rerender(<TeamCell team={makeTeam({ protected: false })} showProtected />);
    expect(screen.queryByText("Protected (via team)")).not.toBeInTheDocument();
  });
});

describe(ProtectionCell, () => {
  it("renders a toggle for org admins and forwards changes", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn<(next: boolean) => void>();
    render(
      <ProtectionCell
        label="Protect Acme Corp"
        checked={false}
        canManage
        isPending={false}
        onToggle={onToggle}
      />,
    );

    await user.click(screen.getByLabelText("Protect Acme Corp"));
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("renders a read-only badge (protected) or dash (unprotected) for non-admins", () => {
    const { rerender } = render(
      <ProtectionCell
        label="Protect Acme Corp"
        checked
        canManage={false}
        isPending={false}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText("Protected")).toBeInTheDocument();
    expect(screen.queryByLabelText("Protect Acme Corp")).not.toBeInTheDocument();

    rerender(
      <ProtectionCell
        label="Protect Acme Corp"
        checked={false}
        canManage={false}
        isPending={false}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
