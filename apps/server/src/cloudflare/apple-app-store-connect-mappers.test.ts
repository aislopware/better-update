import {
  extractDeviceSingle,
  extractDevicesPage,
  extractErrors,
  extractList,
  extractSingle,
  isRecord,
  mapDevice,
  toBundleId,
  toCertificate,
  toDeviceResource,
  toProfile,
} from "./apple-app-store-connect-mappers";

describe(isRecord, () => {
  test("detects object", () => {
    expect(isRecord({ key: 1 })).toBe(true);
  });
  test("rejects null", () => {
    expect(isRecord(null)).toBe(false);
  });
  test("rejects primitives", () => {
    expect(isRecord("x")).toBe(false);
    expect(isRecord(1)).toBe(false);
  });
});

describe(extractErrors, () => {
  test("returns [] for non-object", () => {
    expect(extractErrors(null)).toEqual([]);
  });
  test("returns [] when errors not array", () => {
    expect(extractErrors({ errors: "x" })).toEqual([]);
  });
  test("parses valid error bodies", () => {
    const body = { errors: [{ status: "400", code: "X", title: "T", detail: "D" }] };
    expect(extractErrors(body)[0]?.code).toBe("X");
  });
  test("filters non-objects", () => {
    expect(extractErrors({ errors: [null, 1, { code: "Y" }] })).toEqual([{ code: "Y" }]);
  });
});

describe(toDeviceResource, () => {
  test("returns null for non-object", () => {
    expect(toDeviceResource(null)).toBeNull();
  });
  test("parses valid device", () => {
    const value = {
      id: "dev1",
      attributes: {
        udid: "udid",
        name: "Phone",
        addedDate: "2026-01-01",
        deviceClass: "IPHONE",
        status: "ENABLED",
        model: "iPhone 15",
      },
    };
    expect(toDeviceResource(value)?.attributes.model).toBe("iPhone 15");
  });
  test("returns null for bad attributes", () => {
    expect(toDeviceResource({ id: "x", attributes: {} })).toBeNull();
  });
});

describe(mapDevice, () => {
  test("defaults null deviceClass to IPHONE", () => {
    const mapped = mapDevice({
      type: "devices",
      id: "x",
      attributes: {
        udid: "u",
        name: "n",
        addedDate: "2026-01-01",
        deviceClass: null,
        status: null,
        model: null,
      },
    });
    expect(mapped.deviceClass).toBe("IPHONE");
    expect(mapped.status).toBe("ENABLED");
  });
});

describe(extractDevicesPage, () => {
  test("returns empty for non-record", () => {
    expect(extractDevicesPage(null)).toEqual({ data: [], next: null });
  });
  test("extracts next link", () => {
    const page = extractDevicesPage({ data: [], links: { next: "https://..." } });
    expect(page.next).toBe("https://...");
  });
});

describe(extractDeviceSingle, () => {
  test("returns null for non-record", () => {
    expect(extractDeviceSingle(null)).toBeNull();
  });
});

describe(toBundleId, () => {
  test("parses valid", () => {
    expect(toBundleId({ id: "b1", attributes: { identifier: "com.x", name: "X" } })).toEqual({
      id: "b1",
      identifier: "com.x",
      name: "X",
    });
  });
  test("returns null for invalid", () => {
    expect(toBundleId(null)).toBeNull();
    expect(toBundleId({ id: "x", attributes: {} })).toBeNull();
  });
});

describe(toCertificate, () => {
  test("parses valid", () => {
    expect(
      toCertificate({
        id: "c1",
        attributes: {
          serialNumber: "ABC",
          certificateType: "DISTRIBUTION",
          expirationDate: "2027-01-01",
          displayName: "My cert",
        },
      })?.displayName,
    ).toBe("My cert");
  });
  test("null displayName when not string", () => {
    expect(
      toCertificate({
        id: "c1",
        attributes: {
          serialNumber: "ABC",
          certificateType: "DISTRIBUTION",
          expirationDate: "2027-01-01",
        },
      })?.displayName,
    ).toBeNull();
  });
  test("returns null for invalid", () => {
    expect(toCertificate(null)).toBeNull();
    expect(toCertificate({ id: "x", attributes: {} })).toBeNull();
  });
});

describe(toProfile, () => {
  test("parses valid", () => {
    const value = {
      id: "p1",
      attributes: {
        name: "N",
        uuid: "U",
        expirationDate: "2027-01-01",
        profileContent: "base64",
        profileType: "IOS_APP_STORE",
      },
    };
    expect(toProfile(value)?.profileType).toBe("IOS_APP_STORE");
  });
  test("rejects unknown profileType", () => {
    const value = {
      id: "p1",
      attributes: {
        name: "N",
        uuid: "U",
        expirationDate: "2027-01-01",
        profileContent: "b",
        profileType: "UNKNOWN",
      },
    };
    expect(toProfile(value)).toBeNull();
  });
  test("null for non-object", () => {
    expect(toProfile(null)).toBeNull();
  });
});

describe(extractList, () => {
  test("extracts items", () => {
    const body = { data: [{ id: "1", attributes: { identifier: "a", name: "A" } }] };
    expect(extractList(body, toBundleId)).toHaveLength(1);
  });
  test("returns [] for non-object", () => {
    expect(extractList(null, toBundleId)).toEqual([]);
  });
});

describe(extractSingle, () => {
  test("extracts item", () => {
    const body = { data: { id: "1", attributes: { identifier: "a", name: "A" } } };
    expect(extractSingle(body, toBundleId)?.identifier).toBe("a");
  });
  test("returns null for non-object", () => {
    expect(extractSingle(null, toBundleId)).toBeNull();
  });
});
