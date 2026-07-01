// Typed schema overlay for the kysely-codegen output (`./schema.generated`).
//
// Two corrections over the raw generated types:
//  1. kysely-codegen types every TEXT column as bare `string`, so enum / CHECK-
//     constraint columns lose their domain meaning and every repository row->model
//     mapper had to re-assert the union with a `no-unsafe-type-assertion` cast.
//     We narrow those columns to the domain unions in `../models` /
//     `../submission-models`.
//  2. SQLite lets a `TEXT PRIMARY KEY` hold NULL, so codegen types every `id` as
//     `string | null`. In practice the repositories always populate the PK, so we
//     narrow `id` back to non-null `string` (via `WithNonNullId`) — this removes a
//     swarm of mapper guards without weakening any real nullability.
//
// Consumers keep importing from `../db/schema` (this file); `bun run d1:codegen`
// only ever rewrites `./schema.generated`.
//
// Pure type-only module: zero runtime, so it stays lint-clean (unlike the
// generated `.d.ts`, which lint ignores by extension).

import type {
  ArtifactFormat,
  AppleTeamType,
  AuditLogResourceType,
  AuditLogSource,
  DeviceClass,
  Distribution,
  DistributionType,
  EncryptionKeyKind,
  EnvVarScope,
  EnvVarVisibility,
  Platform,
  PrincipalType,
} from "../models";
import type { SubmissionArchiveSource } from "../submission-models";
import type { EnvVaultRecipientKind } from "../vault-models";
// eslint-disable-next-line import/no-namespace -- type-only namespace access to the generated schema module (45 table interfaces); aliasing each individually would be pure noise with no benefit
import type * as Gen from "./schema.generated";

export type { Generated } from "./schema.generated";

/** Replace the keys of `Base` that appear in `Overrides` with the narrower types. */
type Narrow<Base, Overrides> = Omit<Base, keyof Overrides> & Overrides;

/**
 * Narrow a codegen `id: string | null` (SQLite TEXT PRIMARY KEY quirk) back to a
 * non-null `string`. A no-op for tables whose `id` is differently typed (e.g.
 * `Generated<number>`) or that have no `id` column at all (junction/FTS tables).
 */
type WithNonNullId<T> = T extends { id: string | null } ? Omit<T, "id"> & { id: string } : T;

// -- Table interfaces -------------------------------------------------------
// Every table gets `WithNonNullId`; enum-bearing tables are additionally
// `Narrow`ed so their CHECK-constraint columns carry the domain union (and
// `Union | null` where the column is nullable). Non-narrowed columns — incl.
// their `Generated<>` wrappers — pass through untouched.

export type Account = WithNonNullId<Gen.Account>;
export type AccountKeys = WithNonNullId<Gen.AccountKeys>;
export type AndroidApplicationIdentifiers = WithNonNullId<Gen.AndroidApplicationIdentifiers>;
export type AndroidBuildCredentials = WithNonNullId<Gen.AndroidBuildCredentials>;
export type AndroidUploadKeystores = WithNonNullId<
  Narrow<Gen.AndroidUploadKeystores, { keystore_type: "JKS" | "PKCS12" | null }>
>;
export type Apikey = WithNonNullId<Gen.Apikey>;
export type AppleDistributionCertificates = WithNonNullId<Gen.AppleDistributionCertificates>;
export type AppleProvisioningProfiles = WithNonNullId<
  Narrow<Gen.AppleProvisioningProfiles, { distribution_type: DistributionType }>
>;
export type ApplePushKeys = WithNonNullId<Gen.ApplePushKeys>;
export type ApplePushCertificates = WithNonNullId<Gen.ApplePushCertificates>;
export type ApplePayCertificates = WithNonNullId<Gen.ApplePayCertificates>;
export type ApplePassTypeCertificates = WithNonNullId<Gen.ApplePassTypeCertificates>;
export type AppleTeams = WithNonNullId<Narrow<Gen.AppleTeams, { apple_team_type: AppleTeamType }>>;
export type AscApiKeys = WithNonNullId<Gen.AscApiKeys>;
export type Assets = WithNonNullId<Gen.Assets>;
export type AuditLogs = WithNonNullId<
  Narrow<Gen.AuditLogs, { resource_type: AuditLogResourceType; source: AuditLogSource }>
>;
export type Branches = WithNonNullId<Gen.Branches>;
export type BuildArtifacts = WithNonNullId<Narrow<Gen.BuildArtifacts, { format: ArtifactFormat }>>;
export type Builds = WithNonNullId<
  Narrow<Gen.Builds, { distribution: Distribution; platform: Platform }>
>;
export type Channels = WithNonNullId<Gen.Channels>;
export type DeviceRegistrationRequests = WithNonNullId<
  Narrow<Gen.DeviceRegistrationRequests, { device_class_hint: DeviceClass | null }>
>;
export type Devices = WithNonNullId<Narrow<Gen.Devices, { device_class: DeviceClass }>>;
export type DevicesFts = WithNonNullId<Gen.DevicesFts>;
export type Environments = WithNonNullId<Gen.Environments>;
export type EnvVarDescriptions = WithNonNullId<
  Narrow<Gen.EnvVarDescriptions, { scope: EnvVarScope }>
