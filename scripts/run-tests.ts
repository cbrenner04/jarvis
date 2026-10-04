import {
  aggregateExitCode,
  defaultSpawn,
  resolveConcurrency,
  runSliceTestFiles,
  sliceTests,
} from "./run-slice-tests.ts";

/** Aggregate suite: agent and integration tests both run through the pooled per-file seam. */
export function aggregateTestFiles(): { agent: string[]; integration: string[] } {
  return {
    agent: sliceTests("agent"),
    integration: sliceTests("integration"),
  };
}

export async function runAggregateTests(
  concurrency?: number,
  spawn: Parameters<typeof runSliceTestFiles>[2] = defaultSpawn,
): Promise<number> {
  const conc = concurrency ?? resolveConcurrency();
  const { agent, integration } = aggregateTestFiles();

  if (agent.length > 0) {
    const code = aggregateExitCode(await runSliceTestFiles("agent", agent, spawn, "", conc));
    if (code !== 0) return code;
  }

  if (integration.length > 0) {
    const code = aggregateExitCode(await runSliceTestFiles("integration", integration, spawn, "", conc));
    if (code !== 0) return code;
  }

  return 0;
}

if (import.meta.main) {
  const serial = process.argv.includes("--serial");
  const code = await runAggregateTests(serial ? 1 : undefined);
  process.exit(code);
}
