import { Command, Options } from "@effect/cli";
import { Console, Effect, Option } from "effect";

import { filterCredentials, listAllCredentials } from "../../lib/credentials-manager";
import { printTable } from "../../lib/output";
import { apiClient } from "../../services/api-client";

const platform = Options.choice("platform", ["ios", "android"] as const).pipe(Options.optional);

export const listCommand = Command.make("list", { platform }, (opts) =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    const rows = yield* listAllCredentials(api);

    const filtered = filterCredentials(
      rows,
      Option.match(opts.platform, {
        onNone: () => ({}),
        onSome: (platformValue) => ({ platform: platformValue }),
      }),
    );

    if (filtered.length === 0) {
      yield* Console.log("No credentials found.");
      return;
    }

    yield* printTable(
      ["ID", "Name", "Platform", "Type", "Distribution"],
      filtered.map((row) => [row.id, row.name, row.platform, row.type, row.distribution ?? "-"]),
    );
  }),
);
