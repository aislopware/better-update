import { CredentialBinding, CredentialBindingPlanItem } from "@better-update/api";
import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { computeCredentialBindingPlan } from "../application/credential-binding-plan";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertAccess } from "../auth/policy";
import { Conflict, NotFound } from "../errors";
import { toApiCrudEffect } from "../http/to-api-effect";
import { AndroidUploadKeystoreRepo } from "../repositories/android-upload-keystores";
import { AppleTeamRepo } from "../repositories/apple-teams";
import { AscApiKeyRepo } from "../repositories/asc-api-keys";
import { GoogleServiceAccountKeyRepo } from "../repositories/google-service-account-keys";
import { ProjectCredentialBindingRepo } from "../repositories/project-credential-bindings";
import { ProjectRepo } from "../repositories/projects";

import type { CredentialBindingType } from "../models";

// The target project must live in the acting org — cross-org ids surface as
// NotFound (enumeration-safe, mirroring the project-members handler).
const assertProjectInOrg = (projectId: string) =>
  Effect.gen(function* () {
    const ctx = yield* CurrentActor;
    const project = yield* (yield* ProjectRepo).findById({ id: projectId });
    if (project.organizationId !== ctx.organizationId) {
      return yield* new NotFound({ message: "Project not found" });
    }
  });

// Resolve + org-check the bound resource. `ascApiKey` bindings are reserved
// for TEAM-LESS keys — a team-scoped key rides its team's binding, so binding
// it directly would create a second, diverging grant path (spec §1a).
const assertResourceBindable = (resourceType: CredentialBindingType, resourceId: string) =>
  Effect.gen(function* () {
    const ctx = yield* CurrentActor;
    const notFound = new NotFound({ message: "Credential not found" });
    switch (resourceType) {
      case "appleTeam": {
        const team = yield* (yield* AppleTeamRepo)
          .findById({ id: resourceId })
          .pipe(Effect.mapError(() => notFound));
        if (team.organizationId !== ctx.organizationId) {
          return yield* notFound;
        }
        return;
      }
      case "ascApiKey": {
        const key = yield* (yield* AscApiKeyRepo)
          .findById({ id: resourceId })
          .pipe(Effect.mapError(() => notFound));
        if (key.organizationId !== ctx.organizationId) {
          return yield* notFound;
        }
        if (key.appleTeamId !== null) {
          return yield* new Conflict({
            message: "This ASC API key belongs to an Apple team — bind the team instead",
          });
        }
        return;
      }
      case "googleServiceAccountKey": {
        const key = yield* (yield* GoogleServiceAccountKeyRepo)
          .findById({ id: resourceId })
          .pipe(Effect.mapError(() => notFound));
        if (key.organizationId !== ctx.organizationId) {
          return yield* notFound;
        }
        return;
      }
      case "androidUploadKeystore": {
        const keystore = yield* (yield* AndroidUploadKeystoreRepo)
          .findById({ id: resourceId })
          .pipe(Effect.mapError(() => notFound));
        if (keystore.organizationId !== ctx.organizationId) {
          return yield* notFound;
        }
        return;
      }
      default: {
        return resourceType satisfies never;
      }
    }
  });

export const CredentialBindingsGroupLive = HttpApiBuilder.group(
  ManagementApi,
  "credential-bindings",
  (handlers) =>
    handlers
      .handle("plan", () =>
        toApiCrudEffect(
          Effect.gen(function* () {
            yield* assertAccess("credentialBinding", "read");
            const entries = yield* computeCredentialBindingPlan;
            return { items: entries.map((entry) => new CredentialBindingPlanItem(entry)) };
          }),
        ),
      )
      .handle("list", ({ path }) =>
        toApiCrudEffect(
          Effect.gen(function* () {
            yield* assertAccess("credentialBinding", "read");
            yield* assertProjectInOrg(path.id);
            const ctx = yield* CurrentActor;
            const repo = yield* ProjectCredentialBindingRepo;
            const items = yield* repo.listByProject({
              organizationId: ctx.organizationId,
              projectId: path.id,
            });
            return { items: items.map((item) => new CredentialBinding(item)) };
          }),
        ),
      )
      .handle("bind", ({ path }) =>
        toApiCrudEffect(
          Effect.gen(function* () {
            yield* assertAccess("credentialBinding", "create");
            yield* assertProjectInOrg(path.id);
            yield* assertResourceBindable(path.resourceType, path.resourceId);
            const ctx = yield* CurrentActor;
            const repo = yield* ProjectCredentialBindingRepo;

            const id = crypto.randomUUID();
            const now = new Date().toISOString();
            const inserted = yield* repo.bind({
              id,
              organizationId: ctx.organizationId,
              projectId: path.id,
              resourceType: path.resourceType,
              resourceId: path.resourceId,
              now,
            });

            // Idempotent re-PUT of an existing binding is not an event.
            if (inserted) {
              yield* logAudit({
                action: "credentialBinding.create",
                resourceType: "credentialBinding",
                resourceId: path.resourceId,
                projectId: path.id,
                metadata: { projectId: path.id, bindingType: path.resourceType },
              });
            }

            // Re-read for the canonical row: bind() is an idempotent upsert,
            // so an already-bound resource returns the EXISTING row.
            const items = yield* repo.listByProject({
              organizationId: ctx.organizationId,
              projectId: path.id,
            });
            const bound = items.find(
              (item) =>
                item.resourceType === path.resourceType && item.resourceId === path.resourceId,
            );
            if (bound === undefined) {
              return yield* Effect.die(new Error("Binding vanished right after upsert"));
            }
            return new CredentialBinding(bound);
          }),
        ),
      )
      .handle("unbind", ({ path }) =>
        toApiCrudEffect(
          Effect.gen(function* () {
            yield* assertAccess("credentialBinding", "delete");
            yield* assertProjectInOrg(path.id);
            const ctx = yield* CurrentActor;
            const repo = yield* ProjectCredentialBindingRepo;
            const removed = yield* repo.unbind({
              organizationId: ctx.organizationId,
              projectId: path.id,
              resourceType: path.resourceType,
              resourceId: path.resourceId,
            });
            if (!removed) {
              return yield* new NotFound({ message: "Binding not found" });
            }
            yield* logAudit({
              action: "credentialBinding.delete",
              resourceType: "credentialBinding",
              resourceId: path.resourceId,
              projectId: path.id,
              metadata: { projectId: path.id, bindingType: path.resourceType },
            });
            return { deleted: 1 };
          }),
        ),
      ),
);
