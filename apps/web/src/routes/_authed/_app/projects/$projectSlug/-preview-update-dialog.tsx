import { buildsQueryOptions } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogPopup,
  DialogDescription,
  DialogHeader,
  DialogPanel,
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
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CheckIcon, CopyIcon, EyeIcon, PackageIcon } from "lucide-react";
import { Suspense, useState } from "react";

import type { Channel, Update } from "@better-update/api";

import {
  ChannelBadge,
  DistributionBadge,
  PlatformBadge,
} from "../../../../../components/attribute-badges";
import { useCopyToClipboard } from "../../../../../lib/use-copy-to-clipboard";
import { DROPDOWN_FETCH_LIMIT } from "../../../../../queries/constants";

type UpdateItem = Update;
type ChannelItem = Channel;

const QA_DISTRIBUTIONS = new Set(["development", "ad-hoc", "enterprise", "simulator", "direct"]);

const CopyIconButton = ({ text, label }: { text: string; label: string }) => {
  const { copied, copy } = useCopyToClipboard();
  const handleCopy = async () => {
    const ok = await copy(text);
    if (!ok) {
      toastManager.add({ title: "Failed to copy to clipboard", type: "error" });
    }
  };
  const Icon = copied ? CheckIcon : CopyIcon;
  return (
    <Button variant="ghost" size="icon-xs" aria-label={label} onClick={handleCopy}>
      <Icon strokeWidth={2} />
    </Button>
  );
};

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
      limit: DROPDOWN_FETCH_LIMIT,
    }),
  );

  const qaBuilds = data.items.filter((build) => QA_DISTRIBUTIONS.has(build.distribution));

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
  channelName,
  projectSlug,
  orgId,
  projectId,
}: {
  update: UpdateItem;
  branchName: string | undefined;
  channelName: string | undefined;
  projectSlug: string;
  orgId: string;
  projectId: string;
}) => (
  <DialogPanel className="flex flex-col gap-4">
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
          <CopyIconButton text={update.groupId} label="Copy group ID" />
        </InputGroupAddon>
      </InputGroup>
    </div>

    <div className="flex flex-col gap-2">
      <span className="text-muted-foreground text-xs font-medium uppercase">Compatible builds</span>
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
  </DialogPanel>
);

export const PreviewUpdateDialog = ({
  update,
  branchName,
  channels,
  projectSlug,
  orgId,
  projectId,
}: {
  update: UpdateItem;
  branchName: string | undefined;
  channels: readonly ChannelItem[];
  projectSlug: string;
  orgId: string;
  projectId: string;
}) => {
  const [open, setOpen] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  const channelName = channels.find((channel) => channel.branchId === update.branchId)?.name;

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Preview update"
        onClick={() => {
          setOpen(true);
        }}
      >
        <EyeIcon strokeWidth={2} />
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        onOpenChangeComplete={(next) => {
          if (!next) {
            setResetKey((prev) => prev + 1);
          }
        }}
      >
        <DialogPopup className="sm:max-w-lg">
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
            channelName={channelName}
            projectSlug={projectSlug}
            orgId={orgId}
            projectId={projectId}
          />
        </DialogPopup>
      </Dialog>
    </>
  );
};
