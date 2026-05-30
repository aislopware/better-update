import { Effect } from "effect";

import { validateEmbeddedBaselineId } from "./embedded-baseline-validation";

const LOWERCASE_UUID = "cccccccc-0000-0000-0000-aaaa00000000";
const UPPERCASE_UUID = "CCCCCCCC-0000-0000-0000-AAAA00000000";

const expectBadRequest = async (effect: Effect.Effect<void, unknown>, message: string) => {
  const error = await Effect.runPromise(Effect.flip(effect));
  expect(error).toMatchObject({ _tag: "BadRequest", message });
};

describe(validateEmbeddedBaselineId, () => {
  it("accepts an embedded baseline with a valid lowercase UUID id", async () => {
    await expect(
      Effect.runPromise(validateEmbeddedBaselineId({ id: LOWERCASE_UUID, isEmbedded: true })),
    ).resolves.toBeUndefined();
  });

  it("rejects an embedded baseline with no id", async () => {
    await expectBadRequest(
      validateEmbeddedBaselineId({ id: undefined, isEmbedded: true }),
      "Embedded baseline requires an explicit id (the app.manifest UUID from the native build)",
    );
  });

  it("rejects an embedded baseline whose id is an uppercase UUID", async () => {
    await expectBadRequest(
      validateEmbeddedBaselineId({ id: UPPERCASE_UUID, isEmbedded: true }),
      "Embedded baseline id must be a lowercase UUID (the expo-embedded-update-id baked into the binary)",
    );
  });

  it("rejects an embedded baseline whose id is not a UUID", async () => {
    await expectBadRequest(
      validateEmbeddedBaselineId({ id: "NOT-A-UUID", isEmbedded: true }),
      "Embedded baseline id must be a lowercase UUID (the expo-embedded-update-id baked into the binary)",
    );
  });

  // The signed-render path supplies a deterministic id on NON-embedded updates;
  // the gate must never touch it (a blanket "id ⇒ embedded" rule would break
  // signing).
  it("passes through a non-embedded update with a UUID id (signed-render case)", async () => {
    await expect(
      Effect.runPromise(validateEmbeddedBaselineId({ id: LOWERCASE_UUID, isEmbedded: false })),
    ).resolves.toBeUndefined();
  });

  it("passes through a non-embedded update with no id (unsigned case)", async () => {
    await expect(
      Effect.runPromise(validateEmbeddedBaselineId({ id: undefined, isEmbedded: false })),
    ).resolves.toBeUndefined();
  });
});
