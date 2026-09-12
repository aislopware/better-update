import { Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";

import { printKeyValue } from "../../lib/output";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";

export const installLinkCommand = Command.make(
  "install-link",
  {
    id: Argument.String("id").pipe(Argument.withDescription("Build ID")),
  },
  Effect.fn(function* (args) {
    const api = yield* apiClient;
    const result = yield* api.builds.getInstallLink({ params: { id: args.id } });
    yield* printKeyValue([
      ["Artifact URL", result.artifactUrl],
      ["Install URL", result.installUrl ?? "-"],
      ["Expires", String(result.expires)],
    ]);
  }, runCommand()),
).pipe(Command.withDescription("Get install/artifact URLs for a build"));
