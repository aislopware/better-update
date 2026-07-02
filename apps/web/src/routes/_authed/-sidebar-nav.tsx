import { meQueryOptions } from "@better-update/api-client/react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@better-update/ui/components/ui/sidebar";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ScrollTextIcon,
  BotIcon,
  CloudUploadIcon,
  CodeIcon,
  FingerprintIcon,
  LayersIcon,
  LayoutDashboardIcon,
  FolderIcon,
  GitBranchIcon,
  PackageIcon,
  SatelliteIcon,
  SettingsIcon,
  ShieldCheckIcon,
  ShieldIcon,
  ShieldUserIcon,
  SmartphoneIcon,
  UploadCloudIcon,
  UsersIcon,
  UsersRoundIcon,
} from "lucide-react";

import type { MeResult } from "@better-update/api-client/react";
import type { LucideIcon } from "lucide-react";

// Sidebar entries are gated by the server-computed /api/me capabilities
// (ROLES-CAPABILITIES-SPEC §5b/§9e). Hiding is UX only — every endpoint stays
// IAM-gated regardless.
type MeCapability = keyof Pick<
  MeResult,
  | "canViewPolicies"
  | "canViewAuditLog"
  | "canViewCredentials"
  | "canViewDevices"
  | "canViewVaultAccess"
  | "canViewRobots"
  | "canManageOrgEnvVars"
  | "canManageOrgSettings"
>;

interface OrgNavItem {
  to:
    | "/projects"
    | "/members"
    | "/policies"
    | "/groups"
    | "/audit-log"
    | "/credentials"
    | "/apple-devices"
    | "/vault-access"
    | "/robot-accounts"
    | "/environment-variables"
    | "/settings"
    | "/admin"
    | "/account/profile";
  label: string;
  icon: LucideIcon;
  /** Omitted = visible to every member (projects list + member directory). */
  capability?: MeCapability;
}

interface OrgNavSection {
  label: string;
  items: OrgNavItem[];
}

interface ProjectNavItem {
  to:
    | "/projects/$projectSlug"
    | "/projects/$projectSlug/audit-log"
    | "/projects/$projectSlug/builds"
    | "/projects/$projectSlug/channels"
    | "/projects/$projectSlug/branches"
    | "/projects/$projectSlug/updates"
    | "/projects/$projectSlug/runtimes"
    | "/projects/$projectSlug/credentials"
    | "/projects/$projectSlug/submissions"
    | "/projects/$projectSlug/settings"
    | "/projects/$projectSlug/environment-variables";
  label: string;
  icon: LucideIcon;
  exact?: boolean;
}

interface ProjectNavSection {
  label: string;
  items: ProjectNavItem[];
}

const ORG_NAV: OrgNavSection[] = [
  {
    label: "Platform",
    items: [{ to: "/projects", label: "Projects", icon: FolderIcon }],
  },
  {
    label: "Organization",
    items: [
      { to: "/members", label: "Members", icon: UsersIcon },
      { to: "/audit-log", label: "Audit log", icon: ScrollTextIcon, capability: "canViewAuditLog" },
    ],
  },
  // Demoted (SPEC §9d): the raw policy/group builder is the ADVANCED escape
  // hatch — the Members page Access sheet is the primary surface.
  {
    label: "Access Control",
    items: [
      { to: "/policies", label: "Policies", icon: ShieldIcon, capability: "canViewPolicies" },
      { to: "/groups", label: "Groups", icon: UsersRoundIcon, capability: "canViewPolicies" },
    ],
  },
  {
    label: "Credentials",
    items: [
      {
        to: "/credentials",
        label: "Credentials",
        icon: ShieldCheckIcon,
        capability: "canViewCredentials",
      },
      {
        to: "/apple-devices",
        label: "Apple Devices",
        icon: SmartphoneIcon,
        capability: "canViewDevices",
      },
      {
        to: "/vault-access",
        label: "Vault access",
        icon: FingerprintIcon,
        capability: "canViewVaultAccess",
      },
    ],
  },
  {
    label: "Settings",
    items: [
      {
        to: "/robot-accounts",
        label: "Robot accounts",
        icon: BotIcon,
        capability: "canViewRobots",
      },
      {
        to: "/environment-variables",
        label: "Environment variables",
        icon: CodeIcon,
        capability: "canManageOrgEnvVars",
      },
      {
        to: "/settings",
        label: "Organization settings",
        icon: SettingsIcon,
        capability: "canManageOrgSettings",
      },
    ],
  },
];

