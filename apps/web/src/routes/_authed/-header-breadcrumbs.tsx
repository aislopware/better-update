import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@better-update/ui/components/ui/breadcrumb";
import { Link, useRouterState } from "@tanstack/react-router";
import { Fragment } from "react";

const ORG_SECTION_LABELS: Record<string, string> = {
  projects: "Projects",
  "audit-log": "Audit log",
  members: "Members",
  credentials: "Credentials",
  "vault-access": "Vault access",
  settings: "Organization settings",
  account: "Account",
  onboarding: "Onboarding",
  "apple-devices": "Apple Devices",
  "environment-variables": "Environment variables",
  admin: "Users",
};

const PROJECT_SECTION_LABELS: Record<string, string> = {
  "audit-log": "Audit log",
  builds: "Builds",
  channels: "Channels",
  branches: "Branches",
  updates: "Updates",
  runtimes: "Runtimes",
  submissions: "Submissions",
  settings: "Settings",
  members: "Members",
  credentials: "Credentials",
  "robot-accounts": "Robot accounts",
  "environment-variables": "Environment variables",
  fingerprints: "Fingerprints",
};

const ACCOUNT_SECTION_LABELS: Record<string, string> = {
  profile: "Profile",
  passkeys: "Passkeys",
  connections: "Connections",
  appearance: "Appearance",
  sessions: "Sessions",
};

// List routes with a detail page below them — these crumbs link back to the list.
const PROJECT_LIST_ROUTES = {
  builds: "/projects/$projectSlug/builds",
  updates: "/projects/$projectSlug/updates",
  channels: "/projects/$projectSlug/channels",
  runtimes: "/projects/$projectSlug/runtimes",
  submissions: "/projects/$projectSlug/submissions",
  credentials: "/projects/$projectSlug/credentials",
} as const;

type ProjectListRoute = (typeof PROJECT_LIST_ROUTES)[keyof typeof PROJECT_LIST_ROUTES];

const LIST_ROUTE_BY_SECTION: ReadonlyMap<string, ProjectListRoute> = new Map(
  Object.entries(PROJECT_LIST_ROUTES),
);

interface Crumb {
  readonly label: string;
  readonly mono?: boolean;
  readonly link?: {
    readonly to: ProjectListRoute | "/account";
    readonly params?: { readonly projectSlug: string };
  };
}

/** UUIDs and long opaque ids collapse to a copy-recognizable 8-char prefix. */
const shortId = (raw: string): string => {
  const value = decodeURIComponent(raw);
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
};

const projectDetailCrumbs = (
  projectSlug: string,
  section: string,
  rest: readonly string[],
): readonly Crumb[] => {
  const sectionLabel = PROJECT_SECTION_LABELS[section] ?? section;
  const listRoute = LIST_ROUTE_BY_SECTION.get(section);
  const sectionCrumb: Crumb = listRoute
    ? { label: sectionLabel, link: { to: listRoute, params: { projectSlug } } }
    : { label: sectionLabel };
  const [first, second] = rest;

  if (first === undefined) {
    return [{ label: sectionLabel }];
  }
  if (section === "credentials") {
    if (second === undefined) {
      return [{ label: sectionLabel }];
    }
    return [
      sectionCrumb,
      { label: first === "ios" ? "iOS" : "Android" },
      { label: decodeURIComponent(second), mono: true },
    ];
  }
  if (section === "runtimes") {
    return [sectionCrumb, { label: `v${decodeURIComponent(first)}` }];
  }
  return [sectionCrumb, { label: shortId(first), mono: true }];
};

const projectCrumbs = (projectSlug: string, rest: readonly string[]): readonly Crumb[] => {
  const [section, ...detail] = rest;
  if (!section) {
    return [{ label: "Overview" }];
  }
  if (detail.length === 0) {
    return [{ label: PROJECT_SECTION_LABELS[section] ?? section }];
  }
  return projectDetailCrumbs(projectSlug, section, detail);
};

const orgCrumbs = (segments: readonly string[]): readonly Crumb[] => {
  const [first, second] = segments;
  if (!first) {
    return [{ label: "Projects" }];
  }
  if (first === "account" && second) {
    return [
      { label: "Account", link: { to: "/account" } },
      { label: ACCOUNT_SECTION_LABELS[second] ?? second },
    ];
  }
  return [{ label: ORG_SECTION_LABELS[first] ?? first }];
};

// Split render paths so `params` is only passed when present
// (exactOptionalPropertyTypes rejects an explicit undefined).
const CrumbContent = ({ crumb, isLast }: { crumb: Crumb; isLast: boolean }) => {
  const labelClass = crumb.mono ? "truncate font-mono text-xs" : "truncate";
  if (crumb.link && !isLast) {
    return (
      <CrumbLink link={crumb.link} className={labelClass}>
        {crumb.label}
      </CrumbLink>
    );
  }
  if (isLast) {
    return <BreadcrumbPage className={`font-medium ${labelClass}`}>{crumb.label}</BreadcrumbPage>;
  }
  return <span className={labelClass}>{crumb.label}</span>;
};

const CrumbLink = ({
  link,
  className,
  children,
}: {
  link: NonNullable<Crumb["link"]>;
  className: string;
  children: string;
}) => (
  <BreadcrumbLink
    className={className}
    render={link.params ? <Link to={link.to} params={link.params} /> : <Link to={link.to} />}
  >
    {children}
  </BreadcrumbLink>
);

/**
 * Path-derived breadcrumb trail rendered next to the ProjectSwitcher (which
 * acts as the root crumb). Detail pages get a linked list crumb + a short
 * identifier leaf, Vercel-style — hence the `/` separator override.
 */
export const HeaderBreadcrumbs = ({ projectSlug }: { projectSlug: string | undefined }) => {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const segments = pathname.split("/").filter(Boolean);
  const crumbs =
    projectSlug && segments[0] === "projects"
      ? projectCrumbs(projectSlug, segments.slice(2))
      : orgCrumbs(segments);

  return (
    <Breadcrumb aria-label="Breadcrumb" className="hidden min-w-0 md:block">
      <BreadcrumbList className="flex-nowrap gap-2">
        {crumbs.map((crumb, index) => (
          <Fragment key={`${crumb.label}-${String(index)}`}>
            <BreadcrumbSeparator className="text-muted-foreground/40 select-none">
              /
            </BreadcrumbSeparator>
            <BreadcrumbItem className="min-w-0">
              <CrumbContent crumb={crumb} isLast={index === crumbs.length - 1} />
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
};
