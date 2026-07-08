import { Badge } from "@better-update/ui/components/ui/badge";
import { Switch } from "@better-update/ui/components/ui/switch";
import { LockIcon } from "lucide-react";

import type { AppleTeamItem } from "@better-update/api-client/react";
import type { ReactNode } from "react";

import { formatAppleTeamType } from "./-credentials-utils";

export const EmptyDash = () => <span className="text-muted-foreground">—</span>;

// The credentials page stacks eight sections — an empty section collapses to a
// single quiet row instead of a full-height Empty card so populated sections
// stay above the fold.
export const CredentialEmptyRow = ({ children }: { children: ReactNode }) => (
  <p className="text-muted-foreground rounded-md border border-dashed px-4 py-3 text-sm">
    {children}
  </p>
);

// Read-only per-row protected indicator (GITLAB-RBAC-SPEC §3b) for
// project-scoped credential views; the org tables render the toggle instead.
export const ProtectedBadgeCell = ({ isProtected }: { isProtected: boolean }) =>
  isProtected ? (
    <Badge variant="outline" className="gap-1">
      <LockIcon strokeWidth={2} className="size-3" />
      Protected
    </Badge>
  ) : (
    <EmptyDash />
  );

// Stacked team label shared across every credential/device table: human-readable
// name on top, Apple team type + raw identifier below. Accepts null/undefined so
// both map lookups (`map.get`) and array finds can pass results through directly.
export const TeamCell = ({ team }: { team: AppleTeamItem | null | undefined }) => {
  if (!team) {
    return <EmptyDash />;
  }
  const type = formatAppleTeamType(team.appleTeamType);
  return (
    <div className="flex flex-col">
      <span className="font-medium">{team.name ?? team.appleTeamId}</span>
      <span className="text-muted-foreground text-xs">
        {team.name === null ? type : `${type} · ${team.appleTeamId}`}
      </span>
    </div>
  );
};

export const RolesCell = ({ roles }: { roles: readonly string[] }) =>
  roles.length === 0 ? (
    <EmptyDash />
  ) : (
    <div className="flex flex-wrap gap-1">
      {roles.map((role) => (
        <Badge key={role} variant="outline">
          {role}
        </Badge>
      ))}
    </div>
  );

// Protected-resource toggle cell (GITLAB-RBAC-SPEC §3b): org admins/owners see
// the switch; everyone else sees a read-only badge. Mirrors the environments
// ProtectionSwitch pattern.
export const ProtectionCell = ({
  label,
  checked,
  canManage,
  isPending,
  onToggle,
}: {
  label: string;
  checked: boolean;
  canManage: boolean;
  isPending: boolean;
  onToggle: (next: boolean) => void;
}) => {
  if (canManage) {
    return (
      <Switch
        checked={checked}
        disabled={isPending}
        aria-label={label}
        onCheckedChange={(next) => {
          onToggle(next);
        }}
      />
    );
  }
  return <ProtectedBadgeCell isProtected={checked} />;
};
