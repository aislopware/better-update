-- Git provenance on updates, mirroring the builds path (migrations 0005 +
-- 0041). EAS persists gitCommitHash + isGitWorkingTreeDirty on every update;
-- better-update captures the same two fields at publish time so an update row
-- records the exact commit it was built from and whether the working tree was
-- dirty.
--
-- git_ref (branch name) is intentionally omitted: the branch already lives on
-- the update's branch/channel (update.branchId), so storing it again here would
-- be redundant. EAS's UpdateFragment likewise stores only gitCommitHash + the
-- dirty flag on the update.
--
-- SQLite has no native boolean — git_dirty is a 0/1 INTEGER. Default 0 so
-- existing rows are treated as clean. No index: git_commit is display metadata,
-- not a query key.

ALTER TABLE "updates" ADD COLUMN "git_commit" TEXT;
ALTER TABLE "updates" ADD COLUMN "git_dirty" INTEGER NOT NULL DEFAULT 0;
