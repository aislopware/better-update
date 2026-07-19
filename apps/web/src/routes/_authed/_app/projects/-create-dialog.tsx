import { createProject, projectsQueryKey } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@better-update/ui/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import { toast } from "@better-update/ui/components/ui/sonner";
import { Spinner } from "@better-update/ui/components/ui/spinner";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
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
            const invalid = Boolean(errorMessage);
            return (
              <Field data-invalid={invalid}>
                <FieldLabel htmlFor="project-name">Project name</FieldLabel>
                <Input
                  id="project-name"
                  placeholder="My App"
                  aria-invalid={invalid || undefined}
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
                {invalid ? <FieldError>{errorMessage}</FieldError> : null}
              </Field>
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
            const invalid = Boolean(errorMessage);
            return (
              <Field data-invalid={invalid}>
                <FieldLabel htmlFor="project-slug">Slug</FieldLabel>
                <Input
                  id="project-slug"
                  placeholder="my-app"
                  aria-invalid={invalid || undefined}
                  value={field.state.value}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                    slugEdited.current = event.target.value !== "";
                  }}
                  onBlur={field.handleBlur}
                />
                <FieldDescription>
                  Must match <code className="bg-muted/72 rounded px-1 font-mono">expo.slug</code>{" "}
                  in your <code className="bg-muted/72 rounded px-1 font-mono">app.json</code>.
                </FieldDescription>
                {invalid ? <FieldError>{errorMessage}</FieldError> : null}
              </Field>
            );
          }}
        </form.Field>
      </FieldGroup>

      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit || Boolean(isSubmitting)}>
              {isSubmitting ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <PlusIcon strokeWidth={2} data-icon="inline-start" />
              )}
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
      <DialogTrigger render={<Button />}>
        <PlusIcon strokeWidth={2} data-icon="inline-start" />
        Create project
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
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
