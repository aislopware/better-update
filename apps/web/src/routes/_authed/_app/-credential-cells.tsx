import { Badge } from "@better-update/ui/components/ui/badge";
import { Switch } from "@better-update/ui/components/ui/switch";
import { LockIcon } from "lucide-react";

import type { AppleTeamItem } from "@better-update/api-client/react";

import { formatAppleTeamType } from "./-credentials-utils";

export const EmptyDash = () => <span className="text-muted-foreground">—</span>;

// Stacked team label shared across every credential/device table: human-readable
// name on top, Apple team type + raw identifier below. Accepts null/undefined so
// both map lookups (`map.get`) and array finds can pass results through directly.
// `showProtected` (credential tables only) surfaces the team's cascading
// protection flag (GITLAB-RBAC-SPEC §3b): children inherit it and have no
// toggle of their own, so the badge is their only protection indicator.
export const TeamCell = ({
  team,
  showProtected = false,
}: {
  team: AppleTeamItem | null | undefined;
  showProtected?: boolean;
}) => {
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
      {showProtected && team.protected ? (
        <Badge variant="outline" className="mt-1 w-fit gap-1">
          <LockIcon strokeWidth={2} className="size-3" />
          Protected (via team)
        </Badge>
      ) : null}
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
  if (checked) {
    return (
      <Badge variant="outline" className="gap-1">
        <LockIcon strokeWidth={2} className="size-3" />
        Protected
      </Badge>
    );
  }
  return <EmptyDash />;
};
