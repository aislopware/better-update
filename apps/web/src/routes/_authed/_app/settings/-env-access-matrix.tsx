import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { Spinner } from "@better-update/ui/components/ui/spinner";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import { UsersIcon } from "lucide-react";
import { useMemo } from "react";

import type { EnvGrantRow } from "@better-update/api";

import { useApiMutation } from "../../../../lib/use-api-mutation";
import {
  deleteEnvGrant,
  ENV_GRANT_GLOBAL,
  envGrantsQueryKey,
  upsertEnvGrant,
} from "../../../../queries/org";

import type { MemberItem } from "../../../../queries/org";

// Each cell governs READ access on (project-or-global × environment). Choosing
// "Allow" upserts an allow grant with these tokens; "Deny" upserts a deny grant
// (deny-on-read is the meaningful subtraction for a read-access matrix).
const ENV_VAR_GRANT_ACTIONS = ["envVar:read"] as const;

const ENVIRONMENTS = ["development", "preview", "production"] as const;
type Environment = (typeof ENVIRONMENTS)[number];

const ENVIRONMENT_LABELS: Record<Environment, string> = {
  development: "Development",
  preview: "Preview",
  production: "Production",
};

type CellValue = "inherit" | "allow" | "deny";

const CELL_OPTIONS: Record<CellValue, string> = {
  inherit: "Inherit",
  allow: "Allow",
  deny: "Deny",
};

interface CellKey {
  readonly memberId: string;
  readonly environment: Environment;
}

interface MutationVariables extends CellKey {
  readonly value: CellValue;
}

const memberLabel = (member: MemberItem | undefined, memberId: string): string =>
  member?.user.name || member?.user.email || memberId;

// ── Single matrix cell ───────────────────────────────────────────────────────

interface MatrixCellProps {
  readonly memberId: string;
  readonly environment: Environment;
  readonly value: CellValue;
  readonly pending: boolean;
  readonly onChange: (next: MutationVariables) => void;
}

const MatrixCell = ({ memberId, environment, value, pending, onChange }: MatrixCellProps) => (
  <div className="flex items-center gap-2">
    <Select
      items={CELL_OPTIONS}
      value={value}
      onValueChange={(next) => {
        if (next && next !== value) {
          onChange({ memberId, environment, value: next as CellValue });
        }
      }}
    >
      <SelectTrigger size="sm" className="w-32" disabled={pending}>
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        <SelectItem value="inherit">Inherit</SelectItem>
        <SelectItem value="allow">Allow</SelectItem>
        <SelectItem value="deny">Deny</SelectItem>
      </SelectPopup>
    </Select>
    {pending ? <Spinner className="size-4" /> : null}
  </div>
);

// ── Matrix ───────────────────────────────────────────────────────────────────

interface EnvAccessMatrixProps {
  readonly projectScope: string;
  readonly members: readonly MemberItem[];
  readonly grants: readonly EnvGrantRow[];
}

export const EnvAccessMatrix = ({ projectScope, members, grants }: EnvAccessMatrixProps) => {
  const queryClient = useQueryClient();

  // (memberId × environment) -> effect. Deny wins when both rows exist so the
  // cell reflects the resolved access rather than a stale allow.
  const cellEffect = useMemo(
    () =>
      grants.reduce((map, grant) => {
        const key = `${grant.memberId}:${grant.environment}`;
        if (grant.effect === "deny" || !map.has(key)) {
          map.set(key, grant.effect);
        }
        return map;
      }, new Map<string, "allow" | "deny">()),
    [grants],
  );

  const projectId = projectScope === ENV_GRANT_GLOBAL ? null : projectScope;

  const mutation = useApiMutation({
    mutationFn: async ({ memberId, environment, value }: MutationVariables) => {
      if (value === "inherit") {
        return deleteEnvGrant({ memberId, projectId, environment });
      }
      return upsertEnvGrant({
        memberId,
        projectId,
        environment,
        effect: value,
        actions: value === "allow" ? [...ENV_VAR_GRANT_ACTIONS] : ["envVar:read"],
      });
    },
    onSuccess: async () => {
      toastManager.add({ title: "Access updated", type: "success" });
      await queryClient.invalidateQueries({ queryKey: envGrantsQueryKey(projectScope) });
    },
  });

  const pendingCell: CellKey | undefined = mutation.isPending ? mutation.variables : undefined;

  const valueFor = (memberId: string, environment: Environment): CellValue =>
    cellEffect.get(`${memberId}:${environment}`) ?? "inherit";

  const isPending = (memberId: string, environment: Environment): boolean =>
    pendingCell?.memberId === memberId && pendingCell.environment === environment;

  if (members.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UsersIcon strokeWidth={1.5} />
          </EmptyMedia>
          <EmptyTitle>No members yet</EmptyTitle>
          <EmptyDescription>
            Invite members to your organization to manage their environment access.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="text-muted-foreground px-4 py-2.5 text-left font-medium">Member</th>
            {ENVIRONMENTS.map((environment) => (
              <th
                key={environment}
                className="text-muted-foreground px-4 py-2.5 text-left font-medium"
              >
                {ENVIRONMENT_LABELS[environment]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.id} className="border-b last:border-b-0">
              <td className="px-4 py-2.5 font-medium">{memberLabel(member, member.id)}</td>
              {ENVIRONMENTS.map((environment) => (
                <td key={environment} className="px-4 py-2.5">
                  <MatrixCell
                    memberId={member.id}
                    environment={environment}
                    value={valueFor(member.id, environment)}
                    pending={isPending(member.id, environment)}
                    onChange={(next) => {
                      mutation.mutate(next);
                    }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
