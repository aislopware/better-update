import { appleTeamsQueryOptions } from "@better-update/api-client/react";
import { Select } from "@better-update/ui/components/select";
import { useQuery } from "@tanstack/react-query";

import { formatAppleTeamLabel } from "../-credentials-utils";
import { onPicked } from "../../../../lib/form-utils";

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
    <Select
      label="Apple team"
      required={false}
      description={description}
      className="w-full"
      // Passed as `items` rather than `Select.Option` children so the trigger can
      // resolve the selected label before the popup has ever opened — Base UI
      // otherwise falls back to printing the raw value.
      items={[
        { value: APPLE_TEAM_NONE, label: "No team" },
        ...teams.map((team) => ({ value: team.id, label: formatAppleTeamLabel(team) })),
      ]}
      value={value}
      onValueChange={onPicked(onChange)}
    />
  );
};
