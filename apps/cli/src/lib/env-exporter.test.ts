import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { pullEnvVars } from "./env-exporter";
import { EnvExportError } from "./exit-codes";
import { failureError } from "./test-utils";

import type { ApiClient } from "../services/api-client";

// ── helpers ───────────────────────────────────────────────────────

interface ExportResult {
  readonly environment: string;
  readonly items: readonly {
    readonly key: string;
    readonly value: string;
    readonly visibility: "plaintext" | "sensitive";
  }[];
}

const makeApiStub = (
  exportFn: (args: {
    urlParams: { projectId: string; environment: string };
  }) => Effect.Effect<ExportResult, unknown>,
): ApiClient =>
  ({
    "env-vars": {
      export: exportFn,
    },
  }) as unknown as ApiClient;

// ── tests ─────────────────────────────────────────────────────────

describe(pullEnvVars, () => {
  it.effect("flattens items into a Record<string,string>", () =>
    Effect.gen(function* () {
      const api = makeApiStub(() =>
        Effect.succeed({
          environment: "production",
          items: [
            { key: "API_URL", value: "https://api.example.com", visibility: "plaintext" as const },
            { key: "SECRET", value: "xyz", visibility: "sensitive" as const },
          ],
        }),
      );
      const result = yield* pullEnvVars(api, {
        projectId: "proj_123",
        environment: "production",
      });
      expect(result).toStrictEqual({
        API_URL: "https://api.example.com",
        SECRET: "xyz",
      });
    }),
  );

  it.effect("returns empty object when no items", () =>
    Effect.gen(function* () {
      const api = makeApiStub(() => Effect.succeed({ environment: "development", items: [] }));
      const result = yield* pullEnvVars(api, {
        projectId: "proj_123",
        environment: "development",
      });
      expect(result).toStrictEqual({});
    }),
  );

  it.effect("wraps API errors as EnvExportError", () =>
    Effect.gen(function* () {
      const api = makeApiStub(() => Effect.fail(new Error("boom")));
      const exit = yield* pullEnvVars(api, {
        projectId: "proj_123",
        environment: "production",
      }).pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = failureError(exit);
        expect(error).toBeInstanceOf(EnvExportError);
      }
    }),
  );

  it.effect("forwards projectId and environment via urlParams", () =>
    Effect.gen(function* () {
      let receivedArgs: { urlParams: { projectId: string; environment: string } } | undefined;
      const api = makeApiStub((args) => {
        receivedArgs = args;
        return Effect.succeed({ environment: args.urlParams.environment, items: [] });
      });
      yield* pullEnvVars(api, { projectId: "p_1", environment: "preview" });
      expect(receivedArgs).toStrictEqual({
        urlParams: { projectId: "p_1", environment: "preview" },
      });
    }),
  );
});
