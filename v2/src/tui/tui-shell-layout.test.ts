import { describe, expect, test } from "bun:test";
import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import { formatElapsedWallClock } from "./tui-elapsed-format.ts";
import { buildTreeRunRow, type MonitorLineRow } from "./tui-monitor-lines.ts";
import { workflowCollapsedContextSuffix } from "./tui-monitor-workflow-collapse.ts";
import {
  composeBranchRow,
  composePipelineRow,
  composeRunRow,
  composeStageRow,
  computeShellLayout,
  MIN_LABEL_COLUMNS,
  MONITOR_TREE_NOT_LIVE_LABEL,
  monitorRowFloor,
  nudgeDividerOffset,
  runRowLabel,
} from "./tui-shell-layout.ts";

describe("computeShellLayout", () => {
  test("ordinary and wide terminals use the retuned left-pane clamp", () => {
    // @mutate v2/src/tui/tui-shell-layout.ts "const LEFT_BASE_FRACTION = 0.45;" -> "const LEFT_BASE_FRACTION = 0.38;"
    // @mutate v2/src/tui/tui-shell-layout.ts "const LEFT_FLOOR = 80;" -> "const LEFT_FLOOR = 72;"
    // @mutate v2/src/tui/tui-shell-layout.ts "const LEFT_CEILING_FRACTION = 0.5;" -> "const LEFT_CEILING_FRACTION = 0.4;"
    expect(computeShellLayout(180, 50, 0)).toMatchObject({ leftWidth: 81, rightWidth: 99 });
    expect(computeShellLayout(200, 50, 0)).toMatchObject({ leftWidth: 90, rightWidth: 110 });
    expect(computeShellLayout(245, 72, 0)).toMatchObject({ leftWidth: 111, rightWidth: 134 });

    let floorOffset = 0;
    let ceilingOffset = 0;
    for (let step = 0; step < 20; step += 1) {
      floorOffset = nudgeDividerOffset(245, floorOffset, "[");
      ceilingOffset = nudgeDividerOffset(245, ceilingOffset, "]");
    }

    const base = computeShellLayout(245, 72, 0);
    const floor = computeShellLayout(245, 72, floorOffset);
    const ceiling = computeShellLayout(245, 72, ceilingOffset);
    expect(floor.leftWidth).toBe(80);
    expect(nudgeDividerOffset(245, floorOffset, "[")).toBe(floorOffset);
    expect(ceiling.leftWidth).toBe(Math.floor(245 * 0.5));
    expect(nudgeDividerOffset(245, ceilingOffset, "]")).toBe(ceilingOffset);
    expect(base.leftWidth).toBeLessThanOrEqual(ceiling.leftWidth);
  });

  // Inversion target: STACKED_THRESHOLD in tui-shell-layout.ts — changing `< 120` to `<= 120` turns this test RED.
  test("width 119 is stacked and width 120 is split", () => {
    expect(computeShellLayout(119, 72, 0)).toMatchObject({ layoutMode: "stacked", dockHeight: 4 });
    expect(computeShellLayout(120, 72, 0).layoutMode).toBe("split");
  });
});

describe("nudgeDividerOffset", () => {
  // Inversion target: NUDGE_DELTA in tui-shell-layout.ts — changing the step away from ±2 turns this test RED.
  test("each nudge moves dividerOffset and left width by exactly 2 when unclamped", () => {
    const base = computeShellLayout(245, 72, 0);
    const wider = nudgeDividerOffset(245, 0, "]");
    expect(wider).toBe(2);
    expect(computeShellLayout(245, 72, wider).leftWidth).toBe(base.leftWidth + 2);
    expect(computeShellLayout(245, 72, wider).rightWidth).toBe(base.rightWidth - 2);

    const narrower = nudgeDividerOffset(245, 0, "[");
    expect(narrower).toBe(-2);
    expect(computeShellLayout(245, 72, narrower).leftWidth).toBe(base.leftWidth - 2);
    expect(computeShellLayout(245, 72, narrower).rightWidth).toBe(base.rightWidth + 2);
  });
});

/** Composed rows are `indent, marker, gap, label, gap, atom0, gap, atom1, ...`; label is always segment 3. */
function labelSegment(row: MonitorLineRow): string {
  return row.segments[3]?.text ?? "";
}

