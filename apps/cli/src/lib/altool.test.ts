import { extractAltoolErrors } from "./altool";

describe(extractAltoolErrors, () => {
  it("pulls product-error messages from an altool xml plist, unescaping entities", () => {
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<plist><dict><key>product-errors</key><array>",
      "<dict><key>message</key><string>Asset validation failed: missing icon &amp; bad bundle</string>",
      "<key>code</key><integer>90001</integer></dict>",
      "<dict><key>message</key><string>The build number 1 has already been used</string></dict>",
      "</array></dict></plist>",
    ].join("");

    expect(extractAltoolErrors(xml)).toStrictEqual([
      "Asset validation failed: missing icon & bad bundle",
      "The build number 1 has already been used",
    ]);
  });

  it("returns no messages when the output has no product-errors", () => {
    expect(extractAltoolErrors("UPLOAD FAILED with 1 error\nExitFailure (31)")).toStrictEqual([]);
  });
});
