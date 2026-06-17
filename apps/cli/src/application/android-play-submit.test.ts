import { androidRolloutError } from "./android-play-submit";

describe(androidRolloutError, () => {
  it("requires a rollout when releaseStatus is inProgress", () => {
    const error = androidRolloutError("inProgress", null);
    expect(error).not.toBeNull();
    expect(error).toContain("required");
  });

  it("accepts a rollout with inProgress", () => {
    expect(androidRolloutError("inProgress", 0.1)).toBeNull();
  });

  it("accepts completed/draft/halted without a rollout", () => {
    expect(androidRolloutError("completed", null)).toBeNull();
    expect(androidRolloutError("draft", null)).toBeNull();
    expect(androidRolloutError("halted", null)).toBeNull();
  });

  it("rejects a rollout with any non-inProgress status", () => {
    expect(androidRolloutError("completed", 0.5)).toContain("only allowed");
    expect(androidRolloutError("draft", 0.5)).toContain("only allowed");
    expect(androidRolloutError("halted", 0.5)).toContain("only allowed");
  });
});
