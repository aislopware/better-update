import {
  branchesQueryOptions,
  channelsQueryOptions,
  updateAnalyticsQueryOptions,
  updateAssetsQueryOptions,
  updateGroupQueryOptions,
  updateQueryOptions,
} from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/ui/card";
import { Item, ItemActions, ItemContent, ItemGroup } from "@better-update/ui/components/ui/item";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { FingerprintIcon, GitBranchIcon } from "lucide-react";
import { Suspense } from "react";

import type { Update } from "@better-update/api";

import { UpdateActionsMenu } from "../-update-actions-menu";
import { readUpdateEnvironment } from "../-update-helpers";
import { EnvironmentBadge, PlatformBadge } from "../../../../../../components/attribute-badges";
import { PageHeader } from "../../../../../../components/page-header";
import { DetailCardSkeleton } from "../../../../../../components/skeletons";
import { CopyButton, CopyableId } from "../../../../../../lib/copy-button";
import { formatBytes } from "../../../../../../lib/format-bytes";
import { RelativeTime } from "../../../../../../lib/relative-time";
import { DROPDOWN_FETCH_LIMIT } from "../../../../../../queries/constants";

type UpdateItem = Update;

const OverviewCard = ({
  primary,
  variants,
  projectSlug,
  branchName,
}: {
  primary: UpdateItem;
  variants: readonly UpdateItem[];
  projectSlug: string;
  branchName: string | undefined;
}) => {
  const environment = readUpdateEnvironment(primary.extraJson);
  const groupTotalSize = variants.reduce((acc, variant) => acc + variant.totalAssetSize, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Group metadata</CardTitle>
        <CardDescription>
          Shared values across all per-platform variants in this update group.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <div className="text-muted-foreground text-sm">Message</div>
          <div className="font-medium">{primary.message || "—"}</div>
        </div>
        <div className="flex flex-col gap-1">
          <div className="text-muted-foreground text-sm">Branch</div>
          {branchName ? (
            <Link
              to="/projects/$projectSlug/updates"
              params={{ projectSlug }}
              search={{ page: 1, sort: "-createdAt" as const, branchId: [primary.branchId] }}
              className="inline-flex items-center gap-1.5 font-medium underline-offset-4 hover:underline"
            >
              <GitBranchIcon strokeWidth={2} className="text-muted-foreground size-3.5" />
              {branchName}
            </Link>
          ) : (
            <CopyableId value={primary.branchId} label="Branch ID" />
          )}
        </div>
        <div className="flex flex-col gap-1">
          <div className="text-muted-foreground text-sm">Runtime version</div>
          <Link
            to="/projects/$projectSlug/runtimes/$version"
            params={{ projectSlug, version: primary.runtimeVersion }}
            className="self-start font-medium underline-offset-4 hover:underline"
          >
            v{primary.runtimeVersion}
          </Link>
        </div>
        <div className="flex flex-col gap-1">
          <div className="text-muted-foreground text-sm">Environment</div>
          {environment ? (
            <EnvironmentBadge environment={environment} className="self-start" />
          ) : (
            <div className="font-medium">—</div>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <div className="text-muted-foreground text-sm">Total size</div>
          <div className="font-medium">
            {groupTotalSize > 0 ? formatBytes(groupTotalSize) : "—"}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <div className="text-muted-foreground text-sm">Created</div>
          <div className="font-medium">
            <RelativeTime value={primary.createdAt} />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <div className="text-muted-foreground text-sm">Fingerprint</div>
          {primary.fingerprintHash === null ? (
            <span className="text-muted-foreground text-sm italic">Not recorded</span>
          ) : (
            <div className="flex items-center gap-1">
              <Link
                to="/projects/$projectSlug/fingerprints/$hash"
                params={{ projectSlug, hash: primary.fingerprintHash }}
                className="hover:text-foreground text-muted-foreground inline-flex items-center gap-1 font-mono text-xs transition-colors"
              >
                <FingerprintIcon strokeWidth={2} className="size-3" />
                {primary.fingerprintHash.slice(0, 16)}
              </Link>
              <CopyButton value={primary.fingerprintHash} label="Fingerprint" />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

const PlatformVariantAssets = ({
  orgId,
  projectId,
  updateId,
}: {
  orgId: string;
  projectId: string;
  updateId: string;
}) => {
  const { data: assets } = useSuspenseQuery(updateAssetsQueryOptions(orgId, projectId, updateId));
  if (assets.length === 0) {
    return <p className="text-muted-foreground text-sm">No asset references recorded.</p>;
  }
  return (
    <ItemGroup>
      {assets.map((asset) => (
        <Item key={`${asset.hash}:${asset.key}`} variant="outline" size="sm">
          <ItemContent className="min-w-0 gap-0.5">
            <div className="flex items-center gap-1">
              <code className="min-w-0 truncate font-mono text-xs">{asset.key}</code>
              <CopyButton value={asset.key} label="Asset key" size="icon-xs" />
            </div>
            <div className="flex items-center gap-1">
              <code className="text-muted-foreground min-w-0 truncate font-mono text-xs">
                {asset.hash.slice(0, 16)}
              </code>
              <CopyButton value={asset.hash} label="Asset hash" size="icon-xs" />
            </div>
          </ItemContent>
          {asset.isLaunch ? (
            <ItemActions>
              <Badge variant="secondary">Launch</Badge>
            </ItemActions>
          ) : null}
        </Item>
      ))}
    </ItemGroup>
  );
};

const PlatformVariantDownloads = ({
  orgId,
  projectId,
  updateId,
}: {
  orgId: string;
  projectId: string;
  updateId: string;
}) => {
  const { data } = useSuspenseQuery(updateAnalyticsQueryOptions(orgId, projectId, updateId, "30d"));
  return <div className="text-xs">{data.totalRequests.toLocaleString()}</div>;
};

const PlatformVariantCard = ({
  update,
  orgId,
  projectId,
}: {
  update: UpdateItem;
  orgId: string;
  projectId: string;
}) => (
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2 text-base">
        <PlatformBadge platform={update.platform} />
        <CopyableId value={update.id} label="Update ID" />
        {update.isRollback ? <Badge variant="destructive">Rollback</Badge> : null}
      </CardTitle>
      <CardDescription>
        {update.rolloutPercentage < 100
          ? `Rolling out to ${update.rolloutPercentage}% of devices`
          : "Fully rolled out"}
      </CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="flex flex-col gap-1">
          <div className="text-muted-foreground text-xs">Signature</div>
          <Badge variant={update.signature === null ? "outline" : "success"} className="self-start">
            {update.signature === null ? "Unsigned" : "Signed"}
          </Badge>
        </div>
        <div className="flex flex-col gap-1">
          <div className="text-muted-foreground text-xs">Manifest body</div>
          <Badge
            variant={update.manifestBody === null ? "outline" : "secondary"}
            className="self-start"
          >
            {update.manifestBody === null ? "Not stored" : "Stored"}
          </Badge>
        </div>
        <div className="flex flex-col gap-1">
          <div className="text-muted-foreground text-xs">Size</div>
          <div className="text-xs">
            {update.totalAssetSize > 0 ? formatBytes(update.totalAssetSize) : "—"}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <div className="text-muted-foreground text-xs">Downloads (30d)</div>
          <Suspense fallback={<div className="text-muted-foreground text-xs">…</div>}>
            <PlatformVariantDownloads orgId={orgId} projectId={projectId} updateId={update.id} />
          </Suspense>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <div className="text-muted-foreground text-sm">Assets</div>
        <Suspense fallback={<p className="text-muted-foreground text-xs">Loading assets...</p>}>
          <PlatformVariantAssets orgId={orgId} projectId={projectId} updateId={update.id} />
        </Suspense>
      </div>
    </CardContent>
  </Card>
);

const UpdateDetailContent = () => {
  const { updateId, projectSlug } = Route.useParams();
  const navigate = Route.useNavigate();
  const { activeOrg, project } = Route.useRouteContext();
  const orgId = activeOrg.id;
  const projectId = project.id;
  const { data: update } = useSuspenseQuery(updateQueryOptions(orgId, projectId, updateId));
  const { data: group } = useSuspenseQuery(
    updateGroupQueryOptions(orgId, projectId, update.groupId),
  );
  const { data: branchesData } = useSuspenseQuery(
    branchesQueryOptions(orgId, projectId, { limit: DROPDOWN_FETCH_LIMIT }),
  );
  const { data: channelsData } = useSuspenseQuery(
    channelsQueryOptions(orgId, projectId, { limit: DROPDOWN_FETCH_LIMIT }),
  );

  const primary = group.items.find((entry) => entry.id === updateId) ?? group.items[0] ?? update;
  const title = primary.message || `Update ${update.groupId.slice(0, 8)}`;
  const branchName = branchesData.items.find((branch) => branch.id === primary.branchId)?.name;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="flex flex-wrap items-center gap-2 text-lg font-semibold tracking-tight">
            <span className="truncate">{title}</span>
            {primary.isRollback ? <Badge variant="destructive">Rollback</Badge> : null}
          </h1>
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <CopyableId value={primary.groupId} label="Update group ID" />
            <span className="font-mono text-xs">v{primary.runtimeVersion}</span>
            <RelativeTime value={primary.createdAt} />
          </div>
        </div>
        <UpdateActionsMenu
          update={primary}
          channels={channelsData.items}
          branchName={branchName}
          slug={project.slug}
          orgId={orgId}
          projectId={projectId}
          onDeleted={async () => {
            await navigate({ to: "/projects/$projectSlug/updates", params: { projectSlug } });
          }}
        />
      </div>
      <OverviewCard
        primary={primary}
        variants={group.items}
        projectSlug={project.slug}
        branchName={branchName}
      />
      <div className="flex flex-col gap-3">
        <h2 className="font-heading text-base leading-none font-semibold">Platform variants</h2>
        {group.items.map((variant) => (
          <PlatformVariantCard
            key={variant.id}
            update={variant}
            orgId={orgId}
            projectId={projectId}
          />
        ))}
      </div>
    </>
  );
};

const UpdateDetailSkeleton = () => (
  <>
    <PageHeader size="sub" title="Update" />
    <DetailCardSkeleton rows={4} columns={2} />
    <DetailCardSkeleton rows={2} columns={2} />
  </>
);

const UpdateDetailPage = () => (
  <div className="flex w-full flex-col gap-4">
    <Suspense fallback={<UpdateDetailSkeleton />}>
      <UpdateDetailContent />
    </Suspense>
  </div>
);

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/updates/$updateId")({
  component: UpdateDetailPage,
});
