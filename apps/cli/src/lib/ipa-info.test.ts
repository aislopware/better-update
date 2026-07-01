import { pickAppInfoPlistEntry } from "./ipa-info";

describe(pickAppInfoPlistEntry, () => {
  it("picks the top-level app bundle Info.plist", () => {
    const entries = [
      "Payload/",
      "Payload/Rockxy.app/",
      "Payload/Rockxy.app/Info.plist",
      "Payload/Rockxy.app/Rockxy",
    ];
    expect(pickAppInfoPlistEntry(entries)).toBe("Payload/Rockxy.app/Info.plist");
  });

  it("ignores nested framework and extension Info.plists", () => {
    const entries = [
      "Payload/Rockxy.app/Frameworks/Hermes.framework/Info.plist",
      "Payload/Rockxy.app/PlugIns/Widget.appex/Info.plist",
      "Payload/Rockxy.app/Info.plist",
    ];
    expect(pickAppInfoPlistEntry(entries)).toBe("Payload/Rockxy.app/Info.plist");
  });

  it("tolerates surrounding whitespace from unzip output", () => {
    expect(pickAppInfoPlistEntry(["  Payload/My App.app/Info.plist  "])).toBe(
      "Payload/My App.app/Info.plist",
    );
  });

  it("returns undefined when no app Info.plist is present", () => {
    expect(pickAppInfoPlistEntry(["Payload/", "Payload/Rockxy.app/Rockxy"])).toBeUndefined();
  });
});
