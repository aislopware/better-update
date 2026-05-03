import { toastManager } from "@better-update/ui/components/ui/toast";
import { Effect } from "effect";

import { authClient } from "./auth-client";
import { useApiMutation } from "./use-api-mutation";

/**
 * Creates an organization and activates it in the session.
 * Shows a toast on failure and returns null; returns the created org on success.
 */
export const createAndActivateOrg = async (params: {
  name: string;
  slug: string;
}): Promise<{ id: string } | null> => {
  const { data, error } = await authClient.organization.create({
    ...params,
    fetchOptions: { disableSignal: true },
  });

  if (error) {
    toastManager.add({ title: error.message ?? "Failed to create organization", type: "error" });
    return null;
  }

  if (data.id) {
    await authClient.organization.setActive({
      organizationId: data.id,
      fetchOptions: { disableSignal: true },
    });
  }

  return data;
};

/**
 * Deletes an organization. Rejects on failure so `useMutation.onError` fires.
 * Uses Effect.fail instead of throw to satisfy functional/no-throw-statements.
 */
export const deleteOrg = async (organizationId: string): Promise<void> =>
  Effect.runPromise(
    Effect.asVoid(
      Effect.gen(function* () {
        const { error } = yield* Effect.tryPromise(async () =>
          authClient.organization.delete({ organizationId }),
        );
        if (error) {
          return yield* Effect.fail(new Error(error.message ?? "Failed to delete organization"));
        }
        return undefined;
      }),
    ),
  );

export const useDeleteOrgMutation = (options: {
  orgId: string;
  onSuccess: () => Promise<void> | void;
}) =>
  useApiMutation({
    mutationFn: async () => deleteOrg(options.orgId),
    onSuccess: options.onSuccess,
  });
