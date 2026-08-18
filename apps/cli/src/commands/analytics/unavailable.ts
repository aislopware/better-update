import { Effect } from "effect";

import { printHuman } from "../../lib/output";

import type { OutputMode } from "../../lib/output-mode";

/**
 * Every analytics endpoint answers 200 even when the server could not reach
 * Analytics Engine — a telemetry outage must not fail the command — and flags
 * it with `unavailable`. Without saying so, the zeros below read as "no traffic"
 * and send people looking for a rollout problem they do not have.
 */
export const ANALYTICS_UNAVAILABLE_MESSAGE =
  "Analytics unavailable — the server could not query Cloudflare Analytics Engine. " +
  "On a self-hosted instance this is usually a missing CLOUDFLARE_API_TOKEN worker secret.";

/** Human-mode notice; JSON mode carries `unavailable` in the payload instead. */
export const warnIfUnavailable = (unavailable: boolean): Effect.Effect<void, never, OutputMode> =>
  unavailable ? printHuman(ANALYTICS_UNAVAILABLE_MESSAGE) : Effect.void;

/** Empty-table line: the reason there is nothing to show, when we know it. */
export const emptyMessage = (unavailable: boolean, whenEmpty: string): string =>
  unavailable ? ANALYTICS_UNAVAILABLE_MESSAGE : whenEmpty;
