-- FTS5 trigram index for substring search on devices.name + identifier.
-- Trigram tokenizer (SQLite >= 3.34, supported by D1) lets MATCH find any
-- 3-character substring without LIKE '%query%' full-table scans.
--
-- Mirrors the projects_fts pattern (migration 0033): trigger-based sync,
-- explicit and testable, survives ALTER TABLE without rebuild.

CREATE VIRTUAL TABLE "devices_fts" USING fts5(
  "name",
  "identifier",
  "device_id" UNINDEXED,
  "organization_id" UNINDEXED,
  tokenize = 'trigram'
);

INSERT INTO "devices_fts" ("name", "identifier", "device_id", "organization_id")
  SELECT "name", "identifier", "id", "organization_id" FROM "devices";

CREATE TRIGGER "devices_ai" AFTER INSERT ON "devices" BEGIN
  INSERT INTO "devices_fts" ("name", "identifier", "device_id", "organization_id")
    VALUES (NEW."name", NEW."identifier", NEW."id", NEW."organization_id");
END;

CREATE TRIGGER "devices_au" AFTER UPDATE OF "name", "identifier" ON "devices" BEGIN
  UPDATE "devices_fts"
    SET "name" = NEW."name", "identifier" = NEW."identifier"
    WHERE "device_id" = NEW."id";
END;

CREATE TRIGGER "devices_ad" AFTER DELETE ON "devices" BEGIN
  DELETE FROM "devices_fts" WHERE "device_id" = OLD."id";
END;
