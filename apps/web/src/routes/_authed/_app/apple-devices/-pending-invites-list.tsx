import { registrationRequestsQueryOptions } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/badge";
import { useSuspenseQuery } from "@tanstack/react-query";

import type { DeviceRegistrationRequestItem } from "@better-update/api-client/react";

import { CopyButton } from "../../../../lib/copy-button";
import {
  ClientPaginationFooter,
  ListPanel,
  ListPanelHeader,
  ListPanelRow,
  useClientPagination,
} from "../../../../lib/data-table";
import { formatRelativeFuture } from "../../../../lib/format-relative-time";

const InviteRow = ({ invite }: { invite: DeviceRegistrationRequestItem }) => (
  <ListPanelRow
    title={
      <>
        <span className="truncate">{invite.deviceNameHint ?? "Unnamed invite"}</span>
        {invite.deviceClassHint ? (
          <Badge variant="secondary" className="text-xs font-normal">
            {invite.deviceClassHint}
          </Badge>
        ) : null}
      </>
    }
    description={<span className="font-mono">{invite.url}</span>}
    actions={
      <>
        <span className="text-kumo-subtle text-xs">
          Expires {formatRelativeFuture(invite.expiresAt)}
        </span>
        <CopyButton value={invite.url} label="Invite link" variant="secondary" size="base" />
      </>
    }
  />
);

export const PendingInvitesList = ({ orgId }: { orgId: string }) => {
  const { data } = useSuspenseQuery(registrationRequestsQueryOptions(orgId, true));
  const pagination = useClientPagination(data.items, "invite");

  if (data.items.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      <ListPanel>
        <ListPanelHeader
          title="Pending invites"
          actions={<Badge variant="secondary">{data.items.length}</Badge>}
        />
        {pagination.pageItems.map((invite) => (
          <InviteRow key={invite.id} invite={invite} />
        ))}
      </ListPanel>
      <ClientPaginationFooter state={pagination} />
    </div>
  );
};
