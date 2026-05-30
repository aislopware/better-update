import { compact } from "@better-update/type-guards";
import { defineCommand } from "citty";
import { Effect } from "effect";
import qrcode from "qrcode-terminal";

import { runEffect } from "../../lib/citty-effect";
import { InvalidArgumentError } from "../../lib/exit-codes";
import { printHuman, printHumanKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";

import type { ApiClient } from "../../services/api-client";

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

const renderQrcode = (url: string): Effect.Effect<string> =>
  Effect.async<string>((resume) => {
    qrcode.generate(url, { small: true }, (qr) => {
      resume(Effect.succeed(qr));
    });
  });

interface InviteArgs {
  readonly name?: string;
  readonly deviceClass?: DeviceClassArg;
  readonly appleTeamId?: string;
  readonly ttl?: number;
  readonly renderQr: boolean;
}

const handleInvite = (api: ApiClient, args: InviteArgs) =>
  Effect.gen(function* () {
    const result = yield* api.devices.createRegistrationRequest({
      payload: compact({
        deviceNameHint: args.name,
        deviceClassHint: args.deviceClass,
        appleTeamId: args.appleTeamId,
        ttlHours: args.ttl,
      }),
    });
    yield* printHuman("Share this URL with the device owner (open it in Safari on iOS):");
    yield* printHumanKeyValue([
      ["URL", result.url],
      ["Expires at", result.expiresAt],
      ["Request ID", result.id],
    ]);
    if (args.renderQr) {
      const rendered = yield* renderQrcode(result.url);
      yield* printHuman("");
      yield* printHuman(rendered);
    }
    return result;
  });

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
    qr: {
      type: "boolean",
      default: true,
      description: "Render a scannable QR code alongside the invitation URL",
      negativeDescription: "Skip QR rendering (use --no-qr)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;

        if (args.invite) {
          const deviceClass = isDeviceClass(args["device-class"])
            ? args["device-class"]
            : undefined;
          const ttl = ttlHours(args["expires-in"]);
          return yield* handleInvite(api, {
            renderQr: args.qr,
            ...compact({
              name: args.name,
              deviceClass,
              appleTeamId: args["apple-team-id"],
              ttl,
            }),
          });
        }

        if (args.udid === undefined) {
          return yield* new InvalidArgumentError({
            message:
              "Pass --udid <udid> --name <name>, or use --invite to generate an enrollment URL.",
          });
        }
        const name = args.name ?? args.udid;
        const deviceClass = isDeviceClass(args["device-class"]) ? args["device-class"] : "IPHONE";
        const device = yield* api.devices.register({
          payload: {
            identifier: args.udid,
            name,
            deviceClass,
            ...compact({ appleTeamId: args["apple-team-id"] }),
          },
        });
        yield* printHumanKeyValue([
          ["ID", device.id],
          ["Name", device.name],
          ["UDID", device.identifier],
          ["Class", device.deviceClass],
          ["Enabled", device.enabled ? "yes" : "no"],
        ]);
        return device;
      }),
      { json: "value" },
    ),
});
