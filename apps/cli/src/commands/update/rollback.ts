import { defineCommand } from "citty";
import { Effect } from "effect";

import { runUpdateRollback } from "../../application/update-rollback";
import { runEffect } from "../../lib/citty-effect";
import { printHuman, printHumanTable } from "../../lib/output";
import { updateErrorExtras } from "./helpers";

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

export const rollBackToEmbeddedCommand = defineCommand({
  meta: {
    name: "roll-back-to-embedded",
    description:
      "Roll back updates on a branch to the embedded JS (alias of `update rollback` for EAS parity)",
  },
  args: {
    branch: { type: "string", required: true, description: "Branch to roll back" },
    platform: {
      type: "enum",
      options: ["ios", "android", "all"],
      default: "all",
      description: "Platform(s) to roll back",
    },
    message: { type: "string" },
    environment: { type: "string", default: "production", description: "Env vars scope" },
    "commit-time": { type: "string" },
    "directive-body-file": { type: "string" },
    "signature-file": { type: "string" },
    "certificate-chain-file": { type: "string" },
    "private-key-path": {
      type: "string",
      description:
        "Path to the RSA private key (PEM) to code-sign the rollback directive; reads codeSigningCertificate/codeSigningMetadata from app.json (mutually exclusive with the --*-file options)",
    },
  },
  run: async ({ args }) =>
    runEffect(buildRollbackRun(args), { exits: updateErrorExtras, json: "value" }),
});

export const rollbackCommand = defineCommand({
  meta: { name: "rollback", description: "Roll back updates on a branch" },
  args: {
    branch: { type: "string", required: true, description: "Branch to roll back" },
    platform: {
      type: "enum",
      options: ["ios", "android", "all"],
      default: "all",
      description: "Platform(s) to roll back",
    },
    message: { type: "string" },
    environment: { type: "string", default: "production", description: "Env vars scope" },
    "commit-time": { type: "string" },
    "directive-body-file": { type: "string" },
    "signature-file": { type: "string" },
    "certificate-chain-file": { type: "string" },
    "private-key-path": {
      type: "string",
      description:
        "Path to the RSA private key (PEM) to code-sign the rollback directive; reads codeSigningCertificate/codeSigningMetadata from app.json (mutually exclusive with the --*-file options)",
    },
  },
  run: async ({ args }) =>
    runEffect(buildRollbackRun(args), { exits: updateErrorExtras, json: "value" }),
});
