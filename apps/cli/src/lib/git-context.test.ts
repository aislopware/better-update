import { CommandExecutor } from "@effect/platform";
import { it } from "@effect/vitest";
import { Effect } from "effect";

import { readGitContext } from "./git-context";

// readGitContext runs four independent git invocations through CommandExecutor:
//   git rev-parse HEAD          → commit SHA
//   git symbolic-ref --short HEAD → branch name (fails on detached HEAD)
//   git log -1 --format=%s       → latest commit subject (the update message)
//   git status --porcelain       → dirty-tree probe (non-empty == dirty)
// Each is catchAll-ed to "" so a missing git / non-repo degrades gracefully to
// undefined fields. We stub the executor and route by the first git arg so each
// command can independently succeed or fail.

interface StubCommand {
  readonly args: readonly string[];
}

type ArgResolver = (firstArg: string) => Effect.Effect<string, unknown>;

const makeStubExecutor = (resolve: ArgResolver): CommandExecutor.CommandExecutor =>
  ({
    [CommandExecutor.TypeId]: CommandExecutor.TypeId,
    string: (command: StubCommand) => resolve(command.args[0] ?? ""),
  }) as unknown as CommandExecutor.CommandExecutor;

const run = async (resolve: ArgResolver) =>
  readGitContext("/repo").pipe(
    Effect.provideService(CommandExecutor.CommandExecutor, makeStubExecutor(resolve)),
    Effect.runPromise,
  );

// A clean, fully-resolvable repo on a named branch.
const cleanRepo: ArgResolver = (firstArg) => {
  switch (firstArg) {
    case "rev-parse": {
      return Effect.succeed("a1b2c3d4e5f6\n");
    }
    case "symbolic-ref": {
      return Effect.succeed("feature/login\n");
    }
    case "log": {
      return Effect.succeed("fix: handle null session\n");
    }
    case "status": {
      // empty porcelain → clean tree
      return Effect.succeed("");
    }
    default: {
      return Effect.fail(new Error(`unexpected git arg: ${firstArg}`));
    }
  }
};

describe(readGitContext, () => {
  it("parses branch, commit SHA, and message and trims trailing newlines", async () => {
    const ctx = await run(cleanRepo);
    expect(ctx.ref).toBe("feature/login");
    expect(ctx.commit).toBe("a1b2c3d4e5f6");
    expect(ctx.commitMessage).toBe("fix: handle null session");
    expect(ctx.dirty).toBe(false);
  });

  it("flags a dirty working tree when porcelain status is non-empty", async () => {
    const ctx = await run((firstArg) =>
      firstArg === "status"
        ? Effect.succeed(" M src/app.ts\n?? new-file.ts\n")
        : cleanRepo(firstArg),
    );
    expect(ctx.dirty).toBe(true);
  });

  it("ignores whitespace-only porcelain status (still clean)", async () => {
    const ctx = await run((firstArg) =>
      firstArg === "status" ? Effect.succeed("   \n  ") : cleanRepo(firstArg),
    );
    expect(ctx.dirty).toBe(false);
  });

  it("falls back to undefined fields when the directory is not a git repo", async () => {
    // Non-repo: every git invocation fails. readGitContext swallows each and
    // returns undefined fields + dirty=false so the publish still proceeds.
    const ctx = await run(() => Effect.fail(new Error("not a git repository")));
    expect(ctx.ref).toBeUndefined();
    expect(ctx.commit).toBeUndefined();
    expect(ctx.commitMessage).toBeUndefined();
    expect(ctx.dirty).toBe(false);
  });

  it("treats detached HEAD as no branch while still resolving the commit", async () => {
    // `symbolic-ref --short HEAD` fails on a detached HEAD, but rev-parse + log
    // still succeed — ref is undefined, commit + message survive.
    const ctx = await run((firstArg) =>
      firstArg === "symbolic-ref"
        ? Effect.fail(new Error("fatal: ref HEAD is not a symbolic ref"))
        : cleanRepo(firstArg),
    );
    expect(ctx.ref).toBeUndefined();
    expect(ctx.commit).toBe("a1b2c3d4e5f6");
    expect(ctx.commitMessage).toBe("fix: handle null session");
  });

  it("treats an empty/whitespace command output as an unset field", async () => {
    // A command that returns only whitespace (e.g. an empty repo with no commits)
    // must collapse to undefined, not the empty string.
    const ctx = await run((firstArg) =>
      firstArg === "rev-parse" ? Effect.succeed("   \n") : cleanRepo(firstArg),
    );
    expect(ctx.commit).toBeUndefined();
    expect(ctx.ref).toBe("feature/login");
  });
});
