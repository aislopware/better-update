/**
 * Schema-versioned CLI output envelope.
 *
 * Every `--json` outcome — success OR failure — is emitted as exactly one
 * envelope on stdout. The envelope is the WHOLE stdout payload (compact, one
 * line). `CLI_ENVELOPE_VERSION` is bumped only on a breaking shape change; the
 * colocated unit test pins the value + key sets so any drift is a deliberate,
 * test-touching change.
 *
 * Pure leaf module: imports nothing but type declarations. The actual stdout
 * write happens at the imperative boundary (citty-effect.ts / command-exit.ts).
 */

/** Current envelope schema version. Bump ONLY on a breaking shape change. */
export const CLI_ENVELOPE_VERSION = 1 as const;

export interface SuccessEnvelope {
  readonly schemaVersion: typeof CLI_ENVELOPE_VERSION;
  readonly ok: true;
  /** Dotted command path, e.g. `devices.list`. */
  readonly command: string;
  /** Machine-readable command payload. */
  readonly data: unknown;
}

/** Builder input for the error envelope: tolerates an explicit `undefined` hint. */
export interface EnvelopeErrorInput {
  /** Process exit code (1-7), also the single source of truth surfaced here. */
  readonly code: number;
  /** The failed value's `_tag`, or `"Unknown"` for the catchAll fallback. */
  readonly tag: string;
  /** Human-readable failure message. */
  readonly message: string;
  /** Optional actionable remediation hint. */
  readonly hint?: string | undefined;
}

/** The emitted error shape: `hint` is exact-optional (omitted entirely when absent). */
export interface EnvelopeError {
  readonly code: number;
  readonly tag: string;
  readonly message: string;
  readonly hint?: string;
}

export interface ErrorEnvelope {
  readonly schemaVersion: typeof CLI_ENVELOPE_VERSION;
  readonly ok: false;
  /** Dotted command path, e.g. `devices.list`. */
  readonly command: string;
  readonly error: EnvelopeError;
}

export type CliEnvelope = SuccessEnvelope | ErrorEnvelope;

/** Build a success envelope wrapping `data` for the given command path. */
export const makeSuccessEnvelope = (command: string, data: unknown): SuccessEnvelope => ({
  schemaVersion: CLI_ENVELOPE_VERSION,
  ok: true,
  command,
  data,
});

/** Build an error envelope from the resolved exit code, tag, message, and optional hint. */
export const makeErrorEnvelope = (command: string, error: EnvelopeErrorInput): ErrorEnvelope => ({
  schemaVersion: CLI_ENVELOPE_VERSION,
  ok: false,
  command,
  error:
    error.hint === undefined
      ? { code: error.code, tag: error.tag, message: error.message }
      : { code: error.code, tag: error.tag, message: error.message, hint: error.hint },
});

/** Serialize an envelope to a single-line compact JSON string for stdout. */
export const serializeEnvelope = (envelope: CliEnvelope): string => JSON.stringify(envelope);
