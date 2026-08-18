/**
 * Subject-attribute reads that node-forge cannot do by name.
 *
 * Apple carries the Developer ID identifier in the X.520 `UID` attribute, but
 * node-forge's OID table has no entry for `0.9.2342.19200300.100.1.1`, so the
 * parsed attribute comes back with `shortName`/`name` both undefined and
 * `subject.getField("UID")` returns null for every certificate that has one.
 * Matching on the OID is the only way to read it.
 */

/** X.520 `UID` (userId), the attribute Apple puts the Developer ID in. */
const UID_OID = "0.9.2342.19200300.100.1.1";

export interface SubjectAttributeLike {
  readonly shortName?: string | undefined;
  readonly type?: string | undefined;
  readonly value?: unknown;
}

/**
 * The `UID` subject attribute, which only Developer ID certificates carry.
 * `shortName` is still checked first so a node-forge that learns the OID keeps
 * working.
 */
export const readDeveloperIdIdentifier = (
  attributes: readonly SubjectAttributeLike[],
): string | undefined => {
  const found = attributes.find((attr) => attr.shortName === "UID" || attr.type === UID_OID);
  return typeof found?.value === "string" ? found.value : undefined;
};
