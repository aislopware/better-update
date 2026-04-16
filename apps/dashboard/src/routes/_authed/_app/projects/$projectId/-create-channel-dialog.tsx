import {
  branchesQueryOptions,
  channelsQueryKey,
  createChannel,
  buildCompatibilityMatrixQueryKey,
} from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@better-update/ui/components/ui/dialog";
import { Input } from "@better-update/ui/components/ui/input";
import { Label } from "@better-update/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Effect } from "effect";
import { useState } from "react";
import { toast } from "sonner";

import { useApiMutation } from "../../../../../lib/use-api-mutation";

export const CreateChannelDialog = ({ orgId, projectId }: { orgId: string; projectId: string }) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [branchId, setBranchId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { data: branchesData } = useSuspenseQuery(branchesQueryOptions(orgId, projectId));
  const createChannelMutation = useApiMutation({
    mutationFn: async (input: { name: string; branchId: string }) =>
      createChannel({ projectId, name: input.name, branchId: input.branchId }),
    onSuccess: async () => {
      toast.success("Channel created");
      await Effect.runPromise(
        Effect.asVoid(
          Effect.all(
            [
              Effect.promise(async () =>
                queryClient.invalidateQueries({
                  queryKey: channelsQueryKey(orgId, projectId),
                }),
              ),
              Effect.promise(async () =>
                queryClient.invalidateQueries({
                  queryKey: buildCompatibilityMatrixQueryKey(orgId, projectId),
                }),
              ),
            ],
            { concurrency: "unbounded" },
          ),
        ),
      );
      setName("");
      setBranchId(null);
      setOpen(false);
    },
  });

  const handleSubmit = () => {
    if (!name.trim() || !branchId) {
      return;
    }

    createChannelMutation.mutate({ name: name.trim(), branchId });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        <HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-4" />
        Create channel
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a channel</DialogTitle>
          <DialogDescription>
            Create a new channel linked to a branch for distributing updates.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit();
          }}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="channel-name">Name</Label>
            <Input
              id="channel-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              placeholder="e.g. production, staging"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Branch</Label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a branch" />
              </SelectTrigger>
              <SelectContent>
                {branchesData.items.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="submit"
            disabled={createChannelMutation.isPending || !name.trim() || !branchId}
          >
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-4" />
            {createChannelMutation.isPending ? "Creating..." : "Create channel"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};
