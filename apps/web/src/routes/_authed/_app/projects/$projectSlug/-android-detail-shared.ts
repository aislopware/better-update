import type {
  AndroidBuildCredentialsItem,
  AndroidUploadKeystoreItem,
  GoogleServiceAccountKeyItem,
} from "@better-update/api-client/react";

export const sortGroupsByDefault = (
  groups: readonly AndroidBuildCredentialsItem[],
): readonly AndroidBuildCredentialsItem[] =>
  [...groups].toSorted((left, right) => {
    if (left.isDefault && !right.isDefault) {
      return -1;
    }
    if (!left.isDefault && right.isDefault) {
      return 1;
    }
    return left.name.localeCompare(right.name);
  });

export const findKeystore = (
  items: readonly AndroidUploadKeystoreItem[],
  id: string | null,
): AndroidUploadKeystoreItem | null => {
  if (id === null) {
    return null;
  }
  const found = items.find((keystore) => keystore.id === id);
  return found === undefined ? null : found;
};

export const findGsa = (
  items: readonly GoogleServiceAccountKeyItem[],
  id: string | null,
): GoogleServiceAccountKeyItem | null => {
  if (id === null) {
    return null;
  }
  const found = items.find((sa) => sa.id === id);
  return found === undefined ? null : found;
};
