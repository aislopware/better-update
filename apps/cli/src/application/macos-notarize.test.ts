import { buildNotaryAuthArgs } from "./macos-notarize";

describe(buildNotaryAuthArgs, () => {
  it("builds the ASC API key argv with the staged .p8 path", () => {
    const args = buildNotaryAuthArgs({
      kind: "asc-api-key",
      p8Path: "/tmp/x/AuthKey_ABC123.p8",
      keyId: "ABC123",
      issuerId: "issuer-uuid",
    });
    expect(args).toStrictEqual([
      "--key",
      "/tmp/x/AuthKey_ABC123.p8",
      "--key-id",
      "ABC123",
      "--issuer",
      "issuer-uuid",
    ]);
  });

  it("builds the Apple ID + app-specific password argv", () => {
    const args = buildNotaryAuthArgs({
      kind: "app-specific-password",
      appleId: "dev@example.com",
      teamId: "TEAM123456",
      password: "abcd-efgh-ijkl-mnop",
    });
    expect(args).toStrictEqual([
      "--apple-id",
      "dev@example.com",
      "--team-id",
      "TEAM123456",
      "--password",
      "abcd-efgh-ijkl-mnop",
    ]);
  });
});
