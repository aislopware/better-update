import { logoRejectionReason } from "./projects";

// The logo finalize step (`setLogo`) gates the uploaded R2 object on these rules,
// since a presigned PUT can neither cap its own size nor fully constrain its type.
describe(logoRejectionReason, () => {
  it("accepts each allowed image type within the size cap", () => {
    const types = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
    for (const contentType of types) {
      expect(logoRejectionReason({ size: 1024, contentType })).toBeNull();
    }
  });

  it("accepts a missing content type (R2 recorded none)", () => {
    expect(logoRejectionReason({ size: 1024, contentType: null })).toBeNull();
  });

  it("rejects an object larger than 2 MiB", () => {
    expect(logoRejectionReason({ size: 2_097_153, contentType: "image/png" })).toBe(
      "Logo must be 2 MB or smaller",
    );
  });

  it("accepts an object exactly at the 2 MiB boundary", () => {
    expect(logoRejectionReason({ size: 2_097_152, contentType: "image/png" })).toBeNull();
  });

  it("rejects a disallowed content type", () => {
    expect(logoRejectionReason({ size: 1024, contentType: "image/gif" })).toBe(
      "Unsupported logo type: image/gif",
    );
  });

  it("checks the size cap before the content type", () => {
    expect(logoRejectionReason({ size: 9_999_999, contentType: "image/gif" })).toBe(
      "Logo must be 2 MB or smaller",
    );
  });
});
