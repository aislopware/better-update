import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@better-update/ui/components/ui/dropdown-menu";
import { render, screen } from "@testing-library/react";

import type { Theme } from "../../lib/theme";

/**
 * Tests verify the theme submenu composition used in UserMenu.
 * Mirrors the DropdownMenuSub + RadioGroup structure in _app.tsx.
 */

const ThemeSubmenuDropdown = ({
  theme,
  onThemeChange,
}: {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}) => (
  <DropdownMenu open>
    <DropdownMenuTrigger>User</DropdownMenuTrigger>
    <DropdownMenuContent>
      <DropdownMenuGroup>
        <DropdownMenuSub open>
          <DropdownMenuSubTrigger>Theme</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={theme}
              onValueChange={(value) => onThemeChange(value as Theme)}
            >
              <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>
);

describe("theme toggle dropdown composition", () => {
  it("renders theme submenu without context errors", () => {
    render(<ThemeSubmenuDropdown theme="system" onThemeChange={() => {}} />);

    expect(screen.getByText("Theme")).toBeInTheDocument();
  });

  it("shows Light, Dark, System radio items", () => {
    render(<ThemeSubmenuDropdown theme="system" onThemeChange={() => {}} />);

    expect(screen.getByText("Light")).toBeInTheDocument();
    expect(screen.getByText("Dark")).toBeInTheDocument();
    expect(screen.getByText("System")).toBeInTheDocument();
  });

  it("renders all three radio items as menu radio items", () => {
    render(<ThemeSubmenuDropdown theme="light" onThemeChange={() => {}} />);

    const radioItems = document.querySelectorAll('[data-slot="dropdown-menu-radio-item"]');
    expect(radioItems).toHaveLength(3);
  });
});
