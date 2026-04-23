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
} from "@better-update/ui/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

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
      onSubmit={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await form.handleSubmit();
      }}
    >
      <FieldGroup className="py-4">
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
              <Field data-invalid={errorMessage ? true : undefined}>
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
                  aria-invalid={errorMessage ? true : undefined}
                />
                <FieldError>{errorMessage}</FieldError>
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
            return (
              <Field data-invalid={errorMessage ? true : undefined}>
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
                  aria-invalid={errorMessage ? true : undefined}
                />
                <FieldDescription>
                  Lowercase URL-safe identifier. Must match <code>expo.slug</code> in your{" "}
                  <code>app.json</code>.
                </FieldDescription>
                <FieldError>{errorMessage}</FieldError>
              </Field>
            );
          }}
        </form.Field>
      </FieldGroup>

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
      <DialogContent>
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
      </DialogContent>
    </Dialog>
  );
};
