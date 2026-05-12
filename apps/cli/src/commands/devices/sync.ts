import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { InvalidArgumentError } from "../../lib/exit-codes";
import { printHuman, printJson, printKeyValue } from "../../lib/output";
import { OutputMode } from "../../lib/output-mode";
import { promptSelect } from "../../lib/prompts";
import { apiClient } from "../../services/api-client";

export const syncDevicesCommand = defineCommand({
  meta: {
    name: "sync",
    description:
      "Pull devices from Apple Developer Portal via an ASC API key, push local devices that aren't registered yet",
  },
  args: {
    "asc-key-id": {
      type: "string",
      description:
        "ASC API key ID (from `credentials list`). If omitted, the CLI lists keys and prompts.",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        let ascKeyId = args["asc-key-id"];

        if (ascKeyId === undefined) {
          const keys = yield* api.ascApiKeys.list();
          if (keys.items.length === 0) {
            return yield* new InvalidArgumentError({
              message:
                "No ASC API keys uploaded. Run `better-update credentials upload asc-key --p8 <path> ...` first.",
            });
          }
          ascKeyId =
            keys.items.length === 1
              ? keys.items[0]?.id
              : yield* promptSelect<string>(
                  "Select an ASC API key",
                  keys.items.map((key) => ({
                    value: key.id,
                    label: `${key.name} (${key.keyId})`,
                  })),
                );
        }
        if (ascKeyId === undefined) {
          return yield* new InvalidArgumentError({ message: "ASC API key ID required." });
        }
        const result = yield* api.ascApiKeys.syncDevices({ path: { id: ascKeyId } });
        const mode = yield* OutputMode;
        if (mode.json) {
          yield* printJson(result);
          return undefined;
        }
        yield* printHuman(`Sync complete via ASC key ${ascKeyId}.`);
        yield* printKeyValue([
          ["Pulled", String(result.pulled)],
          ["Pushed", String(result.pushed)],
          ["Skipped", String(result.skipped)],
          ["Devices", String(result.devices.length)],
        ]);
        return undefined;
      }),
    ),
});
