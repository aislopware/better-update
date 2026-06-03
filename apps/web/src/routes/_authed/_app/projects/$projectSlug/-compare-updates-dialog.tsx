import {
  branchesQueryOptions,
  updateAssetsQueryOptions,
  updatesQueryOptions,
} from "@better-update/api-client/react";
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
  Select,
  SelectPopup,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { Spinner } from "@better-update/ui/components/ui/spinner";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ArrowLeftRightIcon, ArrowRightIcon, GitCompareIcon } from "lucide-react";
import { Suspense, useState } from "react";

import type { Update } from "@better-update/api";

import { formatDateTime } from "../../../../../lib/format-date";
import { DROPDOWN_FETCH_LIMIT } from "../../../../../queries/constants";

type UpdateItem = Update;

interface CompareUpdatesDialogProps {
  readonly orgId: string;
  readonly projectId: string;
}

const formatUpdateLabel = (update: UpdateItem, branchName: string) => {
  const messagePart = update.message ? update.message.slice(0, 40) : update.groupId.slice(0, 8);
  return `${branchName} • ${update.platform} • v${update.runtimeVersion} • ${messagePart}`;
};

const MetadataRow = ({
  label,
  left,
  right,
  highlight,
}: {
  label: string;
  left: string;
  right: string;
  highlight: boolean;
}) => (
  <div
    className={`grid grid-cols-[120px_1fr_1fr] items-center gap-3 rounded-lg px-3 py-2 text-sm ${
      highlight ? "bg-warning/10" : ""
    }`}
  >
    <span className="text-muted-foreground font-medium">{label}</span>
    <span className="truncate font-mono text-xs">{left}</span>
    <span className="truncate font-mono text-xs">{right}</span>
  </div>
);

const formatBool = (value: boolean): string => (value ? "yes" : "no");

const MetadataComparison = ({
  left,
  right,
  branchName,
}: {
  left: UpdateItem;
  right: UpdateItem;
  branchName: (id: string) => string;
}) => {
  const rows = [
    { label: "Group ID", valueA: left.groupId, valueB: right.groupId },
    { label: "Update ID", valueA: left.id, valueB: right.id },
    { label: "Platform", valueA: left.platform, valueB: right.platform },
    { label: "Runtime", valueA: left.runtimeVersion, valueB: right.runtimeVersion },
    {
      label: "Branch",
      valueA: branchName(left.branchId),
      valueB: branchName(right.branchId),
    },
    { label: "Message", valueA: left.message || "—", valueB: right.message || "—" },
    {
      label: "Rollout",
      valueA: `${left.rolloutPercentage}%`,
      valueB: `${right.rolloutPercentage}%`,
    },
    {
      label: "Rollback",
      valueA: formatBool(left.isRollback),
      valueB: formatBool(right.isRollback),
    },
    {
      label: "Signed",
      valueA: formatBool(left.signature !== null),
      valueB: formatBool(right.signature !== null),
    },
    {
      label: "Fingerprint",
      valueA: left.fingerprintHash === null ? "—" : `${left.fingerprintHash.slice(0, 12)}…`,
      valueB: right.fingerprintHash === null ? "—" : `${right.fingerprintHash.slice(0, 12)}…`,
    },
    {
      label: "Created at",
      valueA: formatDateTime(left.createdAt),
      valueB: formatDateTime(right.createdAt),
    },
  ];

  return (
    <div className="flex flex-col gap-1">
      <div className="text-muted-foreground grid grid-cols-[120px_1fr_1fr] gap-3 px-3 text-xs font-medium uppercase">
        <span>Field</span>
        <span>Update A</span>
        <span>Update B</span>
      </div>
      {rows.map((row) => (
        <MetadataRow
          key={row.label}
          label={row.label}
          left={row.valueA}
          right={row.valueB}
          highlight={row.valueA !== row.valueB}
        />
      ))}
    </div>
  );
};

interface AssetDiff {
  readonly addedCount: number;
  readonly removedCount: number;
  readonly unchangedCount: number;
  readonly added: readonly { readonly hash: string; readonly key: string }[];
  readonly removed: readonly { readonly hash: string; readonly key: string }[];
}

