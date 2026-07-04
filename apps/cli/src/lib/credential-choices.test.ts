import {
  AndroidUploadKeystore,
  AppleDistributionCertificate,
  ApplePushKey,
  AppleTeam,
} from "@better-update/api";

import {
  distributionCertChoice,
  keystoreChoice,
  makeAppleTeamLabeler,
  pushKeyChoice,
} from "./credential-choices";

const keystore = (overrides: Partial<AndroidUploadKeystore>): AndroidUploadKeystore =>
  AndroidUploadKeystore.make({
    id: overrides.id ?? "11111111-2222-3333-4444-555555555555",
    organizationId: overrides.organizationId ?? "org",
    name: overrides.name ?? null,
    protected: overrides.protected ?? false,
    boundProjectIds: overrides.boundProjectIds ?? [],
    keyAlias: overrides.keyAlias ?? "upload",
    md5Fingerprint: overrides.md5Fingerprint ?? null,
    sha1Fingerprint: overrides.sha1Fingerprint ?? null,
    sha256Fingerprint: overrides.sha256Fingerprint ?? null,
    keystoreType: overrides.keystoreType ?? null,
    createdAt: overrides.createdAt ?? "2026-01-02T03:04:05.000Z",
    updatedAt: overrides.updatedAt ?? "2026-01-02T03:04:05.000Z",
  });

describe(keystoreChoice, () => {
  it("surfaces the type, creation date, and SHA-1 fingerprint", () => {
    const choice = keystoreChoice(
      keystore({ keyAlias: "x9f", keystoreType: "JKS", sha1Fingerprint: "AB:CD:EF" }),
    );
    expect(choice.label).toBe("x9f (JKS, created 2026-01-02)");
    expect(choice.hint).toBe("SHA-1 AB:CD:EF");
  });

  it("omits a null type and falls back to a short id hint", () => {
    const choice = keystoreChoice(
      keystore({
        id: "abcdef0123456789",
        keyAlias: "x9f",
        keystoreType: null,
        sha1Fingerprint: null,
      }),
    );
    expect(choice.label).toBe("x9f (created 2026-01-02)");
    expect(choice.hint).toBe("id abcdef01…");
  });

  it("leads with the user-supplied name, keeping the alias alongside it", () => {
    const choice = keystoreChoice(
      keystore({ name: "alphonso release upload key", keyAlias: "jmango", keystoreType: "JKS" }),
    );
    expect(choice.label).toBe(
      "alphonso release upload key (alias jmango) (JKS, created 2026-01-02)",
    );
  });
});

const pushKey = ApplePushKey.make({
  id: "id",
  organizationId: "org",
  appleTeamId: "team-uuid",
  keyId: "ABC1234567",
  createdAt: "2026-02-03T00:00:00.000Z",
  updatedAt: "2026-02-03T00:00:00.000Z",
});

describe(pushKeyChoice, () => {
  it("falls back to the internal team id when no label is given", () => {
    expect(pushKeyChoice(pushKey).label).toBe("ABC1234567 (team team-uuid, added 2026-02-03)");
  });

  it("uses the resolved team label when provided", () => {
    expect(pushKeyChoice(pushKey, "Acme Inc.").label).toBe(
      "ABC1234567 (team Acme Inc., added 2026-02-03)",
    );
  });
});

const appleTeam = (overrides: Partial<AppleTeam>): AppleTeam =>
  AppleTeam.make({
    id: overrides.id ?? "team-uuid",
    organizationId: overrides.organizationId ?? "org",
    appleTeamId: overrides.appleTeamId ?? "ABCDE12345",
    appleTeamType: overrides.appleTeamType ?? "COMPANY_ORGANIZATION",
    name: overrides.name ?? null,
    protected: overrides.protected ?? false,
    boundProjectIds: overrides.boundProjectIds ?? [],
    distributionCertificateCount: overrides.distributionCertificateCount ?? 0,
    pushKeyCount: overrides.pushKeyCount ?? 0,
    ascApiKeyCount: overrides.ascApiKeyCount ?? 0,
    provisioningProfileCount: overrides.provisioningProfileCount ?? 0,
    deviceCount: overrides.deviceCount ?? 0,
    createdAt: overrides.createdAt ?? "2025-01-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2025-01-01T00:00:00.000Z",
  });

describe(makeAppleTeamLabeler, () => {
  it("prefers the team name, falls back to the portal id, then the raw id", () => {
    const labeler = makeAppleTeamLabeler([
      appleTeam({ id: "named", name: "Acme Inc.", appleTeamId: "ABCDE12345" }),
      appleTeam({ id: "anon", name: null, appleTeamId: "ZZZZZ99999" }),
    ]);
    expect(labeler("named")).toBe("Acme Inc.");
    expect(labeler("anon")).toBe("ZZZZZ99999");
    expect(labeler("missing")).toBe("missing");
  });
});

const distributionCert = AppleDistributionCertificate.make({
  id: "id",
  organizationId: "org",
  appleTeamId: "team-uuid",
  serialNumber: "0123456789ABCDEF",
  developerIdIdentifier: null,
  validFrom: "2025-01-01T00:00:00.000Z",
  validUntil: "2027-01-01T00:00:00.000Z",
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
});

describe(distributionCertChoice, () => {
  it("truncates the serial and surfaces the expiry", () => {
    expect(distributionCertChoice(distributionCert).label).toBe(
      "0123456789AB… (team team-uuid, exp 2027-01-01)",
    );
  });

  it("uses the resolved team label when provided", () => {
    expect(distributionCertChoice(distributionCert, "Acme Inc.").label).toBe(
      "0123456789AB… (team Acme Inc., exp 2027-01-01)",
    );
  });
});
