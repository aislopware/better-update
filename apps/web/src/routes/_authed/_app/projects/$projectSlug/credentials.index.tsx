import {
  androidApplicationIdentifiersQueryOptions,
  androidBuildCredentialsQueryOptions,
  androidUploadKeystoresQueryOptions,
  appleTeamsQueryOptions,
  iosBundleConfigurationsQueryOptions,
} from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/badge";
import { Empty } from "@better-update/ui/components/empty";
import { useSuspenseQueries, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { Suspense, useMemo } from "react";

import type {
  AndroidApplicationIdentifierItem,
  AppleTeamItem,
} from "@better-update/api-client/react";
import type { ColumnDef } from "@tanstack/react-table";

import { EmptyDash, TeamNameCell } from "../../-credential-cells";
import { AndroidIcon } from "../../../../../components/android-icon";
import { AppleIcon } from "../../../../../components/apple-icon";
import { CliCommandBlock } from "../../../../../components/cli-command-block";
import { PageHeader } from "../../../../../components/page-header";
import { TablePanelSkeleton } from "../../../../../components/skeletons";
import { PanelTitle, TablePanel } from "../../../../../components/table-panel";
import {
  clientPaginationFooter,
  DataTableView,
  useClientPagination,
} from "../../../../../lib/data-table";
import { RelativeTime } from "../../../../../lib/relative-time";
import { groupIosConfigs, summarizeAndroidCredentials } from "./-credentials-index-helpers";
import { DISTRIBUTION_LABELS } from "./-ios-detail-shared";

import type { IosBundleGroup, IosSigningSlots } from "./-credentials-index-helpers";

const SectionListSkeleton = () => <TablePanelSkeleton columns={4} rows={3} />;

// The panel around it draws the frame, so the empty state drops its own.
const PANEL_EMPTY_CLASS = "rounded-none border-0 bg-transparent";

const AndroidEmpty = () => (
  <Empty
    className={PANEL_EMPTY_CLASS}
    icon={<AndroidIcon className="text-kumo-inactive size-10" />}
    title="No application identifiers"
    description="Register an Android application identifier and bind upload keystores and Google service account keys for this project from the CLI."
    contents={
      <CliCommandBlock commands={["better-update credentials configure --platform android"]} />
    }
  />
);

const IosEmpty = () => (
  <Empty
    className={PANEL_EMPTY_CLASS}
    icon={<AppleIcon className="text-kumo-inactive size-10" />}
    title="No bundle identifiers"
    description="Register an iOS bundle identifier and bind distribution certificates, provisioning profiles, push keys, and App Store Connect API keys for this project from the CLI."
    contents={<CliCommandBlock commands={["better-update credentials configure --platform ios"]} />}
  />
);

/**
 * Which credential slots this bundle has something in. Only filled slots are
 * named: the row answers "is there a certificate for this bundle at all", and
 * which distribution type holds it — and what is still missing from each — is
 * what the detail page is for.
 */
const SIGNING_SLOT_LABELS: readonly (readonly [keyof IosSigningSlots, string])[] = [
  ["certificate", "Certificate"],
  ["profile", "Profile"],
  ["pushKey", "Push key"],
  ["ascKey", "ASC key"],
];

const SigningCell = ({ slots }: { slots: IosSigningSlots }) => {
  const bound = SIGNING_SLOT_LABELS.filter(([key]) => slots[key]);
  return bound.length === 0 ? (
    <EmptyDash />
  ) : (
    // One line, never wrapped: a stack of four badges would make this row twice
    // the height of every other one, and the primary column has the slack to
    // give up instead.
    <div className="flex gap-1">
      {bound.map(([key, label]) => (
        <Badge key={key} variant="secondary">
          {label}
        </Badge>
      ))}
    </div>
  );
};

const IosTeamCell = ({
  teamIds,
  teams,
}: {
  teamIds: readonly string[];
  teams: readonly AppleTeamItem[];
}) => {
  const [first, ...rest] = teamIds;
  if (first === undefined) {
    return <EmptyDash />;
  }
  // Two distribution types signing under different teams is rare and worth
  // saying plainly rather than picking one of them to show.
  if (rest.length > 0) {
    return <span className="text-kumo-subtle">{teamIds.length} teams</span>;
  }
  return <TeamNameCell team={teams.find((item) => item.id === first)} />;
};

const iosColumns = (teams: readonly AppleTeamItem[]): readonly ColumnDef<IosBundleGroup>[] => [
  {
    id: "bundleIdentifier",
    header: "Bundle identifier",
    // No width cap of its own — the column is the primary one, so the cell is
    // as wide as the table has to spare and truncates against that.
    cell: ({ row }) => (
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate font-mono font-medium">{row.original.bundleIdentifier}</span>
        {row.original.targetName === null && row.original.parentBundleIdentifier === null ? null : (
          <span className="text-kumo-subtle truncate text-xs">
            {row.original.targetName === null
              ? `Extension of ${row.original.parentBundleIdentifier}`
              : row.original.targetName}
          </span>
        )}
      </div>
    ),
    enableSorting: false,
    meta: { primary: true },
  },
  {
    id: "distribution",
    header: "Distribution",
    cell: ({ row }) => (
      <div className="flex gap-1">
        {row.original.distributionTypes.map((type) => (
          <Badge key={type} variant="outline">
            {DISTRIBUTION_LABELS[type]}
          </Badge>
        ))}
      </div>
    ),
    enableSorting: false,
  },
  {
    id: "team",
    header: "Apple team",
    cell: ({ row }) => <IosTeamCell teamIds={row.original.appleTeamIds} teams={teams} />,
    enableSorting: false,
  },
  {
    id: "signing",
    header: "Signing",
    cell: ({ row }) => <SigningCell slots={row.original.slots} />,
    enableSorting: false,
  },
  {
    id: "updatedAt",
    header: "Updated",
    cell: ({ row }) => <RelativeTime value={row.original.updatedAt} />,
    enableSorting: false,
    meta: { align: "right", muted: true },
  },
];

/**
 * The credential groups behind one Android application identifier. Read from
 * the cache the section has already filled, so the cells that show a group,
 * its keystore and its service accounts each ask for it without refetching.
 */
const useAndroidSummary = (orgId: string, identifierId: string) => {
  const { data: groups } = useSuspenseQuery(
    androidBuildCredentialsQueryOptions(orgId, identifierId),
  );
  const { data: keystores } = useSuspenseQuery(androidUploadKeystoresQueryOptions(orgId));
  return summarizeAndroidCredentials(groups.items, keystores.items);
};

const AndroidGroupCell = ({ orgId, identifierId }: { orgId: string; identifierId: string }) => {
  const summary = useAndroidSummary(orgId, identifierId);
  if (summary.defaultGroupName === null) {
    return <span className="text-kumo-subtle">Not configured</span>;
  }
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate font-medium">{summary.defaultGroupName}</span>
      {summary.groupCount > 1 ? (
        <span className="text-kumo-subtle text-xs">
          +{summary.groupCount - 1} more {summary.groupCount === 2 ? "group" : "groups"}
        </span>
      ) : null}
    </div>
  );
};

