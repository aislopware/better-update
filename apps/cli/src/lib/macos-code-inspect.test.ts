import {
  distributionEntitlements,
  parseCodesignDisplay,
  restrictedEntitlements,
} from "./macos-code-inspect";

// Real `codesign -dvvv` output (identity anonymized).
const DEVELOPER_ID_OUTPUT = `Executable=/tmp/My.app/Contents/MacOS/sidecar
Identifier=sidecar
Format=Mach-O universal (x86_64 arm64)
CodeDirectory v=20500 size=307 flags=0x10000(runtime) hashes=4+2 location=embedded
Hash type=sha256 size=32
Signature size=9103
Authority=Developer ID Application: Example Corp (ABCDE12345)
Authority=Developer ID Certification Authority
Authority=Apple Root CA
Timestamp=5 Oct 2026 at 15:14:06
Info.plist=not bound
TeamIdentifier=ABCDE12345
Runtime Version=27.0.0
Sealed Resources=none`;

// What cargo / ld leave on a freshly linked binary.
const LINKER_SIGNED_OUTPUT = `Executable=/tmp/My.app/Contents/MacOS/engine
Identifier=engine-55823b8f36f00161
Format=Mach-O universal (x86_64 arm64)
CodeDirectory v=20400 size=34552 flags=0x20002(adhoc,linker-signed) hashes=1076+0 location=embedded
Signature=adhoc
Info.plist=not bound
TeamIdentifier=not set
Sealed Resources=none`;

describe(parseCodesignDisplay, () => {
  it("reads a Developer ID signature with runtime and a secure timestamp", () => {
    expect(parseCodesignDisplay(DEVELOPER_ID_OUTPUT)).toStrictEqual({
      signed: true,
      identifier: "sidecar",
      teamId: "ABCDE12345",
      authorities: [
        "Developer ID Application: Example Corp (ABCDE12345)",
        "Developer ID Certification Authority",
        "Apple Root CA",
      ],
      secureTimestamp: true,
      adhoc: false,
      linkerSigned: false,
      runtime: true,
    });
  });

  it("flags a linker-signed ad-hoc binary as having no identity, team, or runtime", () => {
    const parsed = parseCodesignDisplay(LINKER_SIGNED_OUTPUT);
    expect(parsed).toMatchObject({
      signed: true,
      teamId: undefined,
      authorities: [],
      adhoc: true,
      linkerSigned: true,
      runtime: false,
      secureTimestamp: false,
    });
  });

  it("reports unsigned code", () => {
    expect(parseCodesignDisplay("/tmp/x: code object is not signed at all").signed).toBe(false);
  });

  it("does not mistake `Signed Time=` for a secure timestamp", () => {
    const output = DEVELOPER_ID_OUTPUT.replace("Timestamp=", "Signed Time=");
    expect(parseCodesignDisplay(output).secureTimestamp).toBe(false);
  });
});

describe(distributionEntitlements, () => {
  it("drops get-task-allow and keeps the rest", () => {
    expect(
      distributionEntitlements({
        "com.apple.security.get-task-allow": true,
        "com.apple.security.cs.allow-jit": true,
      }),
    ).toStrictEqual({ "com.apple.security.cs.allow-jit": true });
  });

  it("returns undefined when only get-task-allow was present", () => {
    expect(distributionEntitlements({ "com.apple.security.get-task-allow": true })).toBeUndefined();
  });
});

describe(restrictedEntitlements, () => {
  it("treats the com.apple.security family as profile-free", () => {
    expect(
      restrictedEntitlements({
        "com.apple.security.cs.allow-jit": true,
        "com.apple.security.app-sandbox": true,
        "com.apple.security.application-groups": ["ABCDE12345.group.example"],
        "com.apple.security.network.client": true,
      }),
    ).toStrictEqual([]);
  });

  it("lists entitlements that need a Developer ID provisioning profile", () => {
    expect(
      restrictedEntitlements({
        "com.apple.security.cs.allow-jit": true,
        "com.apple.developer.associated-domains": ["applinks:example.com"],
        "keychain-access-groups": ["ABCDE12345.com.example.shared"],
      }),
    ).toStrictEqual(["com.apple.developer.associated-domains", "keychain-access-groups"]);
  });
});
