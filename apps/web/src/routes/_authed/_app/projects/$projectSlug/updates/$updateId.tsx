import {
  updateAnalyticsQueryOptions,
  updateAssetsQueryOptions,
  updateGroupQueryOptions,
  updateQueryOptions,
} from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/badge";
import { InputGroup } from "@better-update/ui/components/input-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/table";
import { FingerprintIcon, GitBranchIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useState } from "react";

import type { Update, UpdateAssetEntry } from "@better-update/api";

import { UpdateActionsMenu } from "../-update-actions-menu";
import { readUpdateEnvironment } from "../-update-helpers";
import { EnvironmentBadge, PlatformBadge } from "../../../../../../components/attribute-badges";
import { DetailHeader } from "../../../../../../components/detail-header";
import { DetailStat, DetailStatStrip } from "../../../../../../components/detail-stats";
import {
  DetailCardSkeleton,
  TablePanelSkeleton,
  TableRowsSkeleton,
} from "../../../../../../components/skeletons";
import { CopyButton, CopyableId } from "../../../../../../lib/copy-button";
import {
  ClientPaginationBar,
  ListPanel,
  ListPanelFooter,
  ListPanelHeader,
  PRIMARY_COLUMN_CLASS,
  useClientPagination,
} from "../../../../../../lib/data-table";
import { formatBytes } from "../../../../../../lib/format-bytes";
import { RelativeTime } from "../../../../../../lib/relative-time";
import { RouterLink } from "../../../../../../lib/resource-link";

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
    <ListPanel>
      {/* No description under the title: "shared values across all per-platform
          variants in this update group" is the title again in a longer voice.
          The title is the message, and the meta line above it already carries
          the runtime and when this was published — what is left is what the
          header cannot say, and four facts read as a strip rather than as a
          card's worth of air spent two-across. */}
      <ListPanelHeader title="Group metadata" />
      <DetailStatStrip>
        <DetailStat label="Branch">
          {branchName ? (
            <RouterLink
              to="/projects/$projectSlug/updates"
              params={{ projectSlug }}
              search={{ page: 1, sort: "-createdAt" as const, branchId: [primary.branchId] }}
              className="inline-flex items-center gap-1.5 font-medium"
            >
              <GitBranchIcon weight="bold" className="text-kumo-subtle size-3.5" />
              {branchName}
            </RouterLink>
          ) : (
            <CopyableId value={primary.branchId} label="Branch ID" />
          )}
        </DetailStat>
        <DetailStat label="Environment">
          {environment ? <EnvironmentBadge environment={environment} /> : "—"}
        </DetailStat>
        {/* With one variant the group total is that variant's size, which the
            panel below already states. */}
        {variants.length > 1 ? (
          <DetailStat label="Total size">
            {groupTotalSize > 0 ? formatBytes(groupTotalSize) : "—"}
          </DetailStat>
        ) : null}
        <DetailStat label="Fingerprint">
          {primary.fingerprintHash === null ? (
            <span className="text-kumo-subtle italic">Not recorded</span>
          ) : (
            <>
              <RouterLink
                to="/projects/$projectSlug/fingerprints/$hash"
                params={{ projectSlug, hash: primary.fingerprintHash }}
                className="inline-flex items-center gap-1 font-mono text-xs"
              >
                <FingerprintIcon weight="bold" className="size-3" />
                {primary.fingerprintHash.slice(0, 12)}
              </RouterLink>
              <CopyButton value={primary.fingerprintHash} label="Fingerprint" />
            </>
          )}
        </DetailStat>
      </DetailStatStrip>
    </ListPanel>
  );
};

/** Show the asset filter input only once the list is long enough to need it. */
const ASSET_FILTER_THRESHOLD = 8;

type UpdateAsset = typeof UpdateAssetEntry.Type;

/**
 * A bundle's asset manifest, as rows.
 *
 * Each asset used to be its own bordered box, stacked inside a card, inside the
 * page — a card in a card in a card, drawn twice over on any update that ships
 * both platforms. A manifest is a two-column table of paths and the hashes they
 * resolve to, and the Cloudflare dashboard draws that as hairline rows in one
 * frame, which is also what lets the paths line up column-wise to be scanned.
 */
