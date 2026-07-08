import { Effect } from "effect";

import { DeviceRepo } from "../repositories/devices";

/**
 * The desired device roster for one Apple team: UDIDs of every enabled device
 * registered under (org, team). This is what an ad-hoc/development profile is
 * expected to cover — disabled devices drop out so toggling `enabled` off
 * triggers a regeneration that removes the device.
 */
export const collectDeviceRosterUdids = (params: {
  readonly organizationId: string;
  readonly appleTeamId: string;
}) =>
  Effect.gen(function* () {
    const devices = yield* DeviceRepo;
    const candidates = yield* devices.findAllByOrg({
      organizationId: params.organizationId,
      appleTeamId: params.appleTeamId,
    });
    return candidates.filter((device) => device.enabled).map((device) => device.identifier);
  });
