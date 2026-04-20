import { Effect } from "effect";

import { parseGoogleServiceAccountKey } from "./google-service-account-key-parser";

const VALID = JSON.stringify({
  type: "service_account",
  project_id: "my-project",
  private_key_id: "abc123",
  private_key: "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----",
  client_email: "sa@my-project.iam.gserviceaccount.com",
});

describe(parseGoogleServiceAccountKey, () => {
  test("extracts metadata", async () => {
    const result = await Effect.runPromise(parseGoogleServiceAccountKey(VALID));
    expect(result.googleProjectId).toBe("my-project");
    expect(result.privateKeyId).toBe("abc123");
    expect(result.clientEmail).toMatch(/iam.gserviceaccount.com$/);
  });

  test("rejects non-JSON", async () => {
    const error = await Effect.runPromise(
      Effect.flip(parseGoogleServiceAccountKey("not json at all")),
    );
    expect(error.message).toMatch(/JSON/);
  });

  test("rejects non-service-account type", async () => {
    const error = await Effect.runPromise(
      Effect.flip(parseGoogleServiceAccountKey(JSON.stringify({ type: "user" }))),
    );
    expect(error.message).toMatch(/service_account/);
  });

  test("rejects missing private_key", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        parseGoogleServiceAccountKey(
          JSON.stringify({
            type: "service_account",
            project_id: "x",
            private_key_id: "y",
          }),
        ),
      ),
    );
    expect(error.message).toMatch(/private_key/);
  });
});
