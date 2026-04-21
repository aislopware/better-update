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
          onSome: (value) => ({ action: value }),
        }),
        ...Option.match(opts.resourceType, {
          onNone: () => ({}),
          onSome: (value) => ({ resourceType: value }),
        }),
        ...Option.match(opts.actorId, {
          onNone: () => ({}),
          onSome: (value) => ({ actorId: value }),
        }),
        ...Option.match(opts.from, {
          onNone: () => ({}),
          onSome: (value) => ({ from: value }),
        }),
        ...Option.match(opts.to, {
          onNone: () => ({}),
          onSome: (value) => ({ to: value }),
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
    }).pipe(handleAuditLogCommandErrors),
);