const AndroidKeystoreCell = ({ orgId, identifierId }: { orgId: string; identifierId: string }) => {
  const summary = useAndroidSummary(orgId, identifierId);
  return summary.keystoreAlias === null ? (
    <EmptyDash />
  ) : (
    <span className="font-mono text-xs">{summary.keystoreAlias}</span>
  );
};

const AndroidServiceAccountsCell = ({
  orgId,
  identifierId,
}: {
  orgId: string;
  identifierId: string;
}) => {
  const summary = useAndroidSummary(orgId, identifierId);
  if (!summary.hasSubmissionsKey && !summary.hasFcmKey) {
    return <EmptyDash />;
  }
  return (
    <div className="flex gap-1">
      {summary.hasSubmissionsKey ? <Badge variant="secondary">Submissions</Badge> : null}
      {summary.hasFcmKey ? <Badge variant="secondary">FCM v1</Badge> : null}
    </div>
  );
};

const androidColumns = (orgId: string): readonly ColumnDef<AndroidApplicationIdentifierItem>[] => [
  {
    id: "packageName",
    header: "Application identifier",
    cell: ({ row }) => (
      <span className="block truncate font-mono font-medium">{row.original.packageName}</span>
    ),
    enableSorting: false,
    meta: { primary: true },
  },
  {
    id: "group",
    header: "Credential group",
    cell: ({ row }) => <AndroidGroupCell orgId={orgId} identifierId={row.original.id} />,
    enableSorting: false,
  },
  {
    id: "keystore",
    header: "Upload keystore",
    cell: ({ row }) => <AndroidKeystoreCell orgId={orgId} identifierId={row.original.id} />,
    enableSorting: false,
  },
  {
    id: "serviceAccounts",
    header: "Service accounts",
    cell: ({ row }) => <AndroidServiceAccountsCell orgId={orgId} identifierId={row.original.id} />,
    enableSorting: false,
  },
  {
    id: "updatedAt",
    header: "Updated",
    cell: ({ row }) => <RelativeTime value={row.original.updatedAt} />,
    enableSorting: false,
    meta: { align: "right", muted: true },
  },
];

