import { appleTeamsQueryOptions } from "@better-update/api-client/react";
import { Field, FieldDescription, FieldLabel } from "@better-update/ui/components/ui/field";
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { useQuery } from "@tanstack/react-query";

import { formatAppleTeamLabel } from "../-credentials-utils";

/** Sentinel form value meaning "do not assign the device to an Apple team". */
export const APPLE_TEAM_NONE = "NONE";

/**
 * Apple-team picker shared by the register + invite dialogs. The selected value
 * is the team's *internal* id (the FK the device body expects), not the Apple
 * Team Identifier string. Teams are derived from uploaded credentials, so the
 * field hides itself entirely when the org has none yet — there is nothing to
 * assign and an empty dropdown would only confuse.
 */
export const AppleTeamField = ({
  orgId,
  value,
  onChange,
  description,
}: {
  orgId: string;
  value: string;
  onChange: (next: string) => void;
  description?: string;
}) => {
  const { data } = useQuery(appleTeamsQueryOptions(orgId));
  const teams = data?.items ?? [];

  if (teams.length === 0) {
    return null;
  }

  return (
    <Field>
      <FieldLabel>Apple team (optional)</FieldLabel>
      <Select
        value={value}
        onValueChange={(next) => {
          if (next === null) {
            return;
          }
          onChange(next);
        }}
      >
        <SelectTrigger>
          <SelectValue placeholder="No team" />
        </SelectTrigger>
        <SelectPopup>
          <SelectGroup>
            <SelectItem value={APPLE_TEAM_NONE}>No team</SelectItem>
            {teams.map((team) => (
              <SelectItem key={team.id} value={team.id}>
                {formatAppleTeamLabel(team)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectPopup>
      </Select>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  );
};
