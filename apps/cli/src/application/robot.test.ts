import { deriveRecipient } from "@better-update/credentials-crypto";
import { it } from "@effect/vitest";
import { Effect } from "effect";

import { createRobotAccount, rotateRobotAccountBearer } from "./robot";

import type { ApiClient } from "../services/api-client";

interface CreatePayload {
  readonly name: string;
  readonly publicKey: string;
  readonly fingerprint: string;
}

const buildApi = (captured: CreatePayload[]): ApiClient =>
  ({
    "robot-accounts": {
      create: ({ payload }: { readonly payload: CreatePayload }) => {
        captured.push(payload);
        return Effect.succeed({
          id: "robot-1",
          organizationId: "org-1",
          name: payload.name,
          bearerStart: "bu_rob",
          hasBearer: true,
          userEncryptionKeyId: "key-1",
          createdAt: "2026-01-01T00:00:00Z",
          bearerSecret: "bu_robot_secret",
        });
      },
      rotate: () => Effect.succeed({ bearerSecret: "bu_robot_new-secret" }),
    },
  }) as unknown as ApiClient;

describe("creating a robot account", () => {
  it.effect("mints an age keypair, registers it, and returns both secrets", () =>
    Effect.gen(function* () {
      const captured: CreatePayload[] = [];
      const robot = yield* createRobotAccount(buildApi(captured), "gitlab-ci");

      // Registered under the given name, with a freshly generated public key.
      expect(captured).toHaveLength(1);
      expect(captured[0]?.name).toBe("gitlab-ci");
      expect(captured[0]?.publicKey.startsWith("age1")).toBe(true);
      expect(captured[0]?.fingerprint.startsWith("SHA256:")).toBe(true);

      // The bearer comes straight from the server response.
      expect(robot.bearerSecret).toBe("bu_robot_secret");

      // The private key is the raw age secret and matches the registered public
      // half — it is what gets bundled into BETTER_UPDATE_ROBOT.
      expect(robot.identityPrivateKey.startsWith("AGE-SECRET-KEY-1")).toBe(true);
      const derived = yield* Effect.promise(async () => deriveRecipient(robot.identityPrivateKey));
      expect(derived).toBe(captured[0]?.publicKey);
    }),
  );
});

describe("rotating a robot account's bearer", () => {
  it.effect("returns the freshly minted bearer secret", () =>
    Effect.gen(function* () {
      const rotated = yield* rotateRobotAccountBearer(buildApi([]), "robot-1");
      expect(rotated.bearerSecret).toBe("bu_robot_new-secret");
    }),
  );
});
