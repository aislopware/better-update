import { isMacosCertificateType } from "@better-update/api";
import {
  appleDistributionCertificatesQueryOptions,
  applePassTypeCertificatesQueryOptions,
  applePayCertificatesQueryOptions,
  applePushCertificatesQueryOptions,
  applePushKeysQueryOptions,
  appleTeamsQueryOptions,
  ascApiKeysQueryOptions,
  meQueryOptions,
} from "@better-update/api-client/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { TablePanel } from "../../../components/table-panel";
import { isOrgAdmin } from "../../../lib/access";
import { CredentialPanel } from "./-credential-panel";
import {
  APPLE_TEAMS_EMPTY_HINT,
  ASC_API_KEYS_EMPTY_HINT,
  AppleTeamsTable,
  AscApiKeysTable,
  DISTRIBUTION_CERTIFICATES_EMPTY_HINT,
  DistributionCertificatesTable,
  PUSH_KEYS_EMPTY_HINT,
  PushKeysTable,
} from "./-credentials-tables";
import {
  MACOS_CERTIFICATES_EMPTY_HINT,
  MacosCertificatesTable,
  PASS_TYPE_CERTIFICATES_EMPTY_HINT,
  PAY_CERTIFICATES_EMPTY_HINT,
  PUSH_CERTIFICATES_EMPTY_HINT,
  PassTypeCertificatesTable,
  PayCertificatesTable,
  PushCertificatesTable,
} from "./-credentials-tables-certs";
import { indexAppleTeamsById } from "./-credentials-utils";

// Every Apple child section shares the same shape: the list itself, the teams
// map (team labels) and the org-admin gate for the per-row protection
// switches (GITLAB-RBAC-SPEC §3b).
const useAppleChildSection = (orgId: string) => {
  const { data: teams } = useSuspenseQuery(appleTeamsQueryOptions(orgId));
  const teamsById = useMemo(() => indexAppleTeamsById(teams.items), [teams.items]);
  const { data: me } = useSuspenseQuery(meQueryOptions());
  return { teamsById, canManageProtection: isOrgAdmin(me.orgRole) };
};

export const DistributionCertificatesSection = ({ orgId }: { orgId: string }) => {
  const { data } = useSuspenseQuery(appleDistributionCertificatesQueryOptions(orgId));
  const { teamsById, canManageProtection } = useAppleChildSection(orgId);
  // One endpoint, two panels: a Developer ID certificate signs no iOS build and
  // an iOS certificate signs no macOS app, so listing them together made the
  // count above each useless for deciding whether anything was missing.
  const items = useMemo(
    () => data.items.filter((cert) => !isMacosCertificateType(cert.certificateType)),
    [data.items],
  );

  return (
    <CredentialPanel
      title="Distribution Certificates"
      description=".p12 certs for signing iOS builds."
      items={items}
      noun="certificate"
      emptyHint={DISTRIBUTION_CERTIFICATES_EMPTY_HINT}
    >
      {(pageItems) => (
        <DistributionCertificatesTable
          items={pageItems}
          orgId={orgId}
          teamsById={teamsById}
          canManageProtection={canManageProtection}
        />
      )}
    </CredentialPanel>
  );
};

export const MacosCertificatesSection = ({ orgId }: { orgId: string }) => {
  const { data } = useSuspenseQuery(appleDistributionCertificatesQueryOptions(orgId));
  const { teamsById, canManageProtection } = useAppleChildSection(orgId);
  const items = useMemo(
    () => data.items.filter((cert) => isMacosCertificateType(cert.certificateType)),
    [data.items],
  );

  return (
    <CredentialPanel
      title="macOS Certificates"
      description="Developer ID and Mac App Store .p12 certs for signing and notarizing macOS apps."
      items={items}
      noun="certificate"
      emptyHint={MACOS_CERTIFICATES_EMPTY_HINT}
      hideWhenEmpty
    >
      {(pageItems) => (
        <MacosCertificatesTable
          items={pageItems}
          orgId={orgId}
          teamsById={teamsById}
          canManageProtection={canManageProtection}
        />
      )}
    </CredentialPanel>
  );
};

export const PushKeysSection = ({ orgId }: { orgId: string }) => {
  const { data } = useSuspenseQuery(applePushKeysQueryOptions(orgId));
  const { teamsById, canManageProtection } = useAppleChildSection(orgId);

  return (
    <CredentialPanel
      title="APNs Push Keys"
      description=".p8 keys for Apple Push Notification service."
      items={data.items}
      noun="key"
      emptyHint={PUSH_KEYS_EMPTY_HINT}
    >
      {(pageItems) => (
        <PushKeysTable
          items={pageItems}
          orgId={orgId}
          teamsById={teamsById}
          canManageProtection={canManageProtection}
        />
      )}
    </CredentialPanel>
  );
};

export const PushCertificatesSection = ({ orgId }: { orgId: string }) => {
  const { data } = useSuspenseQuery(applePushCertificatesQueryOptions(orgId));
  const { teamsById, canManageProtection } = useAppleChildSection(orgId);

  return (
    <CredentialPanel
      title="Push Certificates"
      description="APNs Push Services SSL certificates (.p12)."
      items={data.items}
      noun="certificate"
      emptyHint={PUSH_CERTIFICATES_EMPTY_HINT}
      hideWhenEmpty
    >
      {(pageItems) => (
        <PushCertificatesTable
          items={pageItems}
          orgId={orgId}
          teamsById={teamsById}
          canManageProtection={canManageProtection}
        />
      )}
    </CredentialPanel>
  );
};

