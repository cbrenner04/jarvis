import { spawnSync } from "node:child_process";
import { v1Tests } from "./run-v1-tests.ts";
import { aggregateExitCode, runV2TestFiles, v2Tests } from "./run-v2-tests.ts";
import { partitionTestFiles, walkTestFiles } from "./test-slice.ts";

/** Aggregate suite: agent tests run serially per-file (with per-file timeout), integration tests serial. */
export function aggregateTestFiles(): { agent: string[]; integration: string[] } {
  const sharedAndHarness = partitionTestFiles([...walkTestFiles("shared"), ...walkTestFiles("test")]);
  return {
    agent: [...v1Tests("agent"), ...v2Tests("agent"), ...sharedAndHarness.agent],
    integration: [...v1Tests("integration"), ...v2Tests("integration"), ...sharedAndHarness.integration],
  };
}

function runBunTest(args: string[]): number {
  return spawnSync("bun", args, { stdio: "inherit" }).status ?? 1;
}

if (import.meta.main) {
  const { agent, integration } = aggregateTestFiles();

  if (agent.length > 0) {
    const code = aggregateExitCode(runV2TestFiles("agent", agent, undefined, ""));
    if (code !== 0) {
      process.exit(code);
    }
  }

  if (integration.length > 0) {
    for (const file of integration) {
      const code = runBunTest(["test", file]);
      if (code !== 0) {
        process.exit(code);
      }
    }
  }

  process.exit(0);
}
