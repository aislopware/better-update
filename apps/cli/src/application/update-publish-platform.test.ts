import { gitCreateFields } from "./update-publish-platform";

import type { GitContext } from "../lib/git-context";

// gitCreateFields is the pure seam that maps the (best-effort) git context onto
// the `api.updates.create` body. EAS persists gitCommitHash + isGitWorkingTreeDirty
// on every update; better-update mirrors that — commit + dirty are sent ALWAYS
// (not gated on --auto). The previously-dropped values (gitCtx.commit/.dirty)
// must now reach the payload; a non-git project must still publish (commit
// omitted, dirty false).

const git = (overrides: Partial<GitContext>): GitContext => ({
  ref: undefined,
  commit: undefined,
  commitMessage: undefined,
  dirty: false,
  ...overrides,
});

describe(gitCreateFields, () => {
  it("emits commit + dirty when git resolved a HEAD SHA on a clean tree", () => {
    expect(gitCreateFields(git({ commit: "a1b2c3", dirty: false }))).toStrictEqual({
      gitCommit: "a1b2c3",
      gitDirty: false,
    });
  });

  it("carries a dirty working tree through to the payload", () => {
    expect(gitCreateFields(git({ commit: "deadbeef", dirty: true }))).toStrictEqual({
      gitCommit: "deadbeef",
      gitDirty: true,
    });
  });

  it("omits gitCommit (via compact) but still sends gitDirty:false on a non-git project", () => {
    // The best-effort gap: no readable git → commit undefined. compact drops the
    // key so the optional schema field is absent, and dirty defaults to false.
    const fields = gitCreateFields(git({ commit: undefined, dirty: false }));
    expect(fields).toStrictEqual({ gitDirty: false });
    expect("gitCommit" in fields).toBe(false);
  });
});
