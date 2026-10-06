import {
  canStaple,
  classifyMacosArtifact,
  formatNotaryIssues,
  isNotaryTimeout,
  notaryFailureDetail,
  parseNotaryLog,
  parseNotaryResult,
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

// What `notarytool wait --timeout` really prints: nothing on stdout, the JSON
// on stderr, exit 124.
const TIMED_OUT = {
  exitCode: 124,
  stdout: "",
  stderr:
    '{"message":"Timeout of 5 second(s) was reached before processing completed.","id":"00000000-0000-0000-0000-000000000001"}',
};

describe(parseNotaryResult, () => {
  it("reads the id from stderr when stdout is empty (timeout)", () => {
    expect(parseNotaryResult(TIMED_OUT).id).toBe("00000000-0000-0000-0000-000000000001");
  });

  it("prefers stdout when it carries the payload", () => {
    const parsed = parseNotaryResult({
      exitCode: 0,
      stdout: '{"id":"from-stdout","status":"Accepted","message":"Processing complete"}',
      stderr: '{"id":"from-stderr"}',
    });
    expect(parsed.id).toBe("from-stdout");
  });
});

describe(isNotaryTimeout, () => {
  it("detects the timeout exit and message", () => {
    expect(isNotaryTimeout(TIMED_OUT)).toBe(true);
    expect(isNotaryTimeout({ ...TIMED_OUT, exitCode: 1 })).toBe(true);
  });

  it("does not treat an unknown submission as a timeout", () => {
    expect(
      isNotaryTimeout({
        exitCode: 69,
        stdout: "",
        stderr: '{"message":"Submission does not exist or does not belong to your team.","id":"x"}',
      }),
    ).toBe(false);
  });
});

// Real `notarytool log` output for an app built without the hardened runtime.
const REJECTED_LOG = JSON.stringify({
  logFormatVersion: 1,
  jobId: "00000000-0000-0000-0000-000000000001",
  status: "Invalid",
  statusSummary: "Archive contains critical validation errors",
  statusCode: 4000,
  archiveFilename: "My.zip",
  issues: ["x86_64", "arm64"].flatMap((architecture) => [
    {
      severity: "error",
      code: null,
      path: "My.zip/My.app/Contents/MacOS/My",
      message: "The executable does not have the hardened runtime enabled.",
      docUrl: "https://developer.apple.com/documentation/security",
      architecture,
    },
    {
      severity: "error",
      code: null,
      path: "My.zip/My.app/Contents/Helpers/tool",
      message: "The executable does not have the hardened runtime enabled.",
      docUrl: "https://developer.apple.com/documentation/security",
      architecture,
    },
  ]),
});

describe(parseNotaryLog, () => {
  it("strips the archive name from issue paths", () => {
    const issues = parseNotaryLog(REJECTED_LOG);
    expect(issues).toHaveLength(4);
    expect(issues[0]).toStrictEqual({
      severity: "error",
      path: "My.app/Contents/MacOS/My",
      architecture: "x86_64",
      message: "The executable does not have the hardened runtime enabled.",
    });
  });

  it("returns no issues for an unparseable log", () => {
    expect(parseNotaryLog("not json")).toStrictEqual([]);
    expect(parseNotaryLog('{"issues":[{"oops":true}]}')).toStrictEqual([]);
  });
});

describe(formatNotaryIssues, () => {
  it("folds per-architecture duplicates into one line per file and problem", () => {
    expect(formatNotaryIssues(parseNotaryLog(REJECTED_LOG))).toBe(
      [
        "  - [error] My.app/Contents/MacOS/My (x86_64, arm64): The executable does not have the hardened runtime enabled.",
        "  - [error] My.app/Contents/Helpers/tool (x86_64, arm64): The executable does not have the hardened runtime enabled.",
      ].join("\n"),
    );
  });
});
