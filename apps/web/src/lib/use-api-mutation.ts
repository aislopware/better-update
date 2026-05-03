import { getApiError } from "@better-update/api-client";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useMutation } from "@tanstack/react-query";

import type { MutationFunctionContext, UseMutationOptions } from "@tanstack/react-query";

export const useApiMutation = <TData, TVariables = void, TOnMutateResult = unknown>(
  options: UseMutationOptions<TData, unknown, TVariables, TOnMutateResult>,
) => {
  const { onError, ...rest } = options;

  return useMutation({
    ...rest,
    onError: async (error, variables, onMutateResult, context: MutationFunctionContext) => {
      toastManager.add({ title: getApiError(error), type: "error" });
      await onError?.(error, variables, onMutateResult, context);
    },
  });
};

/**
 * Wraps a Promise so it never rejects — errors resolve as void.
 * Use in TanStack Form `onSubmit` with `mutateAsync` to prevent unhandled
 * rejections while keeping `isSubmitting` tracking intact.
 * Error display is still handled by `useApiMutation`'s `onError`.
 */
export const safeSubmit = async <T>(promise: Promise<T>): Promise<void> => {
  // eslint-disable-next-line functional/no-try-statements -- TanStack Form requires a non-rejecting submit promise while mutation errors are displayed by useApiMutation.onError
  try {
    await promise;
  } catch {
    // Mutation errors are handled by useApiMutation.onError.
  }
};
