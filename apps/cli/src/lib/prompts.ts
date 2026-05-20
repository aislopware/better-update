import { compact } from "@better-update/type-guards";
import {
  autocomplete,
  cancel,
  confirm,
  isCancel,
  multiselect,
  password,
  select,
  text,
} from "@clack/prompts";
import { Effect } from "effect";

import { InteractiveProhibitedError } from "./exit-codes";
import { InteractiveMode } from "./interactive-mode";

const ensureInteractive = (
  promptName: string,
): Effect.Effect<void, InteractiveProhibitedError, InteractiveMode> =>
  Effect.gen(function* () {
    const mode = yield* InteractiveMode;
    if (!mode.allow) {
      return yield* new InteractiveProhibitedError({
        message: `Interactive prompt "${promptName}" requested while running non-interactively. Provide the value via a flag, run with --interactive, or unset CI.`,
      });
    }
    return undefined;
  });

const handleCancel = <T>(value: T | symbol): T => {
  if (isCancel(value)) {
    cancel("Operation cancelled.");
    // eslint-disable-next-line eslint-plugin-unicorn/no-process-exit -- SIGINT at a CLI prompt must terminate the process; throwing would leave Effect runtime stuck
    process.exit(130);
  }
  return value;
};

export const promptPassword = (
  message: string,
): Effect.Effect<string, InteractiveProhibitedError, InteractiveMode> =>
  Effect.gen(function* () {
    yield* ensureInteractive(message);
    const value = yield* Effect.promise(async () => password({ message }));
    return handleCancel(value);
  });

type SelectOption<T> = Parameters<typeof select<T>>[0]["options"][number];

export const promptSelect = <T>(
  message: string,
  options: readonly SelectOption<T>[],
): Effect.Effect<T, InteractiveProhibitedError, InteractiveMode> =>
  Effect.gen(function* () {
    yield* ensureInteractive(message);
    const value = yield* Effect.promise(async () => select<T>({ message, options: [...options] }));
    return handleCancel(value);
  });

export const promptAutocomplete = <T>(
  message: string,
  options: readonly SelectOption<T>[],
  config?: { readonly placeholder?: string; readonly maxItems?: number },
): Effect.Effect<T, InteractiveProhibitedError, InteractiveMode> =>
  Effect.gen(function* () {
    yield* ensureInteractive(message);
    const value = yield* Effect.promise(async () =>
      autocomplete<T>(
        compact({
          message,
          options: [...options],
          placeholder: config?.placeholder,
          maxItems: config?.maxItems,
        }),
      ),
    );
    return handleCancel(value);
  });

type MultiSelectOption<T> = Parameters<typeof multiselect<T>>[0]["options"][number];

export const promptMultiSelect = <T>(
  message: string,
  options: readonly MultiSelectOption<T>[],
  config?: { readonly required?: boolean },
): Effect.Effect<readonly T[], InteractiveProhibitedError, InteractiveMode> =>
  Effect.gen(function* () {
    yield* ensureInteractive(message);
    const value = yield* Effect.promise(async () =>
      multiselect<T>({
        message,
        options: [...options],
        required: config?.required ?? false,
      }),
    );
    return handleCancel(value);
  });

export const promptText = (
  message: string,
  options?: { readonly placeholder?: string; readonly defaultValue?: string },
): Effect.Effect<string, InteractiveProhibitedError, InteractiveMode> =>
  Effect.gen(function* () {
    yield* ensureInteractive(message);
    const value = yield* Effect.promise(async () =>
      text(
        compact({
          message,
          placeholder: options?.placeholder,
          defaultValue: options?.defaultValue,
        }),
      ),
    );
    return handleCancel(value);
  });

export const promptConfirm = (
  message: string,
  options?: { readonly initialValue?: boolean },
): Effect.Effect<boolean, InteractiveProhibitedError, InteractiveMode> =>
  Effect.gen(function* () {
    yield* ensureInteractive(message);
    const value = yield* Effect.promise(async () =>
      confirm(compact({ message, initialValue: options?.initialValue })),
    );
    return handleCancel(value);
  });
