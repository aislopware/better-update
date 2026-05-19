-- Track whether the working tree was dirty (uncommitted changes) at build
-- time. SQLite has no native boolean — store as 0/1 INTEGER. Default 0 so
-- existing rows are treated as clean.

ALTER TABLE "builds" ADD COLUMN "git_dirty" INTEGER NOT NULL DEFAULT 0;
