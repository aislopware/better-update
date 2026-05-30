/// <reference types="vitest/globals" />

import {
  buildExpoSignatureHeader,
  CODE_SIGNING_ALG,
  extractLeafCertificatePem,
  isExpoSignatureParseFailure,
  parseExpectSignatureHeader,
  parseExpoSignatureHeader,
} from "./index";

describe(buildExpoSignatureHeader, () => {
  it("emits the exact expo-signature SFV dictionary shape", () => {
    expect(buildExpoSignatureHeader({ sig: "aGVsbG8=", keyid: "main" })).toBe(
      'sig="aGVsbG8=", keyid="main", alg="rsa-v1_5-sha256"',
    );
  });

  it("defaults alg to the only SDK56 algorithm", () => {
    const header = buildExpoSignatureHeader({ sig: "abc", keyid: "main" });
    expect(header).toContain(`alg="${CODE_SIGNING_ALG}"`);
    expect(CODE_SIGNING_ALG).toBe("rsa-v1_5-sha256");
  });
});

describe(parseExpoSignatureHeader, () => {
  it("round-trips a built header back to its parts", () => {
    const header = buildExpoSignatureHeader({ sig: "aGVsbG8=", keyid: "main" });
    const parsed = parseExpoSignatureHeader(header);
    expect(isExpoSignatureParseFailure(parsed)).toBe(false);
    if (!isExpoSignatureParseFailure(parsed)) {
      expect(parsed.sig).toBe("aGVsbG8=");
      expect(parsed.keyid).toBe("main");
      expect(parsed.alg).toBe("rsa-v1_5-sha256");
    }
  });

  it("returns a typed failure (no throw) on a malformed string", () => {
    const parsed = parseExpoSignatureHeader("this is not = a valid \u0000 sfv dictionary");
    expect(isExpoSignatureParseFailure(parsed)).toBe(true);
  });

  it("returns a typed failure when sig is missing", () => {
    const parsed = parseExpoSignatureHeader('keyid="main", alg="rsa-v1_5-sha256"');
    expect(isExpoSignatureParseFailure(parsed)).toBe(true);
  });

  it("parses with sig only (no keyid/alg)", () => {
    const parsed = parseExpoSignatureHeader('sig="abc"');
    expect(isExpoSignatureParseFailure(parsed)).toBe(false);
    if (!isExpoSignatureParseFailure(parsed)) {
      expect(parsed.sig).toBe("abc");
      expect(parsed.keyid).toBeUndefined();
      expect(parsed.alg).toBeUndefined();
    }
  });
});

describe(parseExpectSignatureHeader, () => {
  it("extracts alg and keyid from an expo-expect-signature header (bare sig token)", () => {
    const parsed = parseExpectSignatureHeader('sig, keyid="main", alg="rsa-v1_5-sha256"');
    expect(parsed.keyid).toBe("main");
    expect(parsed.alg).toBe("rsa-v1_5-sha256");
  });

  it("returns empty object on a malformed header (no throw)", () => {
    expect(parseExpectSignatureHeader("\u0000not valid")).toStrictEqual({});
  });
});

describe(extractLeafCertificatePem, () => {
  const cert = (label: string) =>
    `-----BEGIN CERTIFICATE-----\n${label}\n-----END CERTIFICATE-----`;

  it("returns the FIRST (leaf) certificate from a multi-cert chain", () => {
    const chain = `${cert("LEAF")}\n${cert("INTERMEDIATE")}\n${cert("ROOT")}`;
    expect(extractLeafCertificatePem(chain)).toBe(cert("LEAF"));
  });

  it("returns the single cert when the chain has only one", () => {
    expect(extractLeafCertificatePem(cert("ONLY"))).toBe(cert("ONLY"));
  });

  it("returns undefined when no certificate block is present", () => {
    expect(extractLeafCertificatePem("not a pem")).toBeUndefined();
  });
});
