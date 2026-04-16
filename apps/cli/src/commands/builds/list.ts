import { Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";

import { readProjectId } from "../../lib/app-json";
import { printTable } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { handleBuildsCommandErrors } from "./helpers";

const platform = Options.choice("platform", ["ios", "android"]).pipe(Options.optional);
const limit = Options.integer("limit").pipe(Options.withDefault(10));

export const listCommand = Command.make("list", { platform, limit }, (opts) =>
  Effect.gen(function* () {
    const projectId = yield* readProjectId;
    const api = yield* apiClient;

    const platformFilter = Option.match(opts.platform, {
      onNone: () => ({}) as Record<string, string>,
      onSome: (p) => ({ platform: p }) as Record<string, string>,
    });

    const { items } = yield* api.builds.list({
      urlParams: { projectId, ...platformFilter, page: 1, limit: opts.limit },
    });

    yield* printTable(
      ["ID", "Platform", "Profile", "Distribution", "Version", "Created"],
      items.map((b) => [
        b.id,
        b.platform,
        b.profile,
        b.distribution,
        b.appVersion ?? "-",
        b.createdAt,
      ]),
    );
  }).pipe(handleBuildsCommandErrors),
);
