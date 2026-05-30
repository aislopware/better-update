import { Console, Effect } from "effect";

import { resolveActiveCommandName } from "./command-output";
import { makeSuccessEnvelope, serializeEnvelope } from "./envelope";
import { OutputMode } from "./output-mode";

/**
 * Emit the schema-versioned success envelope wrapping `data` on stdout, compact
 * and single-line. This is the shared JSON-mode write for the human-output
 * helpers below; the command name is derived from the citty-rewritten argv.
 */
const emitSuccessEnvelope = (data: unknown): Effect.Effect<void> =>
  Console.log(serializeEnvelope(makeSuccessEnvelope(resolveActiveCommandName(process.argv), data)));

/**
 * Emit a key/value table. Human mode prints aligned columns; JSON mode emits a
 * success envelope whose `data` is `{ items: [...] }` where each row is keyed by
 * header name.
 */
export const printTable = (
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): Effect.Effect<void, never, OutputMode> =>
  Effect.gen(function* () {
    const mode = yield* OutputMode;
    if (mode.json) {
      const items = rows.map((row) =>
        Object.fromEntries(
          headers.map((header, idx) => [
            header,
            // eslint-disable-next-line eslint-js/no-restricted-syntax -- ragged-row JSON: missing cell renders as empty string, matching the human table layout
            row[idx] ?? "",
          ]),
        ),
      );
      yield* emitSuccessEnvelope({ items });
      return;
    }
    const allRows = [headers, ...rows];
    const colWidths = headers.map((_, colIndex) =>
      // eslint-disable-next-line eslint-js/no-restricted-syntax -- table padding for ragged rows; missing cell treated as empty-width
      Math.max(...allRows.map((row) => (row[colIndex] ?? "").length)),
    );

    const formatRow = (row: readonly string[]): string =>
      row.map((cell, idx) => cell.padEnd(colWidths[idx] ?? 0)).join("  ");

    yield* Console.log(formatRow(headers));
    yield* Console.log(colWidths.map((width) => "-".repeat(width)).join("  "));

    for (const row of rows) {
      yield* Console.log(formatRow(row));
    }
  });

/**
 * Emit aligned key/value pairs. Human mode prints a two-column layout; JSON mode
 * emits a success envelope whose `data` is a flat object keyed by the first
 * column.
 */
export const printKeyValue = (
  pairs: readonly (readonly [string, string])[],
): Effect.Effect<void, never, OutputMode> =>
  Effect.gen(function* () {
    const mode = yield* OutputMode;
    if (mode.json) {
      yield* emitSuccessEnvelope(Object.fromEntries(pairs));
      return;
    }
    const maxKeyLen = Math.max(...pairs.map(([key]) => key.length));

    for (const [key, value] of pairs) {
      yield* Console.log(`${key.padEnd(maxKeyLen)}  ${value}`);
    }
  });

/**
 * Emit a machine payload. In JSON mode wraps `data` in the schema-versioned
 * success envelope and prints it compact on stdout; in human mode prints
 * pretty-printed JSON. Use this for `view <id>`-style commands where the whole
 * payload should be machine-parseable.
 */
export const printJson = (data: unknown): Effect.Effect<void, never, OutputMode> =>
  Effect.gen(function* () {
    const mode = yield* OutputMode;
    if (mode.json) {
      yield* emitSuccessEnvelope(data);
      return;
    }
    yield* Console.log(JSON.stringify(data, null, 2));
  });

/**
 * Emit a human-only message. Suppressed entirely in JSON mode so the output
 * stream stays machine-parseable.
 */
export const printHuman = (message: string): Effect.Effect<void, never, OutputMode> =>
  Effect.gen(function* () {
    const mode = yield* OutputMode;
    if (mode.json) {
      return;
    }
    yield* Console.log(message);
  });

/**
 * Human-ONLY aligned table. Identical layout to {@link printTable} in human mode
 * but emits NOTHING in JSON mode.
 *
 * Use this with the `runEffect({ json })` return-value path: the command returns
 * its machine payload (the single JSON-mode emission) and calls this for the
 * human view, so JSON mode never double-emits (one envelope from the boundary,
 * none from here). Prefer this over the dual-mode {@link printTable} when the
 * JSON payload is richer than the table rows (e.g. carries `total`/`page`).
 */
export const printHumanTable = (
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): Effect.Effect<void, never, OutputMode> =>
  Effect.gen(function* () {
    const mode = yield* OutputMode;
    if (mode.json) {
      return;
    }
    yield* printTable(headers, rows);
  });

/**
 * Human-ONLY key/value layout. Identical to {@link printKeyValue} in human mode
 * but emits NOTHING in JSON mode — the companion to {@link printHumanTable} for
 * the return-value JSON path on `view <id>`-style commands.
 */
export const printHumanKeyValue = (
  pairs: readonly (readonly [string, string])[],
): Effect.Effect<void, never, OutputMode> =>
  Effect.gen(function* () {
    const mode = yield* OutputMode;
    if (mode.json) {
      return;
    }
    yield* printKeyValue(pairs);
  });

/**
 * Emit a list result. In JSON mode always emits a success envelope with
 * `data.items`; in human mode prints the table or, if empty, the
 * `emptyMessage`. Use this for `list`-style commands so empty results stay
 * parseable as `{ items: [] }` instead of falling back to a plain-text message.
 */
export const printList = (
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  emptyMessage: string,
): Effect.Effect<void, never, OutputMode> =>
  Effect.gen(function* () {
    const mode = yield* OutputMode;
    if (mode.json) {
      yield* printTable(headers, rows);
      return;
    }
    if (rows.length === 0) {
      yield* Console.log(emptyMessage);
      return;
    }
    yield* printTable(headers, rows);
  });

/**
 * Human-ONLY list. Same human-mode behaviour as {@link printList} (table, or the
 * `emptyMessage` when empty) but emits NOTHING in JSON mode — the companion to
 * {@link printHumanTable} / {@link printHumanKeyValue} for the return-value JSON
 * path where the command returns a richer payload than the table rows.
 */
export const printHumanList = (
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  emptyMessage: string,
): Effect.Effect<void, never, OutputMode> =>
  Effect.gen(function* () {
    const mode = yield* OutputMode;
    if (mode.json) {
      return;
    }
    yield* printList(headers, rows, emptyMessage);
  });
