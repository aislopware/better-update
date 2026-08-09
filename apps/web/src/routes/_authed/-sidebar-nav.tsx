import { meQueryOptions } from "@better-update/api-client/react";
import { Sidebar, useSidebar } from "@better-update/ui/components/sidebar";
import {
  BroadcastIcon,
  CloudArrowUpIcon,
  CodeIcon,
  DeviceMobileIcon,
  FingerprintIcon,
  FolderIcon,
  GearIcon,
  GitBranchIcon,
  LinkIcon,
  MonitorIcon,
  PackageIcon,
  PaletteIcon,
  RobotIcon,
  ScrollIcon,
  ShieldCheckIcon,
  ShieldStarIcon,
  SquaresFourIcon,
  StackIcon,
  UploadSimpleIcon,
  UserIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";

import type { MeResult } from "@better-update/api-client/react";
import type { Icon } from "@phosphor-icons/react";

// Sidebar entries are gated by the server-computed /api/me capabilities
// (ROLES-CAPABILITIES-SPEC §5b/§9e). Hiding is UX only — every endpoint stays
// IAM-gated regardless.
type MeCapability = keyof Pick<
  MeResult,
  | "canViewAuditLog"
  | "canViewCredentials"
  | "canViewDevices"
  | "canViewVaultAccess"
  | "canManageOrgEnvVars"
  | "canManageOrgSettings"
>;

interface OrgNavItem {
  to:
    | "/"
    | "/projects"
    | "/members"
    | "/audit-log"
    | "/credentials"
    | "/apple-devices"
    | "/vault-access"
    | "/environment-variables"
    | "/settings"
    | "/admin"
    | "/account/profile";
  label: string;
  icon: Icon;
  /** Exact-match active state — required for "/" so it never shadows siblings. */
  exact?: boolean;
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
    | "/projects/$projectSlug/members"
    | "/projects/$projectSlug/robot-accounts"
    | "/projects/$projectSlug/environment-variables";
  label: string;
  icon: Icon;
  exact?: boolean;
}

interface ProjectNavSection {
  label: string;
  items: ProjectNavItem[];
}

interface AccountNavItem {
  to:
    | "/account/profile"
    | "/account/appearance"
    | "/account/passkeys"
    | "/account/connections"
    | "/account/sessions";
  label: string;
  icon: Icon;
}

const ORG_NAV: OrgNavSection[] = [
  {
    label: "Platform",
    items: [
      // Same icon as the project-side Overview entry; exact so "/" never also
      // reads active alongside Projects (or any other org page).
      { to: "/", label: "Overview", icon: SquaresFourIcon, exact: true },
      { to: "/projects", label: "Projects", icon: FolderIcon },
    ],
  },
  {
    label: "Organization",
    items: [
      { to: "/members", label: "Members", icon: UsersIcon },
      { to: "/audit-log", label: "Audit log", icon: ScrollIcon, capability: "canViewAuditLog" },
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
        icon: DeviceMobileIcon,
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
        to: "/environment-variables",
        label: "Environment variables",
        icon: CodeIcon,
        capability: "canManageOrgEnvVars",
      },
      {
        to: "/settings",
        label: "Organization settings",
        icon: GearIcon,
        capability: "canManageOrgSettings",
      },
    ],
  },
];

/**
 * The account area, in the same rail as everything else.
 *
 * It used to bring a nav column of its own and stand it beside the org nav, so
 * two lists of places were on screen at once and the page they framed started
 * five hundred pixels in. An account is a section of the dashboard like a
 * project is; it gets the sidebar while you are in it, and the org switcher
 * above the rail is the way back out.
 *
 * The grouping is by what the entries are rather than where they apply: the old
 * "Workspace" heading covered a colour scheme and a list of signed-in devices,
 * neither of which is a workspace and both of which are yours alone.
 */
const ACCOUNT_NAV: { label: string; items: AccountNavItem[] }[] = [
  {
    label: "Account",
    items: [
      { to: "/account/profile", label: "Profile", icon: UserIcon },
      { to: "/account/appearance", label: "Appearance", icon: PaletteIcon },
    ],
  },
  {
    label: "Sign-in",
    items: [
      { to: "/account/passkeys", label: "Passkeys", icon: FingerprintIcon },
      { to: "/account/connections", label: "Connections", icon: LinkIcon },
      { to: "/account/sessions", label: "Sessions", icon: MonitorIcon },
    ],
  },
];

// Platform-superadmin section, appended only for superadmins (see `lib/access`).
const ADMIN_NAV: OrgNavSection = {
  label: "Superadmin",
  items: [{ to: "/admin", label: "Users", icon: ShieldStarIcon }],
};

