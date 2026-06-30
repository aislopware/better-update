import { printHumanKeyValue } from "../../../lib/output";

import type { RolloutView } from "../../../application/app-store-rollout";

/** Shared human view for a phased release, used by every `rollout` leaf. */
export const renderRollout = (view: RolloutView) =>
  printHumanKeyValue([
    ["Version", view.versionString],
    ["State", view.state],
    ["Day", view.currentDayNumber === null ? "—" : String(view.currentDayNumber)],
    ["Start date", view.startDate ?? "—"],
  ]);
