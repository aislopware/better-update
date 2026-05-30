import { dropUnsignedWhenExpected, isUnsignedButSignatureExpected } from "./signature-policy";

const candidate = (id: string, signature: string | null) => ({ id, signature });

describe(dropUnsignedWhenExpected, () => {
  it("is identity (same reference) when the client did not request a signature", () => {
    const candidates = [candidate("a", null), candidate("b", "sig")];
    expect(dropUnsignedWhenExpected(candidates, undefined)).toBe(candidates);
  });

  it("drops unsigned candidates when expo-expect-signature is present", () => {
    const signed = candidate("b", "sig");
    expect(
      dropUnsignedWhenExpected([candidate("a", null), signed], 'sig, keyid="k"'),
    ).toStrictEqual([signed]);
  });

  it("returns empty when every candidate is unsigned and a signature is expected", () => {
    expect(
      dropUnsignedWhenExpected([candidate("a", null), candidate("b", null)], "sig"),
    ).toStrictEqual([]);
  });

  it("keeps all candidates when all are signed", () => {
    const candidates = [candidate("a", "s1"), candidate("b", "s2")];
    expect(dropUnsignedWhenExpected(candidates, "sig")).toStrictEqual(candidates);
  });
});

describe(isUnsignedButSignatureExpected, () => {
  it("true only when a signature is expected AND the update is unsigned", () => {
    expect(isUnsignedButSignatureExpected(candidate("a", null), "sig")).toBe(true);
  });

  it("false when the update is signed", () => {
    expect(isUnsignedButSignatureExpected(candidate("a", "sig"), "sig")).toBe(false);
  });

  it("false when no signature is expected, even for an unsigned update", () => {
    expect(isUnsignedButSignatureExpected(candidate("a", null), undefined)).toBe(false);
  });
});
