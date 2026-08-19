import { Badge } from "@better-update/ui/components/badge";
import { Switch } from "@better-update/ui/components/switch";
import { LockIcon } from "@phosphor-icons/react";

import type { AppleTeamItem } from "@better-update/api-client/react";

import { CopyButton } from "../../../lib/copy-button";
import { STATUS_BADGE_VARIANT, deriveExpiryStatus } from "../../../lib/credential-status";
import { formatShortDate } from "../../../lib/format-date";
import { formatAppleTeamType, formatFingerprint } from "./-credentials-utils";

export const EmptyDash = () => <span className="text-kumo-subtle">—</span>;

// A keystore fingerprint is 32–95 characters of colon-separated hex that nobody
// reads across — it is compared, and comparing is what the copy button is for.
// Head and tail are enough to tell two keystores apart at a glance.
export const FingerprintCell = ({ value, label }: { value: string | null; label: string }) =>
  value === null ? (
    <span className="font-mono text-xs">—</span>
  ) : (
    <span className="flex items-center gap-1">
      <span className="font-mono text-xs" title={value}>
        {formatFingerprint(value)}
      </span>
      <CopyButton value={value} label={label} />
    </span>
  );

// Read-only per-row protected indicator (GITLAB-RBAC-SPEC §3b) for
// project-scoped credential views; the org tables render the toggle instead.
export const ProtectedBadgeCell = ({ isProtected }: { isProtected: boolean }) =>
  isProtected ? (
    <Badge variant="outline">
      <LockIcon weight="bold" className="size-3" />
      Protected
    </Badge>
  ) : (
    <EmptyDash />
  );

// A lock beside the name it protects, rather than a column of dashes: nearly
// nothing is protected, and the few that are are what a reader came to find.
export const ProtectedMark = ({ isProtected }: { isProtected: boolean }) =>
  isProtected ? (
    <Badge variant="outline">
      <LockIcon weight="bold" className="size-3" />
      Protected
    </Badge>
  ) : null;

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
      <span className="text-kumo-subtle text-xs">
        {team.name === null ? type : `${type} · ${team.appleTeamId}`}
      </span>
    </div>
  );
};

// The team's name on its own, for a table where the team is context rather than
// the subject — a device list, a bundle-identifier list. The stacked cell spends
// a third of the row's width on a raw team id, and the column it starves is the
// one the row is named by; the id stays a hover away.
export const TeamNameCell = ({ team }: { team: AppleTeamItem | null | undefined }) =>
  team ? (
    <span className="truncate" title={team.appleTeamId}>
      {team.name ?? team.appleTeamId}
    </span>
  ) : (
    <EmptyDash />
  );

// The date first, and a badge only when the date is a problem: a column of
// green "Active" pills tells a reader nothing they came for, while a single
// amber one is the whole reason this table is worth looking at. It also folds
// what used to be two columns — Status and Valid until — back into one fact.
export const ExpiryCell = ({ validUntil }: { validUntil: string | null }) => {
  const status = deriveExpiryStatus(validUntil);
  if (validUntil === null) {
    return <Badge variant={STATUS_BADGE_VARIANT[status.tone]}>{status.label}</Badge>;
  }
  return (
    <span className="flex items-center gap-2 whitespace-nowrap">
      {formatShortDate(validUntil)}
      {status.tone === "success" ? null : (
        <Badge variant={STATUS_BADGE_VARIANT[status.tone]}>{status.label}</Badge>
      )}
    </span>
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
