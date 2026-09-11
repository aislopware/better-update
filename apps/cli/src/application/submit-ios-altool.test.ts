import { it } from "@effect/vitest";
import { Effect } from "effect";

import { makeOutputModeLayer } from "../lib/output-mode";
import { CliSubmitError } from "./submit-flow";
import { uploadIpaViaAltool } from "./submit-ios-altool";

describe(uploadIpaViaAltool, () => {
  it.effect("refuses an individual ASC key before touching altool (no --apiIssuer to give)", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        uploadIpaViaAltool({
          auth: { kind: "asc-api-key", ascApiKeyId: "row-1" },
          ascCredentials: { keyId: "ABC123DEF4", issuerId: null, p8Pem: "-----BEGIN-----" },
          ipaPath: "/tmp/app.ipa",
        }),
      );
      expect(error).toBeInstanceOf(CliSubmitError);
      expect(error.code).toBe("SUBMISSION_SERVICE_IOS_ALTOOL_FAILED");
      expect(error.message).toMatch(/individual App Store Connect API key/u);
    }).pipe(Effect.provide(makeOutputModeLayer(false))),
  );
});
