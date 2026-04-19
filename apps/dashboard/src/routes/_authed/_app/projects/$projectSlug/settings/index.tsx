import {
  deleteProject,
  projectQueryKey,
  projectQueryOptions,
  projectsQueryKey,
  renameProject,
} from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/ui/card";
import { Input } from "@better-update/ui/components/ui/input";
import { Label } from "@better-update/ui/components/ui/label";
import { Separator } from "@better-update/ui/components/ui/separator";
import { useForm } from "@tanstack/react-form";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import type { ProjectDetail } from "@better-update/api-client/react";

import { ConfirmDeleteDialog } from "../-confirm-delete-dialog";
import { invalidateProjects } from "../-update-helpers";
import { getFieldError, nameSchema } from "../../../../../../lib/form-utils";
import { safeSubmit, useApiMutation } from "../../../../../../lib/use-api-mutation";

const RenameSection = ({ project }: { project: ProjectDetail }) => {
  const queryClient = useQueryClient();
  const renameProjectMutation = useApiMutation({
    mutationFn: async (value: { name: string }) => renameProject(project.id, { name: value.name }),
    onSuccess: async () => {
      toast.success("Project renamed");
      await invalidateProjects(queryClient, project.organizationId, project.id);
    },
  });

  const form = useForm({
    defaultValues: { name: project.name },
    onSubmit: async ({ value }) => safeSubmit(renameProjectMutation.mutateAsync(value)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>General</CardTitle>
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

const DeleteSection = ({ project }: { project: ProjectDetail }) => {
  const router = useRouter();
  const queryClient = useQueryClient();

  return (
    <>
      <Separator />
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle>Danger zone</CardTitle>
          <CardDescription>
            Permanently delete this project and all of its branches, channels, and updates.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <ConfirmDeleteDialog
            name={project.name}
            title={`Delete ${project.name}?`}
            description="This action cannot be undone. All branches, channels, and updates will be permanently removed."
            onConfirm={async () => deleteProject(project.id)}
            successMessage="Project deleted"
            onSuccess={async () => {
              await queryClient.invalidateQueries({
                queryKey: projectsQueryKey(project.organizationId),
              });
              queryClient.removeQueries({
                queryKey: projectQueryKey(project.organizationId, project.id),
              });
              await router.navigate({ to: "/projects" });
            }}
          >
            <Button variant="destructive">Delete project</Button>
          </ConfirmDeleteDialog>
        </CardFooter>
      </Card>
    </>
  );
};

const SettingsPage = () => {
  const { activeOrg, project } = Route.useRouteContext();
  const { data: projectData } = useSuspenseQuery(projectQueryOptions(activeOrg.id, project.id));

  return (
    <div className="flex flex-col gap-6">
      <RenameSection project={projectData} />
      <DeleteSection project={projectData} />
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/settings/")({
  component: SettingsPage,
});
