import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { BadRequest, Conflict } from "../domain/errors";
import { RegisterEncryptionKeyBody, UserEncryptionKey } from "../domain/user-encryption-key";

export class UserEncryptionKeysGroup extends HttpApiGroup.make("userEncryptionKeys")
  .add(
    HttpApiEndpoint.get("list", "/api/encryption-keys")
      .addSuccess(Schema.Struct({ items: Schema.Array(UserEncryptionKey) }))
      .annotateContext(
        OpenApi.annotations({
          title: "List encryption keys",
          description: "List recipient public keys visible to the caller (own devices + org keys)",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("register", "/api/encryption-keys")
      .setPayload(RegisterEncryptionKeyBody)
      .addSuccess(UserEncryptionKey, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Register encryption key",
          description:
            "Register a recipient public key — a device key (self, on first use) or an org-owned recovery / CI machine key (admin)",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Conflict)
  .addError(BadRequest)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Encryption Keys",
      description: "Register and list end-to-end encryption recipient public keys",
    }),
  ) {}
