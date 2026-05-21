import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { Id } from "../domain/common";
import { RotateVaultBody } from "../domain/encrypted-credential";
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
const keyIdParam = HttpApiSchema.param("keyId", Id);

export class OrgVaultGroup extends HttpApiGroup.make("orgVault")
  .add(
    HttpApiEndpoint.get("get", "/api/vault")
      .addSuccess(OrgVault)
      .annotateContext(
        OpenApi.annotations({
          title: "Get vault",
          description: "Read the organization's current vault version (the CAS token for writes)",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("bootstrap", "/api/vault")
      .setPayload(BootstrapVaultBody)
      .addSuccess(OrgVault, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Bootstrap vault",
          description:
            "Initialize the org vault with the first recipient wraps — must include an offline recovery recipient",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("listWraps", "/api/vault/wraps")
      .addSuccess(VaultRecipients)
      .annotateContext(
        OpenApi.annotations({
          title: "List vault recipients",
          description: "List the recipients holding the vault key at the current version",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("addWrap", "/api/vault/wraps")
      .setPayload(AddVaultWrapBody)
      .addSuccess(OrgVaultKeyWrap, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Add vault wrap",
          description:
            "Wrap the vault key to a recipient — granting another recipient (admin) or self-linking your own device",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("getWrap")`/api/vault/wraps/${keyIdParam}`
      .addSuccess(RecipientVaultKey)
      .annotateContext(
        OpenApi.annotations({
          title: "Get vault wrap",
          description: "Fetch the wrapped vault key for a recipient to unwrap locally",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("rotate", "/api/vault/rotate")
      .setPayload(RotateVaultBody)
      .addSuccess(OrgVault)
      .annotateContext(
        OpenApi.annotations({
          title: "Rotate vault key",
          description:
            "Revoke or rotate (admin): bump the vault version, re-wrap every credential DEK, and re-wrap the new key to the surviving recipients — applied atomically with compare-and-swap",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Conflict)
  .addError(BadRequest)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Org Vault",
      description: "Manage the organization's end-to-end encrypted vault key wraps",
    }),
  ) {}
