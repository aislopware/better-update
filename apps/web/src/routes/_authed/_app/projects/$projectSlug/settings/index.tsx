import {
  deleteProject,
  projectQueryKey,
  projectQueryOptions,
  projectsQueryKey,
  renameProject,
} from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import { Field, FieldError, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useForm } from "@tanstack/react-form";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Suspense } from "react";

import type { ProjectDetail } from "@better-update/api-client/react";

import { ConfirmDeleteDialog } from "../-confirm-delete-dialog";
import { invalidateProjects } from "../-update-helpers";
import { SettingCard } from "../../../../../../components/setting-card";
import { SettingCardSkeleton } from "../../../../../../components/skeletons";
import { getFieldError, nameSchema } from "../../../../../../lib/form-utils";
import { safeSubmit, useApiMutation } from "../../../../../../lib/use-api-mutation";

const RenameSection = ({ project }: { project: ProjectDetail }) => {
  const queryClient = useQueryClient();
  const renameProjectMutation = useApiMutation({
    mutationFn: async (value: { name: string }) => renameProject(project.id, { name: value.name }),
    onSuccess: async () => {
      toastManager.add({ title: "Project renamed", type: "success" });
      await invalidateProjects(queryClient, project.organizationId, project.id);
    },
  });

  const form = useForm({
    defaultValues: { name: project.name },
    onSubmit: async ({ value }) => safeSubmit(renameProjectMutation.mutateAsync(value)),
  });

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await form.handleSubmit();
      }}
    >
      <SettingCard
        title="General"
        description="Rename this project."
        footer={
          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
            {([canSubmit, isSubmitting]) => (
              <Button type="submit" disabled={!canSubmit} loading={Boolean(isSubmitting)}>
                Save changes
              </Button>
            )}
          </form.Subscribe>
        }
      >
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
                  value={field.state.value}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                  }}
                  onBlur={field.handleBlur}
                  aria-invalid={errorMessage ? true : undefined}
                />
                <FieldError match={Boolean(errorMessage)}>{errorMessage}</FieldError>
              </Field>
            );
          }}
        </form.Field>
      </SettingCard>
    </form>
  );
};

const DeleteSection = ({ project }: { project: ProjectDetail }) => {
  const router = useRouter();
  const queryClient = useQueryClient();

  return (
    <SettingCard
      className="border-destructive"
      title="Danger zone"
      description="Permanently delete this project and all of its branches, channels, and updates."
      footer={
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
      }
    />
  );
};

const SettingsContent = () => {
  const { activeOrg, project } = Route.useRouteContext();
  const { data: projectData } = useSuspenseQuery(projectQueryOptions(activeOrg.id, project.id));

  return (
    <>
      <RenameSection project={projectData} />
      <DeleteSection project={projectData} />
    </>
  );
};

const SettingsPage = () => (
  <div className="flex flex-col gap-6">
    <Suspense
      fallback={
        <>
          <SettingCardSkeleton fields={1} />
          <SettingCardSkeleton fields={0} hasFooter={false} />
        </>
      }
    >
      <SettingsContent />
    </Suspense>
  </div>
);

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/settings/")({
  component: SettingsPage,
});
