import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { parseCredentialsJson } from "./credentials-json";
import { CredentialsJsonError } from "./exit-codes";
import { failureError } from "./test-utils";

describe(parseCredentialsJson, () => {
  it.effect("parses an ios block without additionalProvisioningProfiles", () =>
    Effect.gen(function* () {
      const parsed = yield* parseCredentialsJson(
        JSON.stringify({
          ios: {
            provisioningProfilePath: "build/main.mobileprovision",
            distributionCertificate: {
              path: "build/dist.p12",
              password: "secret",
            },
          },
        }),
      );
      expect(parsed.ios?.provisioningProfilePath).toBe("build/main.mobileprovision");
      expect(parsed.ios?.additionalProvisioningProfiles).toBeUndefined();
    }),
  );

  it.effect("parses additionalProvisioningProfiles entries", () =>
    Effect.gen(function* () {
      const parsed = yield* parseCredentialsJson(
        JSON.stringify({
          ios: {
            provisioningProfilePath: "build/main.mobileprovision",
            additionalProvisioningProfiles: [
              {
                bundleIdentifier: "com.example.app.notification",
                path: "build/notification.mobileprovision",
              },
              {
                bundleIdentifier: "com.example.app.content",
                path: "build/content.mobileprovision",
              },
            ],
            distributionCertificate: { path: "build/dist.p12", password: "secret" },
          },
        }),
      );
      expect(parsed.ios?.additionalProvisioningProfiles).toStrictEqual([
        {
          bundleIdentifier: "com.example.app.notification",
          path: "build/notification.mobileprovision",
        },
        {
          bundleIdentifier: "com.example.app.content",
          path: "build/content.mobileprovision",
        },
      ]);
    }),
  );

  it.effect("rejects an additional profile entry missing bundleIdentifier", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        parseCredentialsJson(
          JSON.stringify({
            ios: {
              provisioningProfilePath: "build/main.mobileprovision",
              additionalProvisioningProfiles: [{ path: "build/x.mobileprovision" }],
              distributionCertificate: { path: "build/dist.p12", password: "secret" },
            },
          }),
        ),
      );
      const err = failureError(exit);
      expect(err).toBeInstanceOf(CredentialsJsonError);
      expect(err?.message).toContain("bundleIdentifier");
    }),
  );

  it.effect("rejects additionalProvisioningProfiles if not an array", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        parseCredentialsJson(
          JSON.stringify({
            ios: {
              provisioningProfilePath: "build/main.mobileprovision",
              additionalProvisioningProfiles: { wrong: "shape" },
              distributionCertificate: { path: "build/dist.p12", password: "secret" },
            },
          }),
        ),
      );
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );
});