/** Right-aligned cluster atoms, in order (interleaved gaps excluded). */
function clusterAtoms(row: MonitorLineRow): string[] {
  return row.segments
    .slice(5)
    .filter((_, index) => index % 2 === 0)
    .map((segment) => segment.text);
}

function rowDisplayWidth(row: MonitorLineRow): number {
  return row.segments.reduce((sum, segment) => sum + Bun.stringWidth(segment.text), 0);
}

describe("monitorRowFloor", () => {
  test("is hierarchy + gap + compact status + MIN_LABEL_COLUMNS", () => {
    expect(monitorRowFloor(0, "running")).toBe(2 + 1 + Bun.stringWidth("running") + MIN_LABEL_COLUMNS);
    expect(monitorRowFloor(2, "running")).toBe(6 + 1 + Bun.stringWidth("running") + MIN_LABEL_COLUMNS);
  });

  test("substitutes the placeholder glyph for empty status", () => {
    expect(monitorRowFloor(0, "")).toBe(2 + 1 + Bun.stringWidth("—") + MIN_LABEL_COLUMNS);
  });
});

describe("composeMonitorRow", () => {
  test("composes fill-width labels and per-kind clusters", () => {
    // Keystone checkpoint: restoring the fixed-width label baseline here must turn this test RED.
    // @mutate v2/src/tui/tui-shell-layout.ts "const labelWidth = paneWidth - hierarchyColumns(spec.depth) - 1 - clusterWidth(atoms);" -> "const labelWidth = 22;"
    const cases: { depth: number; row: MonitorLineRow }[] = [
      {
        depth: 0,
        row: composePipelineRow(
          { depth: 0, marker: "▼", label: "p", definition: "d", attention: "✋1", elapsed: "1m 0s", status: "running" },
          60,
        ),
      },
      {
        depth: 1,
        row: composeBranchRow(
          { depth: 1, marker: "▶", label: "b", currentStage: "plan", status: "running", elapsed: "2m 0s" },
          60,
        ),
      },
      {
        depth: 2,
        row: composeStageRow({ depth: 2, marker: "", label: "s", status: "running", elapsed: "3m 0s" }, 60),
      },
      {
        depth: 3,
        row: composeRunRow({ depth: 3, label: "r", status: "in-progress", live: "live", elapsed: "4m 0s" }, 60),
      },
      {
        depth: 0,
        row: composeRunRow(
          { depth: 0, label: "a", status: "completed", live: MONITOR_TREE_NOT_LIVE_LABEL, elapsed: "5m 0s" },
          60,
        ),
      },
    ];

    for (const { depth, row } of cases) {
      const hierarchyWidth = row.segments.slice(0, 3).reduce((sum, segment) => sum + Bun.stringWidth(segment.text), 0);
      expect(hierarchyWidth).toBe(2 * depth + 2);
      expect(rowDisplayWidth(row)).toBe(60);
    }

    const longLabelRow = composeStageRow(
      {
        depth: 0,
        marker: "",
        label: "a-very-long-stage-label-that-overflows-the-pane",
        status: "running",
        elapsed: "1s",
      },
      20,
    );
    expect(labelSegment(longLabelRow)).toContain("…");
    expect(rowDisplayWidth(longLabelRow)).toBe(20);
  });

  test("measures and truncates wide, combining, and ZWJ graphemes without splitting one", () => {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const graphemesOf = (text: string): string[] => Array.from(segmenter.segment(text), ({ segment }) => segment);

    const markers = "▼▶✋✗"; // wide/ambiguous-width marker glyphs used elsewhere in the tree
    const combining = "ééééé"; // "é" as base + combining acute, repeated
    const zwj = "👨‍👩‍👧‍👦👨‍👩‍👧‍👦"; // family emoji: multiple codepoints joined by ZWJ into one grapheme each

    for (const label of [markers, combining, zwj]) {
      const originalGraphemes = graphemesOf(label);

      // Ellipsized at/above the floor: the retained prefix is a clean grapheme prefix of the label.
      const stageRow = composeStageRow({ depth: 0, marker: "", label, status: "running", elapsed: "1s" }, 12);
      const painted = labelSegment(stageRow).trimEnd();
      expect(rowDisplayWidth(stageRow)).toBe(12);
      if (painted.endsWith("…")) {
        const prefix = painted.slice(0, -1);
        expect(originalGraphemes.slice(0, graphemesOf(prefix).length).join("")).toBe(prefix);
      }

      // Below the floor: the clipped line is a clean grapheme prefix too, never exceeding the pane width.
      const floor = monitorRowFloor(0, "running");
      const clippedRow = composeStageRow({ depth: 0, marker: "", label, status: "running", elapsed: "" }, floor - 1);
      const clippedText = clippedRow.segments[0]?.text ?? "";
      expect(Bun.stringWidth(clippedText)).toBeLessThanOrEqual(floor - 1);
      expect(graphemesOf(clippedText).join("")).toBe(clippedText);
    }
  });
});

