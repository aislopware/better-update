import { spawnSync } from "node:child_process";
import process from "node:process";

import { defineCommand } from "citty";
import { Data, Effect } from "effect";

import { listBuildProfileNames } from "../lib/better-update-build-config";
import {
  BETTER_UPDATE_PROJECT_ID_ENV,
  readBetterUpdateConfig,
  readLinkedProjectId,
} from "../lib/better-update-config";
import { runEffect } from "../lib/citty-effect";
import { asProjectType, detectProjectType } from "../lib/detect-project-type";
import { printHumanTable } from "../lib/output";
import { readProjectId } from "../lib/project-link";
import { apiClient } from "../services/api-client";
import { CliRuntime } from "../services/cli-runtime";
import { ConfigStore } from "../services/config-store";

class HealthCheckError extends Data.TaggedError("HealthCheckError")<{
  message: string;
  cause?: unknown;
}> {}

type CheckStatus = "pass" | "warn" | "fail";

interface CheckResult {
  readonly id: string;
  readonly name: string;
  readonly status: CheckStatus;
  readonly message: string;
}

const pass = (id: string, name: string, message: string): CheckResult => ({
  id,
  name,
  status: "pass",
  message,
});

const warn = (id: string, name: string, message: string): CheckResult => ({
  id,
  name,
  status: "warn",
  message,
});

const fail = (id: string, name: string, message: string): CheckResult => ({
  id,
  name,
  status: "fail",
  message,
});

const checkNode = (): CheckResult => {
  const version = process.versions.node;
  const major = Number.parseInt(version.split(".")[0] ?? "0", 10);
  if (major >= 22) {
    return pass("node", "Node.js version", `${version} (>= 22 required)`);
  }
  return fail("node", "Node.js version", `${version} is below the minimum required version 22`);
};

const checkCommand = (id: string, name: string, command: string, args: readonly string[]) =>
  Effect.sync((): CheckResult => {
    const result = spawnSync(command, [...args], { stdio: "pipe", timeout: 5000 });
    if (result.status === 0) {
      const stdout = result.stdout.toString().trim();
      return pass(id, name, stdout.length > 0 ? stdout : "available");
    }
    return warn(id, name, `${command} not found or returned status ${result.status}`);
  });

const checkServerHealth = Effect.gen(function* () {
  const config = yield* ConfigStore;
  const base = yield* config.getBaseUrl;
  const url = `${base}/api/health`;
  const response = yield* Effect.tryPromise({
    try: async () => fetch(url, { signal: AbortSignal.timeout(3000) }),
    catch: (cause) => new HealthCheckError({ message: String(cause), cause }),
  }).pipe(Effect.either);
  if (response._tag === "Left") {
    return fail("health", "Server reachable", `${url} unreachable: ${response.left.message}`);
  }
  const res = response.right;
  if (res.ok) {
    return pass("health", "Server reachable", `${url} returned 200`);
  }
  return warn("health", "Server reachable", `${url} returned ${res.status}`);
}).pipe(Effect.scoped);

const checkAuth = Effect.gen(function* () {
  const api = yield* apiClient.pipe(Effect.option);
  if (api._tag === "None") {
    return fail("auth", "Auth token", "Not logged in (run `better-update login`)");
  }
  const result = yield* api.value.me.get().pipe(Effect.either);
  if (result._tag === "Left") {
    return fail("auth", "Auth token", `Token rejected by server: ${String(result.left)}`);
  }
  const me = result.right;
  const who = me.user?.email ?? me.actorEmail;
  return pass("auth", "Auth token", `Valid (${who})`);
});

const checkProjectLink = Effect.gen(function* () {
  const runtime = yield* CliRuntime;
  const root = yield* runtime.cwd;
  const fromEnv = yield* runtime.getEnv(BETTER_UPDATE_PROJECT_ID_ENV);
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return pass(
      "project-linked",
      "Project linked",
      `projectId=${fromEnv} (via ${BETTER_UPDATE_PROJECT_ID_ENV})`,
    );
  }
  const resolved = yield* readProjectId.pipe(Effect.either);
  if (resolved._tag === "Left") {
    return warn("project-linked", "Project linked", resolved.left.message);
  }
  // Distinguish the build-system-neutral link file from the Expo-config fallback.
  const fromFile = yield* readLinkedProjectId(root);
  const source = fromFile === undefined ? "Expo config" : "better-update.json";
  return pass("project-linked", "Project linked", `projectId=${resolved.right} (via ${source})`);
});

const checkProjectType = Effect.gen(function* () {
  const runtime = yield* CliRuntime;
  const root = yield* runtime.cwd;
  const buConfig = yield* readBetterUpdateConfig(root);
  const override = asProjectType(buConfig?.["projectType"]);
  const type = yield* detectProjectType({ projectRoot: root, override });
  const via = override === undefined ? "auto-detected" : "better-update.json override";
  return pass("project-type", "Project type", `${type} (${via})`);
});

const checkBuildConfig = Effect.gen(function* () {
  const runtime = yield* CliRuntime;
  const root = yield* runtime.cwd;
  const names = yield* listBuildProfileNames(root);
  if (names.length === 0) {
    return warn(
      "build-config",
      "Build config",
      'No build profiles found. Add a "build" section to better-update.json.',
    );
  }
  return pass("build-config", "Build config", `${names.length} profile(s) defined`);
});

const runChecks = Effect.gen(function* () {
  const runtime = yield* CliRuntime;
  const xcode =
    runtime.platform === "darwin"
      ? [yield* checkCommand("xcode", "Xcode CLI tools", "xcode-select", ["-p"])]
      : [];
  return [
    checkNode(),
    ...xcode,
    yield* checkCommand("keytool", "keytool (Android signing)", "keytool", ["-help"]),
    yield* checkServerHealth,
    yield* checkAuth,
    yield* checkProjectLink,
    yield* checkProjectType,
    yield* checkBuildConfig,
  ];
});

const statusIcon = (status: CheckStatus): string => {
  if (status === "pass") {
    return "[OK]  ";
  }
  if (status === "warn") {
    return "[WARN]";
  }
  return "[FAIL]";
};

const renderHuman = (checks: readonly CheckResult[]) => {
  const rows: (readonly string[])[] = checks.map((check) => [
    statusIcon(check.status),
    check.name,
    check.message,
  ]);
  return printHumanTable(["", "Check", "Detail"], rows);
};

const computeExitCode = (checks: readonly CheckResult[]): number =>
  checks.some((check) => check.status === "fail") ? 6 : 0;

export const doctorCommand = defineCommand({
  meta: {
    name: "doctor",
    description: "Run diagnostic checks (Node, signing tools, server reachability, auth, config)",
  },
  run: async () =>
    runEffect(
      Effect.gen(function* () {
        const runtime = yield* CliRuntime;
        const checks = yield* runChecks;
        yield* renderHuman(checks);
        const exitCode = computeExitCode(checks);
        if (exitCode !== 0) {
          yield* runtime.setExitCode(exitCode);
        }
        return { checks };
      }),
      { json: "value" },
    ),
});