export const PayCertificatesSection = ({ orgId }: { orgId: string }) => {
  const { data } = useSuspenseQuery(applePayCertificatesQueryOptions(orgId));
  const { teamsById, canManageProtection } = useAppleChildSection(orgId);

  return (
    <CredentialPanel
      title="Apple Pay Certificates"
      description="Apple Pay payment processing certificates (.p12)."
      items={data.items}
      noun="certificate"
      emptyHint={PAY_CERTIFICATES_EMPTY_HINT}
      hideWhenEmpty
    >
      {(pageItems) => (
        <PayCertificatesTable
          items={pageItems}
          orgId={orgId}
          teamsById={teamsById}
          canManageProtection={canManageProtection}
        />
      )}
    </CredentialPanel>
  );
};

export const PassTypeCertificatesSection = ({ orgId }: { orgId: string }) => {
  const { data } = useSuspenseQuery(applePassTypeCertificatesQueryOptions(orgId));
  const { teamsById, canManageProtection } = useAppleChildSection(orgId);

  return (
    <CredentialPanel
      title="Pass Type ID Certificates"
      description="Wallet Pass Type ID certificates (.p12)."
      items={data.items}
      noun="certificate"
      emptyHint={PASS_TYPE_CERTIFICATES_EMPTY_HINT}
      hideWhenEmpty
    >
      {(pageItems) => (
        <PassTypeCertificatesTable
          items={pageItems}
          orgId={orgId}
          teamsById={teamsById}
          canManageProtection={canManageProtection}
        />
      )}
    </CredentialPanel>
  );
};

/**
 * The optional Apple certificate types, when an organization has none of them.
 *
 * Push Services, Apple Pay and Wallet passes are extras: most projects need
 * none of the three, and each was taking a full card to report its own absence
 * — a third of the page spent saying nothing three times. They report it once,
 * together, and each keeps the one sentence that would fill it. Any type with a
 * certificate in it is drawn as its own panel above and drops out of here.
 *
 * The queries are the ones those sections already suspend on, so listing them
 * again costs no request.
 */
export const UnusedCertificateTypesPanel = ({ orgId }: { orgId: string }) => {
  const { data: push } = useSuspenseQuery(applePushCertificatesQueryOptions(orgId));
  const { data: pay } = useSuspenseQuery(applePayCertificatesQueryOptions(orgId));
  const { data: passType } = useSuspenseQuery(applePassTypeCertificatesQueryOptions(orgId));
  const { data: certs } = useSuspenseQuery(appleDistributionCertificatesQueryOptions(orgId));

  const unused = [
    {
      title: "macOS Certificates",
      hint: MACOS_CERTIFICATES_EMPTY_HINT,
      count: certs.items.filter((cert) => isMacosCertificateType(cert.certificateType)).length,
    },
    { title: "Push Certificates", hint: PUSH_CERTIFICATES_EMPTY_HINT, count: push.items.length },
    { title: "Apple Pay Certificates", hint: PAY_CERTIFICATES_EMPTY_HINT, count: pay.items.length },
    {
      title: "Pass Type ID Certificates",
      hint: PASS_TYPE_CERTIFICATES_EMPTY_HINT,
      count: passType.items.length,
    },
  ].filter((entry) => entry.count === 0);

  if (unused.length === 0) {
    return null;
  }

  return (
    <TablePanel
      title="Not in use"
      description="Nothing uploaded for these certificate types. Each is created from the CLI."
    >
      <dl className="divide-kumo-line m-0 divide-y border-t">
        {unused.map((entry) => (
          <div key={entry.title} className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:gap-4">
            <dt className="text-sm font-medium sm:w-56 sm:shrink-0">{entry.title}</dt>
            <dd className="text-kumo-subtle m-0 text-sm">{entry.hint}</dd>
          </div>
        ))}
      </dl>
    </TablePanel>
  );
};

export const AscApiKeysSection = ({ orgId }: { orgId: string }) => {
  const { data } = useSuspenseQuery(ascApiKeysQueryOptions(orgId));
  // Binding management is org-admin work (GITLAB-RBAC-SPEC §1a) — same gate
  // as the protection toggles. Team-scoped keys inherit their team's bindings.
  const { teamsById, canManageProtection } = useAppleChildSection(orgId);

  return (
    <CredentialPanel
      title="App Store Connect API Keys"
      description=".p8 keys for the ASC API."
      items={data.items}
      noun="key"
      emptyHint={ASC_API_KEYS_EMPTY_HINT}
    >
      {(pageItems) => (
        <AscApiKeysTable
          items={pageItems}
          teamsById={teamsById}
          orgId={orgId}
          canManageBindings={canManageProtection}
          canManageProtection={canManageProtection}
        />
      )}
    </CredentialPanel>
  );
};

export const AppleTeamsSection = ({ orgId }: { orgId: string }) => {
  const { data: teams } = useSuspenseQuery(appleTeamsQueryOptions(orgId));
  // Protection toggles are admin/owner-only (GITLAB-RBAC-SPEC §3b) — everyone
  // else sees the read-only protected state.
  const { data: me } = useSuspenseQuery(meQueryOptions());

  return (
    <CredentialPanel
      title="Apple Teams"
      // Where the rows come from is a mechanism the reader never acts on, and
      // the counts across each row show it anyway; what is left is the rule the
      // toggle at the end of the row enforces.
      description="Protected teams restrict creating credentials under the team to maintainers, and new credentials start with the team's protected state."
      items={teams.items}
      noun="team"
      emptyHint={APPLE_TEAMS_EMPTY_HINT}
    >
      {(pageItems) => (
        <AppleTeamsTable
          items={pageItems}
          orgId={orgId}
          canManageProtection={isOrgAdmin(me.orgRole)}
        />
      )}
    </CredentialPanel>
  );
};
