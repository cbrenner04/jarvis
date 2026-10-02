import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { readyStepCompletionRecord, readyStepStartRecord } from "../../../scripts/ready.ts";
import { createJarvisHome } from "../testing/write-fixtures.ts";
import { ReadyGateError, selectFailedReadyStepOutput } from "./ready-finalize.ts";
import { runLoop, TestLogSink } from "./write-loop.test-support.ts";

const GATE_OUTPUT_TAIL_MAX = 4096;
const GATE_COMMAND = "bun run ready";

function gateOutputTail(stepOutput: string): string {
  return stepOutput.length <= GATE_OUTPUT_TAIL_MAX ? stepOutput : stepOutput.slice(-GATE_OUTPUT_TAIL_MAX);
}

function expectedReadyGateRepairFields(gateOutput: string) {
  const failedStep = selectFailedReadyStepOutput(GATE_COMMAND, gateOutput);
  return {
    failingStep: failedStep.step,
    gateOutputTail: gateOutputTail(failedStep.output),
  };
}

function lastLine(text: string): string {
  const lines = text.trimEnd().split("\n");
  return lines.at(-1) ?? "";
}

describe("ready_gate_repair log event context", () => {
  const completionHooks = {
    completionCommitter: async () => ({ commitSha: "commit-abc", filesChanged: 1 }),
    completionPublisher: async () => ({}),
    runFixCommand: async () => {},
  };

  test("first ready_gate_repair includes the terminal failed step and its output tail", async () => {
    const start = (stepId: string, attemptId: string, command: string) =>
      readyStepStartRecord({ stepId, attemptId, command });
    const done = (stepId: string, attemptId: string, command: string, status: number) =>
      readyStepCompletionRecord({ stepId, attemptId, command, status });
    const gateLog = (stdout: string, stderr: string) => `${stdout}${stderr}`;
    const stdout = `${start("1", "1.1", "bun install")}${start("2", "2.1", "bun run check")}warning: unrelated\n${start("3", "3.1", "bun run typecheck")}error TS1: boom\nterminal step last line\n`;
    const stderr = `${start("1", "1.1", "bun install")}${done("1", "1.1", "bun install", 0)}${start("2", "2.1", "bun run check")}${done("2", "2.1", "bun run check", 0)}${start("3", "3.1", "bun run typecheck")}${done("3", "3.1", "bun run typecheck", 2)}`;
    const gateOutput = gateLog(stdout, stderr);
    const expected = expectedReadyGateRepairFields(gateOutput);

    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const logSink = new TestLogSink();
    let invocations = 0;
    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: [
        {
          id: "sim.1",
          metadata: { agent: "sim-agent-1", model: "sim-model-1" },
          invoke: async ({ cwd }) => {
            invocations += 1;
            writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
            return { kind: "ok", stdout: "done", stderr: "" } as const;
          },
        },
      ],
      logSink,
      ...completionHooks,
      readyFinalizer: async () => {
        if (invocations === 1) {
          throw new ReadyGateError(GATE_COMMAND, 1, gateOutput);
        }
      },
    });

    expect(result.kind).toBe("complete");
    const repairEvents = logSink.getEventsForRun(result.runId).filter((event) => event.kind === "ready_gate_repair");
    expect(repairEvents).toHaveLength(1);
    const first = repairEvents[0];
    expect(first).toMatchObject({
      kind: "ready_gate_repair",
      attempt: 1,
      gateExitCode: 1,
      failingStep: expected.failingStep,
      gateOutputTail: expected.gateOutputTail,
    });
    expect(expected.failingStep).toBe("bun run typecheck");
    expect(lastLine(first?.gateOutputTail ?? "")).toBe(lastLine(expected.gateOutputTail));
    expect(first?.gateOutputTail).toContain("terminal step last line");
  });

  test("gateOutputTail is capped at 4096 bytes when step output exceeds the cap", async () => {
    const start = readyStepStartRecord({ stepId: "1", attemptId: "1.1", command: "bun run test:v2" });
    const done = readyStepCompletionRecord({
      stepId: "1",
      attemptId: "1.1",
      command: "bun run test:v2",
      status: 1,
    });
    const padding = "p".repeat(5000);
    const stdout = `${start}${padding}\ncap tail last line\n`;
    const stderr = `${start}${done}`;
    const gateOutput = `${stdout}${stderr}`;
    const expected = expectedReadyGateRepairFields(gateOutput);

    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const logSink = new TestLogSink();
    let invocations = 0;
    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: [
        {
          id: "sim.1",
          metadata: { agent: "sim-agent-1", model: "sim-model-1" },
          invoke: async ({ cwd }) => {
            invocations += 1;
            writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
            return { kind: "ok", stdout: "done", stderr: "" } as const;
          },
        },
      ],
      logSink,
      ...completionHooks,
      readyFinalizer: async () => {
        if (invocations === 1) {
          throw new ReadyGateError(GATE_COMMAND, 1, gateOutput);
        }
      },
    });

    expect(result.kind).toBe("complete");
    const first = logSink.getEventsForRun(result.runId).find((event) => event.kind === "ready_gate_repair");
    expect(first).toMatchObject({
      kind: "ready_gate_repair",
      attempt: 1,
      gateExitCode: 1,
      failingStep: expected.failingStep,
    });
    expect(first?.gateOutputTail.length).toBeLessThanOrEqual(GATE_OUTPUT_TAIL_MAX);
    expect(lastLine(first?.gateOutputTail ?? "")).toBe(lastLine(expected.gateOutputTail));
    expect(first?.gateOutputTail).toContain("cap tail last line");
    expect(first?.gateOutputTail).toBe(expected.gateOutputTail);
  });
});
