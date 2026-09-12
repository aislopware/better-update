import { AuditLogResourceType, csvList } from "@better-update/api";
import { Effect, Schema } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { InvalidArgumentError } from "../../lib/exit-codes";
import { printList } from "../../lib/output";
import { optionalFlag, positiveIntFlag } from "../../lib/params";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";

const parseResourceTypes = (raw: string) =>
  Schema.decodeUnknownEffect(csvList(AuditLogResourceType))(raw).pipe(
    Effect.mapError(
      () =>
        new InvalidArgumentError({
          message: `--resource-type must be a comma-separated list of resource types, got "${raw}".`,
        }),
    ),
  );

export const listCommand = Command.make(
  "list",
  {
    "resource-type": Flag.String("resource-type").pipe(
      Flag.withDescription("Filter by resource type (comma-separated for multiple)"),
      optionalFlag,
    ),
    from: Flag.String("from").pipe(Flag.withDescription("ISO timestamp lower bound"), optionalFlag),
    to: Flag.String("to").pipe(Flag.withDescription("ISO timestamp upper bound"), optionalFlag),
    limit: positiveIntFlag("limit", { description: "Max rows", defaultValue: 100 }),
  },
  Effect.fn(function* (args) {
    const { limit } = args;
    const api = yield* apiClient;

    const resourceType = args["resource-type"]
      ? yield* parseResourceTypes(args["resource-type"])
      : undefined;

    const { items } = yield* api["audit-logs"].list({
      query: {
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
  }, runCommand()),
).pipe(Command.withDescription("List audit log entries"));
