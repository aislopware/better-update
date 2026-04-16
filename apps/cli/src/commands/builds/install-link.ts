import { Args, Command } from "@effect/cli";
import { Effect } from "effect";

import { printKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { handleBuildsCommandErrors } from "./helpers";

const id = Args.text({ name: "id" });

export const installLinkCommand = Command.make("install-link", { id }, (opts) =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    const result = yield* api.builds.getInstallLink({ path: { id: opts.id } });
    yield* printKeyValue([
      ["Artifact URL", result.artifactUrl],
      ["Install URL", result.installUrl ?? "-"],
      ["Expires", String(result.expires)],
    ]);
  }).pipe(handleBuildsCommandErrors),
);
