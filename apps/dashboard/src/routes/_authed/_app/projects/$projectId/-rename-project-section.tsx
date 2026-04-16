import { projectQueryKey, projectsQueryKey, renameProject } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/ui/card";
import { Input } from "@better-update/ui/components/ui/input";
import { Label } from "@better-update/ui/components/ui/label";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { Effect } from "effect";
import { toast } from "sonner";

import type { ProjectDetail } from "@better-update/api-client/react";

import { getFieldError, nameSchema } from "../../../../../lib/form-utils";
import { safeSubmit, useApiMutation } from "../../../../../lib/use-api-mutation";

export const RenameProjectSection = ({ project }: { project: ProjectDetail }) => {
  const queryClient = useQueryClient();
  const renameProjectMutation = useApiMutation({
    mutationFn: async (value: { name: string }) => renameProject(project.id, { name: value.name }),
    onSuccess: async () => {
      toast.success("Project renamed");
      await Effect.runPromise(
        Effect.asVoid(
          Effect.all(
            [
              Effect.promise(async () =>
                queryClient.invalidateQueries({
                  queryKey: projectsQueryKey(project.organizationId),
                }),
              ),
              Effect.promise(async () =>
                queryClient.invalidateQueries({
                  queryKey: projectQueryKey(project.id),
                }),
              ),
            ],
            { concurrency: "unbounded" },
          ),
        ),
      );
    },
  });

  const form = useForm({
    defaultValues: { name: project.name },
    onSubmit: async ({ value }) => safeSubmit(renameProjectMutation.mutateAsync(value)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Project settings</CardTitle>
        <CardDescription>Rename this project.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            event.stopPropagation();
            await form.handleSubmit();
          }}
        >
          <div className="flex flex-col gap-4">
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
                      value={field.state.value}
                      onChange={(event) => {
                        field.handleChange(event.target.value);
                      }}
                      onBlur={field.handleBlur}
                    />
                    {errorMessage ? (
                      <p className="text-destructive text-sm">{errorMessage}</p>
                    ) : null}
                  </div>
                );
              }}
            </form.Field>
            <div>
              <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
                {([canSubmit, isSubmitting]) => (
                  <Button type="submit" disabled={!canSubmit || isSubmitting}>
                    {isSubmitting ? "Saving..." : "Save"}
                  </Button>
                )}
              </form.Subscribe>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
