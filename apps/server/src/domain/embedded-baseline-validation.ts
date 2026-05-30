import { Effect } from "effect";

import { BadRequest } from "../errors";

/**
 * Lowercase 8-4-4-4-12 hex UUID. Lowercase is mandatory: the device sends
 * `expo-embedded-update-id` lowercased (FileDownloader.swift/.kt both
 * `.lowercased()`) and `selectPatchCandidates` lowercases before building the
 * patch R2 key — so the stored embedded baseline id MUST already be lowercase
 * for the first-launch patch key to match. Mirrors the api-contract `UuidLower`
 * schema.
 */
const LOWERCASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

interface EmbeddedBaselineIdInput {
  /** The client-supplied update id, if any. */
  readonly id: string | undefined;
  /** Whether the create registers an embedded baseline. */
  readonly isEmbedded: boolean;
}

/**
 * Gate on the embedded-baseline id. The rule is `embedded ⇒ id required + lowercase-UUID`,
 * NOT `id ⇒ embedded`:
 *
 *  • isEmbedded:true + no id        → BadRequest (an embedded baseline must pin
 *    the binary's app.manifest UUID).
 *  • isEmbedded:true + bad id       → BadRequest (must be a lowercase UUID, the
 *    value the device reports as expo-embedded-update-id).
 *  • isEmbedded:false (any id)      → no-op pass-through, so the existing
 *    render-then-sign path keeps supplying its deterministic id unchanged.
 *
 * Pure: errors are Effect values (no throw). The id+isEmbedded correlation only
 * exists here / in the handler, so the embedded-only strictness lives outside the
 * shared schema (which stays permissive for every server-minted id shape).
 */
export const validateEmbeddedBaselineId = (
  input: EmbeddedBaselineIdInput,
): Effect.Effect<void, BadRequest> => {
  if (!input.isEmbedded) {
    return Effect.void;
  }

  if (input.id === undefined) {
    return Effect.fail(
      new BadRequest({
        message:
          "Embedded baseline requires an explicit id (the app.manifest UUID from the native build)",
      }),
    );
  }

  if (!LOWERCASE_UUID.test(input.id)) {
    return Effect.fail(
      new BadRequest({
        message:
          "Embedded baseline id must be a lowercase UUID (the expo-embedded-update-id baked into the binary)",
      }),
    );
  }

  return Effect.void;
};
