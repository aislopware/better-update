import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { runUpdatePromote } from "../../application/update-promote";
import { printHuman } from "../../lib/output";
import { optionalFlag } from "../../lib/params";
import { runCommand } from "../../lib/run-command";

export const promoteCommand = Command.make(
  "promote",
  {
    updateId: Argument.String("updateId").pipe(Argument.withDescription("Source update ID")),
    channel: Flag.String("channel").pipe(Flag.withDescription("Target channel name")),
    "manifest-body-file": Flag.String("manifest-body-file").pipe(optionalFlag),
    "signature-file": Flag.String("signature-file").pipe(optionalFlag),
    "certificate-chain-file": Flag.String("certificate-chain-file").pipe(optionalFlag),
  },
  Effect.fn(
    function* (args) {
      const result = yield* runUpdatePromote({
        updateId: args.updateId,
        channel: args.channel,
        manifestBodyFile: args["manifest-body-file"],
        signatureFile: args["signature-file"],
        certificateChainFile: args["certificate-chain-file"],
      });

      yield* printHuman(
        `Promoted update ${result.sourceUpdateId} to channel "${result.channel}" as update ${result.updateId}.`,
      );
      return result;
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Promote an existing update to a channel"));
