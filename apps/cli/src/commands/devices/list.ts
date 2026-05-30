import { compact } from "@better-update/type-guards";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { parseLimit } from "../../lib/cli-schemas";
import { printHumanTable } from "../../lib/output";
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
        const page = yield* parseLimit(args.page, 1);
        const limit = yield* parseLimit(args.limit, 20);
        const result = yield* api.devices.list({
          urlParams: {
            page,
            limit,
            ...compact({
              deviceClass: args["device-class"],
              appleTeamId: args["apple-team-id"],
              query: args.query,
            }),
          },
        });
        const enabledFilter = parseEnabled(args.enabled);
        const items =
          enabledFilter === undefined
            ? result.items
            : result.items.filter((device) => device.enabled === enabledFilter);
        yield* printHumanTable(
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
        return { items, total: result.total, page: result.page, limit: result.limit };
      }),
      { json: "value" },
    ),
});
