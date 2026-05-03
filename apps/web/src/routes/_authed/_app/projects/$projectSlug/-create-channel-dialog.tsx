import { branchesQueryOptions, createChannel } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogPopup,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@better-update/ui/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import {
  Select,
  SelectPopup,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useForm } from "@tanstack/react-form";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useState } from "react";

import type { BranchItem } from "@better-update/api-client/react";

import { getFieldError, requiredStringSchema } from "../../../../../lib/form-utils";
import { safeSubmit, useApiMutation } from "../../../../../lib/use-api-mutation";
import { invalidateChannels } from "./-update-helpers";

interface CreateChannelFormValues {
  name: string;
  branchId: string;
}

const useCreateChannelForm = (onSubmit: (value: CreateChannelFormValues) => Promise<void>) =>
  useForm({
    defaultValues: { name: "", branchId: "" } satisfies CreateChannelFormValues,
    onSubmit: async ({ value }) => {
      await onSubmit(value);
    },
  });

type CreateChannelFormApi = ReturnType<typeof useCreateChannelForm>;

const BranchField = ({
  form,
  branches,
}: {
  form: CreateChannelFormApi;
  branches: readonly BranchItem[];
}) => {
  const branchLabels: Record<string, string> = Object.fromEntries(
    branches.map((branch) => [branch.id, branch.name]),
  );
  return (
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
          <Field data-invalid={errorMessage ? true : undefined}>
            <FieldLabel>Branch</FieldLabel>
            <Select
              items={branchLabels}
              value={field.state.value}
              onValueChange={(next) => {
                if (next === null) {
                  return;
                }
                field.handleChange(next);
              }}
            >
              <SelectTrigger aria-invalid={errorMessage ? true : undefined}>
                <SelectValue placeholder="Select a branch" />
              </SelectTrigger>
              <BranchOptions branches={branches} />
            </Select>
            <FieldError>{errorMessage}</FieldError>
          </Field>
        );
      }}
    </form.Field>
  );
};

const BranchOptions = ({ branches }: { branches: readonly BranchItem[] }) => (
  <SelectPopup>
    <SelectGroup>
      {branches.map((branch) => (
        <SelectItem key={branch.id} value={branch.id}>
          {branch.name}
        </SelectItem>
      ))}
    </SelectGroup>
  </SelectPopup>
);

export const CreateChannelDialog = ({ orgId, projectId }: { orgId: string; projectId: string }) => {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data: branchesData } = useSuspenseQuery(branchesQueryOptions(orgId, projectId));

  const createChannelMutation = useApiMutation({
    mutationFn: async (input: { name: string; branchId: string }) =>
      createChannel({ projectId, name: input.name, branchId: input.branchId }),
    onSuccess: async () => {
      toastManager.add({ title: "Channel created", type: "success" });
      await invalidateChannels(queryClient, orgId, projectId);
      form.reset();
      setOpen(false);
    },
  });

  const form = useCreateChannelForm(async (value) => {
    await safeSubmit(
      createChannelMutation.mutateAsync({
        name: value.name.trim(),
        branchId: value.branchId,
      }),
    );
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
        <PlusIcon strokeWidth={2} data-icon="inline-start" />
        Create channel
      </Button>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Create a channel</DialogTitle>
          <DialogDescription>
            Create a new channel linked to a branch for distributing updates.
          </DialogDescription>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={async (event) => {
            event.preventDefault();
            event.stopPropagation();
            await form.handleSubmit();
          }}
        >
          <DialogPanel>
            <FieldGroup>
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
                    <Field data-invalid={errorMessage ? true : undefined}>
                      <FieldLabel htmlFor="channel-name">Name</FieldLabel>
                      <Input
                        id="channel-name"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) => {
                          field.handleChange(event.target.value);
                        }}
                        aria-invalid={errorMessage ? true : undefined}
                        placeholder="e.g. production, staging"
                      />
                      <FieldError>{errorMessage}</FieldError>
                    </Field>
                  );
                }}
              </form.Field>

              <BranchField form={form} branches={branchesData.items} />
            </FieldGroup>
          </DialogPanel>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
              {([canSubmit, isSubmitting]) => (
                <Button type="submit" disabled={!canSubmit || isSubmitting}>
                  <PlusIcon strokeWidth={2} data-icon="inline-start" />
                  {isSubmitting ? "Creating..." : "Create channel"}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
};
