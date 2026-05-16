import {
  Menu,
  MenuPopup,
  MenuGroup,
  MenuItem,
  MenuGroupLabel,
  MenuSeparator,
  MenuTrigger,
} from "@better-update/ui/components/ui/menu";
import { render, screen } from "@testing-library/react";

/**
 * Verifies sidebar menu compositions: MenuGroupLabel wraps Base UI's
 * Menu.GroupLabel which MUST be inside MenuGroup. Without the group wrapper,
 * Base UI throws "MenuGroupRootContext is missing".
 *
 * Mirrors: OrgSwitcher and UserMenu in _app.tsx
 */

const OrgSwitcherDropdown = ({ orgs }: { orgs: { id: string; name: string }[] }) => (
  <Menu open>
    <MenuTrigger>Switch org</MenuTrigger>
    <MenuPopup>
      <MenuGroup>
        <MenuGroupLabel>Organizations</MenuGroupLabel>
        <MenuSeparator />
        {orgs.map((org) => (
          <MenuItem key={org.id}>{org.name}</MenuItem>
        ))}
      </MenuGroup>
      <MenuSeparator />
      <MenuItem>Create organization</MenuItem>
    </MenuPopup>
  </Menu>
);

const UserMenuDropdown = ({ name }: { name: string }) => (
  <Menu open>
    <MenuTrigger>{name}</MenuTrigger>
    <MenuPopup>
      <MenuGroup>
        <MenuGroupLabel>{name}</MenuGroupLabel>
        <MenuSeparator />
        <MenuItem>Log out</MenuItem>
      </MenuGroup>
    </MenuPopup>
  </Menu>
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
