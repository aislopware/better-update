import { apiKeyClient } from "@better-auth/api-key/client";
import { createAuthClient } from "better-auth/client";
import { organizationClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: "",
  plugins: [organizationClient(), apiKeyClient()],
});

/**
 * Converts an authClient-style `{ data, error }` response into a rejected
 * promise when `error` is present, for use inside `useApiMutation.mutationFn`.
 * React Query's mutation API signals errors via rejected promises, so this
 * is a deliberate boundary between functional Effect code and react-query.
 */
export const rejectOnAuthClientError = async <
  TResult extends { error: { message?: string | undefined } | null | undefined },
>(
  promise: Promise<TResult>,
  fallbackMessage: string,
): Promise<TResult> => {
  const result = await promise;
  if (result.error) {
    // eslint-disable-next-line functional/no-throw-statements, functional/no-promise-reject -- react-query mutationFn signals errors via rejected promises; this is the one authorized throw site for authClient responses
    throw new Error(result.error.message ?? fallbackMessage);
  }
  return result;
};
