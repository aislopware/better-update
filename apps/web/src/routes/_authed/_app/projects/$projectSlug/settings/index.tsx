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
import { Button } from "@better-update/ui/components/button";
import { Input } from "@better-update/ui/components/input";
import { toast } from "@better-update/ui/components/toast";
import { useForm } from "@tanstack/react-form";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Suspense, useRef } from "react";

import type { ProjectDetail } from "@better-update/api-client/react";
import type { ChangeEvent } from "react";

import { ConfirmActionDialog } from "../-confirm-action-dialog";
import { ConfirmDeleteDialog } from "../-confirm-delete-dialog";
import { invalidateProjects } from "../-update-helpers";
import { PageHeader } from "../../../../../../components/page-header";
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
    toast.success(title);
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
      toast.error("Use a PNG, JPEG, WebP, or SVG image");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error("Logo must be 2 MB or smaller");
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
              onClick={() => {
                removeMutation.mutate();
              }}
              loading={removeMutation.isPending}
            >
              Remove
            </Button>
          )}
          <Button
            variant="secondary"
            disabled={isArchived || busy}
            onClick={() => inputRef.current?.click()}
            loading={uploadMutation.isPending}
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
      toast.success("Project renamed");
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
      {/* A description only when there is something to say: "Rename this
          project" over a field labelled Project name and a button labelled Save
          changes is the card narrating itself. */}
      <SettingCard
        title="General"
        description={isArchived ? "Unarchive this project to rename it." : undefined}
        footer={
          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
            {([canSubmit, isSubmitting]) => (
              <Button
                variant="primary"
                type="submit"
                disabled={!canSubmit || isArchived || Boolean(isSubmitting)}
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
              <Input
                label="Project name"
                error={errorMessage}
                id="project-name"
                value={field.state.value}
                disabled={isArchived}
                onChange={(event) => {
                  field.handleChange(event.target.value);
                }}
                onBlur={field.handleBlur}
              />
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
      toast.success("Project unarchived");
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
            variant="secondary"
            onClick={() => {
              unarchiveMutation.mutate();
            }}
            loading={unarchiveMutation.isPending}
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
      // Two sentences, not four: "read-only" already covers the list of things
      // that stop working, and the dialog behind the button is where "this is
      // reversible" belongs — it is what you want to hear while deciding.
      description="Hide this project from your list and make it read-only. Updates already on devices keep serving."
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
          {/* The card is titled "Archive project" and the dialog behind this
              button says it again in full — the button itself does not have to. */}
          <Button variant="secondary">Archive</Button>
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
      destructive
      // Every other card on this page is titled after what it does. "Danger
      // zone" named a mood instead, and the mood was already being carried by
      // the red border and the red button — leaving the one card whose heading
      // did not say which of them was the irreversible one.
      title="Delete project"
      description="Branches, channels, and updates go with it. This cannot be undone."
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
          <Button variant="destructive">Delete</Button>
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

// Capped to a readable measure — see the organization settings page for why.
const SettingsPage = () => (
  <div className="flex w-full max-w-3xl flex-col gap-6">
    {/* No description: it listed the cards below it, each of which is titled
        after the thing it does. */}
    <PageHeader title="Project settings" />
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
