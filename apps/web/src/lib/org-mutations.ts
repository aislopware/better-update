import { Data, Effect } from "effect";

import { authClient, rejectOnAuthClientError } from "./auth-client";
import { useApiMutation } from "./use-api-mutation";

class OrgMutationError extends Data.TaggedError("OrgMutationError")<{
  message: string;
  cause?: unknown;
}> {}

/**
 * Creates an organization and activates it in the session.
 * Rejects on failure so `useApiMutation.onError` fires; returns the created org.
 */
export const createAndActivateOrg = async (params: {
  name: string;
  slug: string;
}): Promise<{ id: string }> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const created = yield* Effect.tryPromise(async () =>
        rejectOnAuthClientError(
          authClient.organization.create({
            ...params,
            fetchOptions: { disableSignal: true },
          }),
          "Failed to create organization",
        ),
      );

      if (!created.data) {
        return yield* new OrgMutationError({ message: "Failed to create organization" });
      }

      yield* Effect.tryPromise(async () =>
        rejectOnAuthClientError(
          authClient.organization.setActive({
            organizationId: created.data.id,
            fetchOptions: { disableSignal: true },
          }),
          "Failed to activate organization",
        ),
      );

      return created.data;
    }),
  );

export const useCreateAndActivateOrgMutation = (options: {
  onSuccess: (data: { id: string }) => Promise<void> | void;
}) =>
  useApiMutation({
    mutationFn: createAndActivateOrg,
    onSuccess: options.onSuccess,
  });

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
          return yield* new OrgMutationError({
            message: error.message ?? "Failed to delete organization",
          });
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