export const diffAssets = (
  leftAssets: readonly { readonly hash: string; readonly key: string }[],
  rightAssets: readonly { readonly hash: string; readonly key: string }[],
): AssetDiff => {
  const leftHashes = new Set(leftAssets.map((asset) => asset.hash));
  const rightHashes = new Set(rightAssets.map((asset) => asset.hash));
  const added = rightAssets.filter((asset) => !leftHashes.has(asset.hash));
  const removed = leftAssets.filter((asset) => !rightHashes.has(asset.hash));
  const unchangedCount = leftAssets.length - removed.length;
  return {
    addedCount: added.length,
    removedCount: removed.length,
    unchangedCount,
    added: added.map((asset) => ({ hash: asset.hash, key: asset.key })),
    removed: removed.map((asset) => ({ hash: asset.hash, key: asset.key })),
  };
};

const AssetList = ({
  title,
  variant,
  items,
}: {
  title: string;
  variant: "success" | "destructive";
  items: readonly { readonly hash: string; readonly key: string }[];
}) => {
  if (items.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="text-muted-foreground text-xs font-medium uppercase">{title}</div>
      <ul className="flex flex-col gap-1">
        {items.slice(0, 10).map((asset) => (
          <li key={asset.hash} className="flex items-center gap-2 text-xs">
            <Badge variant={variant}>{variant === "success" ? "+" : "−"}</Badge>
            <span className="truncate font-mono">{asset.key}</span>
            <span className="text-muted-foreground truncate font-mono">
              {asset.hash.slice(0, 12)}
            </span>
          </li>
        ))}
        {items.length > 10 ? (
          <li className="text-muted-foreground text-xs">+{items.length - 10} more</li>
        ) : null}
      </ul>
    </div>
  );
};

const AssetComparison = ({
  orgId,
  projectId,
  leftId,
  rightId,
}: {
  orgId: string;
  projectId: string;
  leftId: string;
  rightId: string;
}) => {
  const { data: leftAssets } = useSuspenseQuery(updateAssetsQueryOptions(orgId, projectId, leftId));
  const { data: rightAssets } = useSuspenseQuery(
    updateAssetsQueryOptions(orgId, projectId, rightId),
  );

  const diff = diffAssets(leftAssets, rightAssets);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="outline">{leftAssets.length} assets in A</Badge>
        <Badge variant="outline">{rightAssets.length} assets in B</Badge>
        <Badge variant="success">+{diff.addedCount} added</Badge>
        <Badge variant="destructive">−{diff.removedCount} removed</Badge>
        <Badge variant="secondary">{diff.unchangedCount} unchanged</Badge>
      </div>
      <div className="flex flex-col gap-3">
        <AssetList title="Only in B (added)" variant="success" items={diff.added} />
        <AssetList title="Only in A (removed)" variant="destructive" items={diff.removed} />
      </div>
    </div>
  );
};

const AssetComparisonSkeleton = () => (
  <div className="text-muted-foreground flex items-center gap-2 py-4 text-sm">
    <Spinner />
    <span>Loading asset diff…</span>
  </div>
);

