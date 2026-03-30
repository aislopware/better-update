-- Better Auth core + organization + api-key plugin tables
-- Generated via: better-auth v1.5.6 compileMigrations() with snake_case field mapping

-- Core: user
CREATE TABLE "user" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "email_verified" INTEGER NOT NULL,
  "image" TEXT,
  "created_at" DATE NOT NULL,
  "updated_at" DATE NOT NULL
);

-- Core: session
CREATE TABLE "session" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "expires_at" DATE NOT NULL,
  "token" TEXT NOT NULL UNIQUE,
  "created_at" DATE NOT NULL,
  "updated_at" DATE NOT NULL,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "user_id" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "active_organization_id" TEXT
);

-- Core: account (OAuth provider links)
CREATE TABLE "account" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "account_id" TEXT NOT NULL,
  "provider_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "access_token" TEXT,
  "refresh_token" TEXT,
  "id_token" TEXT,
  "access_token_expires_at" DATE,
  "refresh_token_expires_at" DATE,
  "scope" TEXT,
  "password" TEXT,
  "created_at" DATE NOT NULL,
  "updated_at" DATE NOT NULL
);

-- Core: verification (email verification tokens)
CREATE TABLE "verification" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expires_at" DATE NOT NULL,
  "created_at" DATE NOT NULL,
  "updated_at" DATE NOT NULL
);

-- Organization plugin: organization
CREATE TABLE "organization" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL UNIQUE,
  "logo" TEXT,
  "created_at" DATE NOT NULL,
  "metadata" TEXT
);

-- Organization plugin: member
CREATE TABLE "member" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "user_id" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "role" TEXT NOT NULL,
  "created_at" DATE NOT NULL
);

-- Organization plugin: invitation
CREATE TABLE "invitation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organization_id" TEXT NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "email" TEXT NOT NULL,
  "role" TEXT,
  "status" TEXT NOT NULL,
  "expires_at" DATE NOT NULL,
  "created_at" DATE NOT NULL,
  "inviter_id" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE
);

-- API Key plugin: apikey
CREATE TABLE "apikey" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "config_id" TEXT NOT NULL,
  "name" TEXT,
  "start" TEXT,
  "reference_id" TEXT NOT NULL,
  "prefix" TEXT,
  "key" TEXT NOT NULL,
  "refill_interval" INTEGER,
  "refill_amount" INTEGER,
  "last_refill_at" DATE,
  "enabled" INTEGER,
  "rate_limit_enabled" INTEGER,
  "rate_limit_time_window" INTEGER,
  "rate_limit_max" INTEGER,
  "request_count" INTEGER,
  "remaining" INTEGER,
  "last_request" DATE,
  "expires_at" DATE,
  "created_at" DATE NOT NULL,
  "updated_at" DATE NOT NULL,
  "permissions" TEXT,
  "metadata" TEXT
);

-- Indexes
CREATE INDEX "session_user_id_idx" ON "session" ("user_id");
CREATE INDEX "account_user_id_idx" ON "account" ("user_id");
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");
CREATE UNIQUE INDEX "organization_slug_uidx" ON "organization" ("slug");
CREATE INDEX "member_organization_id_idx" ON "member" ("organization_id");
CREATE INDEX "member_user_id_idx" ON "member" ("user_id");
CREATE INDEX "invitation_organization_id_idx" ON "invitation" ("organization_id");
CREATE INDEX "invitation_email_idx" ON "invitation" ("email");
CREATE INDEX "apikey_config_id_idx" ON "apikey" ("config_id");
CREATE INDEX "apikey_reference_id_idx" ON "apikey" ("reference_id");
CREATE INDEX "apikey_key_idx" ON "apikey" ("key");
