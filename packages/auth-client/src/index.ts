import { apiKeyClient } from "@better-auth/api-key/client";
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
      // `adminClient` types the global `role`/`banned` fields; `inferAdditionalFields`
      // surfaces our custom `approved` gate flag on `session.user`.
      adminClient(),
      inferAdditionalFields({ user: { approved: { type: "boolean" } } }),
    ],
  });

export type BetterUpdateAuthClient = ReturnType<typeof createBetterUpdateAuthClient>;

export { rejectOnAuthClientError } from "./reject-on-error";
