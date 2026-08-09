import {
  androidUploadKeystoresQueryOptions,
  appleDistributionCertificatesQueryOptions,
  applePassTypeCertificatesQueryOptions,
  applePayCertificatesQueryOptions,
  applePushCertificatesQueryOptions,
} from "@better-update/api-client/react";
import { Banner } from "@better-update/ui/components/banner";
import { WarningIcon } from "@phosphor-icons/react";
import { useSuspenseQuery } from "@tanstack/react-query";

import { deriveExpiryStatus } from "../../../lib/credential-status";
import { pluralize } from "../../../lib/pluralize";

/**
 * Rollup message across every expiring credential type, from tones the tables
 * already derive per row (lib/credential-status). Null when nothing is at risk.
 *
 * "Credential" rather than "certificate": Android upload keystores expire on
 * the same terms and are counted here too, and a reader who only signs Android
 * would be told about a certificate they do not have.
 */
export const expiryRollupMessage = (
  items: readonly { readonly validUntil: string | null }[],
  now: Date = new Date(),
): string | null => {
  const tones = items.map((item) => deriveExpiryStatus(item.validUntil, now).tone);
  const expired = tones.filter((tone) => tone === "error").length;
  const expiringSoon = tones.filter((tone) => tone === "warning").length;
  const parts = [
    expired > 0
      ? `${expired} ${pluralize(expired, "credential")} ${expired === 1 ? "has" : "have"} expired`
      : null,
    expiringSoon > 0
      ? `${expiringSoon} ${pluralize(expiringSoon, "credential")} ${expiringSoon === 1 ? "expires" : "expire"} within 30 days`
      : null,
  ].filter((part) => part !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
};

// Slim attention banner above the sections. Reads the same queries the sections
// below suspend on (react-query dedupes), so no extra data is loaded.
export const ExpiryRollupBanner = ({ orgId }: { orgId: string }) => {
  const { data: distribution } = useSuspenseQuery(appleDistributionCertificatesQueryOptions(orgId));
  const { data: push } = useSuspenseQuery(applePushCertificatesQueryOptions(orgId));
  const { data: pay } = useSuspenseQuery(applePayCertificatesQueryOptions(orgId));
  const { data: passType } = useSuspenseQuery(applePassTypeCertificatesQueryOptions(orgId));
  const { data: keystores } = useSuspenseQuery(androidUploadKeystoresQueryOptions(orgId));
  const message = expiryRollupMessage([
    ...distribution.items,
    ...push.items,
    ...pay.items,
    ...passType.items,
    ...keystores.items,
  ]);

  // A warning that names no remedy leaves the reader to go looking for one; the
  // devices banner names its command, so this one names its own.
  return message === null ? null : (
    <Banner
      variant="alert"
      icon={<WarningIcon weight="fill" />}
      title={message}
      description={
        <>
          Builds signed with an expired certificate or keystore are rejected. Upload a replacement
          with{" "}
          <code className="bg-kumo-recessed rounded px-1 py-0.5 font-mono text-xs">
            better-update credentials upload
          </code>{" "}
          from the CLI.
        </>
      }
    />
  );
};
