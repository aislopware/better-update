export type CredentialStatusTone = "success" | "warning" | "error" | "muted";

export interface CredentialStatus {
  readonly tone: CredentialStatusTone;
  readonly label: string;
}

const DAY_MS = 1000 * 60 * 60 * 24;
const EXPIRES_SOON_DAYS = 30;

export const deriveExpiryStatus = (
  validUntil: string | null,
  now: Date = new Date(),
): CredentialStatus => {
  if (validUntil === null) {
    return { tone: "muted", label: "No expiry" };
  }
  const expiry = new Date(validUntil).getTime();
  const diffMs = expiry - now.getTime();
  if (diffMs <= 0) {
    return { tone: "error", label: "Expired" };
  }
  if (diffMs <= EXPIRES_SOON_DAYS * DAY_MS) {
    return { tone: "warning", label: "Expires soon" };
  }
  return { tone: "success", label: "Active" };
};

export const STATUS_BADGE_VARIANT: Record<
  CredentialStatusTone,
  "success" | "warning" | "error" | "outline"
> = {
  error: "error",
  muted: "outline",
  success: "success",
  warning: "warning",
};
