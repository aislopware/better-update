/**
 * Byte-progress reporting for long uploads (the `.ipa` → App Store Connect
 * Build Upload API). Three render modes, picked once at construction:
 *
 * - JSON mode: silent — the stdout stream stays machine-parseable.
 * - Interactive TTY (no log prefix): a live clack progress bar (via the
 *   `lib/prompts` re-export, the single allowed prompt-library importer).
 * - Everything else (CI, piped output, `[ios]`-prefixed parallel builds): one
 *   `printHuman` line per 10% step, so logs show progress without redraws.
 */
import { Effect, Ref } from "effect";

import { InteractiveMode } from "./interactive-mode";
import { currentLogPrefix } from "./log-prefix";
import { printHuman } from "./output";
import { OutputMode } from "./output-mode";
import { clackProgress } from "./prompts";

export interface UploadProgressReporter {
  readonly start: (totalBytes: number) => Effect.Effect<void>;
  readonly advance: (deltaBytes: number) => Effect.Effect<void>;
  /** Stop reporting with a success line (TTY mode renders it on the bar). */
  readonly finish: (message: string) => Effect.Effect<void>;
  /** Stop reporting with a failure line so an aborted bar never lingers. */
  readonly fail: (message: string) => Effect.Effect<void>;
}

const LINE_MODE_STEP_PERCENT = 10;

const megabytes = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(1);

/** Percent complete, clamped to [0, 100] against a possibly-zero total. */
export const percentOf = (uploadedBytes: number, totalBytes: number): number =>
  totalBytes <= 0 ? 100 : Math.min(100, Math.floor((uploadedBytes / totalBytes) * 100));

export const formatUploadProgressLine = (
  label: string,
  uploadedBytes: number,
  totalBytes: number,
): string =>
  `${label} ${String(percentOf(uploadedBytes, totalBytes))}% (${megabytes(uploadedBytes)} / ${megabytes(totalBytes)} MB)`;

const noopReporter: UploadProgressReporter = {
  start: () => Effect.void,
  advance: () => Effect.void,
  finish: () => Effect.void,
  fail: () => Effect.void,
};

interface ByteCounter {
  readonly uploaded: number;
  readonly total: number;
}

const makeTtyReporter = (label: string): Effect.Effect<UploadProgressReporter> =>
  Effect.gen(function* () {
    const counter = yield* Ref.make<ByteCounter>({ uploaded: 0, total: 0 });
    // The bar is created lazily in `start` so a reporter that never starts
    // (e.g. duplicate build short-circuits the upload) draws nothing.
    const bar = yield* Ref.make<ReturnType<typeof clackProgress> | null>(null);
    const stopWith = (message: string, failed: boolean) =>
      Effect.gen(function* () {
        const active = yield* Ref.getAndSet(bar, null);
        if (active === null) {
          return;
        }
        yield* Effect.sync(() => {
          if (failed) {
            active.error(message);
          } else {
            active.stop(message);
          }
        });
      });
    return {
      start: (totalBytes) =>
        Effect.gen(function* () {
          yield* Ref.set(counter, { uploaded: 0, total: totalBytes });
          const created = clackProgress({ max: Math.max(1, totalBytes), size: 30 });
          yield* Ref.set(bar, created);
          yield* Effect.sync(() => {
            created.start(formatUploadProgressLine(label, 0, totalBytes));
          });
        }),
      advance: (deltaBytes) =>
        Effect.gen(function* () {
          const next = yield* Ref.updateAndGet(counter, (state) => ({
            uploaded: state.uploaded + deltaBytes,
            total: state.total,
          }));
          const active = yield* Ref.get(bar);
          if (active === null) {
            return;
          }
          yield* Effect.sync(() => {
            active.advance(deltaBytes, formatUploadProgressLine(label, next.uploaded, next.total));
          });
        }),
      finish: (message) => stopWith(message, false),
      fail: (message) => stopWith(message, true),
    } satisfies UploadProgressReporter;
  });

const makeLineReporter = (
  label: string,
): Effect.Effect<UploadProgressReporter, never, OutputMode> =>
  Effect.gen(function* () {
    const mode = yield* OutputMode;
    const counter = yield* Ref.make<ByteCounter>({ uploaded: 0, total: 0 });
    const lastStep = yield* Ref.make(0);
    const provideMode = <Value, Err>(self: Effect.Effect<Value, Err, OutputMode>) =>
      Effect.provideService(self, OutputMode, mode);
    return {
      start: (totalBytes) =>
        Ref.set(counter, { uploaded: 0, total: totalBytes }).pipe(
          Effect.zipRight(Ref.set(lastStep, 0)),
          Effect.zipRight(provideMode(printHuman(formatUploadProgressLine(label, 0, totalBytes)))),
        ),
      advance: (deltaBytes) =>
        Effect.gen(function* () {
          const next = yield* Ref.updateAndGet(counter, (state) => ({
            uploaded: state.uploaded + deltaBytes,
            total: state.total,
          }));
          const step =
            Math.floor(percentOf(next.uploaded, next.total) / LINE_MODE_STEP_PERCENT) *
            LINE_MODE_STEP_PERCENT;
          const previous = yield* Ref.getAndSet(lastStep, step);
          if (step > previous) {
            yield* provideMode(
              printHuman(formatUploadProgressLine(label, next.uploaded, next.total)),
            );
          }
        }),
      finish: (message) => provideMode(printHuman(message)),
      fail: (message) => provideMode(printHuman(message)),
    } satisfies UploadProgressReporter;
  });

/**
 * Build the reporter for the current output context. The mode is resolved once
 * here so the upload loop can report progress without re-checking terminal
 * state on every chunk.
 */
export const makeUploadProgressReporter = (
  label: string,
): Effect.Effect<UploadProgressReporter, never, OutputMode | InteractiveMode> =>
  Effect.gen(function* () {
    const output = yield* OutputMode;
    if (output.json) {
      return noopReporter;
    }
    const interactive = yield* InteractiveMode;
    const prefix = yield* currentLogPrefix;
    const useTtyBar = interactive.allow && prefix === undefined && process.stdout.isTTY;
    return useTtyBar ? yield* makeTtyReporter(label) : yield* makeLineReporter(label);
  });
