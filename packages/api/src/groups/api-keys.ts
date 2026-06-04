import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { ApiKeyList, CreateApiKeyBody, CreatedApiKey } from "../domain/api-key";
import { DeletedResult, idParam } from "../domain/common";

export class ApiKeysGroup extends HttpApiGroup.make("api-keys")
  .add(
    HttpApiEndpoint.get("list", "/api/api-keys")
      .addSuccess(ApiKeyList)
      .annotateContext(
        OpenApi.annotations({
          title: "List API keys",
          description:
            "List the active organization's API keys (hashed secret never exposed; only the `start` prefix for identification)",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("create", "/api/api-keys")
      .setPayload(CreateApiKeyBody)
      .addSuccess(CreatedApiKey, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Create API key",
          description:
            "Mint a new API key for the active organization. The plaintext key is returned ONCE; only its hash is stored",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("revoke")`/api/api-keys/${idParam}`
      .addSuccess(DeletedResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Revoke API key",
          description: "Delete an API key by id (org-scoped; no cross-organization deletes)",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "API Keys",
      description: "IAM-gated organization API key mint / list / revoke",
    }),
  ) {}
