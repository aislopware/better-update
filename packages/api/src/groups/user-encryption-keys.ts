import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { BadRequest, Conflict } from "../domain/errors";
import { RegisterEncryptionKeyBody, UserEncryptionKey } from "../domain/user-encryption-key";

export const UserEncryptionKeysGroup = HttpApiGroup.make("userEncryptionKeys")
  .add(
    HttpApiEndpoint.get("list", "/api/encryption-keys", {
      success: Schema.Struct({ items: Schema.Array(UserEncryptionKey) }),
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List encryption keys",
        description: "List recipient public keys visible to the caller (own devices + org keys)",
      }),
    ),
    HttpApiEndpoint.post("register", "/api/encryption-keys", {
      payload: RegisterEncryptionKeyBody,
      success: UserEncryptionKey.pipe(HttpApiSchema.status(201)),
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Register encryption key",
        description:
          "Register a recipient public key — a device key (self, on first use) or an org-owned recovery / CI machine key (admin)",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Encryption Keys",
      description: "Register and list end-to-end encryption recipient public keys",
    }),
  );
