import { Console, Effect, Redacted } from "effect";
import { Prompt } from "effect/unstable/cli";

import { InteractiveProhibitedError } from "./exit-codes";
import { InteractiveMode } from "./interactive-mode";

/** Services every prompt needs: the interactive gate plus the terminal it draws on. */
export type PromptServices = InteractiveMode | Prompt.Environment;

export interface PromptOption<T> {
  readonly value: T;
  readonly label?: string;
  readonly hint?: string;
}

/**
 * Fail with `InteractiveProhibitedError` unless prompts are allowed. Every
 * prompt goes through it; flows that need a human without a prompt (the
 * browser login) call it directly with their own remedy.
 */
export const requireInteractive = (
  what: string,
  remedy = "Provide the value via a flag, run with --interactive, or unset CI.",
): Effect.Effect<void, InteractiveProhibitedError, InteractiveMode> =>
  Effect.gen(function* () {
    const mode = yield* InteractiveMode;
    if (!mode.allow) {
      return yield* new InteractiveProhibitedError({
        message: `${what} requested while running non-interactively. ${remedy}`,
      });
    }
    return undefined;
  });

const ensureInteractive = (promptName: string) =>
  requireInteractive(`Interactive prompt "${promptName}"`);

/**
 * Run a prompt behind the InteractiveMode gate. Ctrl-C at a prompt (`QuitError`)
 * becomes fiber interruption: it passes through every handler untouched and the
 * runtime exits 130, matching the conventional SIGINT status.
 */
const ask = <T>(
  message: string,
  prompt: Prompt.Prompt<T>,
): Effect.Effect<T, InteractiveProhibitedError, PromptServices> =>
  Effect.gen(function* () {
    yield* ensureInteractive(message);
    return yield* Prompt.run(prompt).pipe(
      Effect.catchTag("QuitError", () =>
        Console.error("Operation cancelled.").pipe(Effect.andThen(Effect.interrupt)),
      ),
    );
  });

const toChoices = <T>(options: readonly PromptOption<T>[]): Prompt.SelectChoice<T>[] =>
  options.map((option) => ({
    title: option.label ?? String(option.value),
    value: option.value,
    ...(option.hint === undefined ? {} : { description: option.hint }),
  }));

export const promptPassword = (
  message: string,
): Effect.Effect<string, InteractiveProhibitedError, PromptServices> =>
  ask(message, Prompt.Password({ message })).pipe(Effect.map(Redacted.value));

export const promptSelect = <T>(
  message: string,
  options: readonly PromptOption<T>[],
): Effect.Effect<T, InteractiveProhibitedError, PromptServices> =>
  ask(message, Prompt.Select<T>({ message, choices: toChoices(options) }));

export const promptAutocomplete = <T>(
  message: string,
  options: readonly PromptOption<T>[],
  config?: { readonly placeholder?: string; readonly maxItems?: number },
): Effect.Effect<T, InteractiveProhibitedError, PromptServices> =>
  ask(
    message,
    Prompt.AutoComplete<T>({
      message,
      choices: toChoices(options),
      ...(config?.placeholder === undefined ? {} : { filterPlaceholder: config.placeholder }),
      ...(config?.maxItems === undefined ? {} : { maxPerPage: config.maxItems }),
    }),
  );

export const promptMultiSelect = <T>(
  message: string,
  options: readonly PromptOption<T>[],
  config?: { readonly required?: boolean },
): Effect.Effect<readonly T[], InteractiveProhibitedError, PromptServices> =>
  ask(
    message,
    Prompt.MultiSelect<T>({
      message,
      choices: toChoices(options),
      min: config?.required ? 1 : 0,
    }),
  );

export const promptText = (
  message: string,
  options?: {
    /** Hint appended to the message (Effect prompts have no inline placeholder). */
    readonly placeholder?: string;
    /** Shown as the answer used when the user submits an empty line. */
    readonly defaultValue?: string;
    /** Same as `defaultValue`; kept so callers can express "pre-filled" intent. */
    readonly initialValue?: string;
    /** Return a message to reject + re-prompt; `undefined` accepts the value. */
    readonly validate?: (value: string | undefined) => string | undefined;
  },
): Effect.Effect<string, InteractiveProhibitedError, PromptServices> => {
  const initial = options?.initialValue ?? options?.defaultValue;
  const validate = options?.validate;
  const label =
    options?.placeholder === undefined ? message : `${message} (${options.placeholder})`;
  return ask(
    message,
    Prompt.String({
      message: label,
      ...(initial === undefined ? {} : { default: initial }),
      ...(validate === undefined
        ? {}
        : {
            validate: (value: string) => {
              const problem = validate(value);
              return problem === undefined ? Effect.succeed(value) : Effect.fail(problem);
            },
          }),
    }),
  );
};

export const promptConfirm = (
  message: string,
  options?: { readonly initialValue?: boolean },
): Effect.Effect<boolean, InteractiveProhibitedError, PromptServices> =>
  ask(
    message,
    Prompt.Confirm({
      message,
      ...(options?.initialValue === undefined ? {} : { initial: options.initialValue }),
    }),
  );

/**
 * Ask for an App Store Connect issuer ID. Team keys have one; an individual
 * key does not, so an empty answer means "no issuer" rather than a retry.
 */
export const promptIssuerId = (): Effect.Effect<
  string | undefined,
  InteractiveProhibitedError,
  PromptServices
> =>
  promptText("ASC issuer ID (UUID) — leave empty for an individual key").pipe(
    Effect.map((value) => {
      const trimmed = value.trim();
      return trimmed.length === 0 ? undefined : trimmed;
    }),
  );
