import { Duration, Effect } from "effect";

/**
 * HTTP half of the Build Upload API client: the authenticated JSON request and
 * the two delivery-state polls (file-level `assetDeliveryState`, then a short
 * fast-fail watch of the buildUpload's processing `state`). The upload flow in
 * `asc-build-upload.ts` composes these; parsing lives in
 * `asc-build-upload-parse.ts`.
 */
import type AppleUtils from "@expo/apple-utils";

import {
  AscBuildUploadError,
  BuildUploadFileResource,
  BuildUploadResource,
  decodeOr,
  explainBuildUploadFailure,
  isDeliveredFileState,
} from "./asc-build-upload-parse";
import { printHuman } from "./output";

import type { FetchFn } from "./asc-build-upload-parse";
import type { OutputMode } from "./output-mode";

const ASC_API_BASE = "https://api.appstoreconnect.apple.com/v1";
const FILE_POLL_INTERVAL_MS = 2000;
const FILE_POLL_TIMEOUT_MS = 60_000;
const BUILD_POLL_INTERVAL_MS = 5000;
/** Short fast-fail window only: Apple keeps processing after we return, and the
 * TestFlight config step (when requested) does the long wait. */
const BUILD_POLL_TIMEOUT_MS = 90_000;

// ── Authenticated JSON requests ──────────────────────────────────────────────

export interface AscJsonResponse {
  readonly status: number;
  readonly body: unknown;
}

export const requestJson = (params: {
  readonly token: AppleUtils.Token;
  readonly fetchFn: FetchFn;
  readonly method: "GET" | "POST" | "PATCH";
  readonly path: string;
  readonly body?: unknown;
  readonly step: string;
}): Effect.Effect<AscJsonResponse, AscBuildUploadError> =>
  Effect.tryPromise({
    try: async () => {
      const jwt = await params.token.getToken();
      const response = await params.fetchFn(`${ASC_API_BASE}${params.path}`, {
        method: params.method,
        headers: {
          authorization: `Bearer ${jwt}`,
          "content-type": "application/json",
        },
        ...(params.body === undefined ? {} : { body: JSON.stringify(params.body) }),
      });
      const text = await response.text();
      const body: unknown = text.length > 0 ? JSON.parse(text) : {};
      return { status: response.status, body };
    },
    catch: (cause) =>
      new AscBuildUploadError({
        code: "ASC_BUILD_UPLOAD_REQUEST_FAILED",
        message: `${params.step} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });

export const pollFileDelivery = (params: {
  readonly token: AppleUtils.Token;
  readonly fetchFn: FetchFn;
  readonly fileId: string;
}) =>
  Effect.gen(function* () {
    const deadline = Date.now() + FILE_POLL_TIMEOUT_MS;
    yield* Effect.iterate(
      { done: false, attempt: 0 },
      {
        while: (state) => !state.done,
        body: (state) =>
          Effect.gen(function* () {
            if (state.attempt > 0) {
              yield* Effect.sleep(Duration.millis(FILE_POLL_INTERVAL_MS));
            }
            // The bytes are already delivered — a transient network/proxy blip
            // (or an HTML error body) must not fail the submit. Keep polling
            // until the deadline instead.
            const polled = yield* Effect.either(
              requestJson({
                token: params.token,
                fetchFn: params.fetchFn,
                method: "GET",
                path: `/buildUploadFiles/${params.fileId}?fields[buildUploadFiles]=assetDeliveryState`,
                step: "Build upload file poll",
              }).pipe(
                Effect.flatMap((response) =>
                  decodeOr(BuildUploadFileResource, response.body, "Build upload file poll"),
                ),
              ),
            );
            if (polled._tag === "Left") {
              if (Date.now() > deadline) {
                return yield* new AscBuildUploadError({
                  code: "ASC_BUILD_UPLOAD_DELIVERY_TIMEOUT",
                  message: `Timed out waiting for App Store Connect to acknowledge the uploaded file (${polled.left.message}).`,
                });
              }
              return { done: false, attempt: state.attempt + 1 };
            }
            const delivery = polled.right.data.attributes?.assetDeliveryState;
            const deliveryState = delivery === null ? undefined : delivery?.state;
            if (deliveryState === "FAILED") {
              return yield* new AscBuildUploadError({
                code: "ASC_BUILD_UPLOAD_DELIVERY_FAILED",
                message: `App Store Connect rejected the uploaded file: ${explainBuildUploadFailure((delivery === null ? undefined : delivery?.errors) ?? [])}`,
              });
            }
            if (isDeliveredFileState(deliveryState)) {
              return { done: true, attempt: state.attempt + 1 };
            }
            if (Date.now() > deadline) {
              return yield* new AscBuildUploadError({
                code: "ASC_BUILD_UPLOAD_DELIVERY_TIMEOUT",
                message:
                  "Timed out waiting for App Store Connect to acknowledge the uploaded file.",
              });
            }
            return { done: false, attempt: state.attempt + 1 };
          }),
      },
    );
  });

/**
 * Briefly watch the buildUpload's processing state to fast-fail obvious
 * rejects (closed version train, too-old SDK…). Still-processing after the
 * window is success — Apple keeps working and the TestFlight config step (when
 * requested) does the long wait, exactly like the altool path.
 */
export const pollBuildUploadState = (params: {
  readonly token: AppleUtils.Token;
  readonly fetchFn: FetchFn;
  readonly buildUploadId: string;
}): Effect.Effect<void, AscBuildUploadError, OutputMode> =>
  Effect.gen(function* () {
    const deadline = Date.now() + BUILD_POLL_TIMEOUT_MS;
    yield* Effect.iterate(
      { done: false, attempt: 0 },
      {
        while: (state) => !state.done,
        body: (state) =>
          Effect.gen(function* () {
            if (state.attempt > 0) {
              yield* Effect.sleep(Duration.millis(BUILD_POLL_INTERVAL_MS));
            }
            // This watch is best-effort fast-fail only — a transient request
            // failure just keeps polling until the benign deadline branch.
            const polled = yield* Effect.either(
              requestJson({
                token: params.token,
                fetchFn: params.fetchFn,
                method: "GET",
                path: `/buildUploads/${params.buildUploadId}?fields[buildUploads]=state`,
                step: "Build upload state poll",
              }).pipe(
                Effect.flatMap((response) =>
                  decodeOr(BuildUploadResource, response.body, "Build upload state poll"),
                ),
              ),
            );
            if (polled._tag === "Left" && Date.now() <= deadline) {
              return { done: false, attempt: state.attempt + 1 };
            }
            const uploadState =
              polled._tag === "Left" ? undefined : polled.right.data.attributes?.state;
            if (uploadState?.state === "FAILED") {
              return yield* new AscBuildUploadError({
                code: "ASC_BUILD_UPLOAD_PROCESSING_FAILED",
                message: `App Store Connect rejected the build: ${explainBuildUploadFailure(uploadState.errors ?? [])}`,
              });
            }
            if (uploadState?.state === "COMPLETE") {
              return { done: true, attempt: state.attempt + 1 };
            }
            if (Date.now() > deadline) {
              yield* printHuman(
                "App Store Connect is still processing the build (this can take a while; failures are also emailed by Apple).",
              );
              return { done: true, attempt: state.attempt + 1 };
            }
            return { done: false, attempt: state.attempt + 1 };
          }),
      },
    );
  });
