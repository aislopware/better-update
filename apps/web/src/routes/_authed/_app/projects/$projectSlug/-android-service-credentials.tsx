import {
  androidApplicationIdentifiersQueryOptions,
  androidBuildCredentialsQueryOptions,
  googleServiceAccountKeysQueryOptions,
} from "@better-update/api-client/react";
import { useSuspenseQuery } from "@tanstack/react-query";

import type { GoogleServiceAccountKeyItem } from "@better-update/api-client/react";

import { DetailStat, DetailStatStrip } from "../../../../../components/detail-stats";
import { CopyButton, CopyableMono } from "../../../../../lib/copy-button";
import { RelativeTime } from "../../../../../lib/relative-time";
import { findGsa, sortGroupsByDefault } from "./-android-detail-shared";
import { CredentialSection, EmptyBindingMessage } from "./-credential-section";

const truncatePrivateKey = (value: string): string => {
  if (value.length <= 16) {
    return value;
  }
  return `${value.slice(0, 16)}…`;
};

const GsaCard = ({
  title,
  emptyLabel,
  sa,
}: {
  title: string;
  emptyLabel: string;
  sa: GoogleServiceAccountKeyItem | null;
}) => (
  <CredentialSection title={title}>
    {sa === null ? (
      <EmptyBindingMessage message={emptyLabel} />
    ) : (
      <DetailStatStrip columns={4}>
        <DetailStat label="Project ID">
          <CopyableMono value={sa.googleProjectId} label="Project ID" />
        </DetailStat>
        <DetailStat label="Private key ID">
          <span className="truncate font-mono text-xs">{truncatePrivateKey(sa.privateKeyId)}</span>
          <CopyButton value={sa.privateKeyId} label="Private key ID" />
        </DetailStat>
        <DetailStat label="Client email">
          <CopyableMono value={sa.clientEmail} label="Client email" />
        </DetailStat>
        {sa.clientId === null ? null : (
          <DetailStat label="Client ID">
            <span className="truncate font-mono text-xs">{sa.clientId}</span>
          </DetailStat>
        )}
        <DetailStat label="Uploaded">
          <span className="text-kumo-subtle">
            <RelativeTime value={sa.createdAt} />
          </span>
        </DetailStat>
      </DetailStatStrip>
    )}
  </CredentialSection>
);

export const AndroidServiceCredentialsSection = ({
  orgId,
  projectId,
  packageName,
}: {
  orgId: string;
  projectId: string;
  packageName: string;
}) => {
  const { data: identifiersResult } = useSuspenseQuery(
    androidApplicationIdentifiersQueryOptions(orgId, projectId),
  );
  const identifier = identifiersResult.items.find((item) => item.packageName === packageName);

  const { data: groupsResult } = useSuspenseQuery(
    androidBuildCredentialsQueryOptions(orgId, identifier === undefined ? "" : identifier.id),
  );
  const { data: gsaResult } = useSuspenseQuery(googleServiceAccountKeysQueryOptions(orgId));

  if (identifier === undefined) {
    return null;
  }

  const sortedGroups = sortGroupsByDefault(groupsResult.items);
  // FCM keys are bound per credential group, so only collapse to a single
  // card when every group resolves to the same key.
  const distinctKeyIds = new Set(
    sortedGroups.map((group) => group.googleServiceAccountKeyForFcmV1Id),
  );
  const sharedAcrossGroups = distinctKeyIds.size <= 1;
  const [defaultGroup] = sortedGroups;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-base leading-none font-semibold">Service credentials</h2>
        {/* The sentence used to open by naming the panel below it. What it
            knows and the panel does not is how far the key reaches — and that
            is only worth saying where there is more than one group to reach
            across. */}
        {sortedGroups.length > 1 ? (
          <p className="text-kumo-subtle text-sm">
            {sharedAcrossGroups
              ? "Applied across every credential group for this application identifier."
              : "Bound per credential group for this application identifier."}
          </p>
        ) : null}
      </div>
      {sharedAcrossGroups ? (
        <GsaCard
          title="FCM V1 service account key"
          emptyLabel="No service account key configured for FCM v1 push notifications — bind one with the CLI."
          sa={
            defaultGroup === undefined
              ? null
              : findGsa(gsaResult.items, defaultGroup.googleServiceAccountKeyForFcmV1Id)
          }
        />
      ) : (
        sortedGroups.map((group) => (
          <GsaCard
            key={group.id}
            title={`FCM V1 service account key — ${group.name}`}
            emptyLabel="No service account key configured for FCM v1 push notifications — bind one with the CLI."
            sa={findGsa(gsaResult.items, group.googleServiceAccountKeyForFcmV1Id)}
          />
        ))
      )}
    </section>
  );
};
