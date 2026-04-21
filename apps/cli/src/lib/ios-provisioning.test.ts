import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { ProvisioningError } from "./exit-codes";
import { extractProvisioningInfo } from "./ios-provisioning";
import { failureError } from "./test-utils";

// ── fixtures ──────────────────────────────────────────────────────

const VALID_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>AppIDName</key>
\t<string>My App</string>
\t<key>ApplicationIdentifierPrefix</key>
\t<array>
\t\t<string>ABCD1234EF</string>
\t</array>
\t<key>CreationDate</key>
\t<date>2026-01-15T12:00:00Z</date>
\t<key>Platform</key>
\t<array>
\t\t<string>iOS</string>
\t</array>
\t<key>DeveloperCertificates</key>
\t<array>
\t\t<data>SOMEBASE64DATA==</data>
\t</array>
\t<key>Entitlements</key>
\t<dict>
\t\t<key>application-identifier</key>
\t\t<string>ABCD1234EF.com.example.app</string>
\t\t<key>get-task-allow</key>
\t\t<false/>
\t</dict>
\t<key>Name</key>
\t<string>MyApp AppStore</string>
\t<key>ProvisionedDevices</key>
\t<array>
\t\t<string>00008030-000000000000000E</string>
\t</array>
\t<key>TeamIdentifier</key>
\t<array>
\t\t<string>ABCD1234EF</string>
\t\t<string>XYZ0000000</string>
\t</array>
\t<key>TeamName</key>
\t<string>Example Inc.</string>
\t<key>TimeToLive</key>
\t<integer>365</integer>
\t<key>UUID</key>
\t<string>11111111-2222-3333-4444-555555555555</string>
\t<key>Version</key>
\t<integer>1</integer>
</dict>
</plist>`;

// ── tests ─────────────────────────────────────────────────────────

describe(extractProvisioningInfo, () => {
  it.effect("parses UUID, Name, and first TeamIdentifier from a realistic plist", () =>
    Effect.gen(function* () {
      const info = yield* extractProvisioningInfo(VALID_PLIST);
      expect(info.uuid).toBe("11111111-2222-3333-4444-555555555555");
      expect(info.name).toBe("MyApp AppStore");
      expect(info.teamId).toBe("ABCD1234EF");
    }),
  );

  it.effect("fails with ProvisioningError when UUID is missing", () =>
    Effect.gen(function* () {
      const withoutUuid = VALID_PLIST.replace(/<key>UUID<\/key>\s*<string>[^<]+<\/string>/, "");
      const exit = yield* extractProvisioningInfo(withoutUuid).pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = failureError(exit);
        expect(error).toBeInstanceOf(ProvisioningError);
        expect(error!.message).toContain("UUID");
      }
    }),
  );

  it.effect("fails when TeamIdentifier array is missing", () =>
    Effect.gen(function* () {
      const withoutTeam = VALID_PLIST.replace(
        /<key>TeamIdentifier<\/key>\s*<array>[\s\S]*?<\/array>/,
        "",
      );
      const exit = yield* extractProvisioningInfo(withoutTeam).pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = failureError(exit);
        expect(error!.message).toContain("TeamIdentifier");
      }
    }),
  );

  it.effect("fails when Name is missing", () =>
    Effect.gen(function* () {
      const withoutName = VALID_PLIST.replace(/<key>Name<\/key>\s*<string>[^<]+<\/string>/, "");
      const exit = yield* extractProvisioningInfo(withoutName).pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it.effect("picks the first <string> inside TeamIdentifier array even if multiple", () =>
    Effect.gen(function* () {
      const info = yield* extractProvisioningInfo(VALID_PLIST);
      expect(info.teamId).toBe("ABCD1234EF");
      // Second string should NOT be chosen
      expect(info.teamId).not.toBe("XYZ0000000");
    }),
  );
});
