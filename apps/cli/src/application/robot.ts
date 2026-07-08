import { generateIdentity } from "@better-update/credentials-crypto";
import { compact } from "@better-update/type-guards";
import { Effect } from "effect";

import type { CreatedRobotAccount } from "@better-update/api";

import type { ProjectRole } from "../lib/project-roles";
import type { ApiClient } from "../services/api-client";

/** A freshly minted robot account: the project-scoped identity a CI runner acts as. */
export interface CreatedRobot {
  readonly account: CreatedRobotAccount;
  readonly bearerSecret: string;
  /** The age private key — never stored, printed once for BETTER_UPDATE_ROBOT. */
  readonly identityPrivateKey: string;
}

/** RBAC fixed at mint time (§1b): one robot = one project + one project role. */
export interface CreateRobotOptions {
  readonly projectId: string;
  readonly role: ProjectRole;
}

/**
 * Mint a robot account from a Maintainer's device: generate an age keypair here
 * (so the private key is org-owned and portable, not tied to a runner) and
 * register both its public half and a bearer secret in one call. Granting vault
 * access is a separate step (see `credentials/robot.ts`), so a fresh org whose
 * vault isn't set up yet can still mint the robot first.
 */
export const createRobotAccount = (api: ApiClient, name: string, options: CreateRobotOptions) =>
  Effect.gen(function* () {
    const identity = yield* Effect.promise(async () => generateIdentity());
    const created = yield* api["robot-accounts"].create({
      payload: {
        name,
        publicKey: identity.publicKey,
        fingerprint: identity.fingerprint,
        projectId: options.projectId,
        role: options.role,
      },
    });
    return {
      account: created,
      bearerSecret: created.bearerSecret,
      identityPrivateKey: identity.privateKey,
    } satisfies CreatedRobot;
  });

/**
 * Re-mint a robot account's bearer secret only — any linked vault identity is
 * left untouched. Used to rotate a compromised bearer.
 */
export const rotateRobotAccountBearer = (api: ApiClient, id: string) =>
  api["robot-accounts"].rotate({ path: { id } });

/** In-place robot changes: rename and/or a new project role (never the project). */
export interface UpdateRobotOptions {
  readonly name?: string | undefined;
  readonly role?: ProjectRole | undefined;
}

/**
 * Rename a robot and/or change its project role in place — the project itself
 * is fixed at mint. Server-side the change is audit-logged and a rename also
 * relabels the linked vault identity.
 */
export const updateRobotAccount = (api: ApiClient, id: string, options: UpdateRobotOptions) =>
  api["robot-accounts"].update({
    path: { id },
    payload: compact({ name: options.name, role: options.role }),
  });
