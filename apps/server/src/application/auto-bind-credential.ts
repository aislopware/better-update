import { Effect } from "effect";

import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { NotFound } from "../errors";
import { ProjectCredentialBindingRepo } from "../repositories/project-credential-bindings";
import { ProjectRepo } from "../repositories/projects";

import type { CredentialBindingType } from "../models";

/**
 * Validate the auto-bind target BEFORE any credential/team row is written:
 * cross-org (or dangling) project ids surface as NotFound (enumeration-safe).
 * Members already proved membership via the create gate; this catches
 * admin-tier callers naming a foreign project. No-op without a `projectId`.
 */
export const assertBindableProject = (projectId: string | undefined) =>
  Effect.gen(function* () {
    if (projectId === undefined) {
      return;
    }
    const ctx = yield* CurrentActor;
    const project = yield* (yield* ProjectRepo)
      .findById({ id: projectId })
      .pipe(Effect.mapError(() => new NotFound({ message: "Project not found" })));
    if (project.organizationId !== ctx.organizationId) {
      return yield* new NotFound({ message: "Project not found" });
    }
  });

/**
 * Auto-bind a just-created credential (or its Apple team) to the project the
 * create payload named (GITLAB-RBAC-SPEC §1a): the create gate already
 * authorized this — org admins may name any project, members only one they
 * maintain ({@link assertBindableProject} ran before the insert). Idempotent
 * for already-bound resources. No-op without a `projectId`.
 */
export const autoBindCredential = (params: {
  readonly resourceType: CredentialBindingType;
  readonly resourceId: string;
  readonly projectId: string | undefined;
}) =>
  Effect.gen(function* () {
    if (params.projectId === undefined) {
      return;
    }
    const { projectId } = params;
    const ctx = yield* CurrentActor;
    const bindings = yield* ProjectCredentialBindingRepo;
    const inserted = yield* bindings.bind({
      id: crypto.randomUUID(),
      organizationId: ctx.organizationId,
      projectId,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      now: new Date().toISOString(),
    });
    // Same trail as the manual bind route — a Maintainer widening a
    // credential's reach must be as visible to admins as an admin doing it.
    if (inserted) {
      yield* logAudit({
        action: "credentialBinding.create",
        resourceType: "credentialBinding",
        resourceId: params.resourceId,
        projectId,
        metadata: { projectId, bindingType: params.resourceType, auto: true },
      });
    }
  });
