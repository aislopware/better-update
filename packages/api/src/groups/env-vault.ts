import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { Id } from "../domain/common";
import {
  AddEnvVaultWrapBody,
  CutoverEnvVaultBody,
  EnvVaultCredentialDeks,
  EnvVaultRecipients,
  OrgEnvVaultKeyWrap,
  RecipientEnvVaultKey,
  RotateEnvVaultBody,
} from "../domain/env-vault";
import { BadRequest, Conflict } from "../domain/errors";
import { EnvVaultRecipientKind, OrgVault } from "../domain/org-vault";

/** `:recipientKind` / `:recipientId` path params for a polymorphic env recipient. */
const recipientKindParam = { recipientKind: EnvVaultRecipientKind };
const recipientIdParam = { recipientId: Id };

export const EnvVaultGroup = HttpApiGroup.make("envVault")
  .add(
    HttpApiEndpoint.post("cutover", "/api/env-vault/cutover", {
      payload: CutoverEnvVaultBody,
      success: OrgVault,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Cut over to the env vault",
        description:
          "One-shot fork of the org's env values into a separate env vault: wrap the new env key to every recipient and re-key every env DEK in place. Idempotent (compare-and-swap on the cutover sentinel).",
      }),
    ),
    HttpApiEndpoint.get("listWraps", "/api/env-vault/wraps", {
      success: EnvVaultRecipients,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List env-vault recipients",
        description: "List the recipients holding the env-vault key at the current version",
      }),
    ),
    HttpApiEndpoint.post("addWrap", "/api/env-vault/wraps", {
      payload: AddEnvVaultWrapBody,
      success: OrgEnvVaultKeyWrap.pipe(HttpApiSchema.status(201)),
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Add env-vault wrap",
        description:
          "Wrap the env-vault key to a recipient — granting a member's account key (admin) or self-linking your own device/account key",
      }),
    ),
    HttpApiEndpoint.get("getWrap", "/api/env-vault/wraps/:recipientKind/:recipientId", {
      params: { ...recipientKindParam, ...recipientIdParam },
      success: RecipientEnvVaultKey,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Get env-vault wrap",
        description: "Fetch the wrapped env-vault key for a recipient to unwrap locally",
      }),
    ),
    HttpApiEndpoint.get("listCredentialDeks", "/api/env-vault/credential-deks", {
      success: EnvVaultCredentialDeks,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List wrapped env DEKs",
        description:
          "Every wrapped env DEK + the current env-vault version — fetched to re-wrap under a new key during a rotation",
      }),
    ),
    HttpApiEndpoint.post("rotate", "/api/env-vault/rotate", {
      payload: RotateEnvVaultBody,
      success: OrgVault,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Rotate env-vault key",
        description:
          "Revoke or rotate (admin): bump the env-vault version, re-wrap every env DEK, and re-wrap the new key to the surviving recipients — applied atomically with compare-and-swap",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Env Vault",
      description: "Manage the organization's separate end-to-end encrypted env-vault key wraps",
    }),
  );
