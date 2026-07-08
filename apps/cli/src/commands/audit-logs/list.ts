import { AuditLogResourceType, csvList } from "@better-update/api";
import { defineCommand } from "citty";
import { Effect, Schema } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { parseLimit } from "../../lib/cli-schemas";
import { InvalidArgumentError } from "../../lib/exit-codes";
import { printList } from "../../lib/output";
import { apiClient } from "../../services/api-client";

const parseResourceTypes = (raw: string) =>
  Schema.decodeUnknown(csvList(AuditLogResourceType))(raw).pipe(
    Effect.mapError(
      () =>
        new InvalidArgumentError({
          message: `--resource-type must be a comma-separated list of resource types, got "${raw}".`,
        }),
    ),
  );

export const listCommand = defineCommand({
  meta: { name: "list", description: "List audit log entries" },
  args: {
    "resource-type": {
      type: "string",
      description: "Filter by resource type (comma-separated for multiple)",
    },
    from: { type: "string", description: "ISO timestamp lower bound" },
    to: { type: "string", description: "ISO timestamp upper bound" },
    limit: { type: "string", default: "100", description: "Max rows (default 100)" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const limit = yield* parseLimit(args.limit, 100);
        const api = yield* apiClient;

        const resourceType = args["resource-type"]
          ? yield* parseResourceTypes(args["resource-type"])
          : undefined;

        const { items } = yield* api["audit-logs"].list({
          urlParams: {
            ...(resourceType ? { resourceType } : {}),
            ...(args.from ? { from: args.from } : {}),
            ...(args.to ? { to: args.to } : {}),
            limit,
          },
        });

        yield* printList(
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
          "No audit log entries found.",
        );
      }),
    ),
});
