import {
  appleTeamsQueryKey,
  androidUploadKeystoresQueryKey,
  ascApiKeysQueryKey,
  bindCredentialToProject,
  credentialBindingsQueryKey,
  googleServiceAccountKeysQueryKey,
  projectsQueryOptions,
  unbindCredentialFromProject,
} from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import { Checkbox } from "@better-update/ui/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "@better-update/ui/components/ui/dialog";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";

import type { CredentialBindingTypeValue } from "@better-update/api";

import { useApiMutation } from "../../../lib/use-api-mutation";
import { DROPDOWN_FETCH_LIMIT } from "../../../queries/constants";

// Credential→project bindings (GITLAB-RBAC-SPEC §1a): an org credential is
// usable in a project only when bound to it — unbound means org-admins-only.
// `appleTeam` bindings cascade to every child credential and the team's
// devices, so team-scoped rows surface their team's projects read-only.

interface ProjectOption {
  readonly id: string;
  readonly name: string;
}

// `status: "all"` so bindings to archived projects still resolve to a name.
const useOrgProjects = (orgId: string): readonly ProjectOption[] => {
  const { data } = useSuspenseQuery(
    projectsQueryOptions(orgId, { limit: DROPDOWN_FETCH_LIMIT, status: "all" }),
  );
  return data.items;
};

// Credential list queries whose `boundProjectIds` change with a bind/unbind of
// each resource type — an appleTeam binding also cascades into team-scoped
// ASC key rows.
const AFFECTED_LIST_KEYS: Record<
  CredentialBindingTypeValue,
  (orgId: string) => readonly (readonly unknown[])[]
> = {
  appleTeam: (orgId) => [appleTeamsQueryKey(orgId), ascApiKeysQueryKey(orgId)],
  ascApiKey: (orgId) => [ascApiKeysQueryKey(orgId)],
  googleServiceAccountKey: (orgId) => [googleServiceAccountKeysQueryKey(orgId)],
  androidUploadKeystore: (orgId) => [androidUploadKeystoresQueryKey(orgId)],
};

export const BoundProjectChips = ({
  boundProjectIds,
  projects,
}: {
  boundProjectIds: readonly string[];
  projects: readonly ProjectOption[];
}) =>
  boundProjectIds.length === 0 ? (
    <span className="text-muted-foreground text-xs">Not bound to any project</span>
  ) : (
    <div className="flex flex-wrap gap-1">
      {boundProjectIds.map((projectId) => (
        <Badge key={projectId} variant="secondary">
          {projects.find((project) => project.id === projectId)?.name ?? "Unknown project"}
        </Badge>
      ))}
    </div>
  );

const BindingsChecklist = ({
  orgId,
  resourceType,
  resourceId,
  boundProjectIds,
  projects,
}: {
  orgId: string;
  resourceType: CredentialBindingTypeValue;
  resourceId: string;
  boundProjectIds: readonly string[];
  projects: readonly ProjectOption[];
}) => {
  const queryClient = useQueryClient();
  const toggleMutation = useApiMutation({
    mutationFn: async (input: { readonly projectId: string; readonly next: boolean }) =>
      input.next
        ? bindCredentialToProject({ projectId: input.projectId, resourceType, resourceId })
        : unbindCredentialFromProject({ projectId: input.projectId, resourceType, resourceId }),
    onSuccess: async (_result, { projectId, next }) => {
      toastManager.add({
        title: next ? "Credential bound to project" : "Credential unbound from project",
        type: "success",
      });
      await Promise.all([
        ...AFFECTED_LIST_KEYS[resourceType](orgId).map(async (queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
        queryClient.invalidateQueries({ queryKey: credentialBindingsQueryKey(orgId, projectId) }),
      ]);
    },
  });

  return (
    <DialogPanel className="grid gap-3">
      {projects.length === 0 ? (
        <p className="text-muted-foreground text-sm">No projects in this organization yet.</p>
      ) : (
        projects.map((project) => (
          <label key={project.id} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={boundProjectIds.includes(project.id)}
              disabled={toggleMutation.isPending}
              onCheckedChange={(next) => {
                toggleMutation.mutate({ projectId: project.id, next });
              }}
            />
            <span>{project.name}</span>
          </label>
        ))
      )}
    </DialogPanel>
  );
};

// Chips + (for org admins) a dialog to bind/unbind the credential per project.
// Parent owns the dialog open state; the checklist is keyed so its mutation
// state resets after the close animation (onOpenChangeComplete key bump).
export const BoundProjectsCell = ({
  orgId,
  resourceType,
  resourceId,
  resourceLabel,
  boundProjectIds,
  canManage,
}: {
  orgId: string;
  resourceType: CredentialBindingTypeValue;
  resourceId: string;
  resourceLabel: string;
  boundProjectIds: readonly string[];
  canManage: boolean;
}) => {
  const projects = useOrgProjects(orgId);
  const [open, setOpen] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  return (
    <div className="flex flex-col items-start gap-1">
      <BoundProjectChips boundProjectIds={boundProjectIds} projects={projects} />
      {canManage ? (
        <Dialog
          open={open}
          onOpenChange={setOpen}
          onOpenChangeComplete={(next) => {
            if (!next) {
              setResetKey((prev) => prev + 1);
            }
          }}
        >
          <DialogTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground h-6 px-1.5 text-xs"
              />
            }
          >
            Manage projects
          </DialogTrigger>
          <DialogPopup>
            <DialogHeader>
              <DialogTitle>Bound projects</DialogTitle>
              <DialogDescription>
                Choose which projects can use {resourceLabel}. An unbound credential is usable by
                org admins only.
              </DialogDescription>
            </DialogHeader>
            <BindingsChecklist
              key={resetKey}
              orgId={orgId}
              resourceType={resourceType}
              resourceId={resourceId}
              boundProjectIds={boundProjectIds}
              projects={projects}
            />
            <DialogFooter>
              <DialogClose render={<Button variant="ghost" />}>Close</DialogClose>
            </DialogFooter>
          </DialogPopup>
        </Dialog>
      ) : null}
    </div>
  );
};

// Team-scoped ASC keys (and other Apple-team children) inherit the team's
// bindings (§1a cascade) and manage nothing of their own — read-only chips.
export const InheritedProjectsCell = ({
  orgId,
  boundProjectIds,
}: {
  orgId: string;
  boundProjectIds: readonly string[];
}) => {
  const projects = useOrgProjects(orgId);
  return (
    <div className="flex flex-col items-start gap-1">
      <BoundProjectChips boundProjectIds={boundProjectIds} projects={projects} />
      {boundProjectIds.length === 0 ? null : (
        <span className="text-muted-foreground text-xs">Inherited from team</span>
      )}
    </div>
  );
};
