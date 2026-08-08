import { Button } from "@better-update/ui/components/button";
import { DropdownMenu } from "@better-update/ui/components/dropdown";
import { Loader } from "@better-update/ui/components/loader";
import { CaretUpDownIcon, SignOutIcon, UserIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";

import { EntityAvatar } from "../../lib/entity-avatar";
import { logout } from "../../lib/logout";
import { isValidTheme } from "../../lib/theme";
import { THEME_CHOICES } from "../../lib/theme-choices";
import { useApiMutation } from "../../lib/use-api-mutation";
import { useTheme } from "../../lib/use-theme";

// Top-right, the way the Cloudflare dashboard carries the account menu: the
// avatar is the constant, the name appears once there is room for it.
const renderUserTrigger = (name: string | undefined, image: string | null | undefined) => (
  <Button variant="ghost" aria-label="Account" className="h-8 gap-2 px-1.5">
    <EntityAvatar name={name ?? "U"} image={image} size="sm" />
    <span className="hidden max-w-32 truncate font-normal lg:inline">{name}</span>
    <CaretUpDownIcon weight="bold" className="text-kumo-subtle size-3 shrink-0" />
  </Button>
);

/**
 * The theme, where the Cloudflare dashboard keeps it: in the account menu.
 *
 * It used to live only on the Appearance page and in the palette, so switching
 * to dark took either a walk through a settings section or knowing that ⌘K
 * answers to "dark" — and a preference you flip by daylight should be one click
 * from anywhere. Radio items rather than a toggle, because "System" is a real
 * third answer and a two-state switch has nowhere to put it.
 */
const ThemeMenuGroup = () => {
  const { theme, updateTheme } = useTheme();
  return (
    <DropdownMenu.Group>
      <DropdownMenu.Label>Theme</DropdownMenu.Label>
      <DropdownMenu.RadioGroup
        value={theme}
        // Base UI types a radio group's value as `any`, so the string is
        // checked against the three real themes rather than asserted into one.
        onValueChange={(next: unknown) => {
          if (typeof next === "string" && isValidTheme(next)) {
            updateTheme(next);
          }
        }}
      >
        {THEME_CHOICES.map((choice) => (
          <DropdownMenu.RadioItem
            key={choice.value}
            value={choice.value}
            // The component, not an element of it: Kumo sizes and spaces an
            // icon it instantiates itself, and passes an element straight
            // through — which is how the label ends up against the glyph.
            icon={choice.icon}
            // The menu stays open: a theme is judged by looking at the page
            // behind it, and one that shut on the first pick would make
            // comparing two of them a reopen each time.
            closeOnClick={false}
          >
            {choice.label}
            {/* Right-aligned tick, so which theme is on now reads without
                opening Appearance to find out. */}
            <DropdownMenu.RadioItemIndicator />
          </DropdownMenu.RadioItem>
        ))}
      </DropdownMenu.RadioGroup>
    </DropdownMenu.Group>
  );
};

export interface UserMenuUser {
  readonly name: string;
  readonly email: string;
  readonly image?: string | null | undefined;
}

export const UserMenu = ({ user }: { readonly user: UserMenuUser }) => {
  const router = useRouter();
  const queryClient = useQueryClient();

  const logoutMutation = useApiMutation({
    mutationFn: async () => logout(queryClient),
  });

  return (
    <DropdownMenu>
      <DropdownMenu.Trigger render={renderUserTrigger(user.name, user.image)} />
      <DropdownMenu.Content align="end" side="bottom" sideOffset={4} className="min-w-56">
        <DropdownMenu.Group>
          {/* Canonical nav-user label block: avatar + name + email. */}
          <DropdownMenu.Label className="p-0 font-normal">
            <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
              <EntityAvatar name={user.name || "U"} image={user.image} className="size-8" />
              <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                <span className="text-kumo-strong truncate font-medium">{user.name}</span>
                <span className="text-kumo-subtle truncate text-xs">{user.email}</span>
              </div>
            </div>
          </DropdownMenu.Label>
          <DropdownMenu.Separator />
          <DropdownMenu.Item
            onClick={async () => {
              await router.navigate({ to: "/account/profile" });
            }}
            disabled={logoutMutation.isPending}
          >
            <UserIcon weight="bold" className="size-4" />
            <span>Account</span>
          </DropdownMenu.Item>
        </DropdownMenu.Group>
        <DropdownMenu.Separator />
        <ThemeMenuGroup />
        <DropdownMenu.Separator />
        <DropdownMenu.Group>
          <DropdownMenu.Item
            variant="danger"
            onClick={() => {
              logoutMutation.mutate();
            }}
            disabled={logoutMutation.isPending}
            closeOnClick={false}
          >
            {logoutMutation.isPending ? (
              <Loader size={16} />
            ) : (
              <SignOutIcon weight="bold" className="size-4" />
            )}
            <span>{logoutMutation.isPending ? "Logging out…" : "Log out"}</span>
          </DropdownMenu.Item>
        </DropdownMenu.Group>
      </DropdownMenu.Content>
    </DropdownMenu>
  );
};
