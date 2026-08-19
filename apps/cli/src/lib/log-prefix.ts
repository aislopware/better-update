import chalk from "chalk";
import { Context, Effect } from "effect";

import type { Platform } from "./build-profile";

/**
 * Fiber-scoped output prefix. Unset for normal single-platform runs; when
 * `build --platform all` runs both platform builds in parallel, each build
 * fiber carries its own `[ios]` / `[android]` tag so interleaved lines stay
 * attributable to their build.
 *
 * v4 replaced `FiberRef` with `Context.Reference`: a service key carrying a lazy
 * default, read like any other service and overridden per-scope with
 * `Effect.provideService` instead of `Effect.locally`. Context lookup is by key
 * STRING, so the old `GlobalValue` memo around the ref is no longer needed.
 */
const LogPrefix = Context.Reference<string | undefined>("better-update/cli/log-prefix", {
  defaultValue: () => undefined,
});

/** Read the current fiber's log prefix (`undefined` outside parallel builds). */
export const currentLogPrefix: Effect.Effect<string | undefined> = LogPrefix;

/** Run `self` with every prefix-aware output line tagged with `prefix`. */
export const withLogPrefix =
  (prefix: string) =>
  <Value, Err, Req>(self: Effect.Effect<Value, Err, Req>): Effect.Effect<Value, Err, Req> =>
    Effect.provideService(self, LogPrefix, prefix);

/** Tag `line` with `prefix` when one is set; pass it through untouched otherwise. */
export const prefixLine = (prefix: string | undefined, line: string): string =>
  prefix === undefined ? line : `${prefix}${line}`;

/** Colored, width-aligned tag for a platform build fiber. */
export const platformLogPrefix = (platform: Platform): string =>
  platform === "ios" ? `${chalk.cyan("[ios]")}     ` : `${chalk.green("[android]")} `;

/**
 * Collapse carriage-return redraws to the final rendered segment. In prefixed
 * line mode a spinner/progress line (`frame1\rframe2\rdone`) must print once,
 * as its last visible state, instead of replaying every frame.
 */
export const finalCarriageSegment = (line: string): string => {
  const trimmed = line.replace(/\r+$/u, "");
  return trimmed.slice(trimmed.lastIndexOf("\r") + 1);
};
