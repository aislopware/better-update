import { Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";

import { readProjectId } from "../../lib/app-json";
import { printTable } from "../../lib/output";
import { apiClient } from "../../services/api-client";

const platform = Options.choice("platform", ["ios", "android"]).pipe(Options.optional);

export const listCommand = Command.make("list", { platform }, (opts) =>
  Effect.gen(function* () {
    const projectId = yield* readProjectId;
    const api = yield* apiClient;

    const platformFilter = Option.match(opts.platform, {
      onNone: () => ({}) as Record<string, string>,
      onSome: (p) => ({ platform: p }) as Record<string, string>,
    });

    const { items } = yield* api.credentials.list({
      urlParams: { projectId, ...platformFilter },
    });

    yield* printTable(
      ["ID", "Name", "Platform", "Type", "Active", "Distribution"],
      items.map((c) => [
        c.id,
        c.name,
        c.platform,
        c.type,
        c.isActive ? "yes" : "no",
        c.distribution ?? "-",
      ]),
    );
  }),
);
