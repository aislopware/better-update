import { Effect } from "effect";

import { DeviceRepo } from "../repositories/devices";

export const collectDeviceAscIds = (params: {
  readonly organizationId: string;
  readonly appleTeamId: string;
  readonly deviceIds?: readonly string[];
}) =>
  Effect.gen(function* () {
    const devices = yield* DeviceRepo;
    const candidates = yield* devices.findAllByOrg({
      organizationId: params.organizationId,
      appleTeamId: params.appleTeamId,
    });
    const filtered =
      params.deviceIds === undefined
        ? candidates
        : candidates.filter((device) => params.deviceIds?.includes(device.id));
    return filtered
      .map((device) => device.appleDevicePortalId)
      .filter((id): id is string => id !== null);
  });
