import {
  FingerprintIcon,
  LinkIcon,
  MonitorIcon,
  PaletteIcon,
  UserIcon,
} from "@phosphor-icons/react";
import { Outlet, createFileRoute } from "@tanstack/react-router";

import { SettingsLayout } from "../../../components/settings-layout";

import type { SettingsNavSection } from "../../../components/settings-layout";

const NAV: readonly SettingsNavSection[] = [
  {
    label: "Account",
    items: [
      { to: "/account/profile", label: "Profile", icon: UserIcon },
      { to: "/account/passkeys", label: "Passkeys", icon: FingerprintIcon },
      { to: "/account/connections", label: "Connections", icon: LinkIcon },
    ],
  },
  {
    label: "Workspace",
    items: [
      { to: "/account/appearance", label: "Appearance", icon: PaletteIcon },
      { to: "/account/sessions", label: "Sessions", icon: MonitorIcon },
    ],
  },
];

const AccountLayout = () => (
  <SettingsLayout nav={NAV}>
    <Outlet />
  </SettingsLayout>
);

export const Route = createFileRoute("/_authed/_app/account")({
  component: AccountLayout,
});
