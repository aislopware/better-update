import { it } from "@effect/vitest";
import { Effect } from "effect";
import forge from "node-forge";

import { inspectP12 } from "./pkcs12";

// A real .p12 rather than a mocked parser: the fields this module reads
// (`UID` above all) depend on how node-forge decodes an actual DER subject, and
// a stub would have agreed with the broken version too — node-forge has no name
// for the UID OID, so `getField("UID")` returns null for every certificate
// carrying one.
const makeP12 = (params: {
  readonly password: string;
  readonly commonName: string;
  readonly organizationalUnit: string;
  readonly uid?: string;
}): Buffer => {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "0a1b2c";
  cert.validity.notBefore = new Date("2026-01-01T00:00:00Z");
  cert.validity.notAfter = new Date("2027-01-01T00:00:00Z");
  cert.setSubject([
    { name: "commonName", value: params.commonName },
    { shortName: "OU", value: params.organizationalUnit },
    ...(params.uid === undefined ? [] : [{ type: "0.9.2342.19200300.100.1.1", value: params.uid }]),
  ]);
  cert.setIssuer([{ name: "commonName", value: "Example Certification Authority" }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, cert, params.password, {
    algorithm: "3des",
  });
  return Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), "binary");
};

describe(inspectP12, () => {
  it.effect("classifies a Developer ID certificate and reads its UID", () =>
    Effect.gen(function* () {
      const data = makeP12({
        password: "pw",
        commonName: "Developer ID Application: Example Corp (ABCDE12345)",
        organizationalUnit: "ABCDE12345",
        uid: "ABCDE12345",
      });

      const info = yield* inspectP12({ data, password: "pw" });

      expect(info.certificateType).toBe("DEVELOPER_ID_APPLICATION");
      expect(info.developerIdIdentifier).toBe("ABCDE12345");
      expect(info.teamId).toBe("ABCDE12345");
      expect(info.signingIdentity).toBe("Developer ID Application: Example Corp (ABCDE12345)");
    }),
  );

  it.effect("classifies an iOS distribution certificate, which carries no UID", () =>
    Effect.gen(function* () {
      const data = makeP12({
        password: "pw",
        commonName: "Apple Distribution: Example Corp (ABCDE12345)",
        organizationalUnit: "ABCDE12345",
      });

      const info = yield* inspectP12({ data, password: "pw" });

      expect(info.certificateType).toBe("IOS_DISTRIBUTION");
      expect(info.developerIdIdentifier).toBeUndefined();
    }),
  );

  it.effect("classifies a Mac installer certificate", () =>
    Effect.gen(function* () {
      const data = makeP12({
        password: "pw",
        commonName: "3rd Party Mac Developer Installer: Example Corp (ABCDE12345)",
        organizationalUnit: "ABCDE12345",
      });

      const info = yield* inspectP12({ data, password: "pw" });

      expect(info.certificateType).toBe("MAC_INSTALLER_DISTRIBUTION");
    }),
  );

  it.effect("fails with a validation error on the wrong password", () =>
    Effect.gen(function* () {
      const data = makeP12({
        password: "pw",
        commonName: "Apple Distribution: Example Corp (ABCDE12345)",
        organizationalUnit: "ABCDE12345",
      });

      const result = yield* Effect.either(inspectP12({ data, password: "not-the-password" }));

      expect(result._tag).toBe("Left");
    }),
  );
});
