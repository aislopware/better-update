import { Command, Options } from "@effect/cli";
import { Console, Effect, Option } from "effect";

import { printTable } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { handleAuditLogCommandErrors } from "./helpers";

const action = Options.text("action").pipe(Options.optional);
const resourceType = Options.text("resource-type").pipe(Options.optional);
const actorId = Options.text("actor-id").pipe(Options.optional);
const from = Options.text("from").pipe(Options.optional);
const to = Options.text("to").pipe(Options.optional);

export const listCommand = Command.make(
  "list",
  { action, resourceType, actorId, from, to },
  (opts) =>
    Effect.gen(function* () {
      const api = yield* apiClient;

      const filters = {
        ...Option.match(opts.action, {
          onNone: () => ({}),
          onSome: (v) => ({ action: v }),
        }),
        ...Option.match(opts.resourceType, {
          onNone: () => ({}),
          onSome: (v) => ({ resourceType: v }),
        }),
        ...Option.match(opts.actorId, {
          onNone: () => ({}),
          onSome: (v) => ({ actorId: v }),
        }),
        ...Option.match(opts.from, {
          onNone: () => ({}),
          onSome: (v) => ({ from: v }),
        }),
        ...Option.match(opts.to, {
          onNone: () => ({}),
          onSome: (v) => ({ to: v }),
        }),
      } as Record<string, string>;

      const { items } = yield* api["audit-logs"].list({
        urlParams: { ...filters, page: 1, limit: 100 },
      });

      if (items.length === 0) {
        yield* Console.log("No audit log entries found.");
        return;
      }

      yield* printTable(
        ["ID", "Action", "Resource Type", "Resource ID", "Actor", "Source", "Created"],
        items.map((l) => [
          l.id,
          l.action,
          l.resourceType,
          l.resourceId ?? "-",
          l.actorEmail,
          l.source,
          l.createdAt,
        ]),
      );
    }).pipe(handleAuditLogCommandErrors),
);
