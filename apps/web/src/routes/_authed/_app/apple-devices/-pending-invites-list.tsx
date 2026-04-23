import { registrationRequestsQueryOptions } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@better-update/ui/components/ui/card";
import { useSuspenseQuery } from "@tanstack/react-query";
import { CheckIcon, CopyIcon } from "lucide-react";
import { toast } from "sonner";

import type { DeviceRegistrationRequestItem } from "@better-update/api-client/react";

import { formatRelativeFuture } from "../../../../lib/format-relative-time";
import { useCopyToClipboard } from "../../../../lib/use-copy-to-clipboard";

const InviteRow = ({ invite }: { invite: DeviceRegistrationRequestItem }) => {
  const { copied, copy } = useCopyToClipboard(1500);

  const handleCopy = async () => {
    const ok = await copy(invite.url);
    if (ok) {
      toast.success("Link copied");
    }
  };

  return (
    <li className="flex items-center justify-between gap-3 border-b px-4 py-3 last:border-b-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-2 text-sm font-medium">
          {invite.deviceNameHint ?? "Unnamed invite"}
          {invite.deviceClassHint ? (
            <Badge variant="secondary" className="text-xs font-normal">
              {invite.deviceClassHint}
            </Badge>
          ) : null}
        </div>
        <code className="text-muted-foreground max-w-[46ch] truncate font-mono text-xs">
          {invite.url}
        </code>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="text-muted-foreground text-xs">
          Expires {formatRelativeFuture(invite.expiresAt)}
        </span>
        <Button
          variant="outline"
          size="icon"
          aria-label="Copy invite link"
          onClick={async () => {
            await handleCopy();
          }}
        >
          {copied ? (
            <CheckIcon strokeWidth={2} className="size-4" />
          ) : (
            <CopyIcon strokeWidth={2} className="size-4" />
          )}
        </Button>
      </div>
    </li>
  );
};

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
        <ul className="flex flex-col">
          {data.items.map((invite) => (
            <InviteRow key={invite.id} invite={invite} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
};
