import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { Id } from "../domain/common";
import { RotateVaultBody, VaultCredentialDeks } from "../domain/encrypted-credential";
import { BadRequest, Conflict } from "../domain/errors";
import {
  AddVaultWrapBody,
  BootstrapVaultBody,
  OrgVault,
  OrgVaultKeyWrap,
  RecipientVaultKey,
  VaultRecipients,
} from "../domain/org-vault";

/** `:keyId` path parameter — a registered recipient's `user_encryption_keys.id`. */
const keyIdParam = { keyId: Id };

export const OrgVaultGroup = HttpApiGroup.make("orgVault")
  .add(
    HttpApiEndpoint.get("get", "/api/vault", {
      success: OrgVault,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Get vault",
        description: "Read the organization's current vault version (the CAS token for writes)",
      }),
    ),
    HttpApiEndpoint.post("bootstrap", "/api/vault", {
      payload: BootstrapVaultBody,
      success: OrgVault.pipe(HttpApiSchema.status(201)),
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Bootstrap vault",
        description:
          "Initialize the org vault with the first recipient wraps — must include an offline recovery recipient",
      }),
    ),
    HttpApiEndpoint.get("listWraps", "/api/vault/wraps", {
      success: VaultRecipients,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List vault recipients",
        description: "List the recipients holding the vault key at the current version",
      }),
    ),
    HttpApiEndpoint.post("addWrap", "/api/vault/wraps", {
      payload: AddVaultWrapBody,
      success: OrgVaultKeyWrap.pipe(HttpApiSchema.status(201)),
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Add vault wrap",
        description:
          "Wrap the vault key to a recipient — granting another recipient (admin) or self-linking your own device",
      }),
    ),
    HttpApiEndpoint.get("getWrap", "/api/vault/wraps/:keyId", {
      params: { ...keyIdParam },
      success: RecipientVaultKey,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Get vault wrap",
        description: "Fetch the wrapped vault key for a recipient to unwrap locally",
      }),
    ),
    HttpApiEndpoint.get("listCredentialDeks", "/api/vault/credential-deks", {
      success: VaultCredentialDeks,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List wrapped credential DEKs",
        description:
          "Every wrapped DEK in the org + the current vault version — the client fetches these to re-wrap under a new vault key during a rotation (the DEKs are opaque)",
      }),
    ),
    HttpApiEndpoint.post("rotate", "/api/vault/rotate", {
      payload: RotateVaultBody,
      success: OrgVault,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Rotate vault key",
        description:
          "Revoke or rotate (admin): bump the vault version, re-wrap every credential DEK, and re-wrap the new key to the surviving recipients — applied atomically with compare-and-swap",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Org Vault",
      description: "Manage the organization's end-to-end encrypted vault key wraps",
    }),
  );
