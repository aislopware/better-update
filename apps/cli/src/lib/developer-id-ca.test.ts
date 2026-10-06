import { developerIdCaGeneration } from "./developer-id-ca";

describe(developerIdCaGeneration, () => {
  it("recognises the G2 intermediate by its OU", () => {
    expect(
      developerIdCaGeneration({
        certificateType: "DEVELOPER_ID_APPLICATION",
        issuerCN: "Developer ID Certification Authority",
        issuerOrgUnit: "G2",
      }),
    ).toBe("G2");
  });

  it("treats the original intermediate as G1", () => {
    expect(
      developerIdCaGeneration({
        certificateType: "DEVELOPER_ID_INSTALLER",
        issuerCN: "Developer ID Certification Authority",
        issuerOrgUnit: "Apple Certification Authority",
      }),
    ).toBe("G1");
  });

  it("has nothing to say about other certificates", () => {
    expect(
      developerIdCaGeneration({
        certificateType: "IOS_DISTRIBUTION",
        issuerCN: "Apple Worldwide Developer Relations Certification Authority",
        issuerOrgUnit: "G3",
      }),
    ).toBeUndefined();
  });
});