describe("cluster degradation", () => {
  test("drops optional cluster atoms before shrinking the label", () => {
    const depth = 0;
    const hierarchy = 2 * depth + 2;
    const definition = "type-alpha";
    const attention = "✋1 ✗2";
    const elapsed = "12m 3s";
    const status = "running";
    const label = "lbl";

    const fitWidth = (atomsWidth: number): number => hierarchy + 1 + atomsWidth + MIN_LABEL_COLUMNS;
    const fullAtomsWidth = Bun.stringWidth(definition) + Bun.stringWidth(attention) + Bun.stringWidth(elapsed) + 2;
    const twoAtomsWidth = Bun.stringWidth(definition) + Bun.stringWidth(attention) + 1;
    const oneAtomWidth = Bun.stringWidth(definition);

    const pipelineInput = { depth, marker: "", label, definition, attention, elapsed, status };

    // A full cluster fits: every declared atom, in order.
    // Mutation checkpoint: composeMonitorRow's fit-budget guard omitting MIN_LABEL_COLUMNS must turn this RED.
    // @mutate v2/src/tui/tui-shell-layout.ts "return hierarchyColumns(depth) + gap + clusterWidth(atoms) + MIN_LABEL_COLUMNS <= paneWidth;" -> "return hierarchyColumns(depth) + gap + clusterWidth(atoms) <= paneWidth;"
    const full = composePipelineRow(pipelineInput, fitWidth(fullAtomsWidth));
    expect(clusterAtoms(full)).toEqual([definition, attention, elapsed]);
    expect(Bun.stringWidth(labelSegment(full))).toBe(MIN_LABEL_COLUMNS);

    // One display column less drops exactly the rightmost atom (elapsed) and cleans its separator.
    // Mutation checkpoint: dropRightmostDroppable dropping a non-droppable atom must turn this RED.
    // @mutate v2/src/tui/tui-shell-layout.ts "if (atoms[index]?.droppable) return [...atoms.slice(0, index), ...atoms.slice(index + 1)];" -> "return [...atoms.slice(0, index), ...atoms.slice(index + 1)];"
    const droppedElapsed = composePipelineRow(pipelineInput, fitWidth(fullAtomsWidth) - 1);
    expect(clusterAtoms(droppedElapsed)).toEqual([definition, attention]);
    expect(clusterAtoms(droppedElapsed)).not.toContain(elapsed);
    expect(Bun.stringWidth(labelSegment(droppedElapsed))).toBeGreaterThanOrEqual(MIN_LABEL_COLUMNS);

    // Continuing to shrink drops attention next, per the pipeline's declared right-to-left order.
    // Mutation checkpoint: degradeCluster keeping empty/exhausted atoms here must turn this RED.
    // @mutate v2/src/tui/tui-shell-layout.ts "let atoms = fullAtoms.filter((atom) => atom.text.length > 0);" -> "let atoms = [...fullAtoms];"
    const droppedAttention = composePipelineRow(pipelineInput, fitWidth(twoAtomsWidth) - 1);
    expect(clusterAtoms(droppedAttention)).toEqual([definition]);
    expect(clusterAtoms(droppedAttention)).not.toContain(attention);
    expect(clusterAtoms(droppedAttention)).not.toContain(elapsed);

    // Exhausting every droppable atom substitutes the compact pipeline status.
    // Mutation checkpoint: degradeCluster skipping the compact-status fallback must turn this RED.
    // @mutate v2/src/tui/tui-shell-layout.ts "if (atoms.length === 0 || !clusterFits(atoms, depth, paneWidth)) return [compactAtom];" -> "if (false) return [compactAtom];"
    const compact = composePipelineRow(pipelineInput, fitWidth(oneAtomWidth) - 1);
    expect(clusterAtoms(compact)).toEqual([status]);
    expect(Bun.stringWidth(labelSegment(compact))).toBeGreaterThanOrEqual(MIN_LABEL_COLUMNS);

    // Below the floor, composition falls back to one clipped, unpadded line via the same grapheme-safe primitive.
    // Mutation checkpoint: composeMonitorRow's floor comparison must turn this RED.
    // @mutate v2/src/tui/tui-shell-layout.ts "if (paneWidth < monitorRowFloor(spec.depth, spec.compactStatus)) {" -> "if (false) {"
    // Mutation checkpoint: clippedRowLine returning the unclipped naive line must turn this RED.
    // @mutate v2/src/tui/tui-shell-layout.ts "return { segments: [{ text: clipToWidth(naive, paneWidth) }] };" -> "return { segments: [{ text: naive }] };"
    const floor = monitorRowFloor(depth, status);
    const belowFloor = composePipelineRow(pipelineInput, floor - 1);
    expect(belowFloor.segments).toHaveLength(1);
    expect(Bun.stringWidth(belowFloor.segments[0]?.text ?? "")).toBeLessThanOrEqual(floor - 1);

    // Grapheme-width guard: a wide/combining grapheme never gets split mid-cluster while clipping.
    // Mutation checkpoint: letting a grapheme overshoot width here must turn grapheme-safe clipping RED.
    // @mutate v2/src/tui/tui-shell-layout.ts "if (used + graphemeWidth > width) break;" -> "if (used + graphemeWidth > width + 1) break;"
    const wideLabelRow = composePipelineRow({ ...pipelineInput, label: "✋".repeat(20) }, floor - 1);
    const wideLabelText = wideLabelRow.segments[0]?.text ?? "";
    expect(Bun.stringWidth(wideLabelText)).toBeLessThanOrEqual(floor - 1);

    // Branch compact output retains status only — current stage never survives to the floor.
    const branchInput = { depth: 1, marker: "", label, currentStage: "plan", status, elapsed };
    const branchFull = composeBranchRow(branchInput, 200);
    expect(clusterAtoms(branchFull)).toEqual(["plan", status, elapsed]);
    const branchCompact = composeBranchRow(branchInput, monitorRowFloor(1, status));
    expect(clusterAtoms(branchCompact)).toEqual([status]);
    expect(clusterAtoms(branchCompact)).not.toContain("plan");

    // Ad-hoc rows share the run cluster order (status, live, elapsed) for both full and compact output.
    const runInput = { depth: 0, label, status, live: "live", elapsed };
    const runFull = composeRunRow(runInput, 200);
    expect(clusterAtoms(runFull)).toEqual([status, "live", elapsed]);
    const runCompact = composeRunRow(runInput, monitorRowFloor(0, status));
    expect(clusterAtoms(runCompact)).toEqual([status]);
  });
});

