import { apiKeyClient } from "@better-auth/api-key/client";
import { createAuthClient } from "better-auth/client";
import { organizationClient } from "better-auth/client/plugins";

export const createBetterUpdateAuthClient = (baseURL: string) =>
  createAuthClient({
    baseURL,
    plugins: [organizationClient(), apiKeyClient()],
  });

export type BetterUpdateAuthClient = ReturnType<typeof createBetterUpdateAuthClient>;

export { rejectOnAuthClientError } from "./reject-on-error";
