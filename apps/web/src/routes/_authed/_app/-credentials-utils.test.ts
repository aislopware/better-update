import { dateToIsoBoundary, isoToDate } from "./-credentials-utils";

describe(isoToDate, () => {
  it("returns undefined for an empty string", () => {
    expect(isoToDate("")).toBeUndefined();
  });

  it("parses a stored ISO string back into a Date", () => {
    expect(isoToDate("2026-05-19T08:30:00.000Z")?.toISOString()).toBe("2026-05-19T08:30:00.000Z");
  });
});

describe(dateToIsoBoundary, () => {
  it("returns an empty string when no date is selected", () => {
    expect(dateToIsoBoundary(undefined, "start")).toBe("");
    expect(dateToIsoBoundary(undefined, "end")).toBe("");
  });

  // Date built from local components so the calendar day is the same in any
  // timezone; the helper reads local Y/M/D and snaps to the UTC day boundary.
  it("snaps the selected calendar day to the start-of-day UTC instant", () => {
    expect(dateToIsoBoundary(new Date(2026, 4, 19, 12, 30, 45), "start")).toBe(
      "2026-05-19T00:00:00.000Z",
    );
  });

  it("snaps the selected calendar day to the end-of-day UTC instant", () => {
    expect(dateToIsoBoundary(new Date(2026, 4, 19, 12, 30, 45), "end")).toBe(
      "2026-05-19T23:59:59.000Z",
    );
  });
});
