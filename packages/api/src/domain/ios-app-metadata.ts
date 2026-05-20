import { Schema } from "effect";

import { BundleIdentifier } from "./apple-provisioning-profile";
import { DateTimeString, DeletedResult, Id } from "./common";

export const AscAppId = Schema.String.pipe(
  Schema.pattern(/^[0-9]{1,30}$/u, {
    message: () => "ASC App ID must be 1-30 digits",
  }),
);

export const AppStoreLanguage = Schema.String.pipe(Schema.minLength(2), Schema.maxLength(10));

export const AppStoreSku = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(100));

export const CompanyName = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200));

export const AppName = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200));

export class IosAppMetadata extends Schema.Class<IosAppMetadata>("IosAppMetadata")({
  id: Id,
  organizationId: Id,
  projectId: Id,
  bundleIdentifier: Schema.String,
  ascAppId: Schema.NullOr(Schema.String),
  sku: Schema.NullOr(Schema.String),
  language: Schema.String,
  companyName: Schema.NullOr(Schema.String),
  appName: Schema.NullOr(Schema.String),
  createdAt: DateTimeString,
  updatedAt: DateTimeString,
}) {}

export const CreateIosAppMetadataBody = Schema.Struct({
  bundleIdentifier: BundleIdentifier,
  ascAppId: Schema.optional(AscAppId),
  sku: Schema.optional(AppStoreSku),
  language: Schema.optional(AppStoreLanguage),
  companyName: Schema.optional(CompanyName),
  appName: Schema.optional(AppName),
});

export const UpdateIosAppMetadataBody = Schema.Struct({
  ascAppId: Schema.optional(Schema.NullOr(AscAppId)),
  sku: Schema.optional(Schema.NullOr(AppStoreSku)),
  language: Schema.optional(AppStoreLanguage),
  companyName: Schema.optional(Schema.NullOr(CompanyName)),
  appName: Schema.optional(Schema.NullOr(AppName)),
});

export const DeleteIosAppMetadataResult = DeletedResult;
