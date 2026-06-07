import { Badge } from "@better-update/ui/components/ui/badge";

import type { AppleTeamItem } from "@better-update/api-client/react";

import { formatAppleTeamType } from "./-credentials-utils";

export const EmptyDash = () => <span className="text-muted-foreground">—</span>;

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
