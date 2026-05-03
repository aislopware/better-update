import {
  DropdownMenu,
  DropdownMenuPopup,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@better-update/ui/components/ui/menu";
import { render, screen } from "@testing-library/react";

/**
 * These tests verify dropdown menu compositions used in the sidebar.
 * DropdownMenuLabel wraps Base UI's Menu.GroupLabel which MUST be inside
 * DropdownMenuGroup (Menu.Group). Without the group wrapper, Base UI throws:
 * "MenuGroupRootContext is missing. Menu group parts must be used within <Menu.Group>."
 *
 * Mirrors: OrgSwitcher and UserMenu in _app.tsx
 */

const OrgSwitcherDropdown = ({ orgs }: { orgs: { id: string; name: string }[] }) => (
  <DropdownMenu open>
    <DropdownMenuTrigger>Switch org</DropdownMenuTrigger>
    <DropdownMenuPopup>
      <DropdownMenuGroup>
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {orgs.map((org) => (
          <DropdownMenuItem key={org.id}>{org.name}</DropdownMenuItem>
        ))}
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem>Create organization</DropdownMenuItem>
    </DropdownMenuPopup>
  </DropdownMenu>
);

const UserMenuDropdown = ({ name }: { name: string }) => (
  <DropdownMenu open>
    <DropdownMenuTrigger>{name}</DropdownMenuTrigger>
    <DropdownMenuPopup>
      <DropdownMenuGroup>
        <DropdownMenuLabel>{name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>Log out</DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuPopup>
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

    const label = document.querySelector('[data-slot="menu-label"]');
    expect(label).toHaveTextContent("Test User");
  });

  it("shows logout option", () => {
    render(<UserMenuDropdown name="Test User" />);

    expect(screen.getByText("Log out")).toBeInTheDocument();
  });
});
