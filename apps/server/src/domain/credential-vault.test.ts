import { Effect } from "effect";

import { toBase64 } from "../lib/base64";
import { CredentialVaultConfigError, resolveKeyring } from "./credential-vault";

describe("credential-vault", () => {
  describe(resolveKeyring, () => {
    test("parses valid keyring JSON", () => {
      const secret = toBase64(crypto.getRandomValues(new Uint8Array(32)));
      const json = JSON.stringify({ "1": secret });
      const keyring = Effect.runSync(resolveKeyring(json));

      expect(keyring.currentVersion).toBe(1);
      expect(keyring.secrets[1]).toBeInstanceOf(Uint8Array);
      expect(keyring.secrets[1]!.length).toBe(32);
    });

    test("selects highest version as currentVersion", () => {
      const s1 = toBase64(crypto.getRandomValues(new Uint8Array(32)));
      const s2 = toBase64(crypto.getRandomValues(new Uint8Array(32)));
      const json = JSON.stringify({ "1": s1, "3": s2 });
      const keyring = Effect.runSync(resolveKeyring(json));

      expect(keyring.currentVersion).toBe(3);
    });

    test("throws on empty keyring", () => {
      expect(() => Effect.runSync(resolveKeyring("{}"))).toThrow("Vault keyring is empty");
    });

    test("returns a tagged config error on invalid JSON", async () => {
      const error = await Effect.runPromise(Effect.flip(resolveKeyring("not-json")));

      expect(error).toBeInstanceOf(CredentialVaultConfigError);
      expect(error._tag).toBe("CredentialVaultConfigError");
      expect(error.message).toBe("Vault keyring must be valid JSON");
    });
  });
});
