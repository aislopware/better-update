import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { readProjectId } from "../../lib/expo-config";
import { printTable } from "../../lib/output";
import { apiClient } from "../../services/api-client";

export const compatibilityMatrixCommand = defineCommand({
  meta: {
    name: "compatibility-matrix",
    description: "Show build-to-channel compatibility and missing runtime versions",
  },
  run: async () =>
    runEffect(
      Effect.gen(function* () {
        const projectId = yield* readProjectId;
        const api = yield* apiClient;
        const result = yield* api.builds.compatibilityMatrix({ urlParams: { projectId } });

        const matrixKeys = Object.keys(result.channelStatusByKey);

        if (matrixKeys.length === 0 && result.missingRuntimeVersions.length === 0) {
          yield* Console.log("No compatibility data found.");
          return;
        }

        const channelLookup: Record<string, string> = Object.fromEntries(
          result.channels.map((channel) => [channel.channelId, channel.channelName]),
        );

        if (matrixKeys.length > 0) {
          yield* Console.log("Channel Status by (Platform / Runtime Version):");
          yield* printTable(
            ["Platform / Runtime", "Channel", "Updates"],
            matrixKeys.flatMap((key) =>
              (result.channelStatusByKey[key] ?? [])
                .filter((entry) => entry.updateCount > 0)
                .map((entry) => [
                  key,
                  channelLookup[entry.channelId] ?? entry.channelId,
                  String(entry.updateCount),
                ]),
            ),
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
      }),
    ),
});
