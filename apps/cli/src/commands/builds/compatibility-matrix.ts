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
        result.rows.map((r) => [
          r.id,
          r.platform,
          r.runtimeVersion ?? "-",
          r.channels.map((c) => c.channelName).join(", ") || "-",
        ]),
      );
    }

    if (result.missingRuntimeVersions.length > 0) {
      yield* Console.log("\nMissing Runtime Versions:");
      yield* printTable(
        ["Channel", "Platform", "Runtime Version", "Updates"],
        result.missingRuntimeVersions.map((m) => [
          m.channelName,
          m.platform,
          m.runtimeVersion,
          String(m.updateCount),
        ]),
      );
    }
  }).pipe(handleBuildsCommandErrors),
);
