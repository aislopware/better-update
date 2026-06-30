import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_AUTH_ARGS,
  openAscContext,
} from "../../../application/app-store-connect";
import { listCertificates } from "../../../application/apple-signing-inventory";
import { runEffect } from "../../../lib/citty-effect";
import { printHumanList } from "../../../lib/output";

import type { AscAuthArgs } from "../../../application/app-store-connect";

export const certificateListCommand = defineCommand({
  meta: {
    name: "list",
    description: "List the team's signing certificates on App Store Connect (CI-safe)",
  },
  args: {
    ...ASC_AUTH_ARGS,
  },
  run: async ({ args }: { readonly args: AscAuthArgs }) =>
    runEffect(
      Effect.gen(function* () {
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
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});
