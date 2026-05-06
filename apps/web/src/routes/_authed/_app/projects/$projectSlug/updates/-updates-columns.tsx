import { deleteUpdateGroup } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import { RocketIcon, Trash2Icon, Undo2Icon } from "lucide-react";
import { useState } from "react";

import type { Channel, Update } from "@better-update/api";
import type { ColumnDef } from "@tanstack/react-table";

import { PromoteUpdateDialog } from "../-promote-update-dialog";
import { RollbackToEmbeddedDialog } from "../-rollback-to-embedded-dialog";
import { invalidateUpdates, readUpdateEnvironment } from "../-update-helpers";
import { formatRelativeTime } from "../../../../../../lib/format-relative-time";
import { useApiMutation } from "../../../../../../lib/use-api-mutation";

export type UpdateItem = typeof Update.Type;
export type ChannelItem = typeof Channel.Type;

export interface ColumnMeta {
  readonly align?: "right";
  readonly muted?: boolean;
}

const UpdateActions = ({
  update,
  channels,
  branchName,
  slug,
  orgId,
  projectId,
}: {
  update: UpdateItem;
  channels: readonly ChannelItem[];
  branchName: string | undefined;
  slug: string;
  orgId: string;
  projectId: string;
}) => {
  const queryClient = useQueryClient();
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [rollbackOpen, setRollbackOpen] = useState(false);

  const eligibleChannels = channels.filter((channel) => channel.branchId !== update.branchId);
  const canCreateFollowupUpdate = !update.isRollback && !update.signature;
  const canRollbackToEmbedded = canCreateFollowupUpdate && branchName !== undefined;
  const canPromote = canCreateFollowupUpdate && eligibleChannels.length > 0;

  const deleteUpdateGroupMutation = useApiMutation({
    mutationFn: async () => deleteUpdateGroup(update.groupId),
    onSuccess: async () => {
      toastManager.add({ title: "Update group deleted", type: "success" });
      await invalidateUpdates(queryClient, orgId, projectId);
    },
  });

  return (
    <div className="flex items-center justify-end gap-1">
      {canRollbackToEmbedded ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          title="Rollback to embedded"
          onClick={() => {
            setRollbackOpen(true);
          }}
        >
          <Undo2Icon strokeWidth={2} className="size-4" />
        </Button>
      ) : null}
      {canPromote ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          title="Promote to another channel"
          onClick={() => {
            setPromoteOpen(true);
          }}
        >
          <RocketIcon strokeWidth={2} className="size-4" />
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        title="Delete update group"
        disabled={deleteUpdateGroupMutation.isPending}
        onClick={() => {
          deleteUpdateGroupMutation.mutate();
        }}
      >
        <Trash2Icon strokeWidth={2} className="size-4" />
      </Button>
      {canRollbackToEmbedded ? (
        <RollbackToEmbeddedDialog
          update={update}
          branchName={branchName}
          slug={slug}
          orgId={orgId}
          projectId={projectId}
          open={rollbackOpen}
          onOpenChange={setRollbackOpen}
        />
      ) : null}
      {canPromote ? (
        <PromoteUpdateDialog
          update={update}
          channels={eligibleChannels}
          orgId={orgId}
          projectId={projectId}
          open={promoteOpen}
          onOpenChange={setPromoteOpen}
        />
      ) : null}
    </div>
  );
};

export const buildUpdateColumns = (
  branchNames: ReadonlyMap<string, string>,
  channels: readonly ChannelItem[],
  slug: string,
  orgId: string,
  projectId: string,
): readonly ColumnDef<UpdateItem>[] => [
  {
    id: "message",
    header: "Update",
    cell: ({ row }) => {
      const environment = readUpdateEnvironment(row.original.extraJson);
      return (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 font-medium">
            <span className="truncate">{row.original.message || "—"}</span>
            {row.original.isRollback ? <Badge variant="destructive">Rollback</Badge> : null}
            {typeof environment === "string" ? (
              <Badge variant="secondary">{environment}</Badge>
            ) : null}
          </div>
          <code className="text-muted-foreground truncate font-mono text-xs">
            {row.original.groupId.slice(0, 8)}
          </code>
        </div>
      );
    },
    enableSorting: false,
  },
  {
    id: "branch",
    header: "Branch",
    cell: ({ row }) => branchNames.get(row.original.branchId) ?? row.original.branchId,
    enableSorting: false,
  },
  {
    id: "platform",
    accessorKey: "platform",
    header: "Platform",
    cell: ({ row }) => <Badge variant="outline">{row.original.platform}</Badge>,
    enableSorting: true,
  },
  {
    id: "runtimeVersion",
    accessorKey: "runtimeVersion",
    header: "Runtime",
    cell: ({ row }) => `v${row.original.runtimeVersion}`,
    enableSorting: true,
  },
  {
    id: "rolloutPercentage",
    accessorKey: "rolloutPercentage",
    header: "Rollout",
    cell: ({ row }) => `${row.original.rolloutPercentage}%`,
    enableSorting: true,
    meta: { align: "right" },
  },
  {
    id: "createdAt",
    accessorKey: "createdAt",
    header: "Created",
    cell: ({ row }) => formatRelativeTime(row.original.createdAt),
    enableSorting: true,
    meta: { align: "right", muted: true },
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => (
      <UpdateActions
        update={row.original}
        channels={channels}
        branchName={branchNames.get(row.original.branchId)}
        slug={slug}
        orgId={orgId}
        projectId={projectId}
      />
    ),
    enableSorting: false,
    meta: { align: "right" },
  },
];
