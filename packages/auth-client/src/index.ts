import { apiKeyClient } from "@better-auth/api-key/client";
import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/client";
import {
  adminClient,
  inferAdditionalFields,
  oneTimeTokenClient,
  organizationClient,
} from "better-auth/client/plugins";

export const createBetterUpdateAuthClient = (baseURL: string) =>
  createAuthClient({
    baseURL,
    plugins: [
      organizationClient(),
      apiKeyClient(),
      oneTimeTokenClient(),
      // WebAuthn / passkey: enrollment + the step-up assertion the browser sends
      // to /api/web-vault/step-up before env-vault access (P4). The server only
      // registers the passkey plugin when WEBAUTHN_RP_ID is set, so these client
      // actions are inert until the web env vault is enabled.
      passkeyClient(),
      // `adminClient` types the global `role`/`banned` fields; `inferAdditionalFields`
      // surfaces our custom `approved` gate flag on `session.user` and keeps
      // `member.role` a free string (the IAM model reads only `"owner"` for root).
      adminClient(),
      inferAdditionalFields({
        user: { approved: { type: "boolean" } },
        member: { role: { type: "string" } },
      }),
    ],
  });

export type BetterUpdateAuthClient = ReturnType<typeof createBetterUpdateAuthClient>;

export { rejectOnAuthClientError } from "./reject-on-error";
