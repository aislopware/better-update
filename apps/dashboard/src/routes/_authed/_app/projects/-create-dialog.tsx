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
import { Input } from "@better-update/ui/components/ui/input";
import { Label } from "@better-update/ui/components/ui/label";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import {
  generateScopeKey,
  getFieldError,
  nameSchema,
  requiredStringSchema,
} from "../../../../lib/form-utils";
import { safeSubmit, useApiMutation } from "../../../../lib/use-api-mutation";

const CreateFormContent = ({ orgId, onSuccess }: { orgId: string; onSuccess: () => void }) => {
  const queryClient = useQueryClient();
  const scopeKeyEdited = useRef(false);
  const createProjectMutation = useApiMutation({
    mutationFn: async (value: { name: string; scopeKey: string }) =>
      createProject({ name: value.name, scopeKey: value.scopeKey }),
    onSuccess: async () => {
      toast.success("Project created");
      await queryClient.invalidateQueries({
        queryKey: projectsQueryKey(orgId),
      });
      onSuccess();
    },
  });

  const form = useForm({
    defaultValues: { name: "", scopeKey: "" },
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
      <div className="flex flex-col gap-4 py-4">
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
              <div className="flex flex-col gap-2">
                <Label htmlFor="project-name">Project name</Label>
                <Input
                  id="project-name"
                  placeholder="My App"
                  value={field.state.value}
                  onChange={(event) => {
                    const name = event.target.value;
                    field.handleChange(name);
                    if (!scopeKeyEdited.current) {
                      form.setFieldValue("scopeKey", generateScopeKey(name), {
                        dontUpdateMeta: true,
                        dontValidate: true,
                      });
                    }
                  }}
                  onBlur={field.handleBlur}
                />
                {errorMessage ? <p className="text-destructive text-sm">{errorMessage}</p> : null}
              </div>
            );
          }}
        </form.Field>

        <form.Field
          name="scopeKey"
          validators={{
            onBlur: ({ value }) => {
              const result = requiredStringSchema.safeParse(value);
              return result.success ? undefined : result.error.issues[0]?.message;
            },
          }}
        >
          {(field) => {
            const errorMessage = getFieldError(field);
            return (
              <div className="flex flex-col gap-2">
                <Label htmlFor="project-scope-key">Scope key</Label>
                <Input
                  id="project-scope-key"
                  placeholder="@my-app/app"
                  value={field.state.value}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                    scopeKeyEdited.current = event.target.value !== "";
                  }}
                  onBlur={field.handleBlur}
                />
                <p className="text-muted-foreground text-xs">
                  Unique identifier used by the update client SDK.
                </p>
                {errorMessage ? <p className="text-destructive text-sm">{errorMessage}</p> : null}
              </div>
            );
          }}
        </form.Field>
      </div>

      <DialogFooter>
        <DialogClose>
          <Button variant="outline">Cancel</Button>
        </DialogClose>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit || isSubmitting}>
              <PlusIcon strokeWidth={2} className="size-4" />
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
        <PlusIcon strokeWidth={2} className="size-4" />
        Create project
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a project</DialogTitle>
          <DialogDescription>
            Projects organize your OTA updates and deployment channels.
          </DialogDescription>
        </DialogHeader>
        <CreateFormContent
          orgId={orgId}
          onSuccess={() => {
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
};
