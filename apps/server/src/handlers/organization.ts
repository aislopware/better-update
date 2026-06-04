import { Organization } from "@better-update/api";
import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertAccess } from "../auth/policy";
import { NotFound } from "../errors";
import { toApiCrudEffect } from "../http/to-api-effect";
import { OrganizationRepo } from "../repositories/organizations";

export const OrganizationGroupLive = HttpApiBuilder.group(
  ManagementApi,
  "organization",
  (handlers) =>
    handlers.handle("update", ({ payload }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          // In-org mutation → the IAM gate is authoritative (owner bypasses; a
          // non-owner needs an explicit organization:update grant). Targets the
          // ACTIVE org only — no id is accepted, so there is no cross-org reach.
          yield* assertAccess("organization", "update");
          const ctx = yield* CurrentActor;
          const repo = yield* OrganizationRepo;
          const updated = yield* repo.update({
            id: ctx.organizationId,
            ...(payload.name === undefined ? {} : { name: payload.name }),
            ...(payload.slug === undefined ? {} : { slug: payload.slug }),
          });
          if (updated === null) {
            return yield* new NotFound({ message: "Organization not found" });
          }
          yield* logAudit({
            action: "organization.update",
            resourceType: "organization",
            resourceId: ctx.organizationId,
          });
          return new Organization({ id: updated.id, name: updated.name, slug: updated.slug });
        }),
      ),
    ),
);
