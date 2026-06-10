import { addDays, isAfter, parseISO } from "date-fns";

export type CredentialStatusTone = "success" | "warning" | "error" | "muted";

export interface CredentialStatus {
  readonly tone: CredentialStatusTone;
  readonly label: string;
}

const EXPIRES_SOON_DAYS = 30;

export const deriveExpiryStatus = (
  validUntil: string | null,
  now: Date = new Date(),
): CredentialStatus => {
  if (validUntil === null) {
    return { tone: "muted", label: "No expiry" };
  }
  const expiry = parseISO(validUntil);
  if (!isAfter(expiry, now)) {
    return { tone: "error", label: "Expired" };
  }
  if (!isAfter(expiry, addDays(now, EXPIRES_SOON_DAYS))) {
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
