import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { InvalidArgumentError } from "../../lib/exit-codes";
import { printHuman, printJson, printKeyValue } from "../../lib/output";
import { OutputMode } from "../../lib/output-mode";
import { apiClient } from "../../services/api-client";

const DEVICE_CLASS_VALUES = ["IPHONE", "IPAD", "MAC", "UNKNOWN"] as const;
type DeviceClassArg = (typeof DEVICE_CLASS_VALUES)[number];

const isDeviceClass = (value: string): value is DeviceClassArg =>
  (DEVICE_CLASS_VALUES as readonly string[]).includes(value);

const ttlHours = (value: string | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const match = /^([0-9]+)([hd])?$/u.exec(value);
  if (!match?.[1]) {
    return undefined;
  }
  const num = Number.parseInt(match[1], 10);
  return match[2] === "d" ? num * 24 : num;
};

export const addDeviceCommand = defineCommand({
  meta: {
    name: "add",
    description:
      "Register an Apple device (direct via --udid, or generate an invitation URL via --invite)",
  },
  args: {
    udid: { type: "string", description: "Apple UDID (40 hex, or UUID format)" },
    name: { type: "string", description: "Friendly name for the device" },
    "device-class": {
      type: "string",
      default: "IPHONE",
      description: "Device class (IPHONE, IPAD, MAC, UNKNOWN)",
    },
    "apple-team-id": { type: "string", description: "Apple team to assign" },
    invite: {
      type: "boolean",
      description:
        "Generate a self-service registration URL the user opens on their iOS device in Safari",
    },
    "expires-in": {
      type: "string",
      default: "24h",
      description: "Invitation TTL (e.g. 24h, 7d, max 168h)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const mode = yield* OutputMode;

        if (args.invite) {
          const hint = isDeviceClass(args["device-class"]) ? args["device-class"] : undefined;
          const ttl = ttlHours(args["expires-in"]);
          const result = yield* api.devices.createRegistrationRequest({
            payload: {
              ...(args.name === undefined ? {} : { deviceNameHint: args.name }),
              ...(hint === undefined ? {} : { deviceClassHint: hint }),
              ...(args["apple-team-id"] === undefined
                ? {}
                : { appleTeamId: args["apple-team-id"] }),
              ...(ttl === undefined ? {} : { ttlHours: ttl }),
            },
          });
          if (mode.json) {
            yield* printJson(result);
            return;
          }
          yield* printHuman("Share this URL with the device owner (open it in Safari on iOS):");
          yield* printKeyValue([
            ["URL", result.url],
            ["Expires at", result.expiresAt],
            ["Request ID", result.id],
          ]);
          return;
        }

        if (args.udid === undefined) {
          yield* new InvalidArgumentError({
            message:
              "Pass --udid <udid> --name <name>, or use --invite to generate an enrollment URL.",
          });
          return;
        }
        const name = args.name ?? args.udid;
        const deviceClass = isDeviceClass(args["device-class"]) ? args["device-class"] : "IPHONE";
        const device = yield* api.devices.register({
          payload: {
            identifier: args.udid,
            name,
            deviceClass,
            ...(args["apple-team-id"] === undefined ? {} : { appleTeamId: args["apple-team-id"] }),
          },
        });
        if (mode.json) {
          yield* printJson(device);
          return;
        }
        yield* printKeyValue([
          ["ID", device.id],
          ["Name", device.name],
          ["UDID", device.identifier],
          ["Class", device.deviceClass],
          ["Enabled", device.enabled ? "yes" : "no"],
        ]);
      }),
    ),
});