// Platform-superadmin section, appended only for superadmins (see `lib/access`).
const ADMIN_NAV: OrgNavSection = {
  label: "Superadmin",
  items: [{ to: "/admin", label: "Users", icon: ShieldUserIcon }],
};

const PROJECT_NAV: ProjectNavSection[] = [
  {
    label: "Project",
    items: [
      {
        to: "/projects/$projectSlug",
        label: "Overview",
        icon: LayoutDashboardIcon,
        exact: true,
      },
      {
        to: "/projects/$projectSlug/audit-log",
        label: "Audit log",
        icon: ScrollTextIcon,
      },
    ],
  },
  {
    label: "Deploy",
    items: [
      { to: "/projects/$projectSlug/builds", label: "Builds", icon: PackageIcon },
      {
        to: "/projects/$projectSlug/submissions",
        label: "Submissions",
        icon: UploadCloudIcon,
      },
      { to: "/projects/$projectSlug/channels", label: "Channels", icon: SatelliteIcon },
      { to: "/projects/$projectSlug/branches", label: "Branches", icon: GitBranchIcon },
      { to: "/projects/$projectSlug/updates", label: "Updates", icon: CloudUploadIcon },
      { to: "/projects/$projectSlug/runtimes", label: "Runtimes", icon: LayersIcon },
    ],
  },
  {
    label: "Project settings",
    items: [
      { to: "/projects/$projectSlug/settings", label: "General", icon: SettingsIcon },
      {
        to: "/projects/$projectSlug/credentials",
        label: "Credentials",
        icon: ShieldCheckIcon,
      },
      {
        to: "/projects/$projectSlug/environment-variables",
        label: "Environment variables",
        icon: CodeIcon,
      },
    ],
  },
];

export const OrgNavSections = ({ isSuperadmin = false }: { isSuperadmin?: boolean }) => {
  // Progressive reveal: while /api/me is in flight only ungated entries render,
  // so capability-gated entries never flash in and out.
  const { data: me } = useQuery(meQueryOptions());
  const sections = (isSuperadmin ? [...ORG_NAV, ADMIN_NAV] : ORG_NAV)
    .map((section) => {
      const items = section.items.filter(
        (item) => item.capability === undefined || me?.[item.capability] === true,
      );
      return { label: section.label, items };
    })
    .filter((section) => section.items.length > 0);
  return (
    <>
      {sections.map((section) => (
        <SidebarGroup key={section.label}>
          <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {section.items.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <Link to={item.to}>
                    {({ isActive }) => (
                      <SidebarMenuButton isActive={isActive} tooltip={item.label}>
                        <item.icon strokeWidth={2} />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    )}
                  </Link>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  );
};

export const ProjectNavSections = ({ projectSlug }: { projectSlug: string }) => (
  <>
    {PROJECT_NAV.map((section) => (
      <SidebarGroup key={section.label}>
        <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {section.items.map((item) => (
              <SidebarMenuItem key={item.to}>
                {item.exact ? (
                  <Link to={item.to} params={{ projectSlug }} activeOptions={{ exact: true }}>
                    {({ isActive }) => (
                      <SidebarMenuButton isActive={isActive} tooltip={item.label}>
                        <item.icon strokeWidth={2} />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    )}
                  </Link>
                ) : (
                  <Link to={item.to} params={{ projectSlug }}>
                    {({ isActive }) => (
                      <SidebarMenuButton isActive={isActive} tooltip={item.label}>
                        <item.icon strokeWidth={2} />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    )}
                  </Link>
                )}
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    ))}
  </>
);
