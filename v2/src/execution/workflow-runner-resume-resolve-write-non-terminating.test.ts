import { describe, expect, test } from "bun:test";
import { withStateStore } from "../testing/write-fixtures.ts";
import { DEFAULT_AGENT_MODEL_CONFIG } from "./workflow-runner.test-support.ts";
import { resolveWriteNonTerminatingResumeContext } from "./workflow-runner-resume.ts";
// Side-effect import: wires workflow-runner-resume.ts's module-level resumeInjected() deps,
// which resolveWriteNonTerminatingResumeContext's admission path reads.
import "./workflow-runner-resume.test-support.ts";

describe("resolveWriteNonTerminatingResumeContext", () => {
  function writeNonTerminatingTerminalRecord(
    runId: string,
    overrides: {
      resumable?: boolean;
      loopOutcomeKind?: "non_terminating_mutation_failed" | "surviving_mutation_failed";
    } = {},
  ) {
    return {
      ts: new Date().toISOString(),
      seq: 1,
      runId,
      event: {
        kind: "loop_finished" as const,
        loopOutcomeKind: overrides.loopOutcomeKind ?? "non_terminating_mutation_failed",
        iterationsConsumed: 0,
        resumable: overrides.resumable ?? true,
      },
    };
  }

  test("admits a failed ordinary write row whose terminal loop_finished is resumable non_terminating_mutation_failed", async () => {
    await withStateStore(async (store) => {
      const snapshot = {
        invocationId: "write-non-terminating-resume",
        creationTitle: "implement: non-terminating",
        steps: [
          {
            stepId: "implement",
            role: "implement",
            stepRules: "implement rules",
            expectedArtifactPath: "artifact",
            agents: ["codex"],
            agentModelConfig: DEFAULT_AGENT_MODEL_CONFIG,
          },
        ],
      };
      const writeRunId = store.createRun({
        project: "demo",
        specRef: "main",
        worktreePath: "/fake/non-terminating",
        branch: "write/non-terminating",
        specPath: "spec.md",
        stepId: "implement",
        workflowSnapshot: snapshot,
      });
      store.setRunStatus(writeRunId, "failed");
      const run = store.loadRun(writeRunId);
      if (!run) throw new Error("expected write run");
      const terminalRecord = writeNonTerminatingTerminalRecord(writeRunId);
      expect(resolveWriteNonTerminatingResumeContext(run, store, terminalRecord)).toMatchObject({
        ok: true,
        context: { runId: writeRunId, completionAgent: "codex" },
      });
    });
  });

  test("rejects non_terminating_mutation_failed terminal evidence when resumable is false", async () => {
    await withStateStore(async (store) => {
      const snapshot = {
        invocationId: "write-non-terminating-resume-refuse",
        creationTitle: "implement: non-terminating-refuse",
        steps: [
          {
            stepId: "implement",
            role: "implement",
            stepRules: "implement rules",
            expectedArtifactPath: "artifact",
            agents: ["codex"],
            agentModelConfig: DEFAULT_AGENT_MODEL_CONFIG,
          },
        ],
      };
      const writeRunId = store.createRun({
        project: "demo",
        specRef: "main",
        worktreePath: "/fake/non-terminating-refuse",
        branch: "write/non-terminating-refuse",
        specPath: "spec.md",
        stepId: "implement",
        workflowSnapshot: snapshot,
      });
      store.setRunStatus(writeRunId, "failed");
      const run = store.loadRun(writeRunId);
      if (!run) throw new Error("expected write run");
      const terminalRecord = writeNonTerminatingTerminalRecord(writeRunId, { resumable: false });
      expect(resolveWriteNonTerminatingResumeContext(run, store, terminalRecord)).toMatchObject({
        ok: false,
        message: "run did not fail with non_terminating_mutation_failed",
      });
    });
  });
});