const UpdateSelector = ({
  label,
  value,
  onChange,
  options,
  branchName,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  options: readonly UpdateItem[];
  branchName: (id: string) => string;
}) => {
  const itemLabels: Record<string, string> = Object.fromEntries(
    options.map((update) => [update.id, formatUpdateLabel(update, branchName(update.branchId))]),
  );
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-muted-foreground text-xs font-medium uppercase">{label}</span>
      <Select
        items={itemLabels}
        value={value}
        onValueChange={(next) => {
          if (next) {
            onChange(next);
          }
        }}
      >
        <SelectTrigger>
          <SelectValue placeholder="Choose an update" />
        </SelectTrigger>
        <SelectPopup>
          <SelectGroup>
            {options.map((update) => (
              <SelectItem key={update.id} value={update.id}>
                {formatUpdateLabel(update, branchName(update.branchId))}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectPopup>
      </Select>
    </div>
  );
};

const CompareResult = ({
  left,
  right,
  branchName,
  orgId,
  projectId,
}: {
  left: UpdateItem | undefined;
  right: UpdateItem | undefined;
  branchName: (id: string) => string;
  orgId: string;
  projectId: string;
}) => {
  if (left === undefined || right === undefined) {
    return (
      <div className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm">
        <ArrowRightIcon strokeWidth={2} className="size-4" />
        <span>Pick two updates above to compare.</span>
      </div>
    );
  }
  if (left.id === right.id) {
    return (
      <div className="text-muted-foreground py-4 text-center text-sm">
        Select two different updates to see a comparison.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Metadata</h3>
        <MetadataComparison left={left} right={right} branchName={branchName} />
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Assets</h3>
        <Suspense fallback={<AssetComparisonSkeleton />}>
          <AssetComparison
            orgId={orgId}
            projectId={projectId}
            leftId={left.id}
            rightId={right.id}
          />
        </Suspense>
      </section>
    </div>
  );
};

const CompareBody = ({ orgId, projectId }: { orgId: string; projectId: string }) => {
  const { data: updatesData } = useSuspenseQuery(
    updatesQueryOptions(orgId, projectId, { limit: DROPDOWN_FETCH_LIMIT }),
  );
  const { data: branchesData } = useSuspenseQuery(
    branchesQueryOptions(orgId, projectId, { limit: DROPDOWN_FETCH_LIMIT }),
  );
  const updates = updatesData.items;
  const branches = branchesData.items;

  const [leftId, setLeftId] = useState<string>("");
  const [rightId, setRightId] = useState<string>("");

  const branchName = (id: string): string =>
    branches.find((branch) => branch.id === id)?.name ?? id.slice(0, 8);

  const left = updates.find((update) => update.id === leftId);
  const right = updates.find((update) => update.id === rightId);

  const swap = () => {
    setLeftId(rightId);
    setRightId(leftId);
  };

  if (updates.length < 2) {
    return (
      <DialogPanel>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <GitCompareIcon strokeWidth={1.5} />
            </EmptyMedia>
            <EmptyTitle>Not enough updates to compare</EmptyTitle>
            <EmptyDescription>
              You need at least two updates in this project before you can compare them.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </DialogPanel>
    );
  }

  return (
    <DialogPanel className="flex flex-col gap-4">
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
        <UpdateSelector
          label="Update A"
          value={leftId}
          onChange={setLeftId}
          options={updates}
          branchName={branchName}
        />
        <Button
          variant="ghost"
          size="icon"
          aria-label="Swap A and B"
          disabled={!leftId || !rightId}
          onClick={swap}
        >
          <ArrowLeftRightIcon strokeWidth={2} />
        </Button>
        <UpdateSelector
          label="Update B"
          value={rightId}
          onChange={setRightId}
          options={updates}
          branchName={branchName}
        />
      </div>

      <CompareResult
        left={left}
        right={right}
        branchName={branchName}
        orgId={orgId}
        projectId={projectId}
      />
    </DialogPanel>
  );
};

const CompareBodySkeleton = () => (
  <DialogPanel>
    <div className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm">
      <Spinner />
      <span>Loading updates…</span>
    </div>
  </DialogPanel>
);

export const CompareUpdatesDialog = ({ orgId, projectId }: CompareUpdatesDialogProps) => {
  const [open, setOpen] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setOpen(true);
        }}
      >
        <GitCompareIcon strokeWidth={2} data-icon="inline-start" />
        Compare
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
        <DialogPopup className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Compare updates</DialogTitle>
            <DialogDescription>
              Pick two updates to compare metadata and asset differences side-by-side.
            </DialogDescription>
          </DialogHeader>
          <Suspense fallback={<CompareBodySkeleton />}>
            <CompareBody key={resetKey} orgId={orgId} projectId={projectId} />
          </Suspense>
        </DialogPopup>
      </Dialog>
    </>
  );
};
