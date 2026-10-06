import { profilePlistXml } from "./provisioning-profile-plist";

const envelope = (plist: string) => {
  const body = new TextEncoder().encode(plist);
  // Binary CMS framing around the content, with bytes that are not valid UTF-8.
  return new Uint8Array([0x30, 0x82, 0xff, 0x3c, 0x06, ...body, 0xa0, 0x82, 0x3c, 0x00]);
};

describe(profilePlistXml, () => {
  it("returns the plist between the envelope's binary framing, decoded as UTF-8", () => {
    const plist =
      '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>Name</key><string>Café ✓</string></dict></plist>';
    expect(profilePlistXml(envelope(plist))).toBe(plist);
  });

  it("returns undefined when the bytes hold no plist", () => {
    expect(profilePlistXml(new Uint8Array([0x30, 0x82, 0x01]))).toBeUndefined();
  });

  it("returns undefined when the plist is cut off", () => {
    expect(profilePlistXml(envelope('<?xml version="1.0"?><plist><dict>'))).toBeUndefined();
  });
});
