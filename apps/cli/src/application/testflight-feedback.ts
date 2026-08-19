/**
 * TestFlight **beta feedback** — the screenshot feedback and crash feedback
 * testers send from the TestFlight app (App Store Connect › TestFlight ›
 * Feedback). Backs `testflight feedback list`.
 *
 * Read over the PUBLIC ASC REST API (JWT auth, CI-safe) rather than the
 * apple-utils entity layer, following the `apple-sandbox` / `asc-build-upload`
 * idioms: `App.getBetaFeedback*Async` routes through `fetchAllModelsAsync` ->
 * `fetchAllPagesAsync()`, which walks EVERY `links.next` page, so a `--limit 5`
 * on a busy app would drain the whole collection (and apple-utils exports no
 * bounded client to page with). Here paging stops as soon as `limit` rows are
 * collected.
 *
 * Apple splits feedback into two sibling collections that share every attribute
 * but the attachment (`screenshots` vs. a crash log), so both are fetched
 * concurrently with the same filter and merged newest-first. Read-only: the API
 * has no reply endpoint. A crash submission's log text IS reachable
 * (`GET /v1/betaFeedbackCrashSubmissions/{id}/crashLog`, or apple-utils'
 * `BetaCrashLog.getCrashLogAsync`) at one request per row — deliberately not
 * fetched by a list command.
 */
import { toDbNull, toOptional } from "@better-update/type-guards";
import { Effect, Schema, SchemaGetter } from "effect";

import type AppleUtils from "@expo/apple-utils";

import { AppleConnectError, messageOf } from "../lib/apple-asc-connect";
import { formatAscErrors, parseAscErrors } from "../lib/asc-build-upload";
import { AppStoreError } from "../lib/exit-codes";

import type { FetchFn } from "../lib/asc-build-upload";

const ASC_BASE = "https://api.appstoreconnect.apple.com/v1";
/** ASC rejects `limit` above 200 on collection endpoints. */
const MAX_PAGE_SIZE = 200;
/**
 * Hard stop on `links.next` walks. Only reachable when a client-side filter
 * (`--device-model`) keeps discarding whole pages; the unfiltered path stops
 * after `ceil(limit / 200)` pages.
 */
const MAX_PAGES = 50;

/** Which of the two ASC feedback collections a submission came from. */
export type FeedbackKind = "screenshot" | "crash";

const COLLECTIONS: Readonly<Record<FeedbackKind, string>> = {
  screenshot: "betaFeedbackScreenshotSubmissions",
  crash: "betaFeedbackCrashSubmissions",
};

/** A screenshot attached to tester feedback; Apple's `url` expires at `expiresAt`. */
export interface FeedbackScreenshotView {
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly expiresAt: string;
}

/** The build a submission came from, resolved from the response's `included`. */
export interface FeedbackBuildView {
  readonly id: string;
  readonly version: string | null;
}

/** A feedback submission projected to the fields the CLI surfaces. */
export interface FeedbackView {
  readonly id: string;
  readonly kind: FeedbackKind;
  readonly createdDate: string;
  readonly comment: string | null;
  readonly email: string | null;
  readonly deviceModel: string;
  readonly deviceFamily: string;
  readonly osVersion: string;
  readonly appPlatform: string;
  readonly devicePlatform: string;
  readonly locale: string;
  readonly timeZone: string;
  readonly architecture: string;
  readonly connectionType: string;
  readonly batteryPercentage: number | null;
  readonly appUptimeInMilliseconds: number | null;
  readonly buildBundleId: string | null;
  /** Null when Apple returned no `build` relationship for the submission. */
  readonly build: FeedbackBuildView | null;
  /** Always empty for `crash` feedback — Apple attaches images to screenshot feedback only. */
  readonly screenshots: readonly FeedbackScreenshotView[];
}

// ── Response schemas ─────────────────────────────────────────────────────────

const ScreenshotImage = Schema.Struct({
  url: Schema.String.pipe(Schema.withDecodingDefaultType(Effect.succeed(""))),
  width: Schema.Number.pipe(Schema.withDecodingDefaultType(Effect.succeed(0))),
  height: Schema.Number.pipe(Schema.withDecodingDefaultType(Effect.succeed(0))),
  expirationDate: Schema.String.pipe(Schema.withDecodingDefaultType(Effect.succeed(""))),
});

/**
 * Decoded leniently — ASC omits null-valued attributes rather than sending them,
 * so every field carries its own default and the projection below reads them
 * straight through.
 */
