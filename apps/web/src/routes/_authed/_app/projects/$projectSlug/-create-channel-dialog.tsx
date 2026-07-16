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
import { toast } from "@better-update/ui/components/ui/sonner";
import { Spinner } from "@better-update/ui/components/ui/spinner";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useState } from "react";

import {
  ServerSearchCombobox,
  useServerSearchList,
} from "../../../../../components/server-search-combobox";
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

// Server-searched branch picker: projects can outgrow the dropdown fetch
// limit, so the option list is the first page and typing searches all branches.
const BranchField = ({
  form,
  orgId,
  projectId,
}: {
  form: CreateChannelFormApi;
  orgId: string;
  projectId: string;
}) => {
  const list = useServerSearchList((query) =>
    branchesQueryOptions(
      orgId,
      projectId,
      query ? { limit: DROPDOWN_FETCH_LIMIT, query } : { limit: DROPDOWN_FETCH_LIMIT },
    ),
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
            <ServerSearchCombobox
              value={field.state.value}
              onValueChange={(next) => {
                field.handleChange(next);
              }}
              options={list.items.map((branch) => ({ value: branch.id, label: branch.name }))}
              search={list.search}
              onSearchChange={list.handleSearchChange}
              isPending={list.isPending}
              defaultListTruncated={list.defaultListTruncated}
              placeholder="Select a branch"
              searchPlaceholder="Search branches…"
              emptyMessage="No branches found."
              ariaLabel="Branch"
              invalid={Boolean(errorMessage)}
            />
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
  onSuccess,
}: {
  orgId: string;
  projectId: string;
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

        <BranchField form={form} orgId={orgId} projectId={projectId} />
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
          onSuccess={() => {
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
};
