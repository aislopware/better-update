import { structuredLog } from "../middleware/logging";
import { handleBuildGc } from "./build-gc";
import { handleOtaGc } from "./ota-gc";

// Combined cron fan-in. index.ts wires `ctx.waitUntil(handleScheduled(env))`
// against the single daily cron. Both GC programs are idempotent, so isolating
// them with allSettled means a failure in one never silently aborts the other —
// each failure is logged and the cron still runs the remaining program.
export const handleScheduled = async (env: Env): Promise<void> => {
  const tasks: { readonly name: string; readonly run: () => Promise<void> }[] = [
    { name: "build-gc", run: async () => handleBuildGc(env) },
    { name: "ota-gc", run: async () => handleOtaGc(env) },
  ];

  const results = await Promise.allSettled(tasks.map(async (task) => task.run()));

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      structuredLog("error", "Scheduled GC task failed", {
        task: tasks[index]?.name,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  });
};
