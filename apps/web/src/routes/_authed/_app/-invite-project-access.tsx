import { projectsQueryOptions } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/button";
import { Select } from "@better-update/ui/components/select";
import { Switch } from "@better-update/ui/components/switch";
import { PlusIcon, TrashIcon } from "@phosphor-icons/react";

import type { ProjectMemberRoleValue } from "@better-update/api-client/react";

import {
  ServerSearchCombobox,
  useServerSearchList,
} from "../../../components/server-search-combobox";
import { onPicked } from "../../../lib/form-utils";
import { DROPDOWN_FETCH_LIMIT } from "../../../queries/constants";

// The invite dialog's "Project access" panel: draft per-project grant rows and
// the org-wide ("all projects") draft toggle. Pure form state — nothing is
// written until the invitation is sent (-invite-dialog.tsx).

export const PROJECT_ROLE_LABELS: Record<ProjectMemberRoleValue, string> = {
  maintainer: "Maintainer",
  developer: "Developer",
  reporter: "Reporter",
};

/** One draft (project, role) grant row in the invite form. */
export interface ProjectGrantDraft {
  key: number;
  projectId: string | null;
  role: ProjectMemberRoleValue;
}

/**
 * The role picker that sits beside a project — narrow, unlabelled, and
 * repeated once per grant row, so the label lives in `aria-label` only.
 */
const ProjectRoleSelect = ({
  ariaLabel,
  value,
  onChange,
}: {
  ariaLabel: string;
  value: ProjectMemberRoleValue;
  onChange: (next: ProjectMemberRoleValue) => void;
}) => (
  <Select
    aria-label={ariaLabel}
    className="w-36"
    items={PROJECT_ROLE_LABELS}
    value={value}
    onValueChange={onPicked(onChange)}
  />
);

// Server-searched project picker: orgs can outgrow the dropdown fetch limit,
// so the option list is the first page and typing searches the whole org.
const ProjectGrantPicker = ({
  orgId,
  value,
  onChange,
}: {
  orgId: string;
  value: string | null;
  onChange: (next: string) => void;
}) => {
  const list = useServerSearchList((query) =>
    projectsQueryOptions(
      orgId,
      query ? { limit: DROPDOWN_FETCH_LIMIT, query } : { limit: DROPDOWN_FETCH_LIMIT },
    ),
  );
  return (
    <div className="min-w-0 flex-1">
      <ServerSearchCombobox
        value={value === null ? "" : value}
        onValueChange={onChange}
        options={list.items.map((project) => ({ value: project.id, label: project.name }))}
        search={list.search}
        onSearchChange={list.handleSearchChange}
        isPending={list.isPending}
        defaultListTruncated={list.defaultListTruncated}
        placeholder="Select a project"
        searchPlaceholder="Search projects…"
        emptyMessage="No projects found."
        ariaLabel="Project"
      />
    </div>
  );
};

const ProjectGrantRow = ({
  orgId,
  grant,
  onChange,
  onRemove,
}: {
  orgId: string;
  grant: ProjectGrantDraft;
  onChange: (patch: Partial<Pick<ProjectGrantDraft, "projectId" | "role">>) => void;
  onRemove: () => void;
}) => (
  <div className="flex items-start gap-2">
    <ProjectGrantPicker
      orgId={orgId}
      value={grant.projectId}
      onChange={(next) => {
        onChange({ projectId: next });
      }}
    />
    <ProjectRoleSelect
      ariaLabel="Project role"
      value={grant.role}
      onChange={(role) => {
        onChange({ role });
      }}
    />
    <Button
      variant="ghost"
      shape="square"
      className="text-kumo-subtle/70 hover:text-kumo-danger"
      aria-label="Remove project access"
      onClick={onRemove}
    >
      <TrashIcon weight="bold" className="size-4" />
    </Button>
  </div>
);

// Org-wide draft toggle, mirroring the Manage-projects dialog's
// AllProjectsSection (-member-projects-cell.tsx) — but pure form state here:
// nothing is written until the invitation is sent. Only rendered for inviters
// holding member:update (the server rejects the grant otherwise).
const AllProjectsDraftRow = ({
  role,
  onChange,
}: {
  role: ProjectMemberRoleValue | null;
  onChange: (next: ProjectMemberRoleValue | null) => void;
}) => (
  <div className="flex items-center justify-between gap-3">
    <label htmlFor="invite-all-projects" className="grid gap-0.5">
      <span className="text-sm">All projects</span>
      <span className="text-kumo-subtle text-xs">
        Member of every project, including projects created later.
      </span>
    </label>
    <div className="flex items-center gap-2">
      {role === null ? null : (
        <ProjectRoleSelect ariaLabel="Org-wide role" value={role} onChange={onChange} />
      )}
      <Switch
        id="invite-all-projects"
        checked={role !== null}
        onCheckedChange={(next) => {
          onChange(next ? "developer" : null);
        }}
      />
    </div>
  </div>
);

export const ProjectGrantsSection = ({
  orgId,
  grants,
  allProjectsRole,
  canGrantAllProjects,
  onAllProjectsChange,
  onAdd,
  onChange,
  onRemove,
}: {
  orgId: string;
  grants: readonly ProjectGrantDraft[];
  allProjectsRole: ProjectMemberRoleValue | null;
  canGrantAllProjects: boolean;
  onAllProjectsChange: (next: ProjectMemberRoleValue | null) => void;
  onAdd: () => void;
  onChange: (key: number, patch: Partial<Pick<ProjectGrantDraft, "projectId" | "role">>) => void;
  onRemove: (key: number) => void;
}) => (
  // Same panel framing as the credential-bindings All-projects toggle
  // (-credential-bindings.tsx): rounded-md border p-3 with a title + hint stack.
  <div className="flex flex-col gap-3 rounded-md border p-3">
    <div className="grid gap-0.5">
      <span className="text-sm font-medium">Project access</span>
      <span className="text-kumo-subtle text-xs">
        Optional — grants apply when the invitation is accepted.
      </span>
    </div>
    {canGrantAllProjects ? (
      <AllProjectsDraftRow role={allProjectsRole} onChange={onAllProjectsChange} />
    ) : null}
    {grants.map((grant) => (
      <ProjectGrantRow
        key={grant.key}
        orgId={orgId}
        grant={grant}
        onChange={(patch) => {
          onChange(grant.key, patch);
        }}
        onRemove={() => {
          onRemove(grant.key);
        }}
      />
    ))}
    <Button type="button" variant="secondary" size="sm" className="self-start" onClick={onAdd}>
      <PlusIcon weight="bold" data-icon="inline-start" />
      Add project
    </Button>
  </div>
);
