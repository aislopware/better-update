import { branchesQueryOptions, createChannel } from "@better-update/api-client/react";
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
import { useForm } from "@tanstack/react-form";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { getFieldError, requiredStringSchema } from "../../../../../lib/form-utils";
import { safeSubmit, useApiMutation } from "../../../../../lib/use-api-mutation";
import { invalidateChannels } from "./-update-helpers";

export const CreateChannelDialog = ({ orgId, projectId }: { orgId: string; projectId: string }) => {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data: branchesData } = useSuspenseQuery(branchesQueryOptions(orgId, projectId));

  const createChannelMutation = useApiMutation({
    mutationFn: async (input: { name: string; branchId: string }) =>
      createChannel({ projectId, name: input.name, branchId: input.branchId }),
    onSuccess: async () => {
      toast.success("Channel created");
      await invalidateChannels(queryClient, orgId, projectId);
      form.reset();
      setOpen(false);
    },
  });

  const form = useForm({
    defaultValues: { name: "", branchId: "" },
    onSubmit: async ({ value }) => {
      await safeSubmit(
        createChannelMutation.mutateAsync({
          name: value.name.trim(),
          branchId: value.branchId,
        }),
      );
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          form.reset();
        }
      }}
    >
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        <PlusIcon strokeWidth={2} className="size-4" />
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
          onSubmit={async (event) => {
            event.preventDefault();
            event.stopPropagation();
            await form.handleSubmit();
          }}
          className="flex flex-col gap-4"
        >
          <form.Field
            name="name"
            validators={{
              onBlur: ({ value }) => {
                const result = requiredStringSchema.safeParse(value.trim());
                return result.success ? undefined : "Name is required";
              },
            }}
          >
            {(field) => {
              const errorMessage = getFieldError(field);
              return (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="channel-name">Name</Label>
                  <Input
                    id="channel-name"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      field.handleChange(event.target.value);
                    }}
                    placeholder="e.g. production, staging"
                  />
                  {errorMessage ? <p className="text-destructive text-sm">{errorMessage}</p> : null}
                </div>
              );
            }}
          </form.Field>

          <form.Field
            name="branchId"
            validators={{
              onChange: ({ value }) => {
                const result = requiredStringSchema.safeParse(value);
                return result.success ? undefined : "Branch is required";
              },
            }}
          >
            {(field) => {
              const errorMessage = getFieldError(field);
              return (
                <div className="flex flex-col gap-2">
                  <Label>Branch</Label>
                  <Select
                    value={field.state.value}
                    onValueChange={(next) => {
                      if (next === null) {
                        return;
                      }
                      field.handleChange(next);
                    }}
                  >
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
                  {errorMessage ? <p className="text-destructive text-sm">{errorMessage}</p> : null}
                </div>
              );
            }}
          </form.Field>

          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
            {([canSubmit, isSubmitting]) => (
              <Button type="submit" disabled={!canSubmit || isSubmitting}>
                <PlusIcon strokeWidth={2} className="size-4" />
                {isSubmitting ? "Creating..." : "Create channel"}
              </Button>
            )}
          </form.Subscribe>
        </form>
      </DialogContent>
    </Dialog>
  );
};
