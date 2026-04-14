import { Effect } from "effect";

import { BadRequest } from "../errors";

interface AssetRefInput {
  readonly key: string;
  readonly hash: string;
  readonly isLaunch: boolean;
}

interface UpdatePublishValidationInput {
  readonly runtimeVersion: string;
  readonly assets: readonly AssetRefInput[];
  readonly extra: Record<string, unknown> | undefined;
  readonly isRollback: boolean;
  readonly manifestBody: string | null;
  readonly directiveBody: string | null;
}

interface ManifestAssetRef {
  readonly key: string;
  readonly hash: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const fail = (message: string) => new BadRequest({ message });

const parseJsonBody = (
  value: string,
  field: "manifestBody" | "directiveBody",
): Effect.Effect<unknown, BadRequest> =>
  Effect.try({
    try: () => JSON.parse(value) as unknown,
    catch: () => fail(`${field} must be valid JSON`),
  });

const expectRecord = (
  value: unknown,
  message: string,
): Effect.Effect<Record<string, unknown>, BadRequest> =>
  isRecord(value) ? Effect.succeed(value) : Effect.fail(fail(message));

const readRecordField = (record: Record<string, unknown>, key: string): unknown => record[key];

const expectNonEmptyString = (value: unknown, message: string): Effect.Effect<string, BadRequest> =>
  typeof value === "string" && value.length > 0
    ? Effect.succeed(value)
    : Effect.fail(fail(message));

const parseManifestAssetRef = (
  value: unknown,
  path: string,
): Effect.Effect<ManifestAssetRef, BadRequest> =>
  Effect.gen(function* () {
    const record = yield* expectRecord(value, `${path} must be an object`);
    const key = yield* expectNonEmptyString(
      readRecordField(record, "key"),
      `${path}.key must be a non-empty string`,
    );
    const hash = yield* expectNonEmptyString(
      readRecordField(record, "hash"),
      `${path}.hash must be a non-empty string`,
    );

    return { key, hash };
  });

const normalizeJson = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(normalizeJson);
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => [key, normalizeJson(nestedValue)]),
  );
};

const valuesEqual = (left: unknown, right: unknown) =>
  JSON.stringify(normalizeJson(left)) === JSON.stringify(normalizeJson(right));

const sortedAssetRefs = (assets: readonly ManifestAssetRef[]) =>
  [...assets].toSorted((left, right) =>
    left.key === right.key
      ? left.hash.localeCompare(right.hash)
      : left.key.localeCompare(right.key),
  );

const parseManifestAssetArray = (
  value: unknown,
): Effect.Effect<readonly ManifestAssetRef[], BadRequest> =>
  Array.isArray(value)
    ? Effect.forEach(
        value,
        (asset, index) => parseManifestAssetRef(asset, `manifestBody.assets[${String(index)}]`),
        { concurrency: 1 },
      )
    : Effect.fail(fail("manifestBody.assets must be an array"));

const assertMatchingAssetRefs = (params: {
  readonly actual: readonly ManifestAssetRef[];
  readonly expected: readonly ManifestAssetRef[];
  readonly path: string;
}): Effect.Effect<void, BadRequest> => {
  const sortedActual = sortedAssetRefs(params.actual);
  const sortedExpected = sortedAssetRefs(params.expected);
  const matches =
    sortedActual.length === sortedExpected.length &&
    sortedActual.every((asset, index) => {
      const expected = sortedExpected[index];
      return asset.key === expected?.key && asset.hash === expected.hash;
    });

  return matches ? Effect.void : Effect.fail(fail(`${params.path} must match the request assets`));
};

const assertManifestExtraMatchesRequest = (params: {
  readonly manifest: Record<string, unknown>;
  readonly extra: Record<string, unknown>;
}): Effect.Effect<void, BadRequest> =>
  Effect.gen(function* () {
    const manifestExtra = yield* expectRecord(
      params.manifest["extra"],
      "manifestBody.extra must be an object when request extra is provided",
    );
    const mismatch = Object.entries(params.extra).find(
      ([key, value]) => !valuesEqual(manifestExtra[key], value),
    );

    if (mismatch) {
      yield* fail(`manifestBody.extra.${mismatch[0]} must match the request extra payload`);
    }
  });

