import {
  classifyProcessingState,
  matchBetaGroupsByName,
  pickNewBuild,
} from "./apple-asc-testflight";

import type { AscBetaGroup, AscBuild } from "./apple-asc-testflight";

const build = (id: string, uploadedDate: string | null = "2026-06-17T10:00:00Z"): AscBuild => ({
  id,
  version: "42",
  uploadedDate,
  processingState: "VALID",
});

const group = (id: string, name: string, isInternal = true): AscBetaGroup => ({
  id,
  name,
  isInternal,
});

describe(classifyProcessingState, () => {
  it("maps VALID to valid", () => {
    expect(classifyProcessingState("VALID")).toBe("valid");
  });

  it("maps FAILED and INVALID to failed", () => {
    expect(classifyProcessingState("FAILED")).toBe("failed");
    expect(classifyProcessingState("INVALID")).toBe("failed");
  });

  it("treats PROCESSING, unknown, and null as still-processing", () => {
    expect(classifyProcessingState("PROCESSING")).toBe("processing");
    expect(classifyProcessingState("SOMETHING_ELSE")).toBe("processing");
    expect(classifyProcessingState(null)).toBe("processing");
  });
});

describe(pickNewBuild, () => {
  it("returns null when there are no builds", () => {
    expect(pickNewBuild([], null)).toBeNull();
    expect(pickNewBuild([], "b1")).toBeNull();
  });

  it("returns null when the newest build is the pre-upload baseline", () => {
    expect(pickNewBuild([build("b1")], "b1")).toBeNull();
  });

  it("returns the newest build when it differs from the baseline", () => {
    const builds = [build("b2"), build("b1")];
    expect(pickNewBuild(builds, "b1")?.id).toBe("b2");
  });

  it("returns the newest build when there was no baseline", () => {
    expect(pickNewBuild([build("b1")], null)?.id).toBe("b1");
  });
});

describe(matchBetaGroupsByName, () => {
  it("matches every requested group by exact name", () => {
    const groups = [group("g1", "Internal"), group("g2", "QA")];
    const { matched, missing } = matchBetaGroupsByName(groups, ["Internal", "QA"]);
    expect(matched.map((grp) => grp.id)).toStrictEqual(["g1", "g2"]);
    expect(missing).toStrictEqual([]);
  });

  it("reports names with no matching group", () => {
    const groups = [group("g1", "Internal")];
    const { matched, missing } = matchBetaGroupsByName(groups, ["Internal", "Ghost"]);
    expect(matched.map((grp) => grp.id)).toStrictEqual(["g1"]);
    expect(missing).toStrictEqual(["Ghost"]);
  });

  it("is exact (case-sensitive) on group names", () => {
    const groups = [group("g1", "Internal")];
    const { matched, missing } = matchBetaGroupsByName(groups, ["internal"]);
    expect(matched).toStrictEqual([]);
    expect(missing).toStrictEqual(["internal"]);
  });

  it("returns empty results for no requested names", () => {
    const { matched, missing } = matchBetaGroupsByName([group("g1", "Internal")], []);
    expect(matched).toStrictEqual([]);
    expect(missing).toStrictEqual([]);
  });
});
