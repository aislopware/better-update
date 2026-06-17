import { buildTrackRelease } from "./google-play";

describe(buildTrackRelease, () => {
  it("includes userFraction only for a staged (inProgress) rollout", () => {
    const release = buildTrackRelease({
      releaseStatus: "inProgress",
      versionCode: 42,
      rollout: 0.1,
    });
    expect(release.status).toBe("inProgress");
    expect(release.versionCodes).toStrictEqual(["42"]);
    expect(release.userFraction).toBe(0.1);
  });

  it("drops userFraction for completed releases even when a rollout is given", () => {
    const release = buildTrackRelease({
      releaseStatus: "completed",
      versionCode: 7,
      rollout: 0.25,
    });
    expect(release.userFraction).toBeUndefined();
  });

  it("drops userFraction for draft and halted releases", () => {
    expect(
      buildTrackRelease({ releaseStatus: "draft", versionCode: 1, rollout: 0.5 }).userFraction,
    ).toBeUndefined();
    expect(
      buildTrackRelease({ releaseStatus: "halted", versionCode: 1, rollout: 0.5 }).userFraction,
    ).toBeUndefined();
  });

  it("omits userFraction when no rollout is provided", () => {
    const release = buildTrackRelease({
      releaseStatus: "inProgress",
      versionCode: 9,
      rollout: null,
    });
    expect(release.userFraction).toBeUndefined();
  });

  it("attaches en-US release notes when provided", () => {
    const release = buildTrackRelease({
      releaseStatus: "completed",
      versionCode: 3,
      rollout: null,
      releaseNotes: "Bug fixes",
    });
    expect(release.releaseNotes).toStrictEqual([{ language: "en-US", text: "Bug fixes" }]);
  });

  it("omits release notes when none are provided", () => {
    const release = buildTrackRelease({
      releaseStatus: "completed",
      versionCode: 3,
      rollout: null,
    });
    expect(release.releaseNotes).toBeUndefined();
  });
});
