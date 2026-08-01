import { describe, expect, test } from "bun:test";
import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import { workflowCollapsedContextSuffix } from "./tui-monitor-workflow-collapse.ts";
import {
  buildMonitorTreeRow,
  computeShellLayout,
  formatTreeCell,
  listMonitorTreeCells,
  MONITOR_TREE_NOT_LIVE_LABEL,
  nudgeDividerOffset,
  TREE_COLUMN_WIDTHS,
  visibleColumns,
} from "./tui-shell-layout.ts";

const ALL_COLUMNS = [
  "marker",
  "indent",
  "label",
  "project",
  "branch",
  "state",
  "elapsed",
  "live",
  "agent",
  "id",
] as const;

function without(...omit: (typeof ALL_COLUMNS)[number][]) {
  const drop = new Set(omit);
  return ALL_COLUMNS.filter((column) => !drop.has(column));
}

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

describe("visibleColumns", () => {
  test("returns the full column set at width >= 90", () => {
    expect(visibleColumns(90)).toEqual([...ALL_COLUMNS]);
    expect(visibleColumns(120)).toEqual([...ALL_COLUMNS]);
  });

  test("drops agent and id at 72–89", () => {
    const expected = without("agent", "id");
    expect(visibleColumns(89)).toEqual(expected);
    expect(visibleColumns(72)).toEqual(expected);
  });

  test("drops branch at 58–71", () => {
    const expected = without("agent", "id", "branch");
    expect(visibleColumns(71)).toEqual(expected);
    expect(visibleColumns(58)).toEqual(expected);
  });

  test("drops project at 48–57", () => {
    const expected = without("agent", "id", "branch", "project");
    expect(visibleColumns(57)).toEqual(expected);
    expect(visibleColumns(48)).toEqual(expected);
  });

  test("returns minimal columns below 48", () => {
    const expected = ["marker", "label", "state", "elapsed"] as const;
    expect(visibleColumns(47)).toEqual(expected);
    expect(visibleColumns(30)).toEqual(expected);
  });

  // Inversion target: TIER_FULL in tui-shell-layout.ts — lowering the full-tier boundary below 90 turns this test RED.
  test("tier boundary at 90 and 89", () => {
    expect(visibleColumns(90)).toContain("agent");
    expect(visibleColumns(89)).not.toContain("agent");
  });

  // Inversion target: TIER_NO_AGENT_ID in tui-shell-layout.ts — lowering the 72-tier boundary turns this test RED.
  test("tier boundary at 72 and 71", () => {
    expect(visibleColumns(72)).toContain("project");
    expect(visibleColumns(71)).not.toContain("branch");
  });

  // Inversion target: TIER_NO_BRANCH in tui-shell-layout.ts — lowering the 58-tier boundary turns this test RED.
  test("tier boundary at 58 and 57", () => {
    expect(visibleColumns(58)).toContain("project");
    expect(visibleColumns(57)).not.toContain("project");
  });

  // Inversion target: TIER_NO_PROJECT in tui-shell-layout.ts — lowering the 48-tier boundary turns this test RED.
  test("tier boundary at 48 and 47", () => {
    expect(visibleColumns(48)).toContain("indent");
    expect(visibleColumns(47)).not.toContain("indent");
  });
});

describe("formatTreeCell", () => {
  test("truncates overflow to exactly the column width with ellipsis", () => {
    expect(formatTreeCell("abcdefghij", 5)).toBe("abcd…");
    expect(formatTreeCell("abcdefghij", 5).length).toBe(5);
  });

  test("leaves exact-fit text unchanged", () => {
    expect(formatTreeCell("abcde", 5)).toBe("abcde");
    expect(formatTreeCell("ab", 5)).toBe("ab");
  });
});