>;
export type EnvVarRevisions = WithNonNullId<Gen.EnvVarRevisions>;
export type EnvVars = WithNonNullId<
  Narrow<Gen.EnvVars, { scope: EnvVarScope; visibility: EnvVarVisibility }>
>;
export type GoogleServiceAccountKeys = WithNonNullId<Gen.GoogleServiceAccountKeys>;
export type IamGroup = WithNonNullId<Gen.IamGroup>;
export type IamGroupMembership = WithNonNullId<Gen.IamGroupMembership>;
export type Invitation = WithNonNullId<Gen.Invitation>;
export type IosAppMetadata = WithNonNullId<Gen.IosAppMetadata>;
export type IosBundleConfigurations = WithNonNullId<
  Narrow<Gen.IosBundleConfigurations, { distribution_type: DistributionType }>
>;
export type Member = WithNonNullId<Gen.Member>;
export type Organization = WithNonNullId<Gen.Organization>;
export type OrgEnvVaultKeyWraps = WithNonNullId<
  Narrow<Gen.OrgEnvVaultKeyWraps, { recipient_kind: EnvVaultRecipientKind }>
>;
export type OrgVaultKeyWraps = WithNonNullId<Gen.OrgVaultKeyWraps>;
export type OrgVaults = WithNonNullId<Gen.OrgVaults>;
export type Passkey = WithNonNullId<Gen.Passkey>;
// PK is `session_id` (not `id`), so WithNonNullId is a no-op here — narrow the
// real PK back to non-null instead (SQLite TEXT-PK-nullable quirk).
export type PasskeyStepUp = Narrow<Gen.PasskeyStepUp, { session_id: string }>;
export type Policy = WithNonNullId<Gen.Policy>;
export type PolicyAttachment = WithNonNullId<
  Narrow<Gen.PolicyAttachment, { principal_type: PrincipalType }>
>;
export type ProjectProtocolMetadata = WithNonNullId<Gen.ProjectProtocolMetadata>;
export type Projects = WithNonNullId<Gen.Projects>;
export type ProjectsFts = WithNonNullId<Gen.ProjectsFts>;
export type Session = WithNonNullId<Gen.Session>;
export type Submissions = WithNonNullId<
  Narrow<Gen.Submissions, { archive_source: SubmissionArchiveSource; platform: Platform }>
>;
export type UpdateAssets = WithNonNullId<Gen.UpdateAssets>;
export type Updates = WithNonNullId<Narrow<Gen.Updates, { platform: Platform }>>;
export type User = WithNonNullId<Gen.User>;
export type UserEncryptionKeys = WithNonNullId<
  Narrow<Gen.UserEncryptionKeys, { kind: EncryptionKeyKind }>
>;
export type Verification = WithNonNullId<Gen.Verification>;
export type Webhooks = WithNonNullId<Gen.Webhooks>;

// -- The typed database -----------------------------------------------------
// Same table set as the generated `DB`, every entry pointing at the overlaid
// interface above (enum columns narrowed, `id` non-null).

export interface DB {
  account: Account;
  account_keys: AccountKeys;
  android_application_identifiers: AndroidApplicationIdentifiers;
  android_build_credentials: AndroidBuildCredentials;
  android_upload_keystores: AndroidUploadKeystores;
  apikey: Apikey;
  apple_distribution_certificates: AppleDistributionCertificates;
  apple_provisioning_profiles: AppleProvisioningProfiles;
  apple_push_keys: ApplePushKeys;
  apple_push_certificates: ApplePushCertificates;
  apple_pay_certificates: ApplePayCertificates;
  apple_pass_type_certificates: ApplePassTypeCertificates;
  apple_teams: AppleTeams;
  asc_api_keys: AscApiKeys;
  assets: Assets;
  audit_logs: AuditLogs;
  branches: Branches;
  build_artifacts: BuildArtifacts;
  builds: Builds;
  channels: Channels;
  device_registration_requests: DeviceRegistrationRequests;
  devices: Devices;
  devices_fts: DevicesFts;
  env_var_descriptions: EnvVarDescriptions;
  env_var_revisions: EnvVarRevisions;
  env_vars: EnvVars;
  environments: Environments;
  google_service_account_keys: GoogleServiceAccountKeys;
  iam_group: IamGroup;
  iam_group_membership: IamGroupMembership;
  invitation: Invitation;
  ios_app_metadata: IosAppMetadata;
  ios_bundle_configurations: IosBundleConfigurations;
  member: Member;
  org_env_vault_key_wraps: OrgEnvVaultKeyWraps;
  org_vault_key_wraps: OrgVaultKeyWraps;
  org_vaults: OrgVaults;
  organization: Organization;
  passkey: Passkey;
  passkey_step_up: PasskeyStepUp;
  policy: Policy;
  policy_attachment: PolicyAttachment;
  project_protocol_metadata: ProjectProtocolMetadata;
  projects: Projects;
  projects_fts: ProjectsFts;
  session: Session;
  submissions: Submissions;
  update_assets: UpdateAssets;
  updates: Updates;
  user: User;
  user_encryption_keys: UserEncryptionKeys;
  verification: Verification;
  webhooks: Webhooks;
}
