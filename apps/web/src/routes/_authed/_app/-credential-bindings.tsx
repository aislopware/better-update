import {
  appleTeamsQueryKey,
  androidUploadKeystoresQueryKey,
  ascApiKeysQueryKey,
  bindCredentialToAllProjects,
  bindCredentialToProject,
  credentialBindingsQueryKey,
  googleServiceAccountKeysQueryKey,
  projectsQueryOptions,
  unbindCredentialFromAllProjects,
  unbindCredentialFromProject,
} from "@better-update/api-client/react";
import { Badge, badgeVariants } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import { Checkbox } from "@better-update/ui/components/ui/checkbox";
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
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@better-update/ui/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@better-update/ui/components/ui/popover";
import { toast } from "@better-update/ui/components/ui/sonner";
import { Switch } from "@better-update/ui/components/ui/switch";
import { cn } from "@better-update/ui/lib/utils";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { SearchIcon } from "lucide-react";
import { useState } from "react";

import type { CredentialBindingTypeValue } from "@better-update/api";

import { useServerSearchList } from "../../../components/server-search-combobox";
import { useApiMutation } from "../../../lib/use-api-mutation";
import { DROPDOWN_FETCH_LIMIT } from "../../../queries/constants";

// Credential→project bindings (GITLAB-RBAC-SPEC §1a): an org credential is
// usable in a project only when bound to it — unbound means org-admins-only.
// `appleTeam` bindings cascade to every child credential and the team's
// devices, so team-scoped rows surface their team's projects read-only.
// An ORG-WIDE binding ("All projects") covers every project, present and
// future — no per-project rows needed.

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

// Keep the Projects column compact: a handful of chips, the rest in a popover.
const MAX_VISIBLE_PROJECT_CHIPS = 3;

// Below this count the whole checklist is scannable at a glance — no filter box.
const CHECKLIST_FILTER_THRESHOLD = 8;

