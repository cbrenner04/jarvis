import { aggregateExitCode, defaultSpawn, resolveConcurrency, runV2TestFiles, v2Tests } from "./run-v2-tests.ts";
import { partitionTestFiles, walkTestFiles } from "./test-slice.ts";

/** Aggregate suite: agent and integration tests both run through the pooled per-file seam. */
export function aggregateTestFiles(): { agent: string[]; integration: string[] } {
  const sharedAndHarness = partitionTestFiles([
    ...walkTestFiles("v2/src/shared"),
    ...walkTestFiles("test"),
    ...walkTestFiles("scripts"),
  ]);
  return {
    agent: [...v2Tests("agent"), ...sharedAndHarness.agent],
    integration: [...v2Tests("integration"), ...sharedAndHarness.integration],
  };
}

export async function runAggregateTests(
  concurrency?: number,
  spawn: Parameters<typeof runV2TestFiles>[2] = defaultSpawn,
): Promise<number> {
  const conc = concurrency ?? resolveConcurrency();
  const { agent, integration } = aggregateTestFiles();

  if (agent.length > 0) {
    const code = aggregateExitCode(await runV2TestFiles("agent", agent, spawn, "", conc));
    if (code !== 0) return code;
  }

  if (integration.length > 0) {
    const code = aggregateExitCode(await runV2TestFiles("integration", integration, spawn, "", conc));
    if (code !== 0) return code;
  }

  return 0;
}

if (import.meta.main) {
  const serial = process.argv.includes("--serial");
  const code = await runAggregateTests(serial ? 1 : undefined);
  process.exit(code);
}
