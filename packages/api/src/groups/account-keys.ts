import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import {
  AccountKey,
  AccountKeyEscrow,
  AccountKeyList,
  RegisterAccountKeyBody,
  ResealAccountKeyBody,
} from "../domain/account-key";
import { BadRequest, Conflict } from "../domain/errors";

export const AccountKeysGroup = HttpApiGroup.make("accountKeys")
  .add(
    HttpApiEndpoint.post("register", "/api/account-keys", {
      payload: RegisterAccountKeyBody,
      success: AccountKey.pipe(HttpApiSchema.status(201)),
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Register account key",
        description:
          "Register the caller's per-user account key — the env-vault recipient the browser unwraps with. The CLI seals the private halves under the passphrase first; the server stores the escrow opaquely.",
      }),
    ),
    HttpApiEndpoint.get("list", "/api/account-keys", {
      success: AccountKeyList,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List org account keys",
        description:
          "List the live account keys of the org's members (public view, admin) — the env-vault cutover/rotate uses it to enumerate the account-key recipients and resolve each id to its age recipient.",
      }),
    ),
    HttpApiEndpoint.patch("reseal", "/api/account-keys/me", {
      payload: ResealAccountKeyBody,
      success: AccountKey,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Re-seal account-key escrow",
        description:
          "Re-seal the caller's account-key escrow under a new passphrase (the CLI `passphrase change` flow). The keypair is unchanged, so every env-vault wrap to it stays valid.",
      }),
    ),
    HttpApiEndpoint.get("getMe", "/api/account-keys/me", {
      success: AccountKeyEscrow,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Get my account-key escrow",
        description:
          "Return the caller's passphrase-sealed account-key escrow for local unlock. The contents stay passphrase-sealed regardless of caller. Browser (cookie) callers must first complete a WebAuthn step-up via /api/web-vault/step-up; CLI bearer callers are exempt.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Account Keys",
      description: "Per-user account keys for browser-side env-vault access",
    }),
  );
