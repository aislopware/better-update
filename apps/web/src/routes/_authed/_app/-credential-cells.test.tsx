import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { AppleTeamItem } from "@better-update/api-client/react";

import { ProtectedBadgeCell, ProtectionCell, TeamCell } from "./-credential-cells";

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
  it("renders the team label and a dash when the team is missing", () => {
    const { rerender } = render(<TeamCell team={makeTeam()} />);
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();

    rerender(<TeamCell team={undefined} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe(ProtectedBadgeCell, () => {
  it("renders a badge when protected and a dash otherwise", () => {
    const { rerender } = render(<ProtectedBadgeCell isProtected />);
    expect(screen.getByText("Protected")).toBeInTheDocument();

    rerender(<ProtectedBadgeCell isProtected={false} />);
    expect(screen.getByText("—")).toBeInTheDocument();
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
