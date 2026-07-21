import {
  canStaple,
  classifyMacosArtifact,
  notaryFailureDetail,
  parseNotarySubmission,
} from "./macos-notary";

describe(parseNotarySubmission, () => {
  it("parses the full --wait payload", () => {
    const parsed = parseNotarySubmission(
      '{"id":"abc-123","status":"Accepted","message":"Processing complete"}',
    );
    expect(parsed).toStrictEqual({
      id: "abc-123",
      status: "Accepted",
      message: "Processing complete",
    });
  });

  it("parses an upload-only payload without status", () => {
    const parsed = parseNotarySubmission('{"id":"abc-123","message":"Successfully uploaded file"}');
    expect(parsed.id).toBe("abc-123");
    expect(parsed.status).toBeUndefined();
  });

  it("tolerates non-JSON noise before the payload", () => {
    const parsed = parseNotarySubmission(
      'Conducting pre-submission checks...\n{"id":"xyz","status":"Invalid","message":"nope"}',
    );
    expect(parsed.status).toBe("Invalid");
  });

  it("returns undefined fields when no JSON object exists", () => {
    expect(parseNotarySubmission("plain text")).toStrictEqual({
      id: undefined,
      status: undefined,
      message: undefined,
    });
  });

  it("returns undefined fields on malformed JSON", () => {
    expect(parseNotarySubmission("{not json").id).toBeUndefined();
  });
});

describe(notaryFailureDetail, () => {
  it("prefers the parsed notarytool message", () => {
    const detail = notaryFailureDetail({
      exitCode: 1,
      stdout: '{"message":"Invalid credentials"}',
      stderr: "ignored",
    });
    expect(detail).toBe("Invalid credentials");
  });

  it("falls back to raw streams", () => {
    const detail = notaryFailureDetail({ exitCode: 1, stdout: "", stderr: "boom" });
    expect(detail).toBe("boom");
  });

  it("stubs when there is no output at all", () => {
    expect(notaryFailureDetail({ exitCode: 1, stdout: "", stderr: "" })).toBe("no output");
  });
});

describe(classifyMacosArtifact, () => {
  it("classifies each supported extension case-insensitively", () => {
    expect(classifyMacosArtifact("/x/My App.app")).toBe("app");
    expect(classifyMacosArtifact("/x/My App.APP/")).toBe("app");
    expect(classifyMacosArtifact("/x/installer.DMG")).toBe("dmg");
    expect(classifyMacosArtifact("/x/installer.pkg")).toBe("pkg");
    expect(classifyMacosArtifact("/x/bundle.zip")).toBe("zip");
  });

  it("returns null for anything else", () => {
    expect(classifyMacosArtifact("/x/tool")).toBeNull();
    expect(classifyMacosArtifact("/x/app.ipa")).toBeNull();
  });
});

describe(canStaple, () => {
  it("staples everything except zip", () => {
    expect(canStaple("app")).toBe(true);
    expect(canStaple("dmg")).toBe(true);
    expect(canStaple("pkg")).toBe(true);
    expect(canStaple("zip")).toBe(false);
  });
});
