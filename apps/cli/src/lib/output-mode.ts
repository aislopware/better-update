import { Context, Layer } from "effect";

export class OutputMode extends Context.Tag("cli/OutputMode")<
  OutputMode,
  {
    /** Emit machine-readable JSON only. Suppress spinners, progress, and human prose. */
    readonly json: boolean;
  }
>() {}

export const makeOutputModeLayer = (json: boolean): Layer.Layer<OutputMode> =>
  Layer.succeed(OutputMode, { json });

/** Default output mode: human-readable (json=false). Used when no override layer is provided. */
export const OutputModeLive = makeOutputModeLayer(false);
