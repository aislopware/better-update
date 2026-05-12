import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printJson, printTable } from "../../lib/output";
import { OutputMode } from "../../lib/output-mode";
import { apiClient } from "../../services/api-client";

const parseEnabled = (value: string | undefined): boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return undefined;
};

export const listDevicesCommand = defineCommand({
  meta: { name: "list", description: "List registered Apple devices" },
  args: {
    "device-class": {
      type: "enum",
      options: ["IPHONE", "IPAD", "MAC", "UNKNOWN"],
      description: "Filter by device class",
    },
    "apple-team-id": { type: "string", description: "Filter by Apple team ID" },
    query: { type: "string", description: "Search devices by name or identifier" },
    enabled: { type: "string", description: "Filter by enabled status (true/false)" },
    page: { type: "string", default: "1", description: "Page number" },
    limit: { type: "string", default: "20", description: "Items per page" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const result = yield* api.devices.list({
          urlParams: {
            ...(args["device-class"] === undefined ? {} : { deviceClass: args["device-class"] }),
            ...(args["apple-team-id"] === undefined ? {} : { appleTeamId: args["apple-team-id"] }),
            ...(args.query === undefined ? {} : { query: args.query }),
            page: Number(args.page),
            limit: Number(args.limit),
          },
        });
        const enabledFilter = parseEnabled(args.enabled);
        const items =
          enabledFilter === undefined
            ? result.items
            : result.items.filter((device) => device.enabled === enabledFilter);
        const mode = yield* OutputMode;
        if (mode.json) {
          yield* printJson({ items, total: result.total, page: result.page, limit: result.limit });
          return;
        }
        yield* printTable(
          ["ID", "Name", "Class", "UDID", "Team", "Enabled"],
          items.map((device) => [
            device.id,
            device.name,
            device.deviceClass,
            device.identifier,
            device.appleTeamId ?? "—",
            device.enabled ? "yes" : "no",
          ]),
        );
      }),
    ),
});
