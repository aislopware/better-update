import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { runUpdatePromote } from "../../application/update-promote";
import { runEffect } from "../../lib/citty-effect";
import { updateErrorExtras } from "./helpers";

export const promoteCommand = defineCommand({
  meta: { name: "promote", description: "Promote an existing update to a channel" },
  args: {
    updateId: { type: "positional", required: true, description: "Source update ID" },
    channel: { type: "string", required: true, description: "Target channel name" },
    "manifest-body-file": { type: "string" },
    "signature-file": { type: "string" },
    "certificate-chain-file": { type: "string" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const result = yield* runUpdatePromote({
          updateId: args.updateId,
          channel: args.channel,
          manifestBodyFile: args["manifest-body-file"],
          signatureFile: args["signature-file"],
          certificateChainFile: args["certificate-chain-file"],
        });

        yield* Console.log(
          `Promoted update ${result.sourceUpdateId} to channel "${result.channel}" as update ${result.updateId}.`,
        );
      }),
      updateErrorExtras,
    ),
});
