import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

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
            return { items: entries.map((entry) => entry) };
          }),
        ),
      )
      .handle("list", ({ params }) =>
        toApiCrudEffect(
          Effect.gen(function* () {
            yield* assertAccess("credentialBinding", "read");
            yield* assertProjectInOrg(params.id);
            const ctx = yield* CurrentActor;
            const repo = yield* ProjectCredentialBindingRepo;
            const items = yield* repo.listByProject({
              organizationId: ctx.organizationId,
              projectId: params.id,
            });
            return { items: items.map((item) => item) };
          }),
        ),
      )
      .handle("bind", ({ params }) =>
        toApiCrudEffect(
          Effect.gen(function* () {
            yield* assertAccess("credentialBinding", "create");
            yield* assertProjectInOrg(params.id);
            yield* assertResourceBindable(params.resourceType, params.resourceId);
            const ctx = yield* CurrentActor;
            const repo = yield* ProjectCredentialBindingRepo;

            const id = crypto.randomUUID();
            const now = new Date().toISOString();
            const inserted = yield* repo.bind({
              id,
              organizationId: ctx.organizationId,
              projectId: params.id,
              resourceType: params.resourceType,
              resourceId: params.resourceId,
              now,
            });

            // Idempotent re-PUT of an existing binding is not an event.
            if (inserted) {
              yield* logAudit({
                action: "credentialBinding.create",
                resourceType: "credentialBinding",
                resourceId: params.resourceId,
                projectId: params.id,
                metadata: { projectId: params.id, bindingType: params.resourceType },
              });
            }

            // Re-read for the canonical row: bind() is an idempotent upsert,
            // so an already-bound resource returns the EXISTING row.
            const items = yield* repo.listByProject({
              organizationId: ctx.organizationId,
              projectId: params.id,
            });
            const bound = items.find(
              (item) =>
                item.resourceType === params.resourceType && item.resourceId === params.resourceId,
            );
            if (bound === undefined) {
              return yield* Effect.die(new Error("Binding vanished right after upsert"));
            }
            return bound;
          }),
        ),
      )
      .handle("bindAllProjects", ({ params }) =>
        toApiCrudEffect(
          Effect.gen(function* () {
            yield* assertAccess("credentialBinding", "create");
            yield* assertResourceBindable(params.resourceType, params.resourceId);
            const ctx = yield* CurrentActor;
            const repo = yield* ProjectCredentialBindingRepo;

            const inserted = yield* repo.bindAllProjects({
              id: crypto.randomUUID(),
              organizationId: ctx.organizationId,
              resourceType: params.resourceType,
              resourceId: params.resourceId,
              now: new Date().toISOString(),
            });
            // Idempotent re-PUT of an existing org-wide binding is not an event.
            if (inserted) {
              yield* logAudit({
                action: "credentialBinding.create",
                resourceType: "credentialBinding",
                resourceId: params.resourceId,
                metadata: { bindingType: params.resourceType, allProjects: true },
              });
            }

            // Re-read for the canonical row (idempotent upsert semantics).
            const bound = yield* repo.findAllProjectsBinding({
              organizationId: ctx.organizationId,
              resourceType: params.resourceType,
              resourceId: params.resourceId,
            });
            if (bound === null) {
              return yield* Effect.die(new Error("Org-wide binding vanished right after upsert"));
            }
            return bound;
          }),
        ),
      )
      .handle("unbindAllProjects", ({ params }) =>
        toApiCrudEffect(
          Effect.gen(function* () {
            yield* assertAccess("credentialBinding", "delete");
            const ctx = yield* CurrentActor;
            const repo = yield* ProjectCredentialBindingRepo;
            const removed = yield* repo.unbindAllProjects({
              organizationId: ctx.organizationId,
              resourceType: params.resourceType,
              resourceId: params.resourceId,
            });
            if (!removed) {
              return yield* new NotFound({ message: "Binding not found" });
            }
            yield* logAudit({
              action: "credentialBinding.delete",
              resourceType: "credentialBinding",
              resourceId: params.resourceId,
              metadata: { bindingType: params.resourceType, allProjects: true },
            });
            return { deleted: 1 };
          }),
        ),
      )
      .handle("unbind", ({ params }) =>
        toApiCrudEffect(
          Effect.gen(function* () {
            yield* assertAccess("credentialBinding", "delete");
            yield* assertProjectInOrg(params.id);
            const ctx = yield* CurrentActor;
            const repo = yield* ProjectCredentialBindingRepo;
            const removed = yield* repo.unbind({
              organizationId: ctx.organizationId,
              projectId: params.id,
              resourceType: params.resourceType,
              resourceId: params.resourceId,
            });
            if (!removed) {
              return yield* new NotFound({ message: "Binding not found" });
            }
            yield* logAudit({
              action: "credentialBinding.delete",
              resourceType: "credentialBinding",
              resourceId: params.resourceId,
              projectId: params.id,
              metadata: { projectId: params.id, bindingType: params.resourceType },
            });
            return { deleted: 1 };
          }),
        ),
      ),
);
