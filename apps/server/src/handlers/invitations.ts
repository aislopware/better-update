import { Invitation } from "@better-update/api";
import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertAccess } from "../auth/policy";
import { isWithinBoundary } from "../auth/policy-boundary";
import { cloudflareEnv } from "../cloudflare/context";
import { EmailService } from "../domain/email-service";
import { Forbidden, NotFound } from "../errors";
import { toApiForbiddenEffect, toApiReadEffect } from "../http/to-api-effect";
import { renderInviteEmail } from "../lib/email-templates";
import { structuredLog } from "../middleware/logging";
import { AuthMetaRepo } from "../repositories/auth-meta";
import { InvitationGrantRepo } from "../repositories/invitation-grants";
import { InvitationRepo } from "../repositories/invitations";
import { resolveAttachablePolicy } from "./policy-attachments";

import type { InvitationModel } from "../repositories/invitations";

// Mirrors auth.ts: invite emails come from this verbatim sender.
const INVITE_SENDER_FROM = "noreply@jmango360.dev";

// In the unified IAM model invited members are plain "member"; admin/developer/
// viewer come from policy attachments, not the invite role.
const DEFAULT_ROLE = "member";

const toApiInvitation = (model: InvitationModel): Invitation =>
  new Invitation({
    id: model.id,
    email: model.email,
    role: model.role,
    status: model.status,
    expiresAt: model.expiresAt,
    createdAt: model.createdAt,
  });

// Build + send the invite email, reusing auth.ts's template + EmailService.
// A delivery failure is logged and swallowed (never fails the request): the
// pending invitation row is already written, so the user can still accept via a
// re-sent link. Mirrors the `sendInvitationEmail` hook in auth.ts.
const sendInviteEmail = (params: {
  readonly invitationId: string;
  readonly recipientEmail: string;
  readonly role: string;
  readonly inviterName: string;
  readonly organizationName: string;
}) =>
  Effect.gen(function* () {
    const env = yield* cloudflareEnv;
    const emailService = yield* EmailService;
    const acceptUrl = `${env.BETTER_AUTH_URL}/accept-invitation?id=${params.invitationId}`;
    const rendered = renderInviteEmail({
      inviterName: params.inviterName,
      organizationName: params.organizationName,
      recipientEmail: params.recipientEmail,
      role: params.role,
      acceptUrl,
    });
    yield* emailService.send({
      from: INVITE_SENDER_FROM,
      to: params.recipientEmail,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }).pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => {
        structuredLog("error", "sendInvitationEmail failed", {
          invitationId: params.invitationId,
          recipient: params.recipientEmail,
          cause: error instanceof Error ? error.message : String(error),
        });
      }),
    ),
  );

const inviterDisplayName = (name: string, email: string): string => {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : email;
};

export const InvitationsGroupLive = HttpApiBuilder.group(ManagementApi, "invitations", (handlers) =>
  handlers
    .handle("list", () =>
      toApiForbiddenEffect(
        Effect.gen(function* () {
          yield* assertAccess("invitation", "read");
          const ctx = yield* CurrentActor;
          const repo = yield* InvitationRepo;
          const invitations = yield* repo.list({ organizationId: ctx.organizationId });
          return { items: invitations.map(toApiInvitation) };
        }),
      ),
    )
    .handle("create", ({ payload }) =>
      toApiReadEffect(
        Effect.gen(function* () {
          yield* assertAccess("invitation", "create");
          const ctx = yield* CurrentActor;
          // The `invitation.inviter_id` column FK-references `user(id)` and
          // better-auth's accept flow creates the member from this row, so the
          // inviter must be a real user. API-key principals have no `userId`.
          if (ctx.userId === null) {
            return yield* new Forbidden({
              message: "An API key cannot create invitations; sign in as a member",
            });
          }
          const role = payload.role ?? DEFAULT_ROLE;

          // Resolve + boundary-check the carried grants BEFORE writing anything
          // (SPEC §8d): an inviter cannot smuggle grants they could not attach
          // directly. Bare managed ids normalize to their explicit form.
          const requestedGrants = [...new Set(payload.grants)];
          const resolvedGrants = yield* Effect.all(
            requestedGrants.map((policyId) =>
              resolveAttachablePolicy({ policyId, organizationId: ctx.organizationId }),
            ),
          );
          if (!ctx.isOwner && !ctx.isSuperadmin) {
            const escalating = resolvedGrants.find(
              (grant) => !isWithinBoundary(ctx.effectiveStatements, grant.document),
            );
            if (escalating !== undefined) {
              return yield* new Forbidden({
                message: `Cannot grant more than you currently hold: ${escalating.policyId}`,
              });
            }
          }
          const grantIds = [...new Set(resolvedGrants.map((grant) => grant.policyId))];

          const metaRepo = yield* AuthMetaRepo;
          const repo = yield* InvitationRepo;

          const created = yield* repo.create({
            organizationId: ctx.organizationId,
            email: payload.email,
            role,
            inviterUserId: ctx.userId,
          });

          if (grantIds.length > 0) {
            const grantRepo = yield* InvitationGrantRepo;
            yield* grantRepo.setForInvitation({
              invitationId: created.id,
              organizationId: ctx.organizationId,
              policyIds: grantIds,
              createdAt: new Date().toISOString(),
            });
            yield* logAudit({
              action: "invitation.grants_set",
              resourceType: "invitation",
              resourceId: created.id,
              metadata: { email: created.email, policyIds: grantIds },
            });
          }

          const inviter = yield* metaRepo.findUserById(ctx.userId);
          const organization = yield* metaRepo.findOrganizationById(ctx.organizationId);
          yield* sendInviteEmail({
            invitationId: created.id,
            recipientEmail: created.email,
            role,
            inviterName: inviter ? inviterDisplayName(inviter.name, inviter.email) : ctx.actorEmail,
            organizationName: organization ? organization.name : ctx.organizationId,
          });

          yield* logAudit({
            action: "invitation.create",
            resourceType: "invitation",
            resourceId: created.id,
            metadata: { email: created.email, role: created.role },
          });
          return toApiInvitation(created);
        }),
      ),
    )
    .handle("cancel", ({ path }) =>
      toApiReadEffect(
        Effect.gen(function* () {
          yield* assertAccess("invitation", "cancel");
          const ctx = yield* CurrentActor;
          const repo = yield* InvitationRepo;
          const canceled = yield* repo.cancel({
            id: path.id,
            organizationId: ctx.organizationId,
          });
          if (!canceled) {
            return yield* new NotFound({ message: "Invitation not found" });
          }
          // Grants die with their invitation (the better-auth cancel/reject
          // hooks cover the plugin routes; this covers the IAM endpoint).
          const grantRepo = yield* InvitationGrantRepo;
          yield* grantRepo.deleteForInvitation({ invitationId: path.id });
          yield* logAudit({
            action: "invitation.cancel",
            resourceType: "invitation",
            resourceId: path.id,
          });
          return { deleted: 1 };
        }),
      ),
    ),
);