const AssetRows = ({ assets }: { assets: readonly UpdateAsset[] }) => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead className={PRIMARY_COLUMN_CLASS}>Asset</TableHead>
        <TableHead>Hash</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {assets.map((asset) => (
        <TableRow key={`${asset.hash}:${asset.key}`}>
          <TableCell className={PRIMARY_COLUMN_CLASS}>
            <span className="flex min-w-0 items-center gap-2">
              <code className="min-w-0 truncate font-mono text-xs" title={asset.key}>
                {asset.key}
              </code>
              <CopyButton value={asset.key} label="Asset key" size="xs" />
              {/* One asset in a manifest launches the bundle, so the mark rides
                  in the row it belongs to rather than in a column of blanks. */}
              {asset.isLaunch ? <Badge variant="secondary">Launch</Badge> : null}
            </span>
          </TableCell>
          <TableCell>
            <CopyableId value={asset.hash} label="Asset hash" length={12} />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

/** One page of the manifest, closed by the count the panel is read off. */
const AssetPage = ({ assets, query }: { assets: readonly UpdateAsset[]; query: string }) => {
  const pagination = useClientPagination(assets, "asset");
  if (assets.length === 0) {
    return (
      <ListPanelFooter>
        <span className="text-kumo-subtle text-sm">No assets match “{query}”.</span>
      </ListPanelFooter>
    );
  }
  return (
    <>
      <AssetRows assets={pagination.pageItems} />
      <ListPanelFooter>
        <ClientPaginationBar state={pagination} />
      </ListPanelFooter>
    </>
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
  const [query, setQuery] = useState("");
  if (assets.length === 0) {
    return (
      <ListPanelFooter>
        <span className="text-kumo-subtle text-sm">No asset references recorded.</span>
      </ListPanelFooter>
    );
  }
  const normalizedQuery = query.trim().toLowerCase();
  const visibleAssets = normalizedQuery
    ? assets.filter(
        (asset) =>
          asset.key.toLowerCase().includes(normalizedQuery) ||
          asset.hash.toLowerCase().includes(normalizedQuery),
      )
    : assets;
  return (
    <>
      {assets.length > ASSET_FILTER_THRESHOLD ? (
        <div className="border-kumo-line border-b p-4">
          <InputGroup className="w-full sm:w-64">
            <InputGroup.Input
              type="search"
              value={query}
              placeholder="Filter assets…"
              onChange={(event) => {
                setQuery(event.target.value);
              }}
            />
            <InputGroup.Addon>
              <MagnifyingGlassIcon />
            </InputGroup.Addon>
          </InputGroup>
        </div>
      ) : null}
      {/* Keyed by the filter so a narrowed list opens on its own first page. */}
      <AssetPage key={normalizedQuery} assets={visibleAssets} query={query.trim()} />
    </>
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
  return <>{data.totalRequests.toLocaleString()}</>;
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
  <ListPanel>
    <ListPanelHeader
      title={
        <span className="flex items-center gap-2">
          <PlatformBadge platform={update.platform} />
          <CopyableId value={update.id} label="Update ID" />
          {update.isRollback ? <Badge variant="error">Rollback</Badge> : null}
        </span>
      }
      description={
        update.rolloutPercentage < 100
          ? `Rolling out to ${update.rolloutPercentage}% of devices`
          : "Fully rolled out"
      }
    />
    <DetailStatStrip className="border-kumo-line border-b">
      {/* Signed is what publishing does by default, so it is stated and left
          alone — only a variant nothing vouches for takes a colour. */}
      <DetailStat label="Signature">
        {update.signature === null ? <Badge variant="warning">Unsigned</Badge> : "Signed"}
      </DetailStat>
      <DetailStat label="Manifest body">
        {update.manifestBody === null ? "Not stored" : "Stored"}
      </DetailStat>
      <DetailStat label="Size">
        {update.totalAssetSize > 0 ? formatBytes(update.totalAssetSize) : "—"}
      </DetailStat>
      <DetailStat label="Downloads (30d)">
        <Suspense fallback={<span className="text-kumo-subtle">…</span>}>
          <PlatformVariantDownloads orgId={orgId} projectId={projectId} updateId={update.id} />
        </Suspense>
      </DetailStat>
    </DetailStatStrip>
    <Suspense fallback={<TableRowsSkeleton columns={2} rows={3} />}>
      <PlatformVariantAssets orgId={orgId} projectId={projectId} updateId={update.id} />
    </Suspense>
  </ListPanel>
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

  const primary = group.items.find((entry) => entry.id === updateId) ?? group.items[0] ?? update;
  const title = primary.message || `Update ${update.groupId.slice(0, 8)}`;
  const { branchName } = primary;

  return (
    <>
      <DetailHeader
        title={title}
        badges={primary.isRollback ? <Badge variant="error">Rollback</Badge> : null}
        meta={
          <>
            <CopyableId value={primary.groupId} label="Update group ID" />
            {/* The runtime moved up out of the card below; it keeps the link it
                had there, so nothing became read-only on the way. */}
            <RouterLink
              to="/projects/$projectSlug/runtimes/$version"
              params={{ projectSlug, version: primary.runtimeVersion }}
              className="font-mono text-xs"
            >
              v{primary.runtimeVersion}
            </RouterLink>
            <span>
              Published <RelativeTime value={primary.createdAt} />
            </span>
          </>
        }
        actions={
          <UpdateActionsMenu
            update={primary}
            branchName={branchName}
            slug={project.slug}
            orgId={orgId}
            projectId={projectId}
            onDeleted={async () => {
              await navigate({ to: "/projects/$projectSlug/updates", params: { projectSlug } });
            }}
          />
        }
      />
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

// Shaped like what arrives: the shared-values strip, then a variant panel that
// closes on its manifest.
const UpdateDetailSkeleton = () => (
  <>
    <DetailHeader title="Update" />
    <DetailCardSkeleton rows={1} columns={4} hasDescription={false} />
    <TablePanelSkeleton columns={2} rows={3} />
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