const AndroidSection = ({
  orgId,
  projectId,
  projectSlug,
}: {
  orgId: string;
  projectId: string;
  projectSlug: string;
}) => {
  const navigate = useNavigate();
  const { data } = useSuspenseQuery(androidApplicationIdentifiersQueryOptions(orgId, projectId));
  const { items } = data;

  // Every identifier's groups are fetched here, in one parallel batch, so the
  // cells below read warm cache instead of suspending row by row.
  useSuspenseQueries({
    queries: items.map((item) => androidBuildCredentialsQueryOptions(orgId, item.id)),
  });

  const pagination = useClientPagination(items, "identifier");
  const columns = useMemo(() => androidColumns(orgId), [orgId]);
  const tableData = useMemo(() => [...pagination.pageItems], [pagination.pageItems]);
  const table = useReactTable({
    data: tableData,
    columns: [...columns],
    enableSorting: false,
    getCoreRowModel: getCoreRowModel(),
  });

  const title = <PanelTitle icon={<AndroidIcon />} label="Android" />;

  if (items.length === 0) {
    return (
      <TablePanel title={title}>
        <AndroidEmpty />
      </TablePanel>
    );
  }

  return (
    <DataTableView
      table={table}
      columnsCount={columns.length}
      title={title}
      pagination={clientPaginationFooter(pagination)}
      onRowClick={async (item) => {
        await navigate({
          to: "/projects/$projectSlug/credentials/android/$packageName",
          params: { projectSlug, packageName: item.packageName },
        });
      }}
    />
  );
};

const IosSection = ({
  orgId,
  projectId,
  projectSlug,
}: {
  orgId: string;
  projectId: string;
  projectSlug: string;
}) => {
  const navigate = useNavigate();
  const { data } = useSuspenseQuery(iosBundleConfigurationsQueryOptions(orgId, projectId));
  const { data: teamsResult } = useSuspenseQuery(appleTeamsQueryOptions(orgId));

  const groups = useMemo(() => groupIosConfigs(data.items), [data.items]);
  const pagination = useClientPagination(groups, "bundle identifier");
  const columns = useMemo(() => iosColumns(teamsResult.items), [teamsResult.items]);
  const tableData = useMemo(() => [...pagination.pageItems], [pagination.pageItems]);
  const table = useReactTable({
    data: tableData,
    columns: [...columns],
    enableSorting: false,
    getCoreRowModel: getCoreRowModel(),
  });

  const title = <PanelTitle icon={<AppleIcon />} label="iOS" />;

  if (groups.length === 0) {
    return (
      <TablePanel title={title}>
        <IosEmpty />
      </TablePanel>
    );
  }

  return (
    <DataTableView
      table={table}
      columnsCount={columns.length}
      title={title}
      pagination={clientPaginationFooter(pagination)}
      onRowClick={async (group) => {
        await navigate({
          to: "/projects/$projectSlug/credentials/ios/$bundleIdentifier",
          params: { projectSlug, bundleIdentifier: group.bundleIdentifier },
        });
      }}
    />
  );
};

const ProjectCredentialsIndex = () => {
  const { activeOrg, project } = Route.useRouteContext();
  const { projectSlug } = Route.useParams();
  return (
    <div className="flex w-full flex-col gap-4">
      <PageHeader
        title="Credentials"
        description="App identifiers and their signing credentials for this project. Manage bindings from the CLI."
      />
      <Suspense fallback={<SectionListSkeleton />}>
        <AndroidSection orgId={activeOrg.id} projectId={project.id} projectSlug={projectSlug} />
      </Suspense>
      <Suspense fallback={<SectionListSkeleton />}>
        <IosSection orgId={activeOrg.id} projectId={project.id} projectSlug={projectSlug} />
      </Suspense>
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/credentials/")({
  component: ProjectCredentialsIndex,
});
