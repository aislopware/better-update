import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import { ASC_AUTH_ARGS, openAscContext } from "../../../application/app-store-connect";
import { listCertificates } from "../../../application/apple-signing-inventory";
import { printHumanList } from "../../../lib/output";
import { runCommand } from "../../../lib/run-command";

export const certificateListCommand = Command.make(
  "list",
  {
    ...ASC_AUTH_ARGS,
  },
  Effect.fn(
    function* (args) {
      const session = yield* openAscContext(args);
      const certificates = yield* listCertificates(session.ctx);
      yield* printHumanList(
        ["Name", "Type", "Platform", "Serial", "Expires", "Status", "ID"],
        certificates.map((certificate) => [
          certificate.name,
          certificate.certificateType,
          certificate.platform,
          certificate.serialNumber,
          certificate.expirationDate,
          certificate.status,
          certificate.id,
        ]),
        "No signing certificates found.",
      );
      return { items: certificates };
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription("List the team's signing certificates on App Store Connect (CI-safe)"),
);
