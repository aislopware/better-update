import { certificateTypeFromCommonName, isMacosCertificateType } from "./apple-certificate-type";

describe(certificateTypeFromCommonName, () => {
  it.each([
    ["Developer ID Application: Example Inc (A1B2C3D4E5)", "DEVELOPER_ID_APPLICATION"],
    ["Developer ID Installer: Example Inc (A1B2C3D4E5)", "DEVELOPER_ID_INSTALLER"],
    ["3rd Party Mac Developer Application: Example Inc", "MAC_APP_DISTRIBUTION"],
    ["3rd Party Mac Developer Installer: Example Inc", "MAC_INSTALLER_DISTRIBUTION"],
    ["Mac App Distribution: Example Inc", "MAC_APP_DISTRIBUTION"],
    ["Mac Installer Distribution: Example Inc", "MAC_INSTALLER_DISTRIBUTION"],
    ["Mac Developer: dev@example.com (A1B2C3D4E5)", "MAC_APP_DEVELOPMENT"],
    ["Apple Distribution: Example Inc (A1B2C3D4E5)", "IOS_DISTRIBUTION"],
    ["Apple Development: dev@example.com (A1B2C3D4E5)", "IOS_DEVELOPMENT"],
    ["iPhone Distribution: Example Inc (A1B2C3D4E5)", "IOS_DISTRIBUTION"],
    ["iPhone Developer: dev@example.com (A1B2C3D4E5)", "IOS_DEVELOPMENT"],
  ])("maps %s", (commonName, expected) => {
    expect(certificateTypeFromCommonName(commonName)).toBe(expected);
  });

  // A missing or unfamiliar CN must not make a stored certificate vanish from
  // the iOS lists — that is the state every row predating mig 0101 is in.
  it.each([null, undefined, "", "Some Other Certificate: Example"])(
    "falls back to IOS_DISTRIBUTION for %s",
    (commonName) => {
      expect(certificateTypeFromCommonName(commonName)).toBe("IOS_DISTRIBUTION");
    },
  );

  it("ignores case and surrounding whitespace", () => {
    expect(certificateTypeFromCommonName("  DEVELOPER ID APPLICATION: Example  ")).toBe(
      "DEVELOPER_ID_APPLICATION",
    );
  });
});

describe(isMacosCertificateType, () => {
  it("counts every Developer ID and Mac certificate as macOS", () => {
    expect(isMacosCertificateType("DEVELOPER_ID_APPLICATION")).toBe(true);
    expect(isMacosCertificateType("DEVELOPER_ID_INSTALLER")).toBe(true);
    expect(isMacosCertificateType("MAC_APP_DISTRIBUTION")).toBe(true);
    expect(isMacosCertificateType("MAC_INSTALLER_DISTRIBUTION")).toBe(true);
    expect(isMacosCertificateType("MAC_APP_DEVELOPMENT")).toBe(true);
  });

  it("counts the universal Apple certificates as iOS", () => {
    expect(isMacosCertificateType("IOS_DISTRIBUTION")).toBe(false);
    expect(isMacosCertificateType("IOS_DEVELOPMENT")).toBe(false);
  });
});
