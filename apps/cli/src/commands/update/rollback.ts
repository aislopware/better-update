import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { runUpdateRollback } from "../../application/update-rollback";
import { printHuman, printHumanTable } from "../../lib/output";
import { optionalFlag } from "../../lib/params";
import { runCommand } from "../../lib/run-command";

interface RollbackParsedArgs {
  readonly branch: string;
  readonly platform: "ios" | "android" | "all";
  readonly environment: string;
  readonly message: string | undefined;
  readonly ["commit-time"]: string | undefined;
  readonly ["directive-body-file"]: string | undefined;
  readonly ["signature-file"]: string | undefined;
  readonly ["certificate-chain-file"]: string | undefined;
  readonly ["private-key-path"]: string | undefined;
}

const buildRollbackRun = (args: RollbackParsedArgs) =>
  Effect.gen(function* () {
    const result = yield* runUpdateRollback({
      branch: args.branch,
      platform: args.platform,
      environment: args.environment,
      message: args.message,
      commitTime: args["commit-time"],
      directiveBodyFile: args["directive-body-file"],
      signatureFile: args["signature-file"],
      certificateChainFile: args["certificate-chain-file"],
      privateKeyPath: args["private-key-path"],
    });

    yield* printHuman(
      `Created rollback group ${result.groupId} on branch "${result.branch}" at ${result.commitTime}.`,
    );
    yield* printHuman("");
    yield* printHumanTable(
      ["Platform", "Update ID", "Runtime Version"],
      result.results.map((entry) => [entry.platform, entry.updateId, entry.runtimeVersion]),
    );
    return result;
  });

export const rollBackToEmbeddedCommand = Command.make(
  "roll-back-to-embedded",
  {
    branch: Flag.String("branch").pipe(Flag.withDescription("Branch to roll back")),
    platform: Flag.Literals("platform", ["ios", "android", "all"]).pipe(
      Flag.withDescription("Platform(s) to roll back"),
      Flag.withDefault("all"),
    ),
    message: Flag.String("message").pipe(optionalFlag),
    environment: Flag.String("environment").pipe(
      Flag.withDescription("Env vars scope"),
      Flag.withDefault("production"),
    ),
    "commit-time": Flag.String("commit-time").pipe(optionalFlag),
    "directive-body-file": Flag.String("directive-body-file").pipe(optionalFlag),
    "signature-file": Flag.String("signature-file").pipe(optionalFlag),
    "certificate-chain-file": Flag.String("certificate-chain-file").pipe(optionalFlag),
    "private-key-path": Flag.String("private-key-path").pipe(
      Flag.withDescription(
        "Path to the RSA private key (PEM) to code-sign the rollback directive; reads codeSigningCertificate/codeSigningMetadata from app.json (mutually exclusive with the --*-file options)",
      ),
      optionalFlag,
    ),
  },
  (args) => buildRollbackRun(args).pipe(runCommand({ json: "value" })),
).pipe(
  Command.withDescription(
    "Roll back updates on a branch to the embedded JS (alias of `update rollback` for EAS parity)",
  ),
);

export const rollbackCommand = Command.make(
  "rollback",
  {
    branch: Flag.String("branch").pipe(Flag.withDescription("Branch to roll back")),
    platform: Flag.Literals("platform", ["ios", "android", "all"]).pipe(
      Flag.withDescription("Platform(s) to roll back"),
      Flag.withDefault("all"),
    ),
    message: Flag.String("message").pipe(optionalFlag),
    environment: Flag.String("environment").pipe(
      Flag.withDescription("Env vars scope"),
      Flag.withDefault("production"),
    ),
    "commit-time": Flag.String("commit-time").pipe(optionalFlag),
    "directive-body-file": Flag.String("directive-body-file").pipe(optionalFlag),
    "signature-file": Flag.String("signature-file").pipe(optionalFlag),
    "certificate-chain-file": Flag.String("certificate-chain-file").pipe(optionalFlag),
    "private-key-path": Flag.String("private-key-path").pipe(
      Flag.withDescription(
        "Path to the RSA private key (PEM) to code-sign the rollback directive; reads codeSigningCertificate/codeSigningMetadata from app.json (mutually exclusive with the --*-file options)",
      ),
      optionalFlag,
    ),
  },
  (args) => buildRollbackRun(args).pipe(runCommand({ json: "value" })),
).pipe(Command.withDescription("Roll back updates on a branch"));
