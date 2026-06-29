import { openEnvValue, sealEnvValue } from "@better-update/credentials-crypto";

import type { AccountKeyEscrow } from "@better-update/api";
import type { AccountKeyEnvelope } from "@better-update/credentials-crypto";

// Browser env-vault crypto. All primitives come from @better-update/credentials-crypto
// (pure @noble + age, browser-safe — see that package). The env vault is unlocked
// with a per-user account key whose private halves are passphrase-sealed in an
// escrow the server stores opaquely; once unwrapped, env values seal/open exactly
// as the CLI does (same envelope), so the two clients interoperate.

export { openEnvValue, sealEnvValue };

/**
 * Rebuild the crypto {@link AccountKeyEnvelope} from the server's escrow view. The
 * server stores `escrowCt` (renamed from `ct` on the wire); every other field is
 * the fixed v1 envelope header echoed back so the browser can open it locally.
 */
export const escrowToEnvelope = (escrow: AccountKeyEscrow): AccountKeyEnvelope => ({
  version: escrow.version,
  agePublicKey: escrow.agePublicKey,
  ed25519PublicKey: escrow.ed25519PublicKey,
  fingerprint: escrow.fingerprint,
  kdf: escrow.kdf,
  kdfParams: escrow.kdfParams,
  salt: escrow.salt,
  cipher: escrow.cipher,
  ct: escrow.escrowCt,
});
