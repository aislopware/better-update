import { DropdownMenu } from "@better-update/ui/components/dropdown";
import { render, screen, within } from "@testing-library/react";

/**
 * Verifies sidebar menu compositions: `DropdownMenu.Label` wraps Base UI's
 * Menu.GroupLabel which MUST be inside `DropdownMenu.Group`. Without the group
 * wrapper, Base UI throws "MenuGroupRootContext is missing".
 *
 * Mirrors: OrgSwitcher and UserMenu in _app.tsx
 */

const OrgSwitcherDropdown = ({ orgs }: { orgs: { id: string; name: string }[] }) => (
  <DropdownMenu open>
    <DropdownMenu.Trigger>Switch org</DropdownMenu.Trigger>
    <DropdownMenu.Content>
      <DropdownMenu.Group>
        <DropdownMenu.Label>Organizations</DropdownMenu.Label>
        <DropdownMenu.Separator />
        {orgs.map((org) => (
          <DropdownMenu.Item key={org.id}>{org.name}</DropdownMenu.Item>
        ))}
      </DropdownMenu.Group>
      <DropdownMenu.Separator />
      <DropdownMenu.Item>Create organization</DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu>
);

const UserMenuDropdown = ({ name }: { name: string }) => (
  <DropdownMenu open>
    <DropdownMenu.Trigger>{name}</DropdownMenu.Trigger>
    <DropdownMenu.Content>
      <DropdownMenu.Group>
        <DropdownMenu.Label>{name}</DropdownMenu.Label>
        <DropdownMenu.Separator />
        <DropdownMenu.Item>Log out</DropdownMenu.Item>
      </DropdownMenu.Group>
    </DropdownMenu.Content>
  </DropdownMenu>
);

const orgs = [
  { id: "org-1", name: "Acme Corp" },
  { id: "org-2", name: "Globex Inc" },
];

describe("orgSwitcher dropdown composition", () => {
  it("renders dropdown content without context errors", () => {
    render(<OrgSwitcherDropdown orgs={orgs} />);

    expect(screen.getByText("Organizations")).toBeInTheDocument();
  });

  it("lists all organizations", () => {
    render(<OrgSwitcherDropdown orgs={orgs} />);

    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getByText("Globex Inc")).toBeInTheDocument();
  });

  it("shows create organization option", () => {
    render(<OrgSwitcherDropdown orgs={orgs} />);

    expect(screen.getByText("Create organization")).toBeInTheDocument();
  });
});

describe("userMenu dropdown composition", () => {
  it("renders dropdown content without context errors", () => {
    render(<UserMenuDropdown name="Test User" />);

    // The group takes its accessible name from the label inside it — the very
    // wiring that throws when the label is rendered outside a group.
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("group", { name: "Test User" })).toBeInTheDocument();
  });

  it("shows logout option", () => {
    render(<UserMenuDropdown name="Test User" />);

    expect(screen.getByText("Log out")).toBeInTheDocument();
  });
});