export const BoundProjectChips = ({
  boundProjectIds,
  boundToAllProjects,
  projects,
}: {
  boundProjectIds: readonly string[];
  boundToAllProjects: boolean;
  projects: readonly ProjectOption[];
}) => {
  if (boundToAllProjects) {
    return <Badge variant="secondary">All projects</Badge>;
  }
  if (boundProjectIds.length === 0) {
    return <span className="text-muted-foreground text-xs">Not bound to any project</span>;
  }
  const named = boundProjectIds.map((projectId) => ({
    id: projectId,
    name: projects.find((project) => project.id === projectId)?.name ?? "Unknown project",
  }));
  const visible = named.slice(0, MAX_VISIBLE_PROJECT_CHIPS);
  const overflowCount = named.length - visible.length;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {visible.map((project) => (
        <Badge key={project.id} variant="secondary">
          {project.name}
        </Badge>
      ))}
      {overflowCount > 0 ? (
        <Popover>
          <PopoverTrigger
            className={cn(badgeVariants({ variant: "outline" }), "cursor-pointer")}
            aria-label={`Show all ${named.length} bound projects`}
          >
            +{overflowCount}
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64">
            <PopoverHeader>
              <PopoverTitle>Bound projects</PopoverTitle>
            </PopoverHeader>
            <ul className="max-h-64 overflow-y-auto">
              {named
                .toSorted((left, right) => left.name.localeCompare(right.name))
                .map((project) => (
                  <li key={project.id} className="rounded-sm px-1.5 py-1 text-sm">
                    {project.name}
                  </li>
                ))}
            </ul>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
};

// Org-wide toggle: bound to EVERY project, including ones created later —
// the answer to "stop ticking each project by hand".
const AllProjectsToggle = ({
  orgId,
  resourceType,
  resourceId,
  boundToAllProjects,
}: {
  orgId: string;
  resourceType: CredentialBindingTypeValue;
  resourceId: string;
  boundToAllProjects: boolean;
}) => {
  const queryClient = useQueryClient();
  const toggleMutation = useApiMutation({
    mutationFn: async (next: boolean) =>
      next
        ? bindCredentialToAllProjects({ resourceType, resourceId })
        : unbindCredentialFromAllProjects({ resourceType, resourceId }),
    onSuccess: async (_result, next) => {
      toast.success(
        next
          ? "Credential bound to all projects"
          : "All-projects binding removed — explicit per-project bindings still apply",
      );
      await Promise.all(
        AFFECTED_LIST_KEYS[resourceType](orgId).map(async (queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      );
    },
  });

  const switchId = `all-projects-${resourceType}-${resourceId}`;
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border p-3">
      <label htmlFor={switchId} className="grid gap-0.5">
        <span className="text-sm font-medium">All projects</span>
        <span className="text-muted-foreground text-xs">
          Usable in every project, including projects created later.
        </span>
      </label>
      <Switch
        id={switchId}
        checked={boundToAllProjects}
        disabled={toggleMutation.isPending}
        onCheckedChange={(next) => {
          toggleMutation.mutate(next);
        }}
      />
    </div>
  );
};

// The search runs server-side, so an in-flight query has a distinct
// "Searching…" state before the definitive no-match copy.
const ChecklistEmptyState = ({ query, isPending }: { query: string; isPending: boolean }) => {
  if (isPending) {
    return <p className="text-muted-foreground text-sm">Searching…</p>;
  }
  return <p className="text-muted-foreground text-sm">No projects match “{query}”.</p>;
};

const BindingsChecklist = ({
  orgId,
  resourceType,
  resourceId,
  boundProjectIds,
  projects,
  disabled,
}: {
  orgId: string;
  resourceType: CredentialBindingTypeValue;
  resourceId: string;
  boundProjectIds: readonly string[];
  projects: readonly ProjectOption[];
  disabled: boolean;
}) => {
  // Server-side search: the checklist page is bounded by DROPDOWN_FETCH_LIMIT,
  // so typing queries the whole org instead of filtering the first page.
  const list = useServerSearchList((query) =>
    projectsQueryOptions(
      orgId,
      query
        ? { limit: DROPDOWN_FETCH_LIMIT, query, status: "all" }
        : { limit: DROPDOWN_FETCH_LIMIT, status: "all" },
    ),
  );
  const queryClient = useQueryClient();
  const toggleMutation = useApiMutation({
    mutationFn: async (input: { readonly projectId: string; readonly next: boolean }) =>
      input.next
        ? bindCredentialToProject({ projectId: input.projectId, resourceType, resourceId })
        : unbindCredentialFromProject({ projectId: input.projectId, resourceType, resourceId }),
    onSuccess: async (_result, { projectId, next }) => {
      toast.success(next ? "Credential bound to project" : "Credential unbound from project");
      await Promise.all([
        ...AFFECTED_LIST_KEYS[resourceType](orgId).map(async (queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
        queryClient.invalidateQueries({ queryKey: credentialBindingsQueryKey(orgId, projectId) }),
      ]);
    },
  });

  if (projects.length === 0) {
    return <p className="text-muted-foreground text-sm">No projects in this organization yet.</p>;
  }

  const visibleProjects = list.items.toSorted((left, right) => left.name.localeCompare(right.name));

  return (
    <div className="grid gap-3">
      {projects.length > CHECKLIST_FILTER_THRESHOLD || list.defaultListTruncated ? (
        <InputGroup>
          <InputGroupInput
            type="search"
            value={list.search}
            placeholder="Filter projects…"
            onChange={(event) => {
              list.handleSearchChange(event.target.value);
            }}
          />
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
        </InputGroup>
      ) : null}
      <div className="grid max-h-[40vh] gap-3 overflow-y-auto">
        {visibleProjects.length === 0 ? (
          <ChecklistEmptyState query={list.search.trim()} isPending={list.isPending} />
        ) : (
          visibleProjects.map((project) => (
            <label
              key={project.id}
              className={cn("flex items-center gap-2 text-sm", disabled && "opacity-50")}
            >
              <Checkbox
                checked={boundProjectIds.includes(project.id)}
                disabled={disabled || toggleMutation.isPending}
                onCheckedChange={(next) => {
                  toggleMutation.mutate({ projectId: project.id, next });
                }}
              />
              <span>{project.name}</span>
            </label>
          ))
        )}
      </div>
    </div>
  );
};

// Chips + (for org admins) a dialog to bind/unbind the credential — org-wide
// via the All-projects switch, or per project via the checklist (disabled
// while org-wide is on: every project is already covered). Parent owns the
// dialog open state; the body is keyed so its mutation state resets after the
// close animation (onOpenChangeComplete key bump).
export const BoundProjectsCell = ({
  orgId,
  resourceType,
  resourceId,
  resourceLabel,
  boundProjectIds,
  boundToAllProjects,
  canManage,
}: {
  orgId: string;
  resourceType: CredentialBindingTypeValue;
  resourceId: string;
  resourceLabel: string;
  boundProjectIds: readonly string[];
  boundToAllProjects: boolean;
  canManage: boolean;
}) => {
  const projects = useOrgProjects(orgId);
  const [open, setOpen] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  return (
    <div className="flex flex-col items-start gap-1">
      <BoundProjectChips
        boundProjectIds={boundProjectIds}
        boundToAllProjects={boundToAllProjects}
        projects={projects}
      />
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
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Bound projects</DialogTitle>
              <DialogDescription>
                Choose which projects can use {resourceLabel}. An unbound credential is usable by
                org admins only.
              </DialogDescription>
            </DialogHeader>
            <div key={resetKey} className="grid gap-4">
              <AllProjectsToggle
                orgId={orgId}
                resourceType={resourceType}
                resourceId={resourceId}
                boundToAllProjects={boundToAllProjects}
              />
              <BindingsChecklist
                orgId={orgId}
                resourceType={resourceType}
                resourceId={resourceId}
                boundProjectIds={boundProjectIds}
                projects={projects}
                disabled={boundToAllProjects}
              />
            </div>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
            </DialogFooter>
          </DialogContent>
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
  boundToAllProjects,
}: {
  orgId: string;
  boundProjectIds: readonly string[];
  boundToAllProjects: boolean;
}) => {
  const projects = useOrgProjects(orgId);
  return (
    <div className="flex flex-col items-start gap-1">
      <BoundProjectChips
        boundProjectIds={boundProjectIds}
        boundToAllProjects={boundToAllProjects}
        projects={projects}
      />
      {boundProjectIds.length === 0 && !boundToAllProjects ? null : (
        <span className="text-muted-foreground text-xs">Inherited from team</span>
      )}
    </div>
  );
};
