import { existsSync, readFileSync } from "node:fs";
import { aggregateExitCode, defaultSpawn, resolveConcurrency, runV2TestFiles, v2Tests } from "./run-v2-tests.ts";
import { partitionTestFiles, planTestBatches, readTestIsolationClass, walkTestFiles } from "./test-slice.ts";

function classOfTestFile(file: string) {
  if (!file.replace(/\\/g, "/").replace(/^\.\//, "").startsWith("v2/")) {
    return undefined;
  }
  if (!existsSync(file)) {
    return undefined;
  }
  return readTestIsolationClass(file, readFileSync(file, "utf8"));
}

/** Aggregate suite: agent and integration tests both run through the pooled per-file seam. */
export function aggregateTestFiles(): { agent: string[]; integration: string[] } {
  const sharedAndHarness = partitionTestFiles([
    ...walkTestFiles("shared"),
    ...walkTestFiles("test"),
    ...walkTestFiles("scripts"),
  ]);
  const schedule = (files: string[]) => planTestBatches(files, classOfTestFile).flat();
  return {
    agent: schedule([...v2Tests("agent"), ...sharedAndHarness.agent]),
    integration: schedule([...v2Tests("integration"), ...sharedAndHarness.integration]),
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
