import type { DeviceClass } from "../models";

const LEGACY_UDID = /^[A-Fa-f0-9]{40}$/;
const MODERN_UDID = /^[A-Fa-f0-9]{8}-[A-Fa-f0-9]{16}$/;
const MAC_UUID = /^[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}$/;

export const normalizeIdentifier = (raw: string): string => raw.trim().toLowerCase();

export const isValidIdentifier = (identifier: string): boolean =>
  LEGACY_UDID.test(identifier) || MODERN_UDID.test(identifier) || MAC_UUID.test(identifier);

export const inferDeviceClass = (identifier: string): DeviceClass => {
  const normalized = normalizeIdentifier(identifier);
  if (MAC_UUID.test(normalized)) {
    return "MAC";
  }
  if (MODERN_UDID.test(normalized) || LEGACY_UDID.test(normalized)) {
    return "IPHONE";
  }
  return "UNKNOWN";
};
