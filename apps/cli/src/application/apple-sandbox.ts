/**
 * App Store **sandbox testers** (IAP testing accounts). Backs
 * `apple sandbox list/create/delete`.
 *
 * **List** prefers the PUBLIC ASC REST API (`GET /v2/sandboxTesters`, JWT auth,
 * CI-safe) — apple-utils 2.1.22 has no model for the v2 resource, so it is a
 * small raw read here ({@link listSandboxTestersV2}) following the
 * `asc-build-upload` idioms — with the cookie (Apple ID) path as fallback.
 * **Create/delete** stay cookie-only: the public API exposes no
 * create/delete for sandbox testers (spec 4.4.1 has only GET + PATCH on `/v2`),
 * so those go through the apple-utils `SandboxTester` model (Iris v1).
 */
import { compact, toDbNull, toOptional } from "@better-update/type-guards";
import AppleUtils from "@expo/apple-utils";
import { Effect, Schema } from "effect";

import { AppleConnectError, messageOf, wrapConnect } from "../lib/apple-asc-connect";
import { formatAscErrors, parseAscErrors } from "../lib/asc-build-upload";

import type { FetchFn } from "../lib/asc-build-upload";
import type { AscCredentials } from "../lib/asc-credentials";

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

/** List the team's sandbox testers over the cookie (Apple ID) session. */
export const listSandboxTesters = (ctx: AppleUtils.RequestContext) =>
  wrapConnect("apple-list-sandbox-testers", async () =>
    AppleUtils.SandboxTester.getAsync(ctx),
  ).pipe(Effect.map((testers) => testers.map(toView)));

// ── Public-API list (`GET /v2/sandboxTesters`, JWT auth) ─────────────────────

const V2_STEP = "apple-list-sandbox-testers-v2";
const SANDBOX_TESTERS_V2_URL = "https://api.appstoreconnect.apple.com/v2/sandboxTesters?limit=200";
const MAX_V2_PAGES = 100;

/**
 * SandboxTesterV2 attributes (spec 4.4.1), decoded leniently — absent fields
 * default at the schema so both auth paths render the same empty values.
 */
const SandboxTesterV2Attributes = Schema.Struct({
  firstName: Schema.optionalWith(Schema.String, { default: () => "" }),
  lastName: Schema.optionalWith(Schema.String, { default: () => "" }),
  /** The tester's Apple Account email — the v2 name for v1's `email`. */
  acAccountName: Schema.optionalWith(Schema.String, { default: () => "" }),
  territory: Schema.optional(Schema.NullOr(Schema.String)),
  applePayCompatible: Schema.optionalWith(Schema.Boolean, { default: () => false }),
});

const EMPTY_V2_ATTRIBUTES: typeof SandboxTesterV2Attributes.Type = {
  firstName: "",
  lastName: "",
  acAccountName: "",
  territory: null,
  applePayCompatible: false,
};

const SandboxTestersV2Response = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      attributes: Schema.optionalWith(SandboxTesterV2Attributes, {
        default: () => EMPTY_V2_ATTRIBUTES,
      }),
    }),
  ),
  links: Schema.optional(Schema.Struct({ next: Schema.optional(Schema.NullOr(Schema.String)) })),
});

type SandboxTesterV2Resource = (typeof SandboxTestersV2Response.Type)["data"][number];

/**
 * Project a v2 resource onto the same {@link SandboxTesterView} the cookie path
 * produces, so both auth paths keep one output/JSON contract. Every v1 field has
 * a v2 counterpart (`email` ← `acAccountName`); absent attributes render empty.
 */
export const toViewFromV2 = (resource: SandboxTesterV2Resource): SandboxTesterView => ({
  id: resource.id,
  email: resource.attributes.acAccountName,
  firstName: resource.attributes.firstName,
  lastName: resource.attributes.lastName,
  territory: toDbNull(resource.attributes.territory),
  applePayCompatible: resource.attributes.applePayCompatible,
});

/** One decoded page of `GET /v2/sandboxTesters`: mapped views + the next-page URL. */
export interface SandboxTestersV2Page {
  readonly testers: readonly SandboxTesterView[];
  readonly nextUrl: string | undefined;
}

/** Decode one v2 response body, ignoring the fields the CLI does not surface. */
export const decodeSandboxTestersV2Page = (
  body: unknown,
): Effect.Effect<SandboxTestersV2Page, AppleConnectError> => {
  const decoded = Schema.decodeUnknownOption(SandboxTestersV2Response, {
    onExcessProperty: "ignore",
  })(body);
  return decoded._tag === "Some"
    ? Effect.succeed({
        testers: decoded.value.data.map(toViewFromV2),
        nextUrl: toOptional(decoded.value.links?.next),
      })
    : Effect.fail(
        new AppleConnectError({
          step: V2_STEP,
          message: "GET /v2/sandboxTesters returned an unexpected response shape.",
        }),
      );
};

/**
 * List sandbox testers over the public ASC REST API. Pages via `links.next`
 * (`limit=200`, the spec max) until exhausted. Fails with
 * {@link AppleConnectError} on any HTTP/decode error so the caller can fall
 * back to the cookie path.
 */
export const listSandboxTestersV2 = (params: {
  readonly credentials: AscCredentials;
  /** Injectable for tests; defaults to global fetch. */
  readonly fetchFn?: FetchFn;
}): Effect.Effect<readonly SandboxTesterView[], AppleConnectError> => {
  const fetchFn: FetchFn = params.fetchFn ?? (async (input, init) => fetch(input, init));
  const token = new AppleUtils.Token({
    key: params.credentials.p8Pem,
    keyId: params.credentials.keyId,
    issuerId: params.credentials.issuerId,
  });
  const getPage = (url: string) =>
    Effect.tryPromise({
      try: async () => {
        const jwt = await token.getToken();
        const response = await fetchFn(url, { headers: { authorization: `Bearer ${jwt}` } });
        const text = await response.text();
        const body: unknown = text.length > 0 ? JSON.parse(text) : {};
        return { status: response.status, body };
      },
      catch: (cause) => new AppleConnectError({ step: V2_STEP, message: messageOf(cause) }),
    }).pipe(
      Effect.flatMap(({ status, body }) =>
        status === 200
          ? decodeSandboxTestersV2Page(body)
          : Effect.fail(
              new AppleConnectError({
                step: V2_STEP,
                message: `GET /v2/sandboxTesters returned ${String(status)}: ${formatAscErrors(parseAscErrors(body))}`,
              }),
            ),
      ),
    );
  const drain = (
    accumulator: readonly SandboxTesterView[],
    url: string,
    page: number,
  ): Effect.Effect<readonly SandboxTesterView[], AppleConnectError> =>
    getPage(url).pipe(
      Effect.flatMap(({ testers, nextUrl }) => {
        const next = [...accumulator, ...testers];
        return nextUrl === undefined || page >= MAX_V2_PAGES
          ? Effect.succeed(next)
          : drain(next, nextUrl, page + 1);
      }),
    );
  return drain([], SANDBOX_TESTERS_V2_URL, 1);
};

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
