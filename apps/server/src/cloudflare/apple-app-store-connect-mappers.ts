import { isRecord } from "@better-update/type-guards";

import type {
  AppleBundleId,
  AppleCertificate,
  AppleDevice,
  AppleDeviceClass,
  AppleDeviceStatus,
  AppleProfile,
  AppleProfileType,
} from "./apple-app-store-connect";

interface DeviceAttributes {
  readonly udid: string;
  readonly name: string;
  readonly model: string | null;
  readonly deviceClass: AppleDeviceClass | null;
  readonly status: AppleDeviceStatus | null;
  readonly addedDate: string;
}

interface DeviceResource {
  type: "devices";
  id: string;
  attributes: DeviceAttributes;
}

export interface AppleErrorBody {
  readonly status?: string;
  readonly code?: string;
  readonly title?: string;
  readonly detail?: string;
}

const toErrorBody = (value: unknown): AppleErrorBody | null => {
  if (!isRecord(value)) {
    return null;
  }
  return {
    ...(typeof value["status"] === "string" ? { status: value["status"] } : {}),
    ...(typeof value["code"] === "string" ? { code: value["code"] } : {}),
    ...(typeof value["title"] === "string" ? { title: value["title"] } : {}),
    ...(typeof value["detail"] === "string" ? { detail: value["detail"] } : {}),
  };
};

export const extractErrors = (body: unknown): readonly AppleErrorBody[] => {
  if (!isRecord(body)) {
    return [];
  }
  const { errors } = body;
  if (!Array.isArray(errors)) {
    return [];
  }
  return errors
    .map((value) => toErrorBody(value))
    .filter((value): value is AppleErrorBody => value !== null);
};

const APPLE_DEVICE_CLASSES: readonly AppleDeviceClass[] = [
  "IPHONE",
  "IPAD",
  "MAC",
  "APPLE_WATCH",
  "APPLE_TV",
];

const APPLE_DEVICE_STATUSES: readonly AppleDeviceStatus[] = ["ENABLED", "DISABLED", "PROCESSING"];

const PROFILE_TYPES: readonly AppleProfileType[] = [
  "IOS_APP_ADHOC",
  "IOS_APP_DEVELOPMENT",
  "IOS_APP_STORE",
  "IOS_APP_INHOUSE",
];

const asDeviceClass = (value: unknown): AppleDeviceClass | null => {
  const match = APPLE_DEVICE_CLASSES.find((entry) => entry === value);
  return match === undefined ? null : match;
};

const asDeviceStatus = (value: unknown): AppleDeviceStatus | null => {
  const match = APPLE_DEVICE_STATUSES.find((entry) => entry === value);
  return match === undefined ? null : match;
};

const asProfileType = (value: unknown): AppleProfileType | null => {
  const match = PROFILE_TYPES.find((entry) => entry === value);
  return match === undefined ? null : match;
};

export const toDeviceResource = (value: unknown): DeviceResource | null => {
  if (!isRecord(value)) {
    return null;
  }
  const { id, attributes } = value;
  if (typeof id !== "string" || !isRecord(attributes)) {
    return null;
  }
  const { udid, name, addedDate } = attributes;
  if (typeof udid !== "string" || typeof name !== "string" || typeof addedDate !== "string") {
    return null;
  }
  const model = typeof attributes["model"] === "string" ? attributes["model"] : null;
  return {
    type: "devices",
    id,
    attributes: {
      udid,
      name,
      addedDate,
      model,
      deviceClass: asDeviceClass(attributes["deviceClass"]),
      status: asDeviceStatus(attributes["status"]),
    },
  };
};

export const extractDevicesPage = (
  body: unknown,
): { readonly data: readonly DeviceResource[]; readonly next: string | null } => {
  if (!isRecord(body)) {
    return { data: [], next: null };
  }
  const rawData = Array.isArray(body["data"]) ? body["data"] : [];
  const data = rawData
    .map((value) => toDeviceResource(value))
    .filter((value): value is DeviceResource => value !== null);
  const links = isRecord(body["links"]) ? body["links"] : null;
  const next = links && typeof links["next"] === "string" ? links["next"] : null;
  return { data, next };
};

export const extractDeviceSingle = (body: unknown): DeviceResource | null => {
  if (!isRecord(body)) {
    return null;
  }
  return toDeviceResource(body["data"]);
};

export const mapDevice = (resource: DeviceResource): AppleDevice => {
  const { attributes } = resource;
  return {
    id: resource.id,
    udid: attributes.udid,
    name: attributes.name,
    model: attributes.model,
    deviceClass: attributes.deviceClass === null ? "IPHONE" : attributes.deviceClass,
    status: attributes.status === null ? "ENABLED" : attributes.status,
    addedDate: attributes.addedDate,
  };
};

export const toBundleId = (value: unknown): AppleBundleId | null => {
  if (!isRecord(value)) {
    return null;
  }
  const { id, attributes } = value;
  if (typeof id !== "string" || !isRecord(attributes)) {
    return null;
  }
  const { identifier, name } = attributes;
  if (typeof identifier !== "string" || typeof name !== "string") {
    return null;
  }
  return { id, identifier, name };
};

export const toCertificate = (value: unknown): AppleCertificate | null => {
  if (!isRecord(value)) {
    return null;
  }
  const { id, attributes } = value;
  if (typeof id !== "string" || !isRecord(attributes)) {
    return null;
  }
  const { serialNumber, certificateType, expirationDate } = attributes;
  if (
    typeof serialNumber !== "string" ||
    typeof certificateType !== "string" ||
    typeof expirationDate !== "string"
  ) {
    return null;
  }
  const displayName =
    typeof attributes["displayName"] === "string" ? attributes["displayName"] : null;
  return { id, serialNumber, certificateType, displayName, expirationDate };
};

export const toProfile = (value: unknown): AppleProfile | null => {
  if (!isRecord(value)) {
    return null;
  }
  const { id, attributes } = value;
  if (typeof id !== "string" || !isRecord(attributes)) {
    return null;
  }
  const { name, uuid, expirationDate, profileContent } = attributes;
  const profileType = asProfileType(attributes["profileType"]);
  if (
    typeof name !== "string" ||
    typeof uuid !== "string" ||
    typeof expirationDate !== "string" ||
    typeof profileContent !== "string" ||
    profileType === null
  ) {
    return null;
  }
  return { id, name, uuid, expirationDate, profileContent, profileType };
};

export const extractList = <T>(body: unknown, map: (value: unknown) => T | null): readonly T[] => {
  if (!isRecord(body)) {
    return [];
  }
  const rawData = Array.isArray(body["data"]) ? body["data"] : [];
  return rawData.map((value) => map(value)).filter((value): value is T => value !== null);
};

export const extractSingle = <T>(body: unknown, map: (value: unknown) => T | null): T | null => {
  if (!isRecord(body)) {
    return null;
  }
  return map(body["data"]);
};
