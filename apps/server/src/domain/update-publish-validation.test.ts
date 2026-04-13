import { Effect } from "effect";

import { validateUpdatePublishInput } from "./update-publish-validation";

const regularAssets = [
  { hash: "launch-hash", key: "bundles/app.js", isLaunch: true },
  { hash: "asset-hash", key: "assets/logo.png", isLaunch: false },
] as const;

const matchingManifestBody = JSON.stringify({
  id: "update-1",
  createdAt: "2026-04-13T10:00:00.000Z",
  runtimeVersion: "1.0.0",
  launchAsset: {
    key: "bundles/app.js",
    hash: "launch-hash",
    contentType: "application/javascript",
    url: "https://cdn.example.com/assets/launch-hash",
  },
  assets: [
    {
      key: "assets/logo.png",
      hash: "asset-hash",
      contentType: "image/png",
      fileExtension: ".png",
      url: "https://cdn.example.com/assets/asset-hash",
    },
  ],
  metadata: {},
  extra: {
    scopeKey: "@team/app",
    eas: { projectId: "project-1" },
    expoClient: { name: "My App" },
  },
});

const expectBadRequest = async (effect: Effect.Effect<void, unknown>, message: string) => {
  const error = await Effect.runPromise(Effect.flip(effect));
  expect(error).toMatchObject({ _tag: "BadRequest", message });
};

describe(validateUpdatePublishInput, () => {
  test("accepts an unsigned regular update with one launch asset", async () => {
    await expect(
      Effect.runPromise(
        validateUpdatePublishInput({
          runtimeVersion: "1.0.0",
          assets: regularAssets,
          extra: undefined,
          isRollback: false,
          manifestBody: null,
          directiveBody: null,
        }),
      ),
    ).resolves.toBeUndefined();
  });

  test("rejects a regular update without exactly one launch asset", async () => {
    await expectBadRequest(
      validateUpdatePublishInput({
        runtimeVersion: "1.0.0",
        assets: [{ hash: "asset-hash", key: "assets/logo.png", isLaunch: false }],
        extra: undefined,
        isRollback: false,
        manifestBody: null,
        directiveBody: null,
      }),
      "Non-rollback updates must include exactly one launch asset",
    );
  });

  test("rejects rollback directives that include assets", async () => {
    await expectBadRequest(
      validateUpdatePublishInput({
        runtimeVersion: "1.0.0",
        assets: regularAssets,
        extra: undefined,
        isRollback: true,
        manifestBody: null,
        directiveBody: JSON.stringify({
          type: "rollBackToEmbedded",
          parameters: { commitTime: "2026-04-13T10:00:00.000Z" },
        }),
      }),
      "Rollback directives must not include assets",
    );
  });

  test("accepts a signed manifest body that matches assets and extra", async () => {
    await expect(
      Effect.runPromise(
        validateUpdatePublishInput({
          runtimeVersion: "1.0.0",
          assets: regularAssets,
          extra: {
            expoClient: { name: "My App" },
            eas: { projectId: "project-1" },
          },
          isRollback: false,
          manifestBody: matchingManifestBody,
          directiveBody: null,
        }),
      ),
    ).resolves.toBeUndefined();
  });

  test("rejects a signed manifest body with mismatched runtimeVersion", async () => {
    await expectBadRequest(
      validateUpdatePublishInput({
        runtimeVersion: "2.0.0",
        assets: regularAssets,
        extra: undefined,
        isRollback: false,
        manifestBody: matchingManifestBody,
        directiveBody: null,
      }),
      "manifestBody.runtimeVersion must match the request runtimeVersion",
    );
  });

  test("rejects a signed manifest body with mismatched extra payload", async () => {
    await expectBadRequest(
      validateUpdatePublishInput({
        runtimeVersion: "1.0.0",
        assets: regularAssets,
        extra: {
          expoClient: { name: "Different App" },
        },
        isRollback: false,
        manifestBody: matchingManifestBody,
        directiveBody: null,
      }),
      "manifestBody.extra.expoClient must match the request extra payload",
    );
  });

  test("accepts a rollback directive body with valid commitTime", async () => {
    await expect(
      Effect.runPromise(
        validateUpdatePublishInput({
          runtimeVersion: "1.0.0",
          assets: [],
          extra: undefined,
          isRollback: true,
          manifestBody: null,
          directiveBody: JSON.stringify({
            type: "rollBackToEmbedded",
            parameters: { commitTime: "2026-04-13T10:00:00.000Z" },
          }),
        }),
      ),
    ).resolves.toBeUndefined();
  });

  test("rejects a rollback directive body with invalid type", async () => {
    await expectBadRequest(
      validateUpdatePublishInput({
        runtimeVersion: "1.0.0",
        assets: [],
        extra: undefined,
        isRollback: true,
        manifestBody: null,
        directiveBody: JSON.stringify({
          type: "unsupported",
          parameters: { commitTime: "2026-04-13T10:00:00.000Z" },
        }),
      }),
      'directiveBody.type must be "rollBackToEmbedded"',
    );
  });
});
