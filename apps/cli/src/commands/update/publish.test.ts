import { formatPatchesCell } from "./publish";

import type { PatchPhaseResult } from "../../application/update-patch-phase";

// formatPatchesCell renders the human-table "Patches" column. The richer savings
// fields ride the JSON result envelope (the table is human-only); this cell adds
// the best savings% when at least one patch reported it, and renders "—" when
// the phase was skipped entirely.

const result = (overrides: Partial<PatchPhaseResult>): PatchPhaseResult => ({
  attempted: 2,
  uploaded: 2,
  skipped: 0,
  newBundleBytes: 1000,
  totalPatchBytes: 80,
  bestSavingsPct: undefined,
  ...overrides,
});

describe(formatPatchesCell, () => {
  it("renders uploaded/attempted + skipped + best savings% when present", () => {
    expect(formatPatchesCell(result({ bestSavingsPct: 0.94 }))).toBe(
      "2/2 (0 skipped), 94% smaller",
    );
  });

  it("omits the savings suffix when no patch reported a savings ratio", () => {
    expect(formatPatchesCell(result({ uploaded: 0, skipped: 2, bestSavingsPct: undefined }))).toBe(
      "0/2 (2 skipped)",
    );
  });

  it("renders an em dash when the patch phase was skipped entirely", () => {
    expect(formatPatchesCell(null)).toBe("—");
  });
});
