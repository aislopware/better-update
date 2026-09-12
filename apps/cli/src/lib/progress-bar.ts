import { Effect } from "effect";

export interface ProgressBar {
  readonly start: (message: string) => Effect.Effect<void>;
  readonly advance: (delta: number, message: string) => Effect.Effect<void>;
  readonly stop: (message: string) => Effect.Effect<void>;
  readonly error: (message: string) => Effect.Effect<void>;
}

const FILLED = "█";
const EMPTY = "░";

const renderBar = (value: number, max: number, size: number): string => {
  const ratio = max <= 0 ? 1 : Math.min(1, value / max);
  const filled = Math.round(ratio * size);
  return `${FILLED.repeat(filled)}${EMPTY.repeat(size - filled)}`;
};

/**
 * A single-line TTY progress bar drawn on stderr (chrome, never the stdout
 * envelope). Each frame rewrites the line in place; `stop`/`error` print the
 * final message and move to the next line.
 */
const finish = (message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    process.stderr.write(`\r\u001B[2K${message}\n`);
  });

export const makeProgressBar = (options: {
  readonly max: number;
  readonly size?: number;
}): Effect.Effect<ProgressBar> =>
  Effect.sync(() => {
    const size = options.size ?? 30;
    let value = 0;
    const draw = (message: string): Effect.Effect<void> =>
      Effect.sync(() => {
        process.stderr.write(`\r[2K${renderBar(value, options.max, size)} ${message}`);
      });
    return {
      start: (message) => draw(message),
      advance: (delta, message) => {
        value += delta;
        return draw(message);
      },
      stop: finish,
      error: finish,
    };
  });
