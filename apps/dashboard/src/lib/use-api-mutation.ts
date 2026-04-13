import { getApiError } from "@better-update/api-client";
import { useMutation } from "@tanstack/react-query";
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
