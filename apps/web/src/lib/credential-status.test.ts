import { STATUS_BADGE_VARIANT, deriveExpiryStatus } from "./credential-status";

const NOW = new Date("2026-05-19T00:00:00.000Z");

describe(deriveExpiryStatus, () => {
  it("returns muted/No expiry when validUntil is null", () => {
    expect(deriveExpiryStatus(null, NOW)).toStrictEqual({ tone: "muted", label: "No expiry" });
  });

  it("returns error/Expired when expiry is in the past", () => {
    expect(deriveExpiryStatus("2026-05-18T00:00:00.000Z", NOW)).toStrictEqual({
      tone: "error",
      label: "Expired",
    });
  });

  it("treats the exact instant of expiry as Expired", () => {
    expect(deriveExpiryStatus("2026-05-19T00:00:00.000Z", NOW)).toStrictEqual({
      tone: "error",
      label: "Expired",
    });
  });

  it("returns warning/Expires soon within 30 days", () => {
    const in15Days = new Date(NOW.getTime() + 15 * 24 * 60 * 60 * 1000).toISOString();
    expect(deriveExpiryStatus(in15Days, NOW)).toStrictEqual({
      tone: "warning",
      label: "Expires soon",
    });
  });

  it("treats 30-day boundary as Expires soon", () => {
    const in30Days = new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(deriveExpiryStatus(in30Days, NOW)).toStrictEqual({
      tone: "warning",
      label: "Expires soon",
    });
  });

  it("returns success/Active when expiry is comfortably future", () => {
    const in90Days = new Date(NOW.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();
    expect(deriveExpiryStatus(in90Days, NOW)).toStrictEqual({
      tone: "success",
      label: "Active",
    });
  });
});

it("STATUS_BADGE_VARIANT maps every tone to a Badge variant", () => {
  expect(STATUS_BADGE_VARIANT).toStrictEqual({
    error: "error",
    muted: "outline",
    success: "success",
    warning: "warning",
  });
});