const TEST_NOW_MS = 0;

const SAMPLE_RUN: DaemonListRunRow = {
  runId: "run-abc",
  project: "demo",
  branch: "main",
  createdAt: 0,
  status: "in-progress",
  isLive: true,
};

const WORKFLOW_CHILD_RUN: DaemonListRunRow = {
  ...SAMPLE_RUN,
  runId: "rc",
  branch: "child-branch",
  stepId: "implement-review",
  workflow: {
    invocationId: "inv-1",
    steps: [{ stepId: "implement-review", role: "actuator", status: "in_progress", attemptCount: 1 }],
  },
};

describe("run and ad-hoc rows", () => {
  test("run-row elapsed uses createdAt through finishedAtMs or nowMs", () => {
    const runStartMs = 1_700_000_000_000;
    const runEndMs = runStartMs + 125_000;
    const nowMs = runStartMs + 600_000;
    const activeRun: DaemonListRunRow = { ...SAMPLE_RUN, createdAt: runStartMs };
    const terminalRun: DaemonListRunRow = {
      ...SAMPLE_RUN,
      runId: "run-terminal",
      createdAt: runStartMs,
      finishedAtMs: runEndMs,
      status: "completed",
      isLive: false,
    };

    const activeElapsed = clusterAtoms(buildTreeRunRow({ kind: "standalone", run: activeRun }, 0, 90, nowMs)).at(-1);
    const terminalElapsed = clusterAtoms(buildTreeRunRow({ kind: "standalone", run: terminalRun }, 0, 90, nowMs)).at(
      -1,
    );
    const frozenLater = clusterAtoms(
      buildTreeRunRow({ kind: "standalone", run: terminalRun }, 0, 90, nowMs + 3_600_000),
    ).at(-1);

    expect(activeElapsed).toBe(formatElapsedWallClock(runStartMs, null, nowMs));
    expect(terminalElapsed).toBe(formatElapsedWallClock(runStartMs, runEndMs, runEndMs));
    expect(frozenLater).toBe(terminalElapsed);
  });

  test("finishless terminal runs freeze at durable finish or admission fallback", () => {
    const runStartMs = 1_700_000_000_000;
    const nowMs1 = runStartMs + 60_000;
    const nowMs2 = runStartMs + 120_000;

    // Active rows still change across display clocks.
    const activeRun: DaemonListRunRow = { ...SAMPLE_RUN, createdAt: runStartMs };
    const activeElapsed1 = clusterAtoms(buildTreeRunRow({ kind: "standalone", run: activeRun }, 0, 90, nowMs1)).at(-1);
    const activeElapsed2 = clusterAtoms(buildTreeRunRow({ kind: "standalone", run: activeRun }, 0, 90, nowMs2)).at(-1);
    expect(activeElapsed1).toBe(formatElapsedWallClock(runStartMs, null, nowMs1));
    expect(activeElapsed2).toBe(formatElapsedWallClock(runStartMs, null, nowMs2));
    expect(activeElapsed2).not.toBe(activeElapsed1);

    // A standalone terminal row with no finish has zero elapsed at its own admission, frozen across clocks.
    // @mutate v2/src/tui/tui-shell-layout.ts "const endMs = latestFinishedAtMs ?? latestCreatedAtMs;" -> "const endMs = latestFinishedAtMs ?? nowMs;"
    const finishlessRun: DaemonListRunRow = {
      ...SAMPLE_RUN,
      runId: "run-finishless",
      createdAt: runStartMs,
      status: "killed",
      isLive: false,
    };
    const finishlessElapsed1 = clusterAtoms(
      buildTreeRunRow({ kind: "standalone", run: finishlessRun }, 0, 90, nowMs1),
    ).at(-1);
    const finishlessElapsed2 = clusterAtoms(
      buildTreeRunRow({ kind: "standalone", run: finishlessRun }, 0, 90, nowMs2),
    ).at(-1);
    expect(finishlessElapsed1).toBe("0s");
    expect(finishlessElapsed2).toBe("0s");

    // A grouped terminal row uses the latest retained finish among its members.
    const groupFinishStartMs = runStartMs;
    const groupMemberA: DaemonListRunRow = {
      ...SAMPLE_RUN,
      runId: "run-a",
      createdAt: groupFinishStartMs,
      finishedAtMs: groupFinishStartMs + 30_000,
      status: "completed",
      isLive: false,
      workflow: {
        invocationId: "inv-finish",
        steps: [{ stepId: "a", role: "actuator", status: "completed", attemptCount: 1 }],
      },
      stepId: "a",
    };
    const groupMemberB: DaemonListRunRow = {
      ...SAMPLE_RUN,
      runId: "run-b",
      createdAt: groupFinishStartMs + 10_000,
      finishedAtMs: groupFinishStartMs + 90_000,
      status: "completed",
      isLive: false,
      workflow: {
        invocationId: "inv-finish",
        steps: [{ stepId: "a", role: "actuator", status: "completed", attemptCount: 1 }],
      },
      stepId: "a",
    };
    const groupFinishElapsed = clusterAtoms(
      buildTreeRunRow(
        { kind: "workflow-collapsed", representative: groupMemberB, members: [groupMemberA, groupMemberB] },
        0,
        90,
        nowMs2,
      ),
    ).at(-1);
    expect(groupFinishElapsed).toBe(formatElapsedWallClock(groupFinishStartMs, groupFinishStartMs + 90_000, nowMs2));

    // A no-finish group freezes at its latest member admission instead of the display clock.
    const groupNoFinishA: DaemonListRunRow = {
      ...SAMPLE_RUN,
      runId: "run-c",
      createdAt: runStartMs,
      status: "killed",
      isLive: false,
      workflow: {
        invocationId: "inv-nofinish",
        steps: [{ stepId: "c", role: "actuator", status: "stopped", attemptCount: 1 }],
      },
      stepId: "c",
    };
    const groupNoFinishB: DaemonListRunRow = {
      ...SAMPLE_RUN,
      runId: "run-d",
      createdAt: runStartMs + 45_000,
      status: "killed",
      isLive: false,
      workflow: {
        invocationId: "inv-nofinish",
        steps: [{ stepId: "c", role: "actuator", status: "stopped", attemptCount: 1 }],
      },
      stepId: "c",
    };
    // @mutate v2/src/tui/tui-shell-layout.ts "if (workflowGroupHasActiveMember(members)) return null;" -> "if (false) return null;"
    const groupNoFinishElapsed = clusterAtoms(
      buildTreeRunRow(
        { kind: "workflow-collapsed", representative: groupNoFinishB, members: [groupNoFinishA, groupNoFinishB] },
        0,
        90,
        nowMs2,
      ),
    ).at(-1);
    expect(groupNoFinishElapsed).toBe(formatElapsedWallClock(runStartMs, runStartMs + 45_000, nowMs2));

    // Corrupt/reversed boundaries clamp to zero rather than going negative.
    const corruptRun: DaemonListRunRow = {
      ...SAMPLE_RUN,
      runId: "run-corrupt",
      createdAt: runStartMs,
      finishedAtMs: runStartMs - 60_000,
      status: "completed",
      isLive: false,
    };
    const corruptElapsed = clusterAtoms(buildTreeRunRow({ kind: "standalone", run: corruptRun }, 0, 90, nowMs2)).at(-1);
    expect(corruptElapsed).toBe("0s");

    // A terminal group finishing under a second after admission renders the same "0s" as a finishless one,
    // rather than blanking like formatElapsedWallClock does for any other sub-second interval.
    const subSecondRun: DaemonListRunRow = {
      ...SAMPLE_RUN,
      runId: "run-sub-second",
      createdAt: runStartMs,
      finishedAtMs: runStartMs + 400,
      status: "completed",
      isLive: false,
    };
    const subSecondElapsed = clusterAtoms(buildTreeRunRow({ kind: "standalone", run: subSecondRun }, 0, 90, nowMs2)).at(
      -1,
    );
    expect(subSecondElapsed).toBe("0s");
  });

  test("a run row leads with its role and follows with the short run id", () => {
    // @mutate v2/src/tui/tui-shell-layout.ts "const head = runRowLabelHead(monitorTreeRun(tableRow));" -> "const head = monitorTreeRun(tableRow).runId;"
    const run: DaemonListRunRow = { ...WORKFLOW_CHILD_RUN, runId: "12345678-1234-1234-1234-123456789abc" };
    const label = runRowLabel({ kind: "workflow-child", run });

    expect(label).toBe("role:actuator 12345678");
  });

  test("a collapsed workflow row keeps its step context suffix after the role-first head", () => {
    // @mutate v2/src/tui/tui-shell-layout.ts "if (tableRow.kind !== \"workflow-collapsed\") return head;" -> "if (tableRow.kind === \"workflow-collapsed\") return head;"
    const representative: DaemonListRunRow = {
      runId: "87654321-4321-4321-4321-cba987654321",
      project: "demo",
      branch: "main",
      createdAt: 0,
      status: "in-progress",
      isLive: true,
      stepId: "x",
      workflow: {
        invocationId: "inv-short-role",
        steps: [{ stepId: "x", role: "a", status: "in_progress", attemptCount: 1 }],
      },
    };
    const members = [representative];
    const head = "role:a 87654321";

    const label = runRowLabel({ kind: "workflow-collapsed", representative, members });

    expect(label).toBe(head + workflowCollapsedContextSuffix(members));
    expect(label).not.toBe(head);
  });

  test("workflow-child rows indent by one hierarchy level relative to their standalone run", () => {
    const standalone = buildTreeRunRow({ kind: "standalone", run: SAMPLE_RUN }, 0, 90, TEST_NOW_MS);
    const child = buildTreeRunRow({ kind: "workflow-child", run: WORKFLOW_CHILD_RUN }, 1, 90, TEST_NOW_MS);

    expect(standalone.segments[0]?.text).toBe("");
    expect(child.segments[0]?.text).toBe("  ");
  });
});
