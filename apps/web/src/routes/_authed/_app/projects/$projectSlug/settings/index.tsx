import {
  archiveProject,
  deleteProject,
  isProjectLogoContentType,
  projectQueryKey,
  projectQueryOptions,
  projectsQueryKey,
  removeProjectLogo,
  renameProject,
  unarchiveProject,
  uploadProjectLogo,
} from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import { Field, FieldError, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useForm } from "@tanstack/react-form";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Suspense, useRef } from "react";

import type { ProjectDetail } from "@better-update/api-client/react";
import type { ChangeEvent } from "react";

import { ConfirmActionDialog } from "../-confirm-action-dialog";
import { ConfirmDeleteDialog } from "../-confirm-delete-dialog";
import { invalidateProjects } from "../-update-helpers";
import { SettingCard } from "../../../../../../components/setting-card";
import { SettingCardSkeleton } from "../../../../../../components/skeletons";
import { EntityAvatar } from "../../../../../../lib/entity-avatar";
import { getFieldError, nameSchema } from "../../../../../../lib/form-utils";
import { safeSubmit, useApiMutation } from "../../../../../../lib/use-api-mutation";

// Mirrors the server-side cap (handlers/projects.ts MAX_LOGO_BYTES = 2 MiB);
// checked here for instant feedback before the upload round-trip.
const MAX_LOGO_BYTES = 2_097_152;

const LogoSection = ({ project }: { project: ProjectDetail }) => {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const isArchived = project.archivedAt !== null;

  const onSuccess = async (title: string) => {
    toastManager.add({ title, type: "success" });
    await invalidateProjects(queryClient, project.organizationId, project.id);
  };

  const uploadMutation = useApiMutation({
    mutationFn: async (file: File) => uploadProjectLogo(project.id, file),
    onSuccess: async () => onSuccess("Logo updated"),
  });

  const removeMutation = useApiMutation({
    mutationFn: async () => removeProjectLogo(project.id),
    onSuccess: async () => onSuccess("Logo removed"),
  });

  const busy = uploadMutation.isPending || removeMutation.isPending;

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so re-picking the same file fires onChange again.
    event.target.value = "";
    if (!file) {
      return;
    }
    if (!isProjectLogoContentType(file.type)) {
      toastManager.add({ title: "Use a PNG, JPEG, WebP, or SVG image", type: "error" });
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toastManager.add({ title: "Logo must be 2 MB or smaller", type: "error" });
      return;
    }
    uploadMutation.mutate(file);
  };

  return (
    <SettingCard
      title="Logo"
      description={
        isArchived
          ? "Unarchive this project to change its logo."
          : "Shown across the dashboard. PNG, JPEG, WebP, or SVG up to 2 MB."
      }
      footer={
        <>
          {project.logoUrl === null ? null : (
            <Button
              variant="ghost"
              disabled={isArchived || busy}
              loading={removeMutation.isPending}
              onClick={() => {
                removeMutation.mutate();
              }}
            >
              Remove
            </Button>
          )}
          <Button
            variant="outline"
            disabled={isArchived || busy}
            loading={uploadMutation.isPending}
            onClick={() => inputRef.current?.click()}
          >
            {project.logoUrl === null ? "Upload logo" : "Replace logo"}
          </Button>
        </>
      }
    >
      <div className="flex items-center gap-4">
        <EntityAvatar
          name={project.name}
          seed={project.slug}
          image={project.logoUrl}
          shape="square"
          className="size-16"
        />
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          hidden
          onChange={handleFileChange}
        />
      </div>
    </SettingCard>
  );
};

const RenameSection = ({ project }: { project: ProjectDetail }) => {
  const queryClient = useQueryClient();
  const isArchived = project.archivedAt !== null;
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
        description={isArchived ? "Unarchive this project to rename it." : "Rename this project."}
        footer={
          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
            {([canSubmit, isSubmitting]) => (
              <Button
                type="submit"
                disabled={!canSubmit || isArchived}
                loading={Boolean(isSubmitting)}
              >
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
              <Field invalid={Boolean(errorMessage)}>
                <FieldLabel htmlFor="project-name">Project name</FieldLabel>
                <Input
                  id="project-name"
                  value={field.state.value}
                  disabled={isArchived}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                  }}
                  onBlur={field.handleBlur}
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

const ArchiveSection = ({ project }: { project: ProjectDetail }) => {
  const queryClient = useQueryClient();
  const isArchived = project.archivedAt !== null;

  const unarchiveMutation = useApiMutation({
    mutationFn: async () => unarchiveProject(project.id),
    onSuccess: async () => {
      toastManager.add({ title: "Project unarchived", type: "success" });
      await invalidateProjects(queryClient, project.organizationId, project.id);
    },
  });

  if (isArchived) {
    return (
      <SettingCard
        title="Archived"
        description="This project is archived and read-only. Publishing, builds, and other changes are blocked until you unarchive it. Updates already on devices keep serving."
        footer={
          <Button
            variant="outline"
            loading={unarchiveMutation.isPending}
            onClick={() => {
              unarchiveMutation.mutate();
            }}
          >
            Unarchive project
          </Button>
        }
      />
    );
  }

  return (
    <SettingCard
      title="Archive project"
      description="Hide this project from your project list and make it read-only. Publishing, builds, and other changes are blocked until you unarchive it. Updates already on devices keep serving. Reversible."
      footer={
        <ConfirmActionDialog
          title={`Archive ${project.name}?`}
          description="The project will be hidden from your list and become read-only until you unarchive it. This is reversible."
          confirmLabel="Archive project"
          onConfirm={async () => archiveProject(project.id)}
          successMessage="Project archived"
          onSuccess={async () => {
            await invalidateProjects(queryClient, project.organizationId, project.id);
          }}
        >
          <Button variant="outline">Archive project</Button>
        </ConfirmActionDialog>
      }
    />
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
      <LogoSection project={projectData} />
      <RenameSection project={projectData} />
      <ArchiveSection project={projectData} />
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
          <SettingCardSkeleton fields={1} />
          <SettingCardSkeleton fields={0} hasFooter={false} />
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
