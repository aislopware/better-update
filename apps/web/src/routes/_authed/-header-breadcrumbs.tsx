import {
  buildQueryOptions,
  channelQueryOptions,
  projectBySlugQueryOptions,
  submissionQueryOptions,
  updateQueryOptions,
} from "@better-update/api-client/react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@better-update/ui/components/ui/breadcrumb";
import { cn } from "@better-update/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useRouterState } from "@tanstack/react-router";
import { Fragment } from "react";

import type { ReactNode } from "react";

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

// Sections whose leaf crumb can resolve to a human name (channel name, update
// message…) from the entity query cache the detail route itself populates.
const ENTITY_SECTIONS = ["channels", "updates", "builds", "submissions"] as const;

type EntitySection = (typeof ENTITY_SECTIONS)[number];

const toEntitySection = (section: string): EntitySection | undefined =>
  ENTITY_SECTIONS.find((candidate) => candidate === section);

interface EntityRef {
  readonly section: EntitySection;
  readonly id: string;
  readonly projectSlug: string;
}

interface Crumb {
  readonly label: string;
  readonly mono?: boolean;
  readonly entity?: EntityRef;
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
  const entitySection = toEntitySection(section);
  return [
    sectionCrumb,
    entitySection
      ? {
          label: shortId(first),
          mono: true,
          entity: { section: entitySection, id: decodeURIComponent(first), projectSlug },
        }
      : { label: shortId(first), mono: true },
  ];
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
    return [{ label: "Overview" }];
  }
  if (first === "account" && second) {
    return [
      { label: "Account", link: { to: "/account" } },
      { label: ACCOUNT_SECTION_LABELS[second] ?? second },
    ];
  }
  return [{ label: ORG_SECTION_LABELS[first] ?? first }];
};

const appRoute = getRouteApi("/_authed/_app");

/**
 * Leaf crumb for an entity detail page: shows the entity's human name once the
 * detail route's own query resolves, falling back to the short mono id.
 */
const EntityLeaf = ({ name, fallback }: { name: string | undefined; fallback: string }) => {
  const label = name?.trim() ? name : undefined;
  return (
    <BreadcrumbPage className={cn("truncate font-medium", !label && "font-mono text-xs")}>
      {label ?? fallback}
    </BreadcrumbPage>
  );
};

/**
 * Read-only subscription (`enabled: false`) to the project-by-slug cache the
 * `$projectSlug` route's beforeLoad already populated — never a second fetch.
 */
const useCachedProject = (projectSlug: string) => {
  const { activeOrg } = appRoute.useRouteContext();
  const { data: project } = useQuery({
    ...projectBySlugQueryOptions(activeOrg.id, projectSlug),
    enabled: false,
  });
  return { orgId: activeOrg.id, projectId: project?.id };
};

interface EntityCrumbProps {
  readonly entity: EntityRef;
  readonly fallback: string;
}

interface ProjectEntityCrumbProps {
  readonly orgId: string;
  readonly projectId: string;
  readonly entityId: string;
  readonly fallback: string;
}

const ChannelCrumbName = ({ orgId, projectId, entityId, fallback }: ProjectEntityCrumbProps) => {
  const { data: channel } = useQuery({
    ...channelQueryOptions(orgId, projectId, entityId),
    enabled: false,
  });
  return <EntityLeaf name={channel?.name} fallback={fallback} />;
};

const ChannelCrumb = ({ entity, fallback }: EntityCrumbProps) => {
  const { orgId, projectId } = useCachedProject(entity.projectSlug);
  return projectId ? (
    <ChannelCrumbName
      orgId={orgId}
      projectId={projectId}
      entityId={entity.id}
      fallback={fallback}
    />
  ) : (
    <EntityLeaf name={undefined} fallback={fallback} />
  );
};

const UpdateCrumbName = ({ orgId, projectId, entityId, fallback }: ProjectEntityCrumbProps) => {
  const { data: update } = useQuery({
    ...updateQueryOptions(orgId, projectId, entityId),
    enabled: false,
  });
  return <EntityLeaf name={update?.message} fallback={fallback} />;
};

const UpdateCrumb = ({ entity, fallback }: EntityCrumbProps) => {
  const { orgId, projectId } = useCachedProject(entity.projectSlug);
  return projectId ? (
    <UpdateCrumbName orgId={orgId} projectId={projectId} entityId={entity.id} fallback={fallback} />
  ) : (
    <EntityLeaf name={undefined} fallback={fallback} />
  );
};

const BuildCrumb = ({ entity, fallback }: EntityCrumbProps) => {
  const { orgId } = useCachedProject(entity.projectSlug);
  const { data: build } = useQuery({ ...buildQueryOptions(orgId, entity.id), enabled: false });
  return <EntityLeaf name={build?.message ?? build?.profile} fallback={fallback} />;
};

const SubmissionCrumb = ({ entity, fallback }: EntityCrumbProps) => {
  const { orgId } = useCachedProject(entity.projectSlug);
  const { data: submission } = useQuery({
    ...submissionQueryOptions(orgId, entity.id),
    enabled: false,
  });
  return (
    <EntityLeaf
      name={submission?.buildVersion ? `Build ${submission.buildVersion}` : undefined}
      fallback={fallback}
    />
  );
};

const ENTITY_CRUMBS: Record<EntitySection, (props: EntityCrumbProps) => ReactNode> = {
  channels: ChannelCrumb,
  updates: UpdateCrumb,
  builds: BuildCrumb,
  submissions: SubmissionCrumb,
};

// Split render paths so `params` is only passed when present
// (exactOptionalPropertyTypes rejects an explicit undefined).
const CrumbContent = ({ crumb, isLast }: { crumb: Crumb; isLast: boolean }) => {
  const labelClass = crumb.mono ? "truncate font-mono text-xs" : "truncate";
  if (crumb.entity && isLast) {
    const EntityCrumb = ENTITY_CRUMBS[crumb.entity.section];
    return <EntityCrumb entity={crumb.entity} fallback={crumb.label} />;
  }
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
 * acts as the root crumb). Detail pages get a linked list crumb + a leaf that
 * resolves to the entity's human name from the route's query cache (short mono
 * id until then), Vercel-style — hence the `/` separator override.
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
