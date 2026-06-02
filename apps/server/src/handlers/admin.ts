import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { assertSuperadmin } from "../auth/permissions";
import { NotFound } from "../errors";
import { toApiForbiddenEffect, toApiReadEffect } from "../http/to-api-effect";
import { parsePagination } from "../lib/pagination";
import { AdminUsersRepo } from "../repositories/admin-users";

import type { AdminUserRecord } from "../repositories/admin-users";

const setApprovedOrNotFound = (userId: string, approved: boolean) =>
  Effect.gen(function* () {
    yield* assertSuperadmin;
    const repo = yield* AdminUsersRepo;
    const record = yield* repo.setApproved({ userId, approved });
    if (record === null) {
      return yield* new NotFound({ message: "User not found" });
    }
    return record satisfies AdminUserRecord;
  });

export const AdminGroupLive = HttpApiBuilder.group(ManagementApi, "admin", (handlers) =>
  handlers
    .handle("listUsers", ({ urlParams }) =>
      toApiForbiddenEffect(
        Effect.gen(function* () {
          yield* assertSuperadmin;
          const repo = yield* AdminUsersRepo;
          const { page, limit, offset } = parsePagination(urlParams);

          const { items, total } = yield* repo.list({
            search: urlParams.search,
            status: urlParams.status,
            limit,
            offset,
          });

          return { items, total, page, limit };
        }),
      ),
    )
    .handle("approveUser", ({ path }) => toApiReadEffect(setApprovedOrNotFound(path.userId, true)))
    .handle("revokeUser", ({ path }) => toApiReadEffect(setApprovedOrNotFound(path.userId, false))),
);
