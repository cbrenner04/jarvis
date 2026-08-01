export type LayoutMode = "stacked" | "split";

export type TreeColumnId =
  | "marker"
  | "indent"
  | "label"
  | "project"
  | "branch"
  | "state"
  | "elapsed"
  | "live"
  | "agent"
  | "id";

export type ShellLayout = {
  layoutMode: LayoutMode;
  leftWidth: number;
  rightWidth: number;
  paneHeight: number;
  dockHeight: number;
};

const STACKED_THRESHOLD = 120;
const LEFT_FLOOR = 72;
const LEFT_BASE_FRACTION = 0.38;
const LEFT_CEILING_FRACTION = 0.4;
const DOCK_HEIGHT = 4;
const NUDGE_DELTA = 2;

const TIER_FULL = 90;
const TIER_NO_AGENT_ID = 72;
const TIER_NO_BRANCH = 58;
const TIER_NO_PROJECT = 48;

const FULL_COLUMNS: readonly TreeColumnId[] = [
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
];

const MINIMAL_COLUMNS: readonly TreeColumnId[] = ["marker", "label", "state", "elapsed"];

function columnsWithout(...omit: TreeColumnId[]): readonly TreeColumnId[] {
  const drop = new Set(omit);
  return FULL_COLUMNS.filter((column) => !drop.has(column));
}

const VISIBLE_AT_WIDTH: readonly { min: number; columns: readonly TreeColumnId[] }[] = [
  { min: TIER_FULL, columns: FULL_COLUMNS },
  { min: TIER_NO_AGENT_ID, columns: columnsWithout("agent", "id") },
  { min: TIER_NO_BRANCH, columns: columnsWithout("agent", "id", "branch") },
  { min: TIER_NO_PROJECT, columns: columnsWithout("agent", "id", "branch", "project") },
];

function baseLeftWidth(columns: number): number {
  return Math.ceil(columns * LEFT_BASE_FRACTION);
}

function clampLeftWidth(columns: number, dividerOffset: number): number {
  return Math.max(
    LEFT_FLOOR,
    Math.min(Math.floor(columns * LEFT_CEILING_FRACTION), baseLeftWidth(columns) + dividerOffset),
  );
}

export function computeShellLayout(columns: number, rows: number, dividerOffset: number): ShellLayout {
  const leftWidth = clampLeftWidth(columns, dividerOffset);
  return {
    layoutMode: columns < STACKED_THRESHOLD ? "stacked" : "split",
    leftWidth,
    rightWidth: columns - leftWidth,
    paneHeight: rows - DOCK_HEIGHT,
    dockHeight: DOCK_HEIGHT,
  };
}

export function nudgeDividerOffset(columns: number, dividerOffset: number, direction: "[" | "]"): number {
  const delta = direction === "[" ? -NUDGE_DELTA : NUDGE_DELTA;
  return clampLeftWidth(columns, dividerOffset + delta) - baseLeftWidth(columns);
}

export function visibleColumns(leftPaneWidth: number): readonly TreeColumnId[] {
  if (leftPaneWidth < TIER_NO_PROJECT) {
    return MINIMAL_COLUMNS;
  }
  for (const tier of VISIBLE_AT_WIDTH) {
    if (leftPaneWidth >= tier.min) {
      return tier.columns;
    }
  }
  return MINIMAL_COLUMNS;
}

export function formatTreeCell(text: string, width: number): string {
  return text.length <= width ? text : width <= 0 ? "" : `${text.slice(0, width - 1)}…`;
}