const SAMPLE_RUN: DaemonListRunRow = {
  runId: "run-abc",
  project: "demo",
  branch: "main",
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

const COLLAPSED_WORKFLOW_REP: DaemonListRunRow = {
  runId: "run-review",
  project: "demo",
  branch: "feature-review",
  status: "in-progress",
  isLive: true,
  workflow: {
    invocationId: "inv-implement-review",
    steps: [
      { stepId: "implement", role: "implement", status: "completed", attemptCount: 2 },
      { stepId: "implement-review", role: "actuator", status: "in_progress", attemptCount: 1 },
      { stepId: "verify", role: "verify", status: "pending", attemptCount: 0 },
    ],
  },
};

const COLLAPSED_WORKFLOW_MEMBERS: DaemonListRunRow[] = [
  {
    ...COLLAPSED_WORKFLOW_REP,
    runId: "run-implement",
    branch: "feature",
    status: "completed",
    isLive: false,
  },
  COLLAPSED_WORKFLOW_REP,
];

function fullWidthRowLength(): number {
  return visibleColumns(90).reduce((sum, column) => sum + TREE_COLUMN_WIDTHS[column], 0);
}

function columnSlice(row: string, leftPaneWidth: number, column: keyof typeof TREE_COLUMN_WIDTHS): string {
  let offset = 0;
  for (const id of visibleColumns(leftPaneWidth)) {
    const width = TREE_COLUMN_WIDTHS[id];
    if (id === column) {
      return row.slice(offset, offset + width);
    }
    offset += width;
  }
  throw new Error(`column ${column} not visible at width ${leftPaneWidth}`);
}

describe("buildMonitorTreeRow", () => {
  test("full-width row length matches the sum of reference column widths", () => {
    const row = buildMonitorTreeRow({ kind: "standalone", run: SAMPLE_RUN }, "run-abc", 90);
    expect(row.length).toBe(fullWidthRowLength());
    expect(fullWidthRowLength()).toBe(92);
  });

  // Inversion target: formatMonitorTreeCell in tui-shell-layout.ts — skip or bypass formatTreeCell on overflow turns this test RED.
  test("truncates overflow with ellipsis at column width", () => {
    const longBranchRun: DaemonListRunRow = {
      ...SAMPLE_RUN,
      branch: "abcdefghijklmnopqrstuvwxyz",
    };
    const row = buildMonitorTreeRow({ kind: "standalone", run: longBranchRun }, null, 90);
    const branchCell = columnSlice(row, 90, "branch");
    expect(branchCell).toBe("abcdefghijklm…");
    expect(branchCell.length).toBe(TREE_COLUMN_WIDTHS.branch);
  });

  // Inversion target: formatMonitorTreeCell in tui-shell-layout.ts — omit width padding for absent cell values turns this test RED.
  test("unpopulated column slots reserve their defined widths", () => {
    const standalone = buildMonitorTreeRow({ kind: "standalone", run: SAMPLE_RUN }, null, 90);
    const child = buildMonitorTreeRow({ kind: "workflow-child", run: WORKFLOW_CHILD_RUN }, null, 90);
    expect(columnSlice(child, 90, "project")).toBe(" ".repeat(TREE_COLUMN_WIDTHS.project));
    expect(columnSlice(standalone, 90, "project")).toBe("demo".padEnd(TREE_COLUMN_WIDTHS.project));
    expect(columnSlice(child, 90, "branch")).toBe("child-branch".padEnd(TREE_COLUMN_WIDTHS.branch));
  });

  test("drops agent and id at left-pane width 72–89 while state and elapsed remain", () => {
    const row = buildMonitorTreeRow({ kind: "standalone", run: SAMPLE_RUN }, null, 80);
    const columns = visibleColumns(80);
    expect(columns).not.toContain("agent");
    expect(columns).not.toContain("id");
    expect(columns).toContain("state");
    expect(columns).toContain("elapsed");
    expect(row.length).toBe(columns.reduce((sum, column) => sum + TREE_COLUMN_WIDTHS[column], 0));
    expect(columnSlice(row, 80, "state").trimEnd()).toBe("in-progress");
    expect(columnSlice(row, 80, "elapsed")).toBe(" ".repeat(TREE_COLUMN_WIDTHS.elapsed));
  });

  test("workflow-child uses indent and role suffix; standalone and collapsed do not", () => {
    const standalone = buildMonitorTreeRow({ kind: "standalone", run: SAMPLE_RUN }, null, 90);
    const collapsed = buildMonitorTreeRow(
      { kind: "workflow-collapsed", representative: SAMPLE_RUN, members: [SAMPLE_RUN] },
      null,
      90,
    );
    const child = buildMonitorTreeRow({ kind: "workflow-child", run: WORKFLOW_CHILD_RUN }, null, 90);

    expect(columnSlice(standalone, 90, "indent")).toBe(" ".repeat(TREE_COLUMN_WIDTHS.indent));
    expect(columnSlice(collapsed, 90, "indent")).toBe(" ".repeat(TREE_COLUMN_WIDTHS.indent));
    expect(columnSlice(child, 90, "indent")).toBe("  ");

    expect(columnSlice(standalone, 90, "label").trimEnd()).toBe("run-abc");
    expect(columnSlice(collapsed, 90, "label").trimEnd()).toBe("run-abc");
    expect(columnSlice(child, 90, "label").trimEnd()).toBe("rc role:actuator");
  });

  test("workflow-collapsed appends step context suffix in label via listMonitorTreeCells", () => {
    const tableRow = {
      kind: "workflow-collapsed" as const,
      representative: COLLAPSED_WORKFLOW_REP,
      members: COLLAPSED_WORKFLOW_MEMBERS,
    };
    const expectedLabel = formatTreeCell(
      `run-review${workflowCollapsedContextSuffix(COLLAPSED_WORKFLOW_MEMBERS)}`,
      TREE_COLUMN_WIDTHS.label,
    ).padEnd(TREE_COLUMN_WIDTHS.label, " ");
    const labelCell = listMonitorTreeCells(tableRow, null, 90).find((cell) => cell.column === "label");
    expect(labelCell?.text).toBe(expectedLabel);
    expect(labelCell?.text).toContain("workflow-s");
    expect(buildMonitorTreeRow(tableRow, null, 90)).toContain("workflow-s");
  });

  test("expanded workflow-child rows render through grid builder alongside collapsed parent", () => {
    const collapsed = buildMonitorTreeRow(
      {
        kind: "workflow-collapsed",
        representative: COLLAPSED_WORKFLOW_REP,
        members: COLLAPSED_WORKFLOW_MEMBERS,
      },
      "run-review",
      90,
    );
    const collapsedMember = COLLAPSED_WORKFLOW_MEMBERS[0];
    expect(collapsedMember).toBeDefined();
    if (!collapsedMember) throw new Error("expected collapsed workflow member");
    const implementChild: DaemonListRunRow = {
      ...collapsedMember,
      runId: "run-implement",
      stepId: "implement",
    };
    const child = buildMonitorTreeRow({ kind: "workflow-child", run: implementChild }, null, 90);

    expect(columnSlice(collapsed, 90, "label")).toBe(
      formatTreeCell(
        `run-review${workflowCollapsedContextSuffix(COLLAPSED_WORKFLOW_MEMBERS)}`,
        TREE_COLUMN_WIDTHS.label,
      ).padEnd(TREE_COLUMN_WIDTHS.label, " "),
    );
    expect(columnSlice(child, 90, "indent")).toBe("  ");
    expect(columnSlice(child, 90, "label")).toBe(
      formatTreeCell("run-implement role:implement", TREE_COLUMN_WIDTHS.label).padEnd(TREE_COLUMN_WIDTHS.label, " "),
    );
    expect(columnSlice(child, 90, "project")).toBe(" ".repeat(TREE_COLUMN_WIDTHS.project));
  });

  test("live column uses a five-character non-live token", () => {
    const notLiveRun: DaemonListRunRow = { ...SAMPLE_RUN, isLive: false };
    const liveRow = buildMonitorTreeRow({ kind: "standalone", run: SAMPLE_RUN }, null, 90);
    const idleRow = buildMonitorTreeRow({ kind: "standalone", run: notLiveRun }, null, 90);

    expect(MONITOR_TREE_NOT_LIVE_LABEL.length).toBeLessThanOrEqual(TREE_COLUMN_WIDTHS.live);
    expect(columnSlice(liveRow, 90, "live").trimEnd()).toBe("live");
    expect(columnSlice(idleRow, 90, "live").trimEnd()).toBe(MONITOR_TREE_NOT_LIVE_LABEL);
    expect(columnSlice(idleRow, 90, "live").trimEnd()).not.toBe("not-…");
  });
});
