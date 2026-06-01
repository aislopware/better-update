import {
  directiveCommitTime,
  manifestCreatedAt,
  publishCreatedAt,
  servedCommitTime,
  servedCreatedAt,
} from "./signed-update-recency";

describe(manifestCreatedAt, () => {
  it("extracts the createdAt string from a manifest body", () => {
    const body = JSON.stringify({ id: "u1", createdAt: "2026-05-01T00:00:00.000Z" });
    expect(manifestCreatedAt(body)).toBe("2026-05-01T00:00:00.000Z");
  });

  it("returns null when the body is not valid JSON", () => {
    expect(manifestCreatedAt("{not json")).toBeNull();
  });

  it("returns null when the body is not a JSON object", () => {
    expect(manifestCreatedAt("[1, 2, 3]")).toBeNull();
  });

  it("returns null when createdAt is missing", () => {
    expect(manifestCreatedAt(JSON.stringify({ id: "u1" }))).toBeNull();
  });

  it("returns null when createdAt is not a string", () => {
    expect(manifestCreatedAt(JSON.stringify({ createdAt: 1_717_200_000_000 }))).toBeNull();
  });
});

describe(directiveCommitTime, () => {
  it("extracts parameters.commitTime from a rollback directive body", () => {
    const body = JSON.stringify({
      type: "rollBackToEmbedded",
      parameters: { commitTime: "2026-05-03T00:00:00.000Z" },
    });
    expect(directiveCommitTime(body)).toBe("2026-05-03T00:00:00.000Z");
  });

  it("returns null when the body is not valid JSON", () => {
    expect(directiveCommitTime("{not json")).toBeNull();
  });

  it("returns null when parameters is missing or not an object", () => {
    expect(directiveCommitTime(JSON.stringify({ type: "rollBackToEmbedded" }))).toBeNull();
    expect(directiveCommitTime(JSON.stringify({ parameters: "x" }))).toBeNull();
  });

  it("returns null when commitTime is not a string", () => {
    expect(directiveCommitTime(JSON.stringify({ parameters: { commitTime: 123 } }))).toBeNull();
  });
});

describe(servedCommitTime, () => {
  it("uses the manifest body's createdAt for a signed update", () => {
    const row = {
      manifestBody: JSON.stringify({ createdAt: "2026-05-02T00:00:00.000Z" }),
      directiveBody: null,
    };
    expect(servedCommitTime(row)).toBe("2026-05-02T00:00:00.000Z");
  });

  it("uses the directive body's commitTime for a rollback directive", () => {
    const row = {
      manifestBody: null,
      directiveBody: JSON.stringify({ parameters: { commitTime: "2026-05-03T00:00:00.000Z" } }),
    };
    expect(servedCommitTime(row)).toBe("2026-05-03T00:00:00.000Z");
  });

  it("returns null for an unsigned normal update (no precomputed body)", () => {
    expect(servedCommitTime({ manifestBody: null, directiveBody: null })).toBeNull();
  });
});

describe(publishCreatedAt, () => {
  it("stamps the served commitTime for a precomputed row (signed manifest)", () => {
    expect(
      publishCreatedAt({
        manifestBody: JSON.stringify({ createdAt: "2026-05-02T00:00:00.000Z" }),
        directiveBody: null,
        fallback: "2026-05-09T00:00:00.000Z",
      }),
    ).toBe("2026-05-02T00:00:00.000Z");
  });

  it("stamps the directive commitTime for a rollback directive row", () => {
    expect(
      publishCreatedAt({
        manifestBody: null,
        directiveBody: JSON.stringify({ parameters: { commitTime: "2026-05-03T00:00:00.000Z" } }),
        fallback: "2026-05-09T00:00:00.000Z",
      }),
    ).toBe("2026-05-03T00:00:00.000Z");
  });

  it("falls back to the server clock for an unsigned normal update", () => {
    expect(
      publishCreatedAt({
        manifestBody: null,
        directiveBody: null,
        fallback: "2026-05-09T00:00:00.000Z",
      }),
    ).toBe("2026-05-09T00:00:00.000Z");
  });
});

describe(servedCreatedAt, () => {
  it("uses the manifest body's createdAt for a signed update (served verbatim)", () => {
    // DB clock (createdAt) deliberately differs from the manifest clock; the
    // device sees the manifest body, so its commitTime is the body's createdAt.
    const row = {
      manifestBody: JSON.stringify({ createdAt: "2026-05-02T00:00:00.000Z" }),
      directiveBody: null,
      createdAt: "2026-05-09T00:00:00.000Z",
    };
    expect(servedCreatedAt(row)).toBe("2026-05-02T00:00:00.000Z");
  });

  it("uses the directive body's commitTime for a rollback directive", () => {
    const row = {
      manifestBody: null,
      directiveBody: JSON.stringify({ parameters: { commitTime: "2026-05-03T00:00:00.000Z" } }),
      createdAt: "2026-05-09T00:00:00.000Z",
    };
    expect(servedCreatedAt(row)).toBe("2026-05-03T00:00:00.000Z");
  });

  it("uses the DB createdAt for an unsigned update (no precomputed body)", () => {
    expect(
      servedCreatedAt({
        manifestBody: null,
        directiveBody: null,
        createdAt: "2026-05-09T00:00:00.000Z",
      }),
    ).toBe("2026-05-09T00:00:00.000Z");
  });

  it("falls back to the DB createdAt when a stored signed body lacks a string createdAt", () => {
    expect(
      servedCreatedAt({
        manifestBody: "{not json",
        directiveBody: null,
        createdAt: "2026-05-09T00:00:00.000Z",
      }),
    ).toBe("2026-05-09T00:00:00.000Z");
  });
});
