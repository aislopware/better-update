import { createProject, projectsQueryKey } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@better-update/ui/components/dialog";
import { FieldGroup } from "@better-update/ui/components/field-layout";
import { InlineCode } from "@better-update/ui/components/inline-code";
import { Input } from "@better-update/ui/components/input";
import { toast } from "@better-update/ui/components/toast";
import { PlusIcon } from "@phosphor-icons/react";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { generateSlug, getFieldError, nameSchema, slugSchema } from "../../../../lib/form-utils";
import { safeSubmit, useApiMutation } from "../../../../lib/use-api-mutation";

export const CreateProjectFormContent = ({
  orgId,
  onSuccess,
}: {
  orgId: string;
  onSuccess: () => void;
}) => {
  const queryClient = useQueryClient();
  const slugEdited = useRef(false);
  const createProjectMutation = useApiMutation({
    mutationFn: async (value: { name: string; slug: string }) =>
      createProject({ name: value.name, slug: value.slug }),
    onSuccess: async () => {
      toast.success("Project created");
      await queryClient.invalidateQueries({
        queryKey: projectsQueryKey(orgId),
      });
      onSuccess();
    },
  });

  const form = useForm({
    defaultValues: { name: "", slug: "" },
    onSubmit: async ({ value }) => safeSubmit(createProjectMutation.mutateAsync(value)),
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
              const result = nameSchema.safeParse(value);
              return result.success ? undefined : result.error.issues[0]?.message;
            },
          }}
        >
          {(field) => {
            const errorMessage = getFieldError(field);
            return (
              <Input
                label="Project name"
                error={errorMessage}
                id="project-name"
                placeholder="My App"
                value={field.state.value}
                onChange={(event) => {
                  const name = event.target.value;
                  field.handleChange(name);
                  if (!slugEdited.current) {
                    form.setFieldValue("slug", generateSlug(name), {
                      dontUpdateMeta: true,
                      dontValidate: true,
                    });
                  }
                }}
                onBlur={field.handleBlur}
              />
            );
          }}
        </form.Field>

        <form.Field
          name="slug"
          validators={{
            onBlur: ({ value }) => {
              const result = slugSchema.safeParse(value);
              return result.success ? undefined : result.error.issues[0]?.message;
            },
          }}
        >
          {(field) => {
            const errorMessage = getFieldError(field);
            return (
              <Input
                label="Slug"
                description={
                  <>
                    Must match{" "}
                    <InlineCode className="bg-kumo-tint/72 rounded px-1">expo.slug</InlineCode> in
                    your <InlineCode className="bg-kumo-tint/72 rounded px-1">app.json</InlineCode>.
                  </>
                }
                error={errorMessage}
                id="project-slug"
                placeholder="my-app"
                value={field.state.value}
                onChange={(event) => {
                  field.handleChange(event.target.value);
                  slugEdited.current = event.target.value !== "";
                }}
                onBlur={field.handleBlur}
              />
            );
          }}
        </form.Field>
      </FieldGroup>

      <DialogFooter>
        <DialogClose render={<Button variant="secondary" />}>Cancel</DialogClose>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <Button
              variant="primary"
              type="submit"
              disabled={!canSubmit || Boolean(isSubmitting)}
              loading={Boolean(isSubmitting)}
              icon={<PlusIcon weight="bold" />}
            >
              Create project
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
};

export const CreateProjectDialog = ({ orgId }: { orgId: string }) => {
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
      <DialogTrigger render={<Button variant="primary" />}>
        <PlusIcon weight="bold" data-icon="inline-start" />
        Create project
      </DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Create a project</DialogTitle>
          <DialogDescription>
            Projects organize your OTA updates and deployment channels.
          </DialogDescription>
        </DialogHeader>
        <CreateProjectFormContent
          key={resetKey}
          orgId={orgId}
          onSuccess={() => {
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
};
