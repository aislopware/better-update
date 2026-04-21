import { Command } from "@effect/cli";
import { Console, Effect } from "effect";

import { readProjectId } from "../../lib/app-json";
import { printTable } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { handleBuildsCommandErrors } from "./helpers";

export const compatibilityMatrixCommand = Command.make("compatibility-matrix", {}, () =>
  Effect.gen(function* () {
    const projectId = yield* readProjectId;
    const api = yield* apiClient;
    const result = yield* api.builds.compatibilityMatrix({
      urlParams: { projectId },
    });

    if (result.rows.length === 0 && result.missingRuntimeVersions.length === 0) {
      yield* Console.log("No compatibility data found.");
      return;
    }

    if (result.rows.length > 0) {
      yield* Console.log("Build-to-Channel Compatibility:");
      yield* printTable(
        ["Build ID", "Platform", "Runtime Version", "Channels"],
        result.rows.map((row) => [
          row.id,
          row.platform,
          row.runtimeVersion ?? "-",
          row.channels.map((channel) => channel.channelName).join(", ") || "-",
        ]),
      );
    }

    if (result.missingRuntimeVersions.length > 0) {
      yield* Console.log("\nMissing Runtime Versions:");
      yield* printTable(
        ["Channel", "Platform", "Runtime Version", "Updates"],
        result.missingRuntimeVersions.map((missing) => [
          missing.channelName,
          missing.platform,
          missing.runtimeVersion,
          String(missing.updateCount),
        ]),
      );
    }
  }).pipe(handleBuildsCommandErrors),
);
