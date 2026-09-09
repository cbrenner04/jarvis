import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import { seedFailedIntentReviewResumeRun } from "../execution/workflow-runner.test-support.ts";
import { INTENT_RESUME_LANDING_INPUTS_NOT_RECORDED } from "../execution/workflow-runner-resume.ts";
import { openStateStore } from "../persistence/state-store.ts";
import { mockWriteLoopInput } from "../testing/run-control.ts";
import { ensureWorkflowRunnerResumeDepsWired } from "../testing/workflow-runner-resume-wiring.ts";
import { createJarvisHome, trackedTempRoots } from "../testing/write-fixtures.ts";
import { resolveRunResumeAdmission } from "./daemon-run-resume-admission.ts";
import type { TerminalLogRecord } from "./run-operator-error.ts";

const { roots } = trackedTempRoots();

const AGENT_MODEL_CONFIG: AgentModelConfig = {
  codex: {
    implement: { rungs: [{ adapterModel: "codex", priceKey: "codex" }] },
    plan: { rungs: [{ adapterModel: "plan", priceKey: "plan" }] },
    shrink: { rungs: [{ adapterModel: "shrink", priceKey: "shrink" }] },
    adversary: { rungs: [{ adapterModel: "adv", priceKey: "adv" }] },
    critic: { rungs: [{ adapterModel: "crit", priceKey: "crit" }] },
    advocate: { rungs: [{ adapterModel: "advoc", priceKey: "advoc" }] },
    adjudicator: { rungs: [{ adapterModel: "adj", priceKey: "adj" }] },
    actuator: { rungs: [{ adapterModel: "act", priceKey: "act" }] },
  },
};

test("resolveRunResumeAdmission refuses when operator error does not advertise resume", () => {
  const { jarvisRoot } = createJarvisHome();
  roots.push(jarvisRoot);
  const store = openStateStore(`${jarvisRoot}/state.db`);
  const runId = store.createRun({
    project: "demo",
    specRef: "main",
    worktreePath: "/tmp/demo",
    branch: "demo/failed",
    specPath: "spec.md",
    stepId: "implement",
    workflowSnapshot: {
      invocationId: "admission-terminal",
      steps: [
        {
          stepId: "implement",
          role: "implement",
          stepRules: "rules",
          expectedArtifactPath: "out.md",
          agents: ["codex"],
          agentModelConfig: AGENT_MODEL_CONFIG,
        },
      ],
    },
  });
  store.setRunStatus(runId, "failed");
  const run = store.loadRun(runId);
  expect(run).toBeDefined();
  if (!run) return;

  const admission = resolveRunResumeAdmission(run, undefined, [], {
    store,
    reconstructWriteResume: () => ({ ok: true, input: mockWriteLoopInput() }),
  });
  expect(admission).toEqual({ admitted: false, refusal: "terminal" });
  store.close();
});

test("resolveRunResumeAdmission refuses unsupported reconstruction when operator error advertises resume", () => {
  const { jarvisRoot } = createJarvisHome();
  roots.push(jarvisRoot);
  const store = openStateStore(`${jarvisRoot}/state.db`);
  const runId = store.createRun({
    project: "demo",
    specRef: "main",
    worktreePath: "/tmp/demo",
    branch: "demo/paused",
    specPath: "spec.md",
    stepId: "implement",
    workflowSnapshot: {
      invocationId: "admission-unsupported",
      steps: [
        {
          stepId: "implement",
          role: "implement",
          stepRules: "rules",
          expectedArtifactPath: "out.md",
          agents: ["codex"],
          agentModelConfig: AGENT_MODEL_CONFIG,
        },
      ],
    },
  });
  store.setRunStatus(runId, "paused");
  const run = store.loadRun(runId);
  expect(run).toBeDefined();
  if (!run) return;

  const terminalRecord = {
    runId,
    seq: 1,
    ts: "2026-01-01T00:00:00.000Z",
    event: { kind: "loop_finished", loopOutcomeKind: "paused", iterationsConsumed: 1, resumable: true },
  } as TerminalLogRecord;

  const admission = resolveRunResumeAdmission(run, terminalRecord, [terminalRecord], {
    store,
    reconstructWriteResume: () => ({ ok: false, message: "reconstruction refused for test" }),
  });
  expect(admission).toEqual({
    admitted: false,
    refusal: "unsupported",
    message: "reconstruction refused for test",
  });
  store.close();
});

test("resolveRunResumeAdmission names the missing landing inputs when an intent finalization resume is refused", () => {
  const { jarvisRoot } = createJarvisHome();
  roots.push(jarvisRoot);
  const workspace = join(jarvisRoot, "intent-no-inputs");
  mkdirSync(join(workspace, ".jarvis-intent-stage"), { recursive: true });
  writeFileSync(join(workspace, ".jarvis-intent-stage", "one.md"), "---\nname: one\n---\n\n## Prerequisites\n");
  const store = openStateStore(`${jarvisRoot}/state.db`);
  const runId = seedFailedIntentReviewResumeRun(store, workspace, {
    branch: "intent/no-inputs",
    invocationId: "intent-no-inputs",
    landingInputs: null,
  });
  const run = store.loadRun(runId);
  if (!run) throw new Error("expected review run");

  ensureWorkflowRunnerResumeDepsWired();
  const admission = resolveRunResumeAdmission(run, undefined, undefined, {
    store,
    reconstructWriteResume: () => ({ ok: false, message: "reconstruction must not be consulted" }),
  });
  expect(admission).toEqual({
    admitted: false,
    refusal: "unsupported",
    message: INTENT_RESUME_LANDING_INPUTS_NOT_RECORDED,
  });
  store.close();
});
