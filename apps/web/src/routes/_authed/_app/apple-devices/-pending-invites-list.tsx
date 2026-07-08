import { registrationRequestsQueryOptions } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@better-update/ui/components/ui/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from "@better-update/ui/components/ui/item";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Fragment } from "react";

import type { DeviceRegistrationRequestItem } from "@better-update/api-client/react";

import { CopyButton } from "../../../../lib/copy-button";
import { formatRelativeFuture } from "../../../../lib/format-relative-time";

const InviteRow = ({ invite }: { invite: DeviceRegistrationRequestItem }) => (
  <Item size="sm" className="px-4">
    <ItemContent>
      <ItemTitle>
        {invite.deviceNameHint ?? "Unnamed invite"}
        {invite.deviceClassHint ? (
          <Badge variant="secondary" className="text-xs font-normal">
            {invite.deviceClassHint}
          </Badge>
        ) : null}
      </ItemTitle>
      <ItemDescription className="max-w-[46ch] truncate font-mono text-xs">
        {invite.url}
      </ItemDescription>
    </ItemContent>
    <ItemActions>
      <span className="text-muted-foreground text-xs">
        Expires {formatRelativeFuture(invite.expiresAt)}
      </span>
      <CopyButton value={invite.url} label="Invite link" variant="outline" size="icon" />
    </ItemActions>
  </Item>
);

export const PendingInvitesList = ({ orgId }: { orgId: string }) => {
  const { data } = useSuspenseQuery(registrationRequestsQueryOptions(orgId, true));

  if (data.items.length === 0) {
    return null;
  }

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="flex-row items-center justify-between border-b px-4 py-3">
        <CardTitle className="text-sm font-medium">Pending invites</CardTitle>
        <Badge variant="secondary">{data.items.length}</Badge>
      </CardHeader>
      <CardContent className="p-0">
        <ItemGroup>
          {data.items.map((invite, index) => (
            <Fragment key={invite.id}>
              {index > 0 ? <ItemSeparator /> : null}
              <InviteRow invite={invite} />
            </Fragment>
          ))}
        </ItemGroup>
      </CardContent>
    </Card>
  );
};
