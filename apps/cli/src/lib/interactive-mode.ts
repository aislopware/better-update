import { Context, Layer } from "effect";

export class InteractiveMode extends Context.Tag("cli/InteractiveMode")<
  InteractiveMode,
  {
    /** True when the CLI may show interactive prompts; false in CI / `--non-interactive` / `--json`. */
    readonly allow: boolean;
  }
>() {}

export const makeInteractiveModeLayer = (allow: boolean): Layer.Layer<InteractiveMode> =>
  Layer.succeed(InteractiveMode, { allow });

/** Default: prompts allowed. The CLI entrypoint overrides this via `--non-interactive`/CI detect. */
export const InteractiveModeLive = makeInteractiveModeLayer(true);