// v4's decoding defaults only cover a MISSING key — v3's `nullable: true` option
// is gone — so an explicitly-null attribute is folded into the fallback by an
// extra decode step before the default applies.
const textAttribute = Schema.NullOr(Schema.String).pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transform((value: string | null) => (value === null ? "" : value)),
    encode: SchemaGetter.passthroughSubtype(),
  }),
  Schema.withDecodingDefaultType(Effect.succeed("")),
);
const nullableText = Schema.NullOr(Schema.String).pipe(
  Schema.withDecodingDefaultType(Effect.succeed(null)),
);
const nullableNumber = Schema.NullOr(Schema.Number).pipe(
  Schema.withDecodingDefaultType(Effect.succeed(null)),
);

const FeedbackAttributes = Schema.Struct({
  createdDate: textAttribute,
  comment: nullableText,
  email: nullableText,
  deviceModel: textAttribute,
  deviceFamily: textAttribute,
  osVersion: textAttribute,
  appPlatform: textAttribute,
  devicePlatform: textAttribute,
  locale: textAttribute,
  timeZone: textAttribute,
  architecture: textAttribute,
  connectionType: textAttribute,
  batteryPercentage: nullableNumber,
  appUptimeInMilliseconds: nullableNumber,
  buildBundleId: nullableText,
  screenshots: Schema.NullOr(Schema.Array(ScreenshotImage)).pipe(
    Schema.withDecodingDefaultType(Effect.succeed([])),
  ),
});

/** Stand-in for a resource that arrived without an `attributes` object at all. */
const EMPTY_ATTRIBUTES = Schema.decodeUnknownSync(FeedbackAttributes)({});

const Relationship = Schema.Struct({
  data: Schema.optional(Schema.NullOr(Schema.Struct({ id: Schema.String }))),
});

const FeedbackResource = Schema.Struct({
  id: Schema.String,
  attributes: Schema.optional(FeedbackAttributes),
  relationships: Schema.optional(Schema.Struct({ build: Schema.optional(Relationship) })),
});

const IncludedResource = Schema.Struct({
  type: Schema.optional(Schema.String),
  id: Schema.String,
  attributes: Schema.optional(
    Schema.Struct({ version: Schema.optional(Schema.NullOr(Schema.String)) }),
  ),
});

const FeedbackResponse = Schema.Struct({
  data: Schema.Array(FeedbackResource),
  included: Schema.optional(Schema.Array(IncludedResource)),
  links: Schema.optional(Schema.Struct({ next: Schema.optional(Schema.NullOr(Schema.String)) })),
});

const BuildLookupResponse = Schema.Struct({
  data: Schema.Array(Schema.Struct({ id: Schema.String })),
});

// ── Projection ───────────────────────────────────────────────────────────────

type FeedbackResourceType = (typeof FeedbackResponse.Type)["data"][number];
type IncludedResourceType = (typeof FeedbackResponse.Type)["included"];

const toScreenshots = (
  images: readonly (typeof ScreenshotImage.Type)[],
): readonly FeedbackScreenshotView[] =>
  images.map((image) => ({
    url: image.url,
    width: image.width,
    height: image.height,
    expiresAt: image.expirationDate,
  }));

/** Project one decoded resource; every attribute already carries a schema default. */
const toView = (
  kind: FeedbackKind,
  resource: FeedbackResourceType,
  builds: ReadonlyMap<string, string | null>,
): FeedbackView => {
  const attributes = resource.attributes ?? EMPTY_ATTRIBUTES;
  const buildId = resource.relationships?.build?.data?.id;
  return {
    ...attributes,
    id: resource.id,
    kind,
    build: buildId === undefined ? null : { id: buildId, version: toDbNull(builds.get(buildId)) },
    screenshots: kind === "crash" ? [] : toScreenshots(attributes.screenshots ?? []),
  };
};

/** Index the response's `included` builds by id so each row can name its build. */
const indexBuilds = (included: IncludedResourceType): ReadonlyMap<string, string | null> =>
  new Map(
    (included ?? [])
      .filter((entry) => entry.type === undefined || entry.type === "builds")
      .map((entry) => [entry.id, toDbNull(entry.attributes?.version)]),
  );

// ── Authenticated reads ──────────────────────────────────────────────────────

/**
 * Read the signed JWT off the session's `RequestContext`. Every `testflight` /
 * `app-store` leaf resolves a Token context, so the missing-token case is
 * defensive.
 */
