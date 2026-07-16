import {
  addProjectMember,
  memberProjectMembershipsQueryKey,
  projectMembersQueryKey,
  projectsQueryOptions,
  removeMemberAllProjectsRole,
  removeProjectMember,
  setMemberAllProjectsRole,
  updateProjectMemberRole,
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { toast } from "@better-update/ui/components/ui/sonner";
import { Switch } from "@better-update/ui/components/ui/switch";
import { cn } from "@better-update/ui/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { SearchIcon } from "lucide-react";
import { useState } from "react";

import type {
  MemberProjectMembershipsItem,
  ProjectMemberRoleValue,
} from "@better-update/api-client/react";

import { useServerSearchList } from "../../../components/server-search-combobox";
import { useApiMutation } from "../../../lib/use-api-mutation";
import { DROPDOWN_FETCH_LIMIT } from "../../../queries/constants";

// Centralized project-membership management (Members screen), mirroring the
// credential "Manage projects" dialog: an org-wide ("all projects") switch —
// every project, present and future, org_credential_binding-style — plus a
// per-project checklist backed by the same project-members routes the project
// page uses. Roles combine: the higher of the org-wide and per-project role
// applies (server-side max at query time).

const PROJECT_ROLE_LABELS: Record<ProjectMemberRoleValue, string> = {
  maintainer: "Maintainer",
  developer: "Developer",
  reporter: "Reporter",
};

const PROJECT_ROLE_VALUES = ["maintainer", "developer", "reporter"] as const;

const DEFAULT_MEMBERSHIP_ROLE: ProjectMemberRoleValue = "developer";

// Keep the Projects column compact: a handful of chips, the rest in a popover.
const MAX_VISIBLE_PROJECT_CHIPS = 3;

// Below this count the whole checklist is scannable at a glance — no filter box.
const CHECKLIST_FILTER_THRESHOLD = 8;

/** The member a Manage-projects dialog targets. */
export interface ManageProjectsTarget {
  readonly id: string;
  readonly name: string;
}

/** One checklist toggle: role null = leave, isNew = join vs. role change. */
interface MembershipChange {
  readonly projectId: string;
  readonly role: ProjectMemberRoleValue | null;
  readonly isNew: boolean;
}

const membershipToast = (change: MembershipChange): string => {
  if (change.role === null) {
    return "Removed from project";
  }
  return change.isNew ? "Added to project" : "Project role updated";
};

const RoleSelect = ({
  value,
  disabled,
  label,
  onChange,
}: {
  value: ProjectMemberRoleValue;
  disabled: boolean;
  label: string;
  onChange: (role: ProjectMemberRoleValue) => void;
}) => (
  <Select
    items={PROJECT_ROLE_LABELS}
    value={value}
    disabled={disabled}
    onValueChange={(next) => {
      if (next !== null && next !== value) {
        onChange(next);
      }
    }}
  >
    <SelectTrigger className="h-8 w-32" aria-label={label}>
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectGroup>
        {PROJECT_ROLE_VALUES.map((role) => (
          <SelectItem key={role} value={role}>
            {PROJECT_ROLE_LABELS[role]}
          </SelectItem>
        ))}
      </SelectGroup>
    </SelectContent>
  </Select>
);

export const MemberProjectChips = ({
  summary,
}: {
  summary: MemberProjectMembershipsItem | undefined;
}) => {
  if (summary !== undefined && summary.allProjectsRole !== null) {
    return (
      <Badge variant="secondary">
        All projects · {PROJECT_ROLE_LABELS[summary.allProjectsRole]}
      </Badge>
    );
  }
  const projects = summary === undefined ? [] : summary.projects;
  if (projects.length === 0) {
    return <span className="text-muted-foreground text-xs">No projects</span>;
  }
  const visible = projects.slice(0, MAX_VISIBLE_PROJECT_CHIPS);
  const overflowCount = projects.length - visible.length;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {visible.map((project) => (
        <Badge key={project.projectId} variant="secondary">
          {project.projectName}
        </Badge>
      ))}
      {overflowCount > 0 ? (
        <Popover>
          <PopoverTrigger
            className={cn(badgeVariants({ variant: "outline" }), "cursor-pointer")}
            aria-label={`Show all ${projects.length} projects`}
          >
            +{overflowCount}
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72">
            <PopoverHeader>
              <PopoverTitle>Projects</PopoverTitle>
            </PopoverHeader>
            <ul className="max-h-64 overflow-y-auto">
              {projects.map((project) => (
                <li
                  key={project.projectId}
                  className="flex items-center justify-between gap-2 rounded-sm px-1.5 py-1 text-sm"
                >
                  <span className="truncate">{project.projectName}</span>
                  <span className="text-muted-foreground text-xs">
                    {PROJECT_ROLE_LABELS[project.role]}
                  </span>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
};

// Org-wide switch: member of EVERY project, including ones created later —
// the membership analog of the credential All-projects binding. The role
// select feeds the same idempotent PUT, so changing it while on is a re-grant.
const AllProjectsSection = ({
  orgId,
  principalId,
  allProjectsRole,
}: {
  orgId: string;
  principalId: string;
  allProjectsRole: ProjectMemberRoleValue | null;
}) => {
  const queryClient = useQueryClient();
  const mutation = useApiMutation({
    mutationFn: async (next: ProjectMemberRoleValue | null) =>
      next === null
        ? removeMemberAllProjectsRole(principalId)
        : setMemberAllProjectsRole(principalId, next),
    onSuccess: async (_result, next) => {
      toast.success(
        next === null
          ? "Org-wide membership removed — per-project memberships still apply"
          : `Member joined all projects as ${PROJECT_ROLE_LABELS[next]}`,
      );
      await queryClient.invalidateQueries({ queryKey: memberProjectMembershipsQueryKey(orgId) });
    },
  });

  const switchId = `all-projects-${principalId}`;
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border p-3">
      <label htmlFor={switchId} className="grid gap-0.5">
        <span className="text-sm font-medium">All projects</span>
        <span className="text-muted-foreground text-xs">
          Member of every project, including projects created later.
        </span>
      </label>
      <div className="flex items-center gap-2">
        {allProjectsRole === null ? null : (
          <RoleSelect
            value={allProjectsRole}
            disabled={mutation.isPending}
            label="Org-wide role"
            onChange={(role) => {
              mutation.mutate(role);
            }}
          />
        )}
        <Switch
          id={switchId}
          checked={allProjectsRole !== null}
          disabled={mutation.isPending}
          onCheckedChange={(next) => {
            mutation.mutate(next ? DEFAULT_MEMBERSHIP_ROLE : null);
          }}
        />
      </div>
    </div>
  );
};

// The search runs server-side, so an in-flight query has a distinct
// "Searching…" state before the definitive no-match copy.
const ChecklistEmptyState = ({ query, isPending }: { query: string; isPending: boolean }) => {
  if (isPending) {
    return <p className="text-muted-foreground text-sm">Searching…</p>;
  }
  if (query === "") {
    return <p className="text-muted-foreground text-sm">No projects in this organization yet.</p>;
  }
  return <p className="text-muted-foreground text-sm">No projects match “{query}”.</p>;
};

const MembershipChecklist = ({
  orgId,
  principalId,
  summary,
}: {
  orgId: string;
  principalId: string;
  summary: MemberProjectMembershipsItem | undefined;
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
  const roleByProjectId = new Map(
    (summary === undefined ? [] : summary.projects).map(
      (project) => [project.projectId, project.role] as const,
    ),
  );

  const toggleMutation = useApiMutation({
    mutationFn: async (input: MembershipChange) => {
      if (input.role === null) {
        return removeProjectMember(input.projectId, principalId, "member");
      }
      if (input.isNew) {
        return addProjectMember(input.projectId, {
          principalType: "member",
          principalId,
          role: input.role,
        });
      }
      return updateProjectMemberRole(input.projectId, principalId, {
        principalType: "member",
        role: input.role,
      });
    },
    onSuccess: async (_result, change) => {
      toast.success(membershipToast(change));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: memberProjectMembershipsQueryKey(orgId) }),
        queryClient.invalidateQueries({ queryKey: projectMembersQueryKey(change.projectId) }),
      ]);
    },
  });

  const visibleProjects = list.items.toSorted((left, right) => left.name.localeCompare(right.name));

  return (
    <div className="grid gap-3">
      {visibleProjects.length > CHECKLIST_FILTER_THRESHOLD || list.defaultListTruncated ? (
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
      <div className="grid max-h-[40vh] gap-2 overflow-y-auto">
        {visibleProjects.length === 0 ? (
          <ChecklistEmptyState query={list.search.trim()} isPending={list.isPending} />
        ) : (
          visibleProjects.map((project) => {
            const role = roleByProjectId.get(project.id);
            return (
              <div key={project.id} className="flex min-h-8 items-center gap-2">
                <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                  <Checkbox
                    checked={role !== undefined}
                    disabled={toggleMutation.isPending}
                    onCheckedChange={(next) => {
                      toggleMutation.mutate({
                        projectId: project.id,
                        role: next ? DEFAULT_MEMBERSHIP_ROLE : null,
                        isNew: next,
                      });
                    }}
                  />
                  <span className="truncate">{project.name}</span>
                </label>
                {role === undefined ? null : (
                  <RoleSelect
                    value={role}
                    disabled={toggleMutation.isPending}
                    label={`Role on ${project.name}`}
                    onChange={(next) => {
                      toggleMutation.mutate({ projectId: project.id, role: next, isNew: false });
                    }}
                  />
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

// Chips + (for org admins) a trigger for the page-level manage dialog.
// Owner/admin rows are implicit maintainers on every project — a static
// badge, nothing to manage.
export const MemberProjectsCell = ({
  principalId,
  memberName,
  orgRole,
  summary,
  canManage,
  onManage,
}: {
  principalId: string;
  memberName: string;
  orgRole: string;
  summary: MemberProjectMembershipsItem | undefined;
  canManage: boolean;
  onManage: (target: ManageProjectsTarget) => void;
}) => {
  if (orgRole === "owner" || orgRole === "admin") {
    return (
      <div className="flex flex-col items-start gap-0.5">
        <Badge variant="secondary">All projects</Badge>
        <span className="text-muted-foreground text-xs">Implicit maintainer</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <MemberProjectChips summary={summary} />
      {canManage ? (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground h-6 px-1.5 text-xs"
          onClick={() => {
            onManage({ id: principalId, name: memberName });
          }}
        >
          Manage projects
        </Button>
      ) : null}
    </div>
  );
};

// One dialog instance at page level (like RemoveDialog): a cell-hosted dialog
// would remount — and silently close — whenever the memberships query
// invalidates and the table columns rebuild. The parent keeps `target` set
// through the close animation and clears it in onClosed (key-bump pattern).
export const ManageProjectsDialog = ({
  orgId,
  open,
  target,
  summary,
  onClose,
  onClosed,
}: {
  orgId: string;
  open: boolean;
  target: ManageProjectsTarget | null;
  summary: MemberProjectMembershipsItem | undefined;
  onClose: () => void;
  onClosed: () => void;
}) => {
  const [resetKey, setResetKey] = useState(0);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
      onOpenChangeComplete={(next) => {
        if (!next) {
          setResetKey((prev) => prev + 1);
          onClosed();
        }
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Project memberships</DialogTitle>
          <DialogDescription>
            Choose which projects {target === null ? "the member" : target.name} joins. When both an
            org-wide and a per-project role apply, the higher role wins.
          </DialogDescription>
        </DialogHeader>
        {target === null ? null : (
          <div key={resetKey} className="grid gap-4">
            <AllProjectsSection
              orgId={orgId}
              principalId={target.id}
              allProjectsRole={summary === undefined ? null : summary.allProjectsRole}
            />
            <MembershipChecklist orgId={orgId} principalId={target.id} summary={summary} />
          </div>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
