import { createProject, projectsQueryKey } from "@better-update/api-client/react";
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
import { toastManager } from "@better-update/ui/components/ui/toast";
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
      toastManager.add({ title: "Project created", type: "success" });
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
      <DialogPanel>
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
                <Field invalid={invalid}>
                  <FieldLabel htmlFor="project-name">Project name</FieldLabel>
                  <Input
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
                  <FieldError match={invalid}>{errorMessage}</FieldError>
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
                <Field invalid={invalid}>
                  <FieldLabel htmlFor="project-slug">Slug</FieldLabel>
                  <Input
                    id="project-slug"
                    placeholder="my-app"
                    value={field.state.value}
                    onChange={(event) => {
                      field.handleChange(event.target.value);
                      slugEdited.current = event.target.value !== "";
                    }}
                    onBlur={field.handleBlur}
                  />
                  <p className="text-muted-foreground text-xs">
                    Must match <code className="bg-muted/72 rounded px-1 font-mono">expo.slug</code>{" "}
                    in your <code className="bg-muted/72 rounded px-1 font-mono">app.json</code>.
                  </p>
                  <FieldError match={invalid}>{errorMessage}</FieldError>
                </Field>
              );
            }}
          </form.Field>
        </FieldGroup>
      </DialogPanel>

      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit || isSubmitting}>
              <PlusIcon strokeWidth={2} data-icon="inline-start" />
              {isSubmitting ? "Creating..." : "Create project"}
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
};

export const CreateProjectDialog = ({ orgId }: { orgId: string }) => {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        Create project
      </Button>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Create a project</DialogTitle>
          <DialogDescription>
            Projects organize your OTA updates and deployment channels.
          </DialogDescription>
        </DialogHeader>
        <CreateProjectFormContent
          orgId={orgId}
          onSuccess={() => {
            setOpen(false);
          }}
        />
      </DialogPopup>
    </Dialog>
  );
};