const jwtOf = (
  ctx: AppleUtils.RequestContext,
  step: string,
): Effect.Effect<string, AppleConnectError> => {
  const { token } = ctx;
  if (token === undefined) {
    return Effect.fail(
      new AppleConnectError({
        step,
        message:
          "TestFlight feedback needs an App Store Connect API key (no signed-token session).",
      }),
    );
  }
  return typeof token === "string"
    ? Effect.succeed(token)
    : Effect.tryPromise({
        try: async () => token.getToken(),
        catch: (cause) => new AppleConnectError({ step, message: messageOf(cause) }),
      });
};

/** GET an ASC URL with the session's JWT and decode the body against `schema`. */
const getJson = <Decoded, Encoded>(params: {
  readonly ctx: AppleUtils.RequestContext;
  readonly fetchFn: FetchFn;
  readonly step: string;
  readonly url: string;
  readonly schema: Schema.Codec<Decoded, Encoded>;
}): Effect.Effect<Decoded, AppleConnectError> =>
  jwtOf(params.ctx, params.step).pipe(
    Effect.flatMap((jwt) =>
      Effect.tryPromise({
        try: async () => {
          const response = await params.fetchFn(params.url, {
            headers: { authorization: `Bearer ${jwt}` },
          });
          const text = await response.text();
          const body: unknown = text.length > 0 ? JSON.parse(text) : {};
          return { status: response.status, body };
        },
        catch: (cause) => new AppleConnectError({ step: params.step, message: messageOf(cause) }),
      }),
    ),
    Effect.flatMap(({ status, body }) => {
      if (status !== 200) {
        return Effect.fail(
          new AppleConnectError({
            step: params.step,
            message: `App Store Connect returned ${String(status)}: ${formatAscErrors(parseAscErrors(body))}`,
          }),
        );
      }
      const decoded = Schema.decodeUnknownOption(params.schema, { onExcessProperty: "ignore" })(
        body,
      );
      return decoded._tag === "Some"
        ? Effect.succeed(decoded.value)
        : Effect.fail(
            new AppleConnectError({
              step: params.step,
              message: "App Store Connect returned an unexpected response shape.",
            }),
          );
    }),
  );

const defaultFetch: FetchFn = async (input, init) => fetch(input, init);

// ── Build selector ───────────────────────────────────────────────────────────

export interface FeedbackBuildSelector {
  readonly buildId: string | undefined;
  readonly buildVersion: string | undefined;
  /** ASC `Platform` name (e.g. `IOS`); disambiguates a build number shared across platforms. */
  readonly platform: string | undefined;
}

/**
 * Resolve `--build` / `--build-version` to an ASC build id **owned by this app**.
 * Both paths query `/v1/builds` scoped by `filter[app]`, so a wrong or foreign
 * build id fails loudly instead of silently filtering the feedback list down to
 * nothing, and `--platform` disambiguates a build number that exists on more
 * than one platform.
 *
 * Deliberately not `app-store-versions`' `resolveBuildId`: that one is for
 * commands acting *on* a build, so it trusts `--build` unchecked, ignores
 * platform, and fails when no selector was given. Here the selector is an
 * optional filter (absent -> `undefined`, list everything) and a bad id must be
 * an error rather than an empty table.
 */
export const resolveFeedbackBuildId = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  selector: FeedbackBuildSelector,
  fetchFn: FetchFn = defaultFetch,
): Effect.Effect<string | undefined, AppleConnectError | AppStoreError> => {
  const { buildId, buildVersion } = selector;
  if (buildId === undefined && buildVersion === undefined) {
    return Effect.succeed(undefined);
  }
  const params = new URLSearchParams({ "filter[app]": appId, limit: "1" });
  if (buildId !== undefined) {
    params.set("filter[id]", buildId);
  } else if (buildVersion !== undefined) {
    params.set("filter[version]", buildVersion);
  }
  if (selector.platform !== undefined) {
    params.set("filter[preReleaseVersion.platform]", selector.platform);
  }
  return getJson({
    ctx,
    fetchFn,
    step: "apple-resolve-feedback-build",
    url: `${ASC_BASE}/builds?${params.toString()}`,
    schema: BuildLookupResponse,
  }).pipe(
    Effect.flatMap((response) => {
      const [match] = response.data;
      if (match !== undefined) {
        return Effect.succeed(match.id);
      }
      const platform = selector.platform === undefined ? "" : ` on platform ${selector.platform}`;
      return Effect.fail(
        new AppStoreError({
          message:
            buildId === undefined
              ? `No uploaded build with version ${String(buildVersion)} found for this app${platform}.`
              : `Build ${buildId} does not belong to this app${platform}.`,
        }),
      );
    }),
  );
};

