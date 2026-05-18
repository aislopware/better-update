import {
  androidBuildCredentialsQueryOptions,
  deleteAndroidBuildCredentials,
  updateAndroidBuildCredentials,
} from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { CheckCircle2Icon, Trash2Icon } from "lucide-react";

const SetDefaultButton = ({
  id,
  orgId,
  applicationIdentifierId,
  isDefault,
}: {
  id: string;
  orgId: string;
  applicationIdentifierId: string;
  isDefault: boolean;
}) => {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async () => updateAndroidBuildCredentials(id, { isDefault: true }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: androidBuildCredentialsQueryOptions(orgId, applicationIdentifierId).queryKey,
      });
      toastManager.add({ title: "Default credential group updated" });
    },
    onError: (error) => {
      toastManager.add({
        title: error instanceof Error ? error.message : "Failed to set default",
        type: "error",
      });
    },
  });
  if (isDefault) {
    return (
      <Badge variant="success" className="gap-1">
        <CheckCircle2Icon strokeWidth={2} className="size-3" />
        Default
      </Badge>
    );
  }
  return (
    <Button
      variant="outline"
      size="sm"
      loading={mutation.isPending}
      onClick={() => {
        mutation.mutate();
      }}
    >
      Set default
    </Button>
  );
};

const DeleteGroupButton = ({
  id,
  orgId,
  applicationIdentifierId,
  name,
}: {
  id: string;
  orgId: string;
  applicationIdentifierId: string;
  name: string;
}) => {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async () => deleteAndroidBuildCredentials(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: androidBuildCredentialsQueryOptions(orgId, applicationIdentifierId).queryKey,
      });
      toastManager.add({ title: `Deleted credential group "${name}"` });
    },
    onError: (error) => {
      toastManager.add({
        title: error instanceof Error ? error.message : "Failed to delete",
        type: "error",
      });
    },
  });
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={`Delete credential group ${name}`}
      loading={mutation.isPending}
      onClick={() => {
        mutation.mutate();
      }}
    >
      <Trash2Icon strokeWidth={2} className="size-4" />
    </Button>
  );
};

export const AndroidCredentialGroups = ({
  orgId,
  applicationIdentifierId,
}: {
  orgId: string;
  applicationIdentifierId: string;
}) => {
  const { data } = useSuspenseQuery(
    androidBuildCredentialsQueryOptions(orgId, applicationIdentifierId),
  );
  if (data.items.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        No credential groups bound. Use the build wizard to add one.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {data.items.map((group) => (
        <div
          key={group.id}
          className="flex items-center justify-between gap-3 rounded-xl border p-2"
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{group.name}</span>
              {group.androidUploadKeystoreId === null ? (
                <Badge variant="outline">No keystore</Badge>
              ) : null}
            </div>
            <div className="text-muted-foreground text-xs">
              Keystore: {group.androidUploadKeystoreId === null ? "—" : "bound"} · Play SA:{" "}
              {group.googleServiceAccountKeyForSubmissionsId === null ? "—" : "bound"} · FCM SA:{" "}
              {group.googleServiceAccountKeyForFcmV1Id === null ? "—" : "bound"}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <SetDefaultButton
              id={group.id}
              orgId={orgId}
              applicationIdentifierId={applicationIdentifierId}
              isDefault={group.isDefault}
            />
            <DeleteGroupButton
              id={group.id}
              orgId={orgId}
              applicationIdentifierId={applicationIdentifierId}
              name={group.name}
            />
          </div>
        </div>
      ))}
    </div>
  );
};
