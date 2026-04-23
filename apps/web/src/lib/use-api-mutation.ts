import { getApiError } from "@better-update/api-client";
import { useMutation } from "@tanstack/react-query";
import { Effect } from "effect";
import { toast } from "sonner";

import type { MutationFunctionContext, UseMutationOptions } from "@tanstack/react-query";

export const useApiMutation = <TData, TVariables = void, TOnMutateResult = unknown>(
  options: UseMutationOptions<TData, unknown, TVariables, TOnMutateResult>,
) => {
  const { onError, ...rest } = options;

  return useMutation({
    ...rest,
    onError: async (error, variables, onMutateResult, context: MutationFunctionContext) => {
      toast.error(getApiError(error));
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
export const safeSubmit = async <T>(promise: Promise<T>): Promise<void> =>
  Effect.runPromise(Effect.ignore(Effect.tryPromise(async () => promise)));
