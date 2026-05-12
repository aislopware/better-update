import { Console, Effect } from "effect";

import { OutputMode } from "./output-mode";

/**
 * Emit a key/value table. Human mode prints aligned columns; JSON mode emits a
 * `{ items: [...] }` array where each row is keyed by header name.
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
      yield* Console.log(JSON.stringify({ items }));
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
 * Emit aligned key/value pairs. Human mode prints a two-column layout; JSON
 * mode emits a flat object keyed by the first column.
 */
export const printKeyValue = (
  pairs: readonly (readonly [string, string])[],
): Effect.Effect<void, never, OutputMode> =>
  Effect.gen(function* () {
    const mode = yield* OutputMode;
    if (mode.json) {
      yield* Console.log(JSON.stringify(Object.fromEntries(pairs)));
      return;
    }
    const maxKeyLen = Math.max(...pairs.map(([key]) => key.length));

    for (const [key, value] of pairs) {
      yield* Console.log(`${key.padEnd(maxKeyLen)}  ${value}`);
    }
  });

/**
 * Emit arbitrary JSON. In human mode emits pretty-printed JSON; in JSON mode
 * emits compact JSON. Use this for `view <id>`-style commands where the whole
 * payload should be machine-parseable.
 */
export const printJson = (data: unknown): Effect.Effect<void, never, OutputMode> =>
  Effect.gen(function* () {
    const mode = yield* OutputMode;
    yield* Console.log(JSON.stringify(data, null, mode.json ? 0 : 2));
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
 * Emit a list result. In JSON mode always emits `{items: [...]}`; in human mode
 * prints the table or, if empty, the `emptyMessage`. Use this for `list`-style
 * commands so empty results stay parseable as `{items: []}` instead of falling
 * back to a plain-text "Nothing found" message.
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
