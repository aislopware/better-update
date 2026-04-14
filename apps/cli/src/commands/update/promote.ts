import { Args, Command, Options } from "@effect/cli";
import { Console, Effect, Option } from "effect";

import { runUpdatePromote } from "../../application/update-promote";
import { handleUpdateCommandErrors } from "./helpers";

const updateId = Args.text({ name: "updateId" });
const channel = Options.text("channel");
const manifestBodyFile = Options.text("manifest-body-file").pipe(Options.optional);
const signatureFile = Options.text("signature-file").pipe(Options.optional);
const certificateChainFile = Options.text("certificate-chain-file").pipe(Options.optional);

export const promoteCommand = Command.make(
  "promote",
  { updateId, channel, manifestBodyFile, signatureFile, certificateChainFile },
  (opts) =>
    Effect.gen(function* () {
      const result = yield* runUpdatePromote({
        updateId: opts.updateId,
        channel: opts.channel,
        manifestBodyFile: Option.getOrUndefined(opts.manifestBodyFile),
        signatureFile: Option.getOrUndefined(opts.signatureFile),
        certificateChainFile: Option.getOrUndefined(opts.certificateChainFile),
      });

      yield* Console.log(
        `Promoted update ${result.sourceUpdateId} to channel "${result.channel}" as update ${result.updateId}.`,
      );
    }).pipe(handleUpdateCommandErrors),
);