// Exported for the ⌘K command palette so both surfaces list the same entries.
export const PROJECT_NAV: ProjectNavSection[] = [
  {
    label: "Project",
    items: [
      {
        to: "/projects/$projectSlug",
        label: "Overview",
        icon: SquaresFourIcon,
        exact: true,
      },
      {
        to: "/projects/$projectSlug/audit-log",
        label: "Audit log",
        icon: ScrollIcon,
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
        icon: UploadSimpleIcon,
      },
      { to: "/projects/$projectSlug/channels", label: "Channels", icon: BroadcastIcon },
      { to: "/projects/$projectSlug/branches", label: "Branches", icon: GitBranchIcon },
      { to: "/projects/$projectSlug/updates", label: "Updates", icon: CloudArrowUpIcon },
      { to: "/projects/$projectSlug/runtimes", label: "Runtimes", icon: StackIcon },
    ],
  },
  {
    label: "Project settings",
    items: [
      { to: "/projects/$projectSlug/settings", label: "General", icon: GearIcon },
      { to: "/projects/$projectSlug/members", label: "Members", icon: UsersIcon },
      {
        to: "/projects/$projectSlug/credentials",
        label: "Credentials",
        icon: ShieldCheckIcon,
      },
      {
        to: "/projects/$projectSlug/robot-accounts",
        label: "Robot accounts",
        icon: RobotIcon,
      },
      {
        to: "/projects/$projectSlug/environment-variables",
        label: "Environment variables",
        icon: CodeIcon,
      },
    ],
  },
];

// Capability-gated org nav sections, shared by the sidebar and the ⌘K command
// palette so both surfaces show exactly the same entries.
export const useOrgNavSections = (isSuperadmin: boolean): OrgNavSection[] => {
  // Progressive reveal: while /api/me is in flight only ungated entries render,
  // so capability-gated entries never flash in and out.
  const { data: me } = useQuery(meQueryOptions());
  return (isSuperadmin ? [...ORG_NAV, ADMIN_NAV] : ORG_NAV)
    .map((section) => {
      const items = section.items.filter(
        (item) => item.capability === undefined || me?.[item.capability] === true,
      );
      return { label: section.label, items };
    })
    .filter((section) => section.items.length > 0);
};

/**
 * Kumo's `MenuButton` navigates through the `href` it is given (routed by the
 * app's `LinkProvider`) and takes `active` as a plain boolean, so the active
 * row is resolved here rather than by a `Link` render prop. Matching is
 * prefix-based — a nested page keeps its section lit — except where the entry
 * asks for an exact match.
 */
const useIsCurrent = (): ((href: string, exact: boolean) => boolean) => {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (href, exact) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
};

/** Project routes are declared with the typed `$projectSlug` the palette needs. */
const projectHref = (to: ProjectNavItem["to"], projectSlug: string): string =>
  to.replace("$projectSlug", projectSlug);

const NavSection = ({
  label,
  items,
}: {
  label: string;
  items: readonly { href: string; label: string; icon: Icon; exact: boolean }[];
}) => {
  const isCurrent = useIsCurrent();
  // Below Kumo's breakpoint the rail is a modal sheet over the page, and a
  // `MenuButton` is a plain link: without this a tap navigated and left the page
  // it had asked for underneath the nav and its backdrop. Inert on desktop,
  // where the rail is drawn from `open` rather than `openMobile`.
  const { setOpenMobile } = useSidebar();
  return (
    <Sidebar.Group>
      <Sidebar.GroupLabel>{label}</Sidebar.GroupLabel>
      <Sidebar.Menu>
        {items.map((item) => (
          // No `tooltip`: the sidebar peeks open on hover while collapsed, so
          // the label is already there — and Kumo's tooltip wrapper forces
          // `cursor-default` onto the row even when the tooltip never fires.
          <Sidebar.MenuButton
            key={item.href}
            href={item.href}
            icon={item.icon}
            active={isCurrent(item.href, item.exact)}
            onClick={() => {
              setOpenMobile(false);
            }}
          >
            {item.label}
          </Sidebar.MenuButton>
        ))}
      </Sidebar.Menu>
    </Sidebar.Group>
  );
};

export const OrgNavSections = ({ isSuperadmin = false }: { isSuperadmin?: boolean }) => {
  const sections = useOrgNavSections(isSuperadmin);
  return (
    <>
      {sections.map((section) => (
        <NavSection
          key={section.label}
          label={section.label}
          items={section.items.map((item) => ({
            href: item.to,
            label: item.label,
            icon: item.icon,
            exact: item.exact === true,
          }))}
        />
      ))}
    </>
  );
};

export const AccountNavSections = () => (
  <>
    {ACCOUNT_NAV.map((section) => (
      <NavSection
        key={section.label}
        label={section.label}
        items={section.items.map((item) => ({
          href: item.to,
          label: item.label,
          icon: item.icon,
          exact: true,
        }))}
      />
    ))}
  </>
);

export const ProjectNavSections = ({ projectSlug }: { projectSlug: string }) => (
  <>
    {PROJECT_NAV.map((section) => (
      <NavSection
        key={section.label}
        label={section.label}
        items={section.items.map((item) => ({
          href: projectHref(item.to, projectSlug),
          label: item.label,
          icon: item.icon,
          exact: item.exact === true,
        }))}
      />
    ))}
  </>
);