// ── Listing ──────────────────────────────────────────────────────────────────

export interface ListFeedbackInput {
  /** Which collections to read. */
  readonly kinds: readonly FeedbackKind[];
  /** Already resolved + validated by {@link resolveFeedbackBuildId}. */
  readonly buildId: string | undefined;
  readonly deviceModel: string | undefined;
  readonly osVersion: string | undefined;
  /** ASC `Platform` name (e.g. `IOS`). */
  readonly platform: string | undefined;
  readonly testerId: string | undefined;
  readonly limit: number;
  /** Injectable for tests; defaults to global fetch. */
  readonly fetchFn?: FetchFn;
}

const firstPageUrl = (appId: string, kind: FeedbackKind, input: ListFeedbackInput): string => {
  const params = new URLSearchParams({
    limit: String(Math.min(input.limit, MAX_PAGE_SIZE)),
    sort: "-createdDate",
    include: "build",
  });
  if (input.buildId !== undefined) {
    params.set("filter[build]", input.buildId);
  }
  if (input.osVersion !== undefined) {
    params.set("filter[osVersion]", input.osVersion);
  }
  if (input.platform !== undefined) {
    params.set("filter[appPlatform]", input.platform);
  }
  if (input.testerId !== undefined) {
    params.set("filter[tester]", input.testerId);
  }
  // `--device-model` is matched client-side on purpose: ASC treats a comma in a
  // filter value as the multi-value OR separator, and every device model
  // identifier contains one (`iPhone14,2` would ask for "iPhone14" OR "2").
  return `${ASC_BASE}/apps/${appId}/${COLLECTIONS[kind]}?${params.toString()}`;
};

/** Newest-first ordering by parsed instant; unparseable dates sort last. */
const byNewest = (left: FeedbackView, right: FeedbackView): number => {
  const leftTime = Date.parse(left.createdDate);
  const rightTime = Date.parse(right.createdDate);
  if (Number.isNaN(leftTime)) {
    return Number.isNaN(rightTime) ? 0 : 1;
  }
  return Number.isNaN(rightTime) ? -1 : rightTime - leftTime;
};

/**
 * Walk one collection's pages until `limit` matching rows are collected, the
 * `links.next` chain ends, or {@link MAX_PAGES} is hit.
 */
const listCollection = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  kind: FeedbackKind,
  input: ListFeedbackInput,
  fetchFn: FetchFn,
): Effect.Effect<readonly FeedbackView[], AppleConnectError> => {
  const wanted = input.deviceModel?.trim().toLowerCase();
  const matches = (view: FeedbackView): boolean =>
    wanted === undefined || view.deviceModel.toLowerCase() === wanted;
  const step = `apple-list-beta-feedback-${kind}`;
  const drain = (
    url: string,
    accumulated: readonly FeedbackView[],
    page: number,
  ): Effect.Effect<readonly FeedbackView[], AppleConnectError> =>
    getJson({ ctx, fetchFn, step, url, schema: FeedbackResponse }).pipe(
      Effect.flatMap((response) => {
        const builds = indexBuilds(response.included);
        const next = [
          ...accumulated,
          ...response.data.map((resource) => toView(kind, resource, builds)).filter(matches),
        ];
        const nextUrl = toOptional(response.links?.next);
        return next.length >= input.limit || nextUrl === undefined || page >= MAX_PAGES
          ? Effect.succeed(next.slice(0, input.limit))
          : drain(nextUrl, next, page + 1);
      }),
    );
  return drain(firstPageUrl(appId, kind, input), [], 1);
};

/**
 * List an app's TestFlight feedback, newest first. The two collections are read
 * concurrently and merged; `limit` caps both the per-collection walk and the
 * merged result.
 */
export const listFeedback = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  input: ListFeedbackInput,
): Effect.Effect<readonly FeedbackView[], AppleConnectError> =>
  Effect.all(
    input.kinds.map((kind) =>
      listCollection(ctx, appId, kind, input, input.fetchFn ?? defaultFetch),
    ),
    { concurrency: 2 },
  ).pipe(Effect.map((pages) => pages.flat().toSorted(byNewest).slice(0, input.limit)));
