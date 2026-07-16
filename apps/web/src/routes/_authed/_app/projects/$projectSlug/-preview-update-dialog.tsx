import { buildsQueryOptions, channelsQueryOptions } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@better-update/ui/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@better-update/ui/components/ui/input-group";
import { Spinner } from "@better-update/ui/components/ui/spinner";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { PackageIcon } from "lucide-react";
import { Suspense, useState } from "react";

import type { Update } from "@better-update/api";
import type { BuildDistribution } from "@better-update/api-client/react";

import {
  ChannelBadge,
  DistributionBadge,
  PlatformBadge,
} from "../../../../../components/attribute-badges";
import { CopyButton } from "../../../../../lib/copy-button";
import { DROPDOWN_FETCH_LIMIT } from "../../../../../queries/constants";

type UpdateItem = Update;

// Filtered server-side so QA builds surface even when the first page of the
// unfiltered list is all store builds.
const QA_DISTRIBUTIONS = [
  "development",
  "ad-hoc",
  "enterprise",
  "simulator",
  "direct",
] as const satisfies readonly BuildDistribution[];

const CompatibleBuildsList = ({
  orgId,
  projectId,
  projectSlug,
  runtimeVersion,
  platform,
}: {
  orgId: string;
  projectId: string;
  projectSlug: string;
  runtimeVersion: string;
  platform: "ios" | "android";
}) => {
  const { data } = useSuspenseQuery(
    buildsQueryOptions(orgId, projectId, {
      runtimeVersion,
      platform,
      distribution: QA_DISTRIBUTIONS,
      limit: DROPDOWN_FETCH_LIMIT,
    }),
  );

  const qaBuilds = data.items;

  if (qaBuilds.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <PackageIcon strokeWidth={1.5} />
          </EmptyMedia>
          <EmptyTitle>No compatible builds</EmptyTitle>
          <EmptyDescription>
            Build a development build on runtime v{runtimeVersion} for {platform} to install this
            update for testing.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {qaBuilds.map((build) => (
        <li
          key={build.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-3"
        >
          <div className="flex min-w-0 flex-col gap-1">
            <span className="truncate font-medium">
              {(build.message ?? build.profile) || `Build ${build.id.slice(0, 8)}`}
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <PlatformBadge platform={build.platform} />
              <DistributionBadge distribution={build.distribution} />
              {build.appVersion ? (
                <span className="text-muted-foreground text-xs">app v{build.appVersion}</span>
              ) : null}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            render={
              <Link
                to="/projects/$projectSlug/builds/$buildId"
                params={{ projectSlug, buildId: build.id }}
              />
            }
          >
            Open build
          </Button>
        </li>
      ))}
    </ul>
  );
};

const CompatibleBuildsSkeleton = () => (
  <div className="flex items-center justify-center gap-2 py-6">
    <Spinner />
    <span className="text-muted-foreground text-sm">Loading compatible builds…</span>
  </div>
);

const PreviewBody = ({
  update,
  branchName,
  projectSlug,
  orgId,
  projectId,
}: {
  update: UpdateItem;
  branchName: string | undefined;
  projectSlug: string;
  orgId: string;
  projectId: string;
}) => {
  // Resolved server-side by linked branch (exact regardless of channel count);
  // only fetched while the dialog body is mounted. The badge simply stays
  // hidden until it resolves — it is informational, not blocking.
  const { data: servingChannels } = useQuery(
    channelsQueryOptions(orgId, projectId, { branchId: update.branchId, limit: 1 }),
  );
  const channelName = servingChannels?.items[0]?.name;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <PlatformBadge platform={update.platform} />
        <Badge variant="outline">v{update.runtimeVersion}</Badge>
        {channelName ? <ChannelBadge name={channelName} /> : null}
        {branchName ? <span className="text-muted-foreground">on {branchName}</span> : null}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-muted-foreground text-xs font-medium uppercase">Update group</span>
        <InputGroup>
          <InputGroupInput readOnly value={update.groupId} className="font-mono text-xs" />
          <InputGroupAddon align="inline-end">
            <CopyButton value={update.groupId} label="Group ID" size="icon-xs" />
          </InputGroupAddon>
        </InputGroup>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-muted-foreground text-xs font-medium uppercase">
          Compatible builds
        </span>
        <Suspense fallback={<CompatibleBuildsSkeleton />}>
          <CompatibleBuildsList
            orgId={orgId}
            projectId={projectId}
            projectSlug={projectSlug}
            runtimeVersion={update.runtimeVersion}
            platform={update.platform}
          />
        </Suspense>
      </div>
    </div>
  );
};

export const PreviewUpdateDialog = ({
  update,
  branchName,
  projectSlug,
  orgId,
  projectId,
  open,
  onOpenChange,
}: {
  update: UpdateItem;
  branchName: string | undefined;
  projectSlug: string;
  orgId: string;
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const [resetKey, setResetKey] = useState(0);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(next) => {
        if (!next) {
          setResetKey((prev) => prev + 1);
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Preview update</DialogTitle>
          <DialogDescription>
            Pick a compatible development build to install this update on a device.
          </DialogDescription>
        </DialogHeader>
        <PreviewBody
          key={resetKey}
          update={update}
          branchName={branchName}
          projectSlug={projectSlug}
          orgId={orgId}
          projectId={projectId}
        />
      </DialogContent>
    </Dialog>
  );
};
