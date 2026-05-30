// Pure code-signing SELECTION policy.
//
// A client with code signing configured sends `expo-expect-signature` on the
// manifest request (the default `allowUnsignedManifests` is FALSE). Its on-device
// verifier HARD-THROWS when the served manifest/directive carries no
// `expo-signature` header ("No expo-signature header specified" on Android /
// `SignatureHeaderMissing` on iOS), aborting the whole update check — NOT a
// graceful no-op. Verified against expo/expo sdk-56 CodeSigningConfiguration.{kt,swift}.
//
// So an UNSIGNED update (signature column NULL — a normal unsigned publish, or an
// older unsigned update still latest after signing was enabled) must never be
// served to such a client. We drop unsigned candidates and let the device keep
// its current/embedded update via a 204, instead of bricking its update check.
//
// Domain rule over UpdateRow-shaped candidates: pure, total, no I/O.

interface SignedCandidate {
  readonly signature: string | null;
}

/**
 * When the request carries `expo-expect-signature`, drop every candidate whose
 * `signature` is NULL (unservable to a code-signing client). When the header is
 * absent (a non-signing client), the input is returned unchanged.
 */
export const dropUnsignedWhenExpected = <T extends SignedCandidate>(
  candidates: readonly T[],
  expectSignature: string | undefined,
): readonly T[] =>
  expectSignature ? candidates.filter((candidate) => candidate.signature !== null) : candidates;

/**
 * True iff a resolved update must NOT be served because the client expects a
 * signature but the update is unsigned. Used as a final anti-brick re-assertion
 * on the rollout fallback pick, which re-queries D1 and bypasses the in-memory
 * {@link dropUnsignedWhenExpected} narrowing.
 */
export const isUnsignedButSignatureExpected = (
  update: SignedCandidate,
  expectSignature: string | undefined,
): boolean => Boolean(expectSignature) && update.signature === null;
