import { Option, Schema } from "effect";
import { Argument, Flag } from "effect/unstable/cli";

/**
 * Optional flag flattened to `undefined` when absent. The application layer
 * models "not provided" as `undefined` (it feeds `compact()` and optional
 * fields), so the CLI boundary hands it that shape instead of an `Option`.
 */
export const optionalFlag = <Value>(flag: Flag.Flag<Value>): Flag.Flag<Value | undefined> =>
  flag.pipe(Flag.optional, Flag.map(Option.getOrUndefined));

/** Optional positional argument flattened to `undefined` when absent (see {@link optionalFlag}). */
export const optionalArgument = <Value>(
  argument: Argument.Argument<Value>,
): Argument.Argument<Value | undefined> =>
  argument.pipe(Argument.optional, Argument.map(Option.getOrUndefined));

const PositiveInt = Schema.NumberFromString.check(
  Schema.isInt({ message: "Expected a whole number" }),
  Schema.isGreaterThanOrEqualTo(1, { message: "Expected a positive number" }),
);

const NonNegativeInt = Schema.NumberFromString.check(
  Schema.isInt({ message: "Expected a whole number" }),
  Schema.isGreaterThanOrEqualTo(0, { message: "Expected zero or a positive number" }),
);

/**
 * `--<name> <n>` parsed + range-checked by the CLI parser (≥ 1), so a bad value
 * is a usage error before the handler runs. Used for `--limit` / `--page`.
 */
export const positiveIntFlag = (
  name: string,
  options: { readonly description: string; readonly defaultValue: number },
): Flag.Flag<number> =>
  Flag.String(name).pipe(
    Flag.withSchema(PositiveInt),
    Flag.withDescription(`${options.description} (default: ${String(options.defaultValue)})`),
    Flag.withDefault(options.defaultValue),
  );

/** Like {@link positiveIntFlag} without a default (`undefined` when absent). */
export const optionalPositiveIntFlag = (
  name: string,
  description: string,
): Flag.Flag<number | undefined> =>
  Flag.String(name).pipe(
    Flag.withSchema(PositiveInt),
    Flag.withDescription(description),
    optionalFlag,
  );

/** Like {@link positiveIntFlag} but allows `0` and has no default (`undefined` when absent). */
export const optionalNonNegativeIntFlag = (
  name: string,
  description: string,
): Flag.Flag<number | undefined> =>
  Flag.String(name).pipe(
    Flag.withSchema(NonNegativeInt),
    Flag.withDescription(description),
    optionalFlag,
  );

/** `--yes` / `-y`: skip a confirmation prompt (destructive or out-of-band confirmations). */
export const yesFlag = (description = "Skip the confirmation prompt"): Flag.Flag<boolean> =>
  Flag.Boolean("yes").pipe(
    Flag.withAlias("y"),
    Flag.withDescription(description),
    Flag.withDefault(false),
  );

/** Analytics time window shared by the `analytics *` / `* insights` commands. */
export const periodFlag = Flag.Literals("period", ["1d", "7d", "30d", "90d"]).pipe(
  Flag.withDescription("Time window"),
  optionalFlag,
);
