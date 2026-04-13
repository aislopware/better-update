import { Console, Effect } from "effect";

export const printTable = (
  headers: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string>>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const allRows = [headers, ...rows];
    const colWidths = headers.map((_, colIndex) =>
      Math.max(...allRows.map((row) => (row[colIndex] ?? "").length)),
    );

    const formatRow = (row: ReadonlyArray<string>): string =>
      row.map((cell, i) => (cell ?? "").padEnd(colWidths[i] ?? 0)).join("  ");

    yield* Console.log(formatRow(headers));
    yield* Console.log(colWidths.map((w) => "-".repeat(w)).join("  "));

    for (const row of rows) {
      yield* Console.log(formatRow(row));
    }
  });

export const printKeyValue = (
  pairs: ReadonlyArray<readonly [string, string]>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const maxKeyLen = Math.max(...pairs.map(([key]) => key.length));

    for (const [key, value] of pairs) {
      yield* Console.log(`${key.padEnd(maxKeyLen)}  ${value}`);
    }
  });
