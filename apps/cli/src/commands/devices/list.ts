import { compact } from "@better-update/type-guards";
import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { printHumanTable } from "../../lib/output";
import { optionalFlag, positiveIntFlag } from "../../lib/params";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";

export const listDevicesCommand = Command.make(
  "list",
  {
    "device-class": Flag.Literals("device-class", ["IPHONE", "IPAD", "MAC", "UNKNOWN"]).pipe(
      Flag.withDescription("Filter by device class"),
      optionalFlag,
    ),
    "apple-team-id": Flag.String("apple-team-id").pipe(
      Flag.withDescription("Filter by internal team Id (UUID), not the Apple Team Identifier"),
      optionalFlag,
    ),
    query: Flag.String("query").pipe(
      Flag.withDescription("Search devices by name or identifier"),
      optionalFlag,
    ),
    enabled: Flag.Boolean("enabled").pipe(
      Flag.withDescription("Only enabled devices (--no-enabled: only disabled)"),
      optionalFlag,
    ),
    page: positiveIntFlag("page", { description: "Page number", defaultValue: 1 }),
    limit: positiveIntFlag("limit", { description: "Items per page", defaultValue: 20 }),
  },
  Effect.fn(
    function* (args) {
      const api = yield* apiClient;
      const { page, limit } = args;
      const result = yield* api.devices.list({
        query: {
          page,
          limit,
          ...compact({
            deviceClass: args["device-class"] ? [args["device-class"]] : undefined,
            appleTeamId: args["apple-team-id"] ? [args["apple-team-id"]] : undefined,
            query: args.query,
          }),
        },
      });
      const enabledFilter = args.enabled;
      const items =
        enabledFilter === undefined
          ? result.items
          : result.items.filter((device) => device.enabled === enabledFilter);
      yield* printHumanTable(
        ["ID", "Name", "Class", "UDID", "Team", "Synced", "Enabled"],
        items.map((device) => [
          device.id,
          device.name,
          device.deviceClass,
          device.identifier,
          device.appleTeamId ?? "—",
          device.appleDevicePortalId === null ? "no" : "yes",
          device.enabled ? "yes" : "no",
        ]),
      );
      return { items, total: result.total, page: result.page, limit: result.limit };
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("List registered Apple devices"));
