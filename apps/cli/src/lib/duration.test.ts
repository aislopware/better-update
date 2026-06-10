import { formatDurationApprox, parseDurationMs } from "./duration";

describe(parseDurationMs, () => {
  it("treats a bare number as minutes", () => {
    expect(parseDurationMs("90")).toBe(90 * 60_000);
    expect(parseDurationMs("1")).toBe(60_000);
  });

  it("parses h/m unit forms, case-insensitively and trimmed", () => {
    expect(parseDurationMs("45m")).toBe(45 * 60_000);
    expect(parseDurationMs("2h")).toBe(2 * 60 * 60_000);
    expect(parseDurationMs("1h30m")).toBe(90 * 60_000);
    expect(parseDurationMs(" 2H ")).toBe(2 * 60 * 60_000);
    expect(parseDurationMs("1h30")).toBe(90 * 60_000);
  });

  it("rejects unparseable or non-positive inputs", () => {
    expect(parseDurationMs("")).toBeUndefined();
    expect(parseDurationMs("0")).toBeUndefined();
    expect(parseDurationMs("0h0m")).toBeUndefined();
    expect(parseDurationMs("5x")).toBeUndefined();
    expect(parseDurationMs("m30")).toBeUndefined();
    expect(parseDurationMs("-5m")).toBeUndefined();
    expect(parseDurationMs("1.5h")).toBeUndefined();
  });
});

describe(formatDurationApprox, () => {
  it("renders minutes-only durations, rounding up with a floor of 1", () => {
    expect(formatDurationApprox(500)).toBe("1 min");
    expect(formatDurationApprox(45 * 60_000)).toBe("45 min");
    expect(formatDurationApprox(44 * 60_000 + 1)).toBe("45 min");
  });

  it("renders hour and mixed durations", () => {
    expect(formatDurationApprox(2 * 60 * 60_000)).toBe("2 h");
    expect(formatDurationApprox(90 * 60_000)).toBe("1 h 30 min");
    expect(formatDurationApprox(24 * 60 * 60_000)).toBe("24 h");
  });
});
