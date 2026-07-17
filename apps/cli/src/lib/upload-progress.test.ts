import { formatUploadProgressLine, percentOf } from "./upload-progress";

describe(percentOf, () => {
  it("computes the floored percentage", () => {
    expect(percentOf(0, 100)).toBe(0);
    expect(percentOf(999, 1000)).toBe(99);
    expect(percentOf(1000, 1000)).toBe(100);
  });

  it("clamps overshoot and treats a zero total as complete", () => {
    expect(percentOf(2000, 1000)).toBe(100);
    expect(percentOf(0, 0)).toBe(100);
  });
});

describe(formatUploadProgressLine, () => {
  it("renders percent and megabytes", () => {
    const line = formatUploadProgressLine("Uploading", 5 * 1024 * 1024, 10 * 1024 * 1024);
    expect(line).toBe("Uploading 50% (5.0 / 10.0 MB)");
  });
});
