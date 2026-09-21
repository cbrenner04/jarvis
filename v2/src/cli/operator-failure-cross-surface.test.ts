import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { OperatorFailureRecord } from "../../../shared/operator-failure-record.ts";
import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import type { PipelineSnapshot } from "../daemon/pipeline-observation.ts";
import {
  type CliRepoFixture,
  captureIo,
  cliMain as main,
  makeCliRepoFixture,
  makeIpcClient,
  SESSION_UUID,
} from "../testing/cli-test-helpers.ts";
import { withFixedUuid } from "../testing/fixed-uuid.ts";
import { joinMonitorRow, monitorRightPaneSegmentRows } from "../tui/tui-monitor-lines.ts";
import { monitorPipelineStageNodeId } from "../tui/tui-monitor-pipeline-tree.ts";
import type { TuiMonitorState } from "../tui/tui-monitor-types.ts";

let fx: CliRepoFixture;

beforeAll(() => {
  fx = makeCliRepoFixture();
});

afterAll(() => {
  fx.cleanup();
});

const REQUEST_ID = "00000000-0000-4000-8000-000000000010";
const NOW_MS = 1_700_000_000_000;
const PIPELINE_ID = "pipe-cross";

const RECORD: OperatorFailureRecord = {
  expectation: "a plan file under v2/spec",
  observation: "no plan file\nfound; tab\there; esc\u001b[0m; del\u007f",
  nearMiss: "plan.txt",
  retryable: true,
  referencedPaths: [
    { path: "prompts/plan\\rules.md", origin: "harness-internal" },
    { path: "v2/spec/x y.md", origin: "operator-repository" },
  ],
};

/** Block from the `failure:` line through the last consecutive two-space-indented line, after stripping the host row prefix. */
function extractFailureBlock(lines: readonly string[], rowPrefix = ""): string[] {
  const stripped = lines.map((line) => (line.startsWith(rowPrefix) ? line.slice(rowPrefix.length) : line));
  const start = stripped.indexOf("failure:");
  if (start === -1) return [];
  let end = start + 1;
  while (end < stripped.length && stripped[end]?.startsWith("  ")) end += 1;
  return stripped.slice(start, end);
}

const nonBlockLines = (lines: readonly string[], block: readonly string[]): string[] => {
  const start = lines.indexOf("failure:");
  return start === -1 ? [...lines] : [...lines.slice(0, start), ...lines.slice(start + block.length)];
};

async function runListLines(): Promise<string[]> {
  const cap = captureIo();
  const run = { runId: "run-x", project: "demo", branch: "main", status: "failed", isLive: false, failure: RECORD };
  await withFixedUuid(REQUEST_ID, () =>
    main(["run", "list"], cap.io, {
      connectIpcClient: async () => makeIpcClient([{ kind: "response", id: REQUEST_ID, result: { runs: [run] } }]),
    }),
  );
  return cap.read().stdout.trimEnd().split("\n");
}

async function runWaitLines(): Promise<string[]> {
  const cap = captureIo();
  await withFixedUuid([SESSION_UUID, REQUEST_ID], () =>
    main(["run", "wait", "run-x"], cap.io, {
      connectIpcClient: async () =>
        makeIpcClient([{ kind: "response", id: REQUEST_ID, result: { runStatus: "failed", failure: RECORD } }]),
    }),
  );
  return cap.read().stderr.trimEnd().split("\n");
}

function failedStage(): Record<string, unknown> {
  return { stageId: "plan", branchKey: "default", position: 0, status: "failed", failureDetail: RECORD };
}

async function pipelineListLines(): Promise<string[]> {
  const cap = captureIo();
  const pipeline = { pipelineId: PIPELINE_ID, name: "cross", state: "failed", createdAt: 1, stages: [failedStage()] };
  await withFixedUuid([SESSION_UUID, "pipe-list"], () =>
    main(["pipeline", "list"], cap.io, {
      cwd: () => fx.repoRoot,
      connectIpcClient: async () =>
        makeIpcClient([{ kind: "response", id: "pipe-list", result: { pipelines: [completeSnapshot(pipeline)] } }]),
    }),
  );
  return cap.read().stdout.trimEnd().split("\n");
}

function completeSnapshot(pipeline: Record<string, unknown>): Record<string, unknown> {
  const stages = (pipeline.stages as Record<string, unknown>[]).map((stage) => ({
    id: "stage",
    workflowInvocationId: null,
    startedAt: null,
    endedAt: null,
    decidedAt: null,
    artifact: null,
    ...stage,
  }));
  return {
    terminalPublicationSucceededAt: null,
    terminalPublicationFailure: null,
    finishedAtMs: null,
    dismissedAt: null,
    ...pipeline,
    stages,
  };
}

function tuiLines(state: Partial<TuiMonitorState>): string[] {
  return monitorRightPaneSegmentRows(
    { runs: [], selectedNodeId: null, steeringFeedback: null, expandedPipelineNodeIds: [], ...state },
    NOW_MS,
  ).map(joinMonitorRow);
}

function tuiDetailLines(): string[] {
  const stage = { ...failedStage(), workflowInvocationId: null } as PipelineSnapshot["stages"][number];
  const pipeline = completeSnapshot({
    pipelineId: PIPELINE_ID,
    name: "cross",
    state: "failed",
    createdAt: NOW_MS,
    stages: [stage],
  }) as unknown as PipelineSnapshot;
  return tuiLines({
    selectedNodeId: monitorPipelineStageNodeId(PIPELINE_ID, "plan", "default"),
    pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [pipeline] } },
  });
}

function tuiRunDetailLines(): string[] {
  const run: DaemonListRunRow = {
    runId: "run-x",
    project: "demo",
    branch: "main",
    createdAt: 0,
    status: "failed",
    isLive: false,
    failure: RECORD,
  };
  return tuiLines({ runs: [run], selectedNodeId: "run-x" });
}

describe("operator failure block identity across surfaces", () => {
  test("run list, run wait, pipeline list, and TUI stage and run detail render byte-identical blocks", async () => {
    const surfaces = {
      "run list": await runListLines(),
      "run wait": await runWaitLines(),
      "pipeline list": await pipelineListLines(),
      "tui stage detail": tuiDetailLines(),
      "tui run detail": tuiRunDetailLines(),
    };
    const blocks = Object.values(surfaces).map((lines) => extractFailureBlock(lines));

    const [expected] = blocks;
    expect(expected).toEqual([
      "failure:",
      "  expectation: a plan file under v2/spec",
      "  observation: no plan file\\nfound; tab\\there; esc\\u001b[0m; del\\u007f",
      "  near miss: plan.txt",
      "  reissue can help: yes",
      "  path (harness-internal): prompts/plan\\\\rules.md",
      "  path (operator-repository): v2/spec/x y.md",
    ]);
    for (const block of blocks) expect(block.join("\n")).toBe(expected?.join("\n") ?? "");

    const surroundings = Object.values(surfaces).map((lines) => nonBlockLines(lines, expected ?? []).join("\n"));
    expect(new Set(surroundings).size).toBe(surroundings.length);
  });

  test("extractFailureBlock stops at the first non-indented line and strips only the row prefix", () => {
    expect(extractFailureBlock(["run x", "failure:", "  a: 1", "  b: 2", "next", "  c: 3"])).toEqual([
      "failure:",
      "  a: 1",
      "  b: 2",
    ]);
    expect(extractFailureBlock(["> failure:", ">   a: 1", "> tail"], "> ")).toEqual(["failure:", "  a: 1"]);
    expect(extractFailureBlock(["no block here"])).toEqual([]);
  });
});
