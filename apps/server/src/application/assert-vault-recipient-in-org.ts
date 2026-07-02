import { Effect } from "effect";

import { BadRequest } from "../errors";
import { MemberRepo } from "../repositories/member-repo";

// A user-owned recipient key (device or account kind) carries no
// `organization_id` column — it is bound to a USER, reachable via the member
// roster. So before granting a vault to such a key, verify its owner is a
// current member of the acting org; otherwise a `vaultAccess:create` holder
// could wrap the org's vault to an out-of-org user's key (given its id +
// public key), leaking decryption access. Recovery/machine keys carry an
// organization_id and are checked directly by the caller, so they never reach
// here.
export const assertVaultRecipientOwnerInOrg = (params: {
  readonly ownerUserId: string | null;
  readonly organizationId: string;
}) =>
  Effect.gen(function* () {
    const memberRepo = yield* MemberRepo;
    const members = yield* memberRepo.listByOrg({ organizationId: params.organizationId });
    const isMember =
      params.ownerUserId !== null && members.some((member) => member.userId === params.ownerUserId);
    if (!isMember) {
      return yield* new BadRequest({
        message: "Recipient key's owner is not a member of this organization",
      });
    }
  });
