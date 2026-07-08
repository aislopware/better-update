import { branchesQueryOptions, createChannel } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@better-update/ui/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { toast } from "@better-update/ui/components/ui/sonner";
import { Spinner } from "@better-update/ui/components/ui/spinner";
import { useForm } from "@tanstack/react-form";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useState } from "react";

import type { BranchItem } from "@better-update/api-client/react";

import { getFieldError, requiredStringSchema } from "../../../../../lib/form-utils";
import { safeSubmit, useApiMutation } from "../../../../../lib/use-api-mutation";
import { DROPDOWN_FETCH_LIMIT } from "../../../../../queries/constants";
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

const BranchOptions = ({ branches }: { branches: readonly BranchItem[] }) => (
  <SelectContent>
    <SelectGroup>
      {branches.map((branch) => (
        <SelectItem key={branch.id} value={branch.id}>
          {branch.name}
        </SelectItem>
      ))}
    </SelectGroup>
  </SelectContent>
);

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
          <Field data-invalid={Boolean(errorMessage)}>
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
              <SelectTrigger className="w-full" aria-invalid={errorMessage ? true : undefined}>
                <SelectValue placeholder="Select a branch" />
              </SelectTrigger>
              <BranchOptions branches={branches} />
            </Select>
            {errorMessage ? <FieldError>{errorMessage}</FieldError> : null}
          </Field>
        );
      }}
    </form.Field>
  );
};

const CreateChannelForm = ({
  orgId,
  projectId,
  branches,
  onSuccess,
}: {
  orgId: string;
  projectId: string;
  branches: readonly BranchItem[];
  onSuccess: () => void;
}) => {
  const queryClient = useQueryClient();

  const createChannelMutation = useApiMutation({
    mutationFn: async (input: { name: string; branchId: string }) =>
      createChannel({ projectId, name: input.name, branchId: input.branchId }),
    onSuccess: async () => {
      toast.success("Channel created");
      await invalidateChannels(queryClient, orgId, projectId);
      onSuccess();
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
    <form
      className="contents"
      onSubmit={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await form.handleSubmit();
      }}
    >
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
              <Field data-invalid={Boolean(errorMessage)}>
                <FieldLabel htmlFor="channel-name">Name</FieldLabel>
                <Input
                  id="channel-name"
                  aria-invalid={Boolean(errorMessage) || undefined}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                  }}
                  placeholder="e.g. production, staging"
                />
                {errorMessage ? <FieldError>{errorMessage}</FieldError> : null}
              </Field>
            );
          }}
        </form.Field>

        <BranchField form={form} branches={branches} />
      </FieldGroup>

      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <PlusIcon strokeWidth={2} data-icon="inline-start" />
              )}
              Create channel
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
};

export const CreateChannelDialog = ({ orgId, projectId }: { orgId: string; projectId: string }) => {
  const [open, setOpen] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const { data: branchesData } = useSuspenseQuery(
    branchesQueryOptions(orgId, projectId, { limit: DROPDOWN_FETCH_LIMIT }),
  );
  const branches = branchesData.items;

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(next) => {
        if (!next) {
          setResetKey((prev) => prev + 1);
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create a channel</DialogTitle>
          <DialogDescription>
            Create a new channel linked to a branch for distributing updates.
          </DialogDescription>
        </DialogHeader>
        <CreateChannelForm
          key={resetKey}
          orgId={orgId}
          projectId={projectId}
          branches={branches}
          onSuccess={() => {
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
};
