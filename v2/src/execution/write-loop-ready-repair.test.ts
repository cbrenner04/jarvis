import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { readyStepCompletionRecord, readyStepStartRecord } from "../../../scripts/ready.ts";
import { createJarvisHome } from "../testing/write-fixtures.ts";
import { ReadyGateError } from "./ready-finalize.ts";
import { runLoop, TestLogSink } from "./write-loop.test-support.ts";
import { readyGateRepairLogFields } from "./write-loop.ts";

const GATE_COMMAND = "bun run ready";
const OUTPUT_TAIL_MAX = 4096;

function lastLine(text: string): string {
  const lines = text.trimEnd().split("\n");
  return lines.at(-1) ?? "";
}

function readyGateRepairPin(gateOutput: string, attempt: number, gateExitCode: number) {
  return {
    kind: "ready_gate_repair" as const,
    attempt,
    gateExitCode,
    ...readyGateRepairLogFields(GATE_COMMAND, gateOutput),
  };
}

async function firstReadyGateRepairEvent(gateOutput: string) {
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
    completionCommitter: async () => ({ commitSha: "commit-abc", filesChanged: 1 }),
    completionPublisher: async () => ({}),
    runFixCommand: async () => {},
    readyFinalizer: async () => {
      if (invocations === 1) {
        throw new ReadyGateError(GATE_COMMAND, 1, gateOutput);
      }
    },
  });
  const events = logSink.getEventsForRun(result.runId).filter((event) => event.kind === "ready_gate_repair");
  return { result, first: events[0], repairCount: events.length };
}

describe("ready_gate_repair log event context", () => {
  test("first ready_gate_repair includes the terminal failed step and its output tail", async () => {
    const start = (stepId: string, attemptId: string, command: string) =>
      readyStepStartRecord({ stepId, attemptId, command });
    const done = (stepId: string, attemptId: string, command: string, status: number) =>
      readyStepCompletionRecord({ stepId, attemptId, command, status });
    const stdout = `${start("1", "1.1", "bun install")}${start("2", "2.1", "bun run check")}warning: unrelated\n${start("3", "3.1", "bun run typecheck")}error TS1: boom\nterminal step last line\n`;
    const stderr = `${start("1", "1.1", "bun install")}${done("1", "1.1", "bun install", 0)}${start("2", "2.1", "bun run check")}${done("2", "2.1", "bun run check", 0)}${start("3", "3.1", "bun run typecheck")}${done("3", "3.1", "bun run typecheck", 2)}`;
    const gateOutput = `${stdout}${stderr}`;
    const expected = readyGateRepairLogFields(GATE_COMMAND, gateOutput);

    const { result, first, repairCount } = await firstReadyGateRepairEvent(gateOutput);
    expect(result.kind).toBe("complete");
    expect(repairCount).toBe(1);
    expect(first).toEqual(readyGateRepairPin(gateOutput, 1, 1));
    expect(expected.failingStep).toBe("bun run typecheck");
    expect(lastLine(first?.gateOutputTail ?? "")).toBe(lastLine(expected.gateOutputTail));
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
    const gateOutput = `${start}${padding}\ncap tail last line\n${start}${done}`;
    const expected = readyGateRepairLogFields(GATE_COMMAND, gateOutput);

    const { result, first } = await firstReadyGateRepairEvent(gateOutput);
    expect(result.kind).toBe("complete");
    expect(first).toEqual(readyGateRepairPin(gateOutput, 1, 1));
    expect(first?.gateOutputTail.length).toBeLessThanOrEqual(OUTPUT_TAIL_MAX);
    expect(lastLine(first?.gateOutputTail ?? "")).toBe(lastLine(expected.gateOutputTail));
  });
});
