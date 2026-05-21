import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@better-update/ui/components/ui/sidebar";
import { Link } from "@tanstack/react-router";
import {
  ScrollTextIcon,
  CloudUploadIcon,
  CodeIcon,
  FingerprintIcon,
  LayersIcon,
  LayoutDashboardIcon,
  FolderIcon,
  GitBranchIcon,
  KeyIcon,
  PackageIcon,
  SatelliteIcon,
  SettingsIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
  UploadCloudIcon,
  UsersIcon,
} from "lucide-react";

import type { LucideIcon } from "lucide-react";

interface OrgNavItem {
  to:
    | "/projects"
    | "/members"
    | "/audit-log"
    | "/credentials"
    | "/apple-devices"
    | "/vault-access"
    | "/api-keys"
    | "/environment-variables"
    | "/settings"
    | "/account/profile";
  label: string;
  icon: LucideIcon;
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
      { to: "/audit-log", label: "Audit log", icon: ScrollTextIcon },
    ],
  },
  {
    label: "Credentials",
    items: [
      { to: "/credentials", label: "Credentials", icon: ShieldCheckIcon },
      { to: "/apple-devices", label: "Apple Devices", icon: SmartphoneIcon },
      { to: "/vault-access", label: "Vault access", icon: FingerprintIcon },
    ],
  },
  {
    label: "Settings",
    items: [
      { to: "/api-keys", label: "API Keys", icon: KeyIcon },
      {
        to: "/environment-variables",
        label: "Environment variables",
        icon: CodeIcon,
      },
      { to: "/settings", label: "Organization settings", icon: SettingsIcon },
    ],
  },
];

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

export const OrgNavSections = () => (
  <>
    {ORG_NAV.map((section) => (
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
