/**
 * Pure parsing half of the App Store Connect Build Upload API client: response
 * schemas, error classification (duplicate-build 409, processing-failure state
 * codes), and chunk-PUT header assembly. No I/O — the flow lives in
 * `asc-build-upload.ts`.
 */
import { Data, Effect, Schema } from "effect";

export class AscBuildUploadError extends Data.TaggedError("AscBuildUploadError")<{
  readonly code: string;
  readonly message: string;
}> {}

/** Reserve-phase failure before any bytes moved — safe to fall back to altool. */
export class AscBuildUploadUnavailableError extends Data.TaggedError(
  "AscBuildUploadUnavailableError",
)<{
  readonly message: string;
}> {}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

// ── ASC error bodies ─────────────────────────────────────────────────────────

const AscErrorItem = Schema.Struct({
  status: Schema.optional(Schema.String),
  code: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  detail: Schema.optional(Schema.String),
});

const AscErrorResponse = Schema.Struct({
  errors: Schema.optional(Schema.Array(AscErrorItem)),
});

export type AscErrorList = readonly (typeof AscErrorItem.Type)[];

/** Pull the `errors` array out of an ASC error body; empty when unparseable. */
export const parseAscErrors = (body: unknown): AscErrorList => {
  const decoded = Schema.decodeUnknownOption(AscErrorResponse, { onExcessProperty: "ignore" })(
    body,
  );
  return decoded._tag === "Some" ? (decoded.value.errors ?? []) : [];
};

const DUPLICATE_CODE = "ENTITY_ERROR.ATTRIBUTE.INVALID.DUPLICATE";

/** True when a reserve 409 means "this exact build number is already uploaded". */
export const isDuplicateBuildUploadConflict = (status: number, errors: AscErrorList): boolean =>
  status === 409 && errors.length > 0 && errors.every((error) => error.code === DUPLICATE_CODE);

export const formatAscErrors = (errors: AscErrorList): string =>
  errors.map((error) => error.detail ?? error.title ?? error.code ?? "unknown error").join("; ") ||
  "no error detail";

// ── Processing/delivery state ────────────────────────────────────────────────

const StateDetail = Schema.Struct({
  code: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
});

type StateDetails = readonly (typeof StateDetail.Type)[];

/** Known buildUpload processing-failure codes, translated to actionable text. */
const KNOWN_STATE_CODES: Readonly<Record<string, string>> = {
  "90062": "the version train for this build number is closed",
  "90186": "the version train for this build number is closed",
  "90478": "the version train for this build number is closed",
  "90725": "the build was made with an SDK that is too old for App Store Connect",
  "90054": "the IPA's bundle identifier does not match the App Store Connect app",
  "90055": "the IPA's bundle identifier does not match the App Store Connect app",
  "90683": "the IPA is missing required privacy purpose strings (Info.plist NS*UsageDescription)",
};

export const explainBuildUploadFailure = (details: StateDetails): string =>
  details
    .map((detail) => {
      const known = detail.code === undefined ? undefined : KNOWN_STATE_CODES[detail.code];
      const description = detail.description ?? detail.code ?? "unknown failure";
      return known === undefined ? description : `${description} (${known})`;
    })
    .join("; ") || "App Store Connect reported no failure detail";

/** Delivery states that mean the file needs no further waiting. */
export const isDeliveredFileState = (state: string | undefined): boolean =>
  state === "COMPLETE" || state === "UPLOAD_COMPLETE";

// ── Resources ────────────────────────────────────────────────────────────────

const HttpHeaderSchema = Schema.Struct({ name: Schema.String, value: Schema.String });

const UploadOperationSchema = Schema.Struct({
  method: Schema.String,
  url: Schema.String,
  offset: Schema.Number,
  length: Schema.Number,
  requestHeaders: Schema.optional(Schema.Array(HttpHeaderSchema)),
});

export type AscUploadOperation = typeof UploadOperationSchema.Type;

/**
 * Headers for one presigned chunk PUT: a safe default Content-Type, overridden
 * by whatever Apple's operation dictates (its headers must be replayed verbatim).
 */
export const chunkRequestHeaders = (operation: AscUploadOperation): Record<string, string> => ({
  "content-type": "application/octet-stream",
  ...Object.fromEntries(
    (operation.requestHeaders ?? []).map((header) => [header.name.toLowerCase(), header.value]),
  ),
});

const AssetDeliveryState = Schema.Struct({
  state: Schema.optional(Schema.String),
  errors: Schema.optional(Schema.Array(StateDetail)),
});

const BuildUploadState = Schema.Struct({
  state: Schema.optional(Schema.String),
  errors: Schema.optional(Schema.Array(StateDetail)),
});

export const BuildUploadResource = Schema.Struct({
  data: Schema.Struct({
    id: Schema.String,
    attributes: Schema.optional(
      Schema.Struct({
        state: Schema.optional(BuildUploadState),
      }),
    ),
  }),
});

export const BuildUploadFileResource = Schema.Struct({
  data: Schema.Struct({
    id: Schema.String,
    attributes: Schema.optional(
      Schema.Struct({
        uploadOperations: Schema.optional(Schema.NullOr(Schema.Array(UploadOperationSchema))),
        assetDeliveryState: Schema.optional(Schema.NullOr(AssetDeliveryState)),
      }),
    ),
  }),
});

/** Decode a response body against `schema`, failing as a bad-response error. */
export const decodeOr = <Decoded, Encoded>(
  schema: Schema.Schema<Decoded, Encoded>,
  body: unknown,
  step: string,
): Effect.Effect<Decoded, AscBuildUploadError> => {
  const decoded = Schema.decodeUnknownOption(schema, { onExcessProperty: "ignore" })(body);
  return decoded._tag === "Some"
    ? Effect.succeed(decoded.value)
    : Effect.fail(
        new AscBuildUploadError({
          code: "ASC_BUILD_UPLOAD_BAD_RESPONSE",
          message: `${step} returned an unexpected response shape.`,
        }),
      );
};
