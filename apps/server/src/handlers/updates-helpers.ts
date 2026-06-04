// Pure, framework-agnostic helpers for the updates handler — extracted to keep
// handlers/updates.ts under the max-lines budget. No I/O, no Effect services.

import type { UpdateSortKey, UpdateSortOrder } from "../repositories/updates";

export const parseUpdateSort = (
  value: string | undefined = "-createdAt",
): { readonly sort: UpdateSortKey; readonly order: UpdateSortOrder } => {
  const order: UpdateSortOrder = value.startsWith("-") ? "desc" : "asc";
  const column = value.startsWith("-") ? value.slice(1) : value;
  switch (column) {
    case "createdAt":
    case "runtimeVersion":
    case "platform":
    case "rolloutPercentage": {
      return { sort: column, order };
    }
    default: {
      return { sort: "createdAt", order: "desc" };
    }
  }
};

const DEFAULT_PATCH_BASE_LIMIT = 10;
const MAX_PATCH_BASE_LIMIT = 50;

export const clampPatchBaseLimit = (limit: number | undefined): number => {
  if (limit === undefined || !Number.isFinite(limit) || limit < 1) {
    return DEFAULT_PATCH_BASE_LIMIT;
  }
  return Math.min(Math.trunc(limit), MAX_PATCH_BASE_LIMIT);
};
