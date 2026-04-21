import { Console, Effect } from "effect";

export const printTable = (
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): Effect.Effect<void> =>
  Effect.gen(function* () {
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

export const printKeyValue = (pairs: readonly (readonly [string, string])[]): Effect.Effect<void> =>
  Effect.gen(function* () {
    const maxKeyLen = Math.max(...pairs.map(([key]) => key.length));

    for (const [key, value] of pairs) {
      yield* Console.log(`${key.padEnd(maxKeyLen)}  ${value}`);
    }
  });
