-- FTS5 trigram index for substring search on projects.name + slug.
-- Trigram tokenizer (SQLite >= 3.34, supported by D1) lets MATCH find any
-- 3-character substring without LIKE '%query%' full-table scans.
--
-- Why trigger-based sync rather than the contentless "external content" mode:
-- triggers are explicit, testable, and survive ALTER TABLE without rebuild.

CREATE VIRTUAL TABLE "projects_fts" USING fts5(
  "name",
  "slug",
  "project_id" UNINDEXED,
  "organization_id" UNINDEXED,
  tokenize = 'trigram'
);

INSERT INTO "projects_fts" ("name", "slug", "project_id", "organization_id")
  SELECT "name", "slug", "id", "organization_id" FROM "projects";

CREATE TRIGGER "projects_ai" AFTER INSERT ON "projects" BEGIN
  INSERT INTO "projects_fts" ("name", "slug", "project_id", "organization_id")
    VALUES (NEW."name", NEW."slug", NEW."id", NEW."organization_id");
END;

CREATE TRIGGER "projects_au" AFTER UPDATE OF "name", "slug" ON "projects" BEGIN
  UPDATE "projects_fts"
    SET "name" = NEW."name", "slug" = NEW."slug"
    WHERE "project_id" = NEW."id";
END;

CREATE TRIGGER "projects_ad" AFTER DELETE ON "projects" BEGIN
  DELETE FROM "projects_fts" WHERE "project_id" = OLD."id";
END;
