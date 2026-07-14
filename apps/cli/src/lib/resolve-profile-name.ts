import { Effect } from "effect";

import { listBuildProfileNames } from "./eas-json";
import { InteractiveMode } from "./interactive-mode";
import { printHuman } from "./output";
import { promptSelect } from "./prompts";

/**
 * Resolve the build-profile name: pass a known name through, otherwise offer
 * an interactive picker over the profiles eas.json declares. Non-interactive
 * (or empty eas.json) falls through to the requested name so `readBuildProfile`
 * fails with its existing "not found" / missing-eas.json message.
 */
export const resolveProfileName = (projectRoot: string, requested: string) =>
  Effect.gen(function* () {
    const available = yield* listBuildProfileNames(projectRoot);
    if (available.includes(requested)) {
      return requested;
    }
    const mode = yield* InteractiveMode;
    if (!mode.allow || available.length === 0) {
      return requested;
    }
    yield* printHuman(`Build profile "${requested}" not found in eas.json.`);
    return yield* promptSelect<string>(
      "Pick a build profile:",
      available.map((name) => ({ value: name, label: name })),
    );
  });
