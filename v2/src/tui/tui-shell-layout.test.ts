import { describe, expect, test } from "bun:test";
import {
  computeShellLayout,
  formatTreeCell,
  nudgeDividerOffset,
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
