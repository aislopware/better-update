import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@better-update/ui/components/ui/sidebar";
import {
  ArrowLeft01Icon,
  Audit01Icon,
  CloudUploadIcon,
  CodeIcon,
  DashboardSquare02Icon,
  Folder02Icon,
  GitBranchIcon,
  Key01Icon,
  Package02Icon,
  SatelliteIcon,
  Settings02Icon,
  ShieldKeyIcon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";

import type { IconSvgElement } from "@hugeicons/react";

interface OrgNavItem {
  to: "/projects" | "/members" | "/audit-log" | "/credentials" | "/api-keys" | "/settings";
  label: string;
  icon: IconSvgElement;
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
  icon: IconSvgElement;
  exact?: boolean;
}

interface ProjectNavSection {
  label: string;
  items: ProjectNavItem[];
}

const ORG_NAV: OrgNavSection[] = [
  {
    label: "Platform",
    items: [{ to: "/projects", label: "Overview", icon: Folder02Icon }],
  },
  {
    label: "Organization",
    items: [
      { to: "/members", label: "Members", icon: UserGroupIcon },
      { to: "/audit-log", label: "Audit log", icon: Audit01Icon },
    ],
  },
  {
    label: "Credentials",
    items: [{ to: "/credentials", label: "Credentials", icon: ShieldKeyIcon }],
  },
  {
    label: "Settings",
    items: [
      { to: "/api-keys", label: "API Keys", icon: Key01Icon },
      { to: "/settings", label: "Organization settings", icon: Settings02Icon },
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
        icon: DashboardSquare02Icon,
        exact: true,
      },
    ],
  },
  {
    label: "Deploy",
    items: [
      { to: "/projects/$projectId/builds", label: "Builds", icon: Package02Icon },
      { to: "/projects/$projectId/channels", label: "Channels", icon: SatelliteIcon },
      { to: "/projects/$projectId/branches", label: "Branches", icon: GitBranchIcon },
      { to: "/projects/$projectId/updates", label: "Updates", icon: CloudUploadIcon },
    ],
  },
  {
    label: "Project settings",
    items: [
      { to: "/projects/$projectId/settings", label: "General", icon: Settings02Icon },
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
                      <HugeiconsIcon icon={item.icon} strokeWidth={2} />
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
                        <HugeiconsIcon icon={item.icon} strokeWidth={2} />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    )}
                  </Link>
                ) : (
                  <Link to={item.to} params={{ projectId }}>
                    {({ isActive }) => (
                      <SidebarMenuButton isActive={isActive} tooltip={item.label}>
                        <HugeiconsIcon icon={item.icon} strokeWidth={2} />
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
              <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
              <span>Account</span>
            </SidebarMenuButton>
          </Link>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroupContent>
  </SidebarGroup>
);
