import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printTable } from "../../lib/output";
import { apiClient } from "../../services/api-client";

export const listCommand = defineCommand({
  meta: { name: "list", description: "List audit log entries" },
  args: {
    action: { type: "string", description: "Filter by action" },
    "resource-type": { type: "string", description: "Filter by resource type" },
    "actor-id": { type: "string", description: "Filter by actor ID" },
    from: { type: "string", description: "ISO timestamp lower bound" },
    to: { type: "string", description: "ISO timestamp upper bound" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;

        const filters: Record<string, string> = {};
        if (args.action) {
          filters["action"] = args.action;
        }
        if (args["resource-type"]) {
          filters["resourceType"] = args["resource-type"];
        }
        if (args["actor-id"]) {
          filters["actorId"] = args["actor-id"];
        }
        if (args.from) {
          filters["from"] = args.from;
        }
        if (args.to) {
          filters["to"] = args.to;
        }

        const { items } = yield* api["audit-logs"].list({
          urlParams: { ...filters, page: 1, limit: 100 },
        });

        if (items.length === 0) {
          yield* Console.log("No audit log entries found.");
          return;
        }

        yield* printTable(
          ["ID", "Action", "Resource Type", "Resource ID", "Actor", "Source", "Created"],
          items.map((log) => [
            log.id,
            log.action,
            log.resourceType,
            log.resourceId ?? "-",
            log.actorEmail,
            log.source,
            log.createdAt,
          ]),
        );
      }),
    ),
});
