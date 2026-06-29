import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { Id } from "../domain/common";
import {
  AddEnvVaultWrapBody,
  CutoverEnvVaultBody,
  EnvVaultCredentialDeks,
  EnvVaultRecipientKind,
  EnvVaultRecipients,
  OrgEnvVaultKeyWrap,
  RecipientEnvVaultKey,
  RotateEnvVaultBody,
} from "../domain/env-vault";
import { BadRequest, Conflict } from "../domain/errors";
import { OrgVault } from "../domain/org-vault";

/** `:recipientKind` / `:recipientId` path params for a polymorphic env recipient. */
const recipientKindParam = HttpApiSchema.param("recipientKind", EnvVaultRecipientKind);
const recipientIdParam = HttpApiSchema.param("recipientId", Id);

export class EnvVaultGroup extends HttpApiGroup.make("envVault")
  .add(
    HttpApiEndpoint.post("cutover", "/api/env-vault/cutover")
      .setPayload(CutoverEnvVaultBody)
      .addSuccess(OrgVault)
      .annotateContext(
        OpenApi.annotations({
          title: "Cut over to the env vault",
          description:
            "One-shot fork of the org's env values into a separate env vault: wrap the new env key to every recipient and re-key every env DEK in place. Idempotent (compare-and-swap on the cutover sentinel).",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("listWraps", "/api/env-vault/wraps")
      .addSuccess(EnvVaultRecipients)
      .annotateContext(
        OpenApi.annotations({
          title: "List env-vault recipients",
          description: "List the recipients holding the env-vault key at the current version",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("addWrap", "/api/env-vault/wraps")
      .setPayload(AddEnvVaultWrapBody)
      .addSuccess(OrgEnvVaultKeyWrap, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Add env-vault wrap",
          description:
            "Wrap the env-vault key to a recipient — granting a member's account key (admin) or self-linking your own device/account key",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("getWrap")`/api/env-vault/wraps/${recipientKindParam}/${recipientIdParam}`
      .addSuccess(RecipientEnvVaultKey)
      .annotateContext(
        OpenApi.annotations({
          title: "Get env-vault wrap",
          description: "Fetch the wrapped env-vault key for a recipient to unwrap locally",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("listCredentialDeks", "/api/env-vault/credential-deks")
      .addSuccess(EnvVaultCredentialDeks)
      .annotateContext(
        OpenApi.annotations({
          title: "List wrapped env DEKs",
          description:
            "Every wrapped env DEK + the current env-vault version — fetched to re-wrap under a new key during a rotation",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("rotate", "/api/env-vault/rotate")
      .setPayload(RotateEnvVaultBody)
      .addSuccess(OrgVault)
      .annotateContext(
        OpenApi.annotations({
          title: "Rotate env-vault key",
          description:
            "Revoke or rotate (admin): bump the env-vault version, re-wrap every env DEK, and re-wrap the new key to the surviving recipients — applied atomically with compare-and-swap",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Conflict)
  .addError(BadRequest)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Env Vault",
      description: "Manage the organization's separate end-to-end encrypted env-vault key wraps",
    }),
  ) {}
