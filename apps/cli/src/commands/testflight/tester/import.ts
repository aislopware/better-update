import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { ASC_COMMON_ARGS, openAscSession } from "../../../application/app-store-connect";
import { findBetaGroupEntity } from "../../../application/testflight-groups";
import { importTesters } from "../../../application/testflight-testers";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { asJsonArray, asJsonObject, readJsonInput } from "../../../lib/json-input";
import { printHuman, printHumanList } from "../../../lib/output";
import { optionalFlag } from "../../../lib/params";
import { runCommand } from "../../../lib/run-command";

import type { ImportTesterRow } from "../../../application/testflight-testers";

export const testerImportCommand = Command.make(
  "import",
  {
    ...ASC_COMMON_ARGS,
    from: Flag.String("from").pipe(
      Flag.withDescription(
        'JSON file path or inline JSON: an array of { "email", "firstName", "lastName" } (required)',
      ),
      optionalFlag,
    ),
    group: Flag.String("group").pipe(
      Flag.withDescription("Beta group to import into (by name)"),
      optionalFlag,
    ),
    "group-id": Flag.String("group-id").pipe(
      Flag.withDescription("Beta group to import into (by id)"),
      optionalFlag,
    ),
  },
  Effect.fn(
    function* (args) {
      if (args.from === undefined || args.from.trim().length === 0) {
        return yield* new InvalidArgumentError({ message: "--from is required." });
      }
      if (args.group === undefined && args["group-id"] === undefined) {
        return yield* new InvalidArgumentError({ message: "Pass --group or --group-id." });
      }
      const parsed = yield* readJsonInput(args.from);
      const items = yield* asJsonArray(parsed, "--from testers");
      const rows: ImportTesterRow[] = [];
      for (const [index, raw] of items.entries()) {
        const row = yield* asJsonObject(raw, `--from testers[${index}]`);
        const { email } = row;
        const { firstName } = row;
        const { lastName } = row;
        if (
          typeof email !== "string" ||
          typeof firstName !== "string" ||
          typeof lastName !== "string"
        ) {
          return yield* new InvalidArgumentError({
            message: `Tester ${index} must have string "email", "firstName", and "lastName".`,
          });
        }
        rows.push({ email, firstName, lastName });
      }
      if (rows.length === 0) {
        return yield* new InvalidArgumentError({ message: "--from contained no testers." });
      }
      const session = yield* openAscSession(args);
      const group = yield* findBetaGroupEntity(session.ctx, session.appId, {
        id: args["group-id"],
        name: args.group,
      });
      const results = yield* importTesters(group, rows);
      const failed = results.filter((result) => result.result !== "ASSIGNED");
      yield* printHuman(
        `Imported ${String(results.length - failed.length)}/${String(results.length)} testers into "${group.attributes.name}".`,
      );
      yield* printHumanList(
        ["Email", "Result", "Errors"],
        results.map((result) => [
          result.email ?? "—",
          result.result,
          result.errors.join("; ") || "—",
        ]),
        "No testers imported.",
      );
      return { items: results };
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription("Bulk-import testers into a beta group from a JSON file or inline JSON"),
);
