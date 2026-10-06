import path from "node:path";

import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/cli";

import {
  createPendingRequest,
  handoffGuide,
  importIssuedCertificate,
  listPendingRequests,
} from "../../application/csr-handoff";
import { printHuman, printHumanKeyValue, printKeyValue } from "../../lib/output";
import { optionalFlag } from "../../lib/params";
import { promptText } from "../../lib/prompts";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";
import { CliRuntime } from "../../services/cli-runtime";

import type { CsrPurpose } from "../../application/csr-handoff";

const DEFAULT_FILE_NAME: Record<CsrPurpose, string> = {
  "developer-id-application": "DeveloperIDApplication.certSigningRequest",
  "developer-id-installer": "DeveloperIDInstaller.certSigningRequest",
  other: "CertificateSigningRequest.certSigningRequest",
};

const filled = (value: string | undefined) =>
  value !== undefined && value.trim().length > 0 ? value : undefined;

const createCsrCommand = Command.make(
  "create",
  {
    type: Flag.Literals("type", ["developer-id", "developer-id-installer", "other"]).pipe(
      Flag.withDescription(
        "Certificate the Account Holder will create from it (a label for the guide; any Apple certificate type works)",
      ),
      Flag.withDefault("developer-id"),
    ),
    "common-name": Flag.String("common-name").pipe(
      Flag.withDescription("Requester name in the CSR (Keychain Access uses your name)"),
      optionalFlag,
    ),
    email: Flag.String("email").pipe(
      Flag.withDescription("Requester email in the CSR"),
      optionalFlag,
    ),
    output: Flag.String("output").pipe(
      Flag.withDescription("Where to write the .certSigningRequest (default: current directory)"),
      optionalFlag,
    ),
  },
  Effect.fn(
    function* (args) {
      const runtime = yield* CliRuntime;
      const cwd = yield* runtime.cwd;
      const purpose: CsrPurpose =
        args.type === "developer-id" ? "developer-id-application" : args.type;
      const commonName =
        filled(args["common-name"]) ?? (yield* promptText("Your name (CSR common name)"));
      const email = filled(args.email) ?? (yield* promptText("Your email (CSR email address)"));
      const csrPath = path.resolve(cwd, args.output ?? DEFAULT_FILE_NAME[purpose]);
      const created = yield* createPendingRequest({ purpose, commonName, email, csrPath });
      yield* printHumanKeyValue([
        ["Request", csrPath],
        ["Private key", created.keyPath],
      ]);
      yield* printHuman("");
      yield* printHuman(handoffGuide(purpose, csrPath));
      return { csrPath, fingerprint: created.fingerprint };
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Create a private key + certificate signing request to hand to the Account Holder (Developer ID certificates)",
  ),
);

const importCsrCommand = Command.make(
  "import",
  {
    cer: Argument.String("cer").pipe(
      Argument.withDescription("The .cer the Account Holder downloaded from Apple"),
    ),
    name: Flag.String("name").pipe(
      Flag.withDescription("Display name in the vault (default: the certificate's common name)"),
      optionalFlag,
    ),
  },
  Effect.fn(function* (args) {
    const api = yield* apiClient;
    const runtime = yield* CliRuntime;
    const cwd = yield* runtime.cwd;
    const result = yield* importIssuedCertificate(api, {
      cerPath: path.resolve(cwd, args.cer),
      name: args.name,
    });
    yield* printKeyValue([
      ["Credential", result.id],
      ["Certificate", result.commonName ?? "-"],
      ["Platform", result.platform],
      ["Type", result.type],
    ]);
    return result;
  }, runCommand()),
).pipe(
  Command.withDescription(
    "Pair a .cer issued for a `csr create` request with its private key and store the .p12 in the vault",
  ),
);

const listCsrCommand = Command.make(
  "list",
  {},
  Effect.fn(
    function* () {
      const pending = yield* listPendingRequests;
      if (pending.length === 0) {
        yield* printHuman("No pending certificate requests on this machine.");
        return pending;
      }
      yield* Effect.forEach(
        pending,
        (request) =>
          printHumanKeyValue([
            ["Request", request.csrPath],
            ["For", request.purpose],
            ["Common name", request.commonName],
            ["Created", request.createdAt],
          ]),
        { discard: true },
      );
      return pending;
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("List certificate requests still waiting for their .cer"));

export const csrCommand = Command.make("csr").pipe(
  Command.withDescription(
    "Certificate signing requests for the Account Holder hand-off (create · import · list)",
  ),
  Command.withSubcommands([createCsrCommand, importCsrCommand, listCsrCommand]),
);
