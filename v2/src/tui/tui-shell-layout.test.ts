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
  test("reference 245×72 geometry at dividerOffset 0", () => {
    expect(computeShellLayout(245, 72, 0)).toEqual({
      layoutMode: "split",
      leftWidth: 94,
      rightWidth: 151,
      paneHeight: 68,
      dockHeight: 4,
    });
  });

  test("non-reference 200×50 geometry at dividerOffset 0", () => {
    expect(computeShellLayout(200, 50, 0)).toEqual({
      layoutMode: "split",
      leftWidth: 76,
      rightWidth: 124,
      paneHeight: 46,
      dockHeight: 4,
    });
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

  // Inversion target: LEFT_FLOOR in tui-shell-layout.ts — lowering the floor below 72 turns this test RED.
  test("[ cannot nudge left pane below 72 cols", () => {
    let offset = 0;
    for (let step = 0; step < 20; step += 1) {
      offset = nudgeDividerOffset(245, offset, "[");
    }
    expect(computeShellLayout(245, 72, offset).leftWidth).toBe(72);
    expect(nudgeDividerOffset(245, offset, "[")).toBe(offset);
  });

  // Inversion target: LEFT_CEILING_FRACTION in tui-shell-layout.ts — raising the ceiling above 40% turns this test RED.
  test("] cannot nudge left pane above 40% of width", () => {
    const ceiling = Math.floor(245 * 0.4);
    let offset = 0;
    for (let step = 0; step < 20; step += 1) {
      offset = nudgeDividerOffset(245, offset, "]");
    }
    expect(computeShellLayout(245, 72, offset).leftWidth).toBe(ceiling);
    expect(nudgeDividerOffset(245, offset, "]")).toBe(offset);
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

  test("finishless terminal run elapsed keeps advancing when nowMs advances", () => {
    const runStartMs = 1_700_000_000_000;
    const nowMs1 = runStartMs + 60_000;
    const nowMs2 = runStartMs + 120_000;
    const finishlessRun: DaemonListRunRow = {
      ...SAMPLE_RUN,
      runId: "run-finishless",
      createdAt: runStartMs,
      status: "killed",
      isLive: false,
    };

    const elapsedBefore = clusterAtoms(buildTreeRunRow({ kind: "standalone", run: finishlessRun }, 0, 90, nowMs1)).at(
      -1,
    );
    const elapsedAfter = clusterAtoms(buildTreeRunRow({ kind: "standalone", run: finishlessRun }, 0, 90, nowMs2)).at(
      -1,
    );

    expect(elapsedBefore).toBe(formatElapsedWallClock(runStartMs, null, nowMs1));
    expect(elapsedAfter).toBe(formatElapsedWallClock(runStartMs, null, nowMs2));
    expect(elapsedAfter).not.toBe(elapsedBefore);
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