const assertLaunchAssetSemantics = (
  input: UpdatePublishValidationInput,
): Effect.Effect<void, BadRequest> =>
  Effect.gen(function* () {
    const launchAssets = input.assets.filter((asset) => asset.isLaunch);

    if (input.isRollback) {
      if (input.assets.length > 0) {
        yield* fail("Rollback directives must not include assets");
      }

      if (input.manifestBody !== null) {
        yield* fail("Rollback directives must not include manifestBody");
      }

      return;
    }

    if (input.directiveBody !== null) {
      yield* fail("Non-rollback updates must not include directiveBody");
    }

    if (launchAssets.length !== 1) {
      yield* fail("Non-rollback updates must include exactly one launch asset");
    }
  });

const assertManifestBodyMatchesRequest = (
  manifestBody: string,
  input: UpdatePublishValidationInput,
): Effect.Effect<void, BadRequest> =>
  Effect.gen(function* () {
    const manifest = yield* parseJsonBody(manifestBody, "manifestBody").pipe(
      Effect.flatMap((value) => expectRecord(value, "manifestBody must decode to a JSON object")),
    );
    const { runtimeVersion } = manifest;
    if (runtimeVersion !== input.runtimeVersion) {
      yield* fail("manifestBody.runtimeVersion must match the request runtimeVersion");
    }

    const launchAsset = yield* parseManifestAssetRef(
      manifest["launchAsset"],
      "manifestBody.launchAsset",
    );
    const expectedLaunchAsset = input.assets.find((asset) => asset.isLaunch);

    if (
      expectedLaunchAsset === undefined ||
      launchAsset.key !== expectedLaunchAsset.key ||
      launchAsset.hash !== expectedLaunchAsset.hash
    ) {
      yield* fail("manifestBody.launchAsset must match the request launch asset");
    }

    const actualAssets = yield* parseManifestAssetArray(manifest["assets"]);
    const expectedAssets = input.assets
      .filter((asset) => !asset.isLaunch)
      .map((asset) => ({ key: asset.key, hash: asset.hash }));
    yield* assertMatchingAssetRefs({
      actual: actualAssets,
      expected: expectedAssets,
      path: "manifestBody.assets",
    });

    if (input.extra !== undefined) {
      yield* assertManifestExtraMatchesRequest({ manifest, extra: input.extra });
    }
  });

const assertDirectiveBodyMatchesRequest = (
  directiveBody: string,
): Effect.Effect<void, BadRequest> =>
  Effect.gen(function* () {
    const directive = yield* parseJsonBody(directiveBody, "directiveBody").pipe(
      Effect.flatMap((value) => expectRecord(value, "directiveBody must decode to a JSON object")),
    );

    if (directive["type"] !== "rollBackToEmbedded") {
      yield* fail('directiveBody.type must be "rollBackToEmbedded"');
    }

    const parameters = yield* expectRecord(
      directive["parameters"],
      "directiveBody.parameters must be an object",
    );
    const { commitTime } = parameters;
    if (typeof commitTime !== "string" || Number.isNaN(Date.parse(commitTime))) {
      yield* fail("directiveBody.parameters.commitTime must be a valid ISO 8601 timestamp");
    }
  });

export const validateUpdatePublishInput = (
  input: UpdatePublishValidationInput,
): Effect.Effect<void, BadRequest> =>
  Effect.gen(function* () {
    yield* assertLaunchAssetSemantics(input);

    if (input.manifestBody !== null) {
      yield* assertManifestBodyMatchesRequest(input.manifestBody, input);
    }

    if (input.directiveBody !== null) {
      if (!input.isRollback) {
        yield* fail("Only rollback updates may include directiveBody");
      }

      yield* assertDirectiveBodyMatchesRequest(input.directiveBody);
    }
  });
