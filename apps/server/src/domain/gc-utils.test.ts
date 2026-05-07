import { GC_BATCH_SIZE, computeCutoff, parseRetentionDays } from "./gc-utils";

describe("gc-utils", () => {
  describe(parseRetentionDays, () => {
    it("parses a numeric string", () => {
      expect(parseRetentionDays("7")).toBe(7);
    });

    it("defaults to 30 when undefined", () => {
      expect(parseRetentionDays(undefined)).toBe(30);
    });

    it("returns NaN for non-numeric string", () => {
      expect(parseRetentionDays("abc")).toBeNaN();
    });
  });

  describe(computeCutoff, () => {
    it("returns an ISO string in the past", () => {
      const cutoff = computeCutoff(30);
      const cutoffDate = new Date(cutoff);

      expect(cutoffDate.getTime()).toBeLessThan(Date.now());
      expect(cutoff).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("cutoff is approximately retentionDays ago", () => {
      const days = 7;
      const before = Date.now();
      const cutoff = computeCutoff(days);
      const after = Date.now();

      const cutoffMs = new Date(cutoff).getTime();
      const expectedMs = days * 86_400_000;

      expect(cutoffMs).toBeGreaterThanOrEqual(before - expectedMs);
      expect(cutoffMs).toBeLessThanOrEqual(after - expectedMs);
    });

    it("zero retention days returns approximately now", () => {
      const before = Date.now();
      const cutoff = computeCutoff(0);
      const cutoffMs = new Date(cutoff).getTime();

      expect(Math.abs(before - cutoffMs)).toBeLessThan(100);
    });
  });

  describe("gc batch size constant", () => {
    it("is 100", () => {
      expect(GC_BATCH_SIZE).toBe(100);
    });
  });
});
