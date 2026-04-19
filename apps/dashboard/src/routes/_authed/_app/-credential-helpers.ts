export const TYPE_LABELS: Record<string, string> = {
  "distribution-certificate": "Distribution Certificate",
  "provisioning-profile": "Provisioning Profile",
  "push-key": "Push Key",
  keystore: "Keystore",
  "play-service-account": "Service Account",
};

export const DISTRIBUTION_LABELS: Record<string, string> = {
  "ad-hoc": "Ad Hoc",
  "app-store": "App Store",
  development: "Development",
  enterprise: "Enterprise",
  "play-store": "Play Store",
  direct: "Direct",
};

export const IOS_TYPES = [
  { value: "distribution-certificate", label: "Distribution Certificate (.p12)" },
  { value: "provisioning-profile", label: "Provisioning Profile (.mobileprovision)" },
  { value: "push-key", label: "Push Notification Key (.p8)" },
] as const;

export const ANDROID_TYPES = [
  { value: "keystore", label: "Keystore (.jks / .keystore)" },
  { value: "play-service-account", label: "Play Service Account (.json)" },
] as const;

export const DISTRIBUTIONS = [
  { value: "ad-hoc", label: "Ad Hoc" },
  { value: "app-store", label: "App Store" },
  { value: "development", label: "Development" },
  { value: "enterprise", label: "Enterprise" },
] as const;

export type CredentialTypeValue =
  | (typeof IOS_TYPES)[number]["value"]
  | (typeof ANDROID_TYPES)[number]["value"];
export type DistributionValue = (typeof DISTRIBUTIONS)[number]["value"];

const CREDENTIAL_TYPE_VALUES = new Set<string>(
  [...IOS_TYPES, ...ANDROID_TYPES].map((opt) => opt.value),
);
const DISTRIBUTION_VALUES = new Set<string>(DISTRIBUTIONS.map((opt) => opt.value));

export const isCredentialType = (value: string): value is CredentialTypeValue =>
  CREDENTIAL_TYPE_VALUES.has(value);
export const isDistribution = (value: string): value is DistributionValue =>
  DISTRIBUTION_VALUES.has(value);

export const ACCEPTED_EXTENSIONS = {
  "distribution-certificate": ".p12",
  "provisioning-profile": ".mobileprovision",
  "push-key": ".p8",
  keystore: ".jks,.keystore",
  "play-service-account": ".json",
} as const satisfies Record<CredentialTypeValue, string>;

export const TYPE_OPTIONS_BY_PLATFORM = {
  ios: IOS_TYPES,
  android: ANDROID_TYPES,
} as const satisfies Record<"ios" | "android", typeof IOS_TYPES | typeof ANDROID_TYPES>;

export const PLATFORM_LABELS: Record<string, string> = { ios: "iOS", android: "Android" };

export const TYPE_LABELS_BY_PLATFORM: Record<"ios" | "android", Record<string, string>> = {
  ios: Object.fromEntries(IOS_TYPES.map((opt) => [opt.value, opt.label])),
  android: Object.fromEntries(ANDROID_TYPES.map((opt) => [opt.value, opt.label])),
};
