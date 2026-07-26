import { v1Tests } from "./run-v1-tests.ts";
import { aggregateExitCode, runV2TestFiles, v2Tests } from "./run-v2-tests.ts";
import { partitionTestFiles, walkTestFiles } from "./test-slice.ts";

/** Aggregate suite: agent and integration tests both run through the pooled per-file seam. */
export function aggregateTestFiles(): { agent: string[]; integration: string[] } {
  const sharedAndHarness = partitionTestFiles([...walkTestFiles("shared"), ...walkTestFiles("test")]);
  return {
    agent: [...v1Tests("agent"), ...v2Tests("agent"), ...sharedAndHarness.agent],
    integration: [...v1Tests("integration"), ...v2Tests("integration"), ...sharedAndHarness.integration],
  };
}

if (import.meta.main) {
  const { agent, integration } = aggregateTestFiles();

  if (agent.length > 0) {
    const code = aggregateExitCode(await runV2TestFiles("agent", agent, undefined, ""));
    if (code !== 0) {
      process.exit(code);
    }
  }

  if (integration.length > 0) {
    const code = aggregateExitCode(await runV2TestFiles("integration", integration, undefined, ""));
    if (code !== 0) {
      process.exit(code);
    }
  }

  process.exit(0);
}
