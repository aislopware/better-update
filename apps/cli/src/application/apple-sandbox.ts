/**
 * App Store **sandbox testers** (IAP testing accounts) on the `@expo/apple-utils`
 * entity layer. Backs `apple sandbox list/create/delete`. Realistically
 * **cookie-only**: the public ASC REST host 404s these (Apple serves them under
 * `/v2`), so the commands take an Apple ID session and degrade in CI. The only
 * writable IAP model in apple-utils.
 */
import { compact, toDbNull } from "@better-update/type-guards";
import AppleUtils from "@expo/apple-utils";
import { Effect } from "effect";

import { wrapConnect } from "../lib/apple-asc-connect";

/** A sandbox tester projected to the (non-secret) fields the CLI surfaces. */
export interface SandboxTesterView {
  readonly id: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly territory: string | null;
  readonly applePayCompatible: boolean;
}

const toView = (tester: AppleUtils.SandboxTester): SandboxTesterView => ({
  id: tester.id,
  email: tester.attributes.email,
  firstName: tester.attributes.firstName,
  lastName: tester.attributes.lastName,
  territory: toDbNull(tester.attributes.appStoreTerritory?.id),
  applePayCompatible: tester.attributes.applePayCompatible,
});

/** List the team's sandbox testers. */
export const listSandboxTesters = (ctx: AppleUtils.RequestContext) =>
  wrapConnect("apple-list-sandbox-testers", async () =>
    AppleUtils.SandboxTester.getAsync(ctx),
  ).pipe(Effect.map((testers) => testers.map(toView)));

export interface CreateSandboxTesterInput {
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly password: string;
  readonly secretQuestion?: string;
  readonly secretAnswer?: string;
  /** Birth date, YYYY-MM-DD. */
  readonly birthDate?: string;
}

/** Create a sandbox tester. `confirmPassword` is mirrored from `password` automatically. */
export const createSandboxTester = (
  ctx: AppleUtils.RequestContext,
  input: CreateSandboxTesterInput,
) =>
  wrapConnect("apple-create-sandbox-tester", async () =>
    AppleUtils.SandboxTester.createAsync(ctx, {
      attributes: compact({
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        password: input.password,
        confirmPassword: input.password,
        secretQuestion: input.secretQuestion,
        secretAnswer: input.secretAnswer,
        birthDate: input.birthDate,
      }),
    }),
  ).pipe(Effect.map(toView));

/** Delete a sandbox tester by id. */
export const deleteSandboxTester = (ctx: AppleUtils.RequestContext, id: string) =>
  wrapConnect("apple-delete-sandbox-tester", async () =>
    AppleUtils.SandboxTester.deleteAsync(ctx, { id }),
  );
