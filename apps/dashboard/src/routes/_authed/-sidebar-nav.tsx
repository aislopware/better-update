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
  ArrowLeftIcon,
  ScrollTextIcon,
  CloudUploadIcon,
  CodeIcon,
  LayoutDashboardIcon,
  FolderIcon,
  GitBranchIcon,
  KeyIcon,
  PackageIcon,
  SatelliteIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UsersIcon,
} from "lucide-react";

import type { LucideIcon } from "lucide-react";

interface OrgNavItem {
  to: "/projects" | "/members" | "/audit-log" | "/credentials" | "/api-keys" | "/settings";
  label: string;
  icon: LucideIcon;
}

interface OrgNavSection {
  label: string;
  items: OrgNavItem[];
}

interface ProjectNavItem {
  to:
    | "/projects/$projectId"
    | "/projects/$projectId/builds"
    | "/projects/$projectId/channels"
    | "/projects/$projectId/branches"
    | "/projects/$projectId/updates"
    | "/projects/$projectId/settings"
    | "/projects/$projectId/environment-variables";
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
    items: [{ to: "/projects", label: "Overview", icon: FolderIcon }],
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
    items: [{ to: "/credentials", label: "Credentials", icon: ShieldCheckIcon }],
  },
  {
    label: "Settings",
    items: [
      { to: "/api-keys", label: "API Keys", icon: KeyIcon },
      { to: "/settings", label: "Organization settings", icon: SettingsIcon },
    ],
  },
];

const PROJECT_NAV: ProjectNavSection[] = [
  {
    label: "Project",
    items: [
      {
        to: "/projects/$projectId",
        label: "Overview",
        icon: LayoutDashboardIcon,
        exact: true,
      },
    ],
  },
  {
    label: "Deploy",
    items: [
      { to: "/projects/$projectId/builds", label: "Builds", icon: PackageIcon },
      { to: "/projects/$projectId/channels", label: "Channels", icon: SatelliteIcon },
      { to: "/projects/$projectId/branches", label: "Branches", icon: GitBranchIcon },
      { to: "/projects/$projectId/updates", label: "Updates", icon: CloudUploadIcon },
    ],
  },
  {
    label: "Project settings",
    items: [
      { to: "/projects/$projectId/settings", label: "General", icon: SettingsIcon },
      {
        to: "/projects/$projectId/environment-variables",
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

export const ProjectNavSections = ({ projectId }: { projectId: string }) => (
  <>
    {PROJECT_NAV.map((section) => (
      <SidebarGroup key={section.label}>
        <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {section.items.map((item) => (
              <SidebarMenuItem key={item.to}>
                {item.exact ? (
                  <Link to={item.to} params={{ projectId }} activeOptions={{ exact: true }}>
                    {({ isActive }) => (
                      <SidebarMenuButton isActive={isActive} tooltip={item.label}>
                        <item.icon strokeWidth={2} />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    )}
                  </Link>
                ) : (
                  <Link to={item.to} params={{ projectId }}>
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

export const ProjectBackLink = () => (
  <SidebarGroup>
    <SidebarGroupContent>
      <SidebarMenu>
        <SidebarMenuItem>
          <Link to="/projects">
            <SidebarMenuButton tooltip="Account">
              <ArrowLeftIcon strokeWidth={2} />
              <span>Account</span>
            </SidebarMenuButton>
          </Link>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroupContent>
  </SidebarGroup>
);
