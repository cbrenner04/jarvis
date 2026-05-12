import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const uncheckedTaskPattern = /^\s*-\s\[ \]\s/i;
const taskPattern = /^\s*-\s\[(?: |x)\]\s/i;
const uncheckedTaskCapturePattern = /^\s*-\s\[ \]\s(.*)$/i;
const uncheckedLinkPattern = /^\s*-\s\[ \]\s\[[^\]]+\]\(([^)]+)\)/;

export class MalformedSpecError extends Error {
  constructor(specPath: string) {
    super(
      `Malformed spec at ${specPath}: no GitHub-style task list checkboxes found`,
    );
    this.name = "MalformedSpecError";
  }
}

export function countUnchecked(specPath: string): number {
  const lines = readSpec(specPath).split(/\r?\n/);
  let taskCount = 0;
  let uncheckedCount = 0;

  for (const line of lines) {
    if (taskPattern.test(line)) {
      taskCount += 1;
    }

    if (uncheckedTaskPattern.test(line)) {
      uncheckedCount += 1;
    }
  }

  if (taskCount === 0) {
    throw new MalformedSpecError(specPath);
  }

  return uncheckedCount;
}

export function isComplete(specPath: string): boolean {
  return countUnchecked(specPath) === 0;
}

export type UncheckedTaskSummary = {
  line: string;
  ordinal: number;
  total: number;
};

export function getFirstUncheckedTask(specPath: string): UncheckedTaskSummary {
  const lines = readSpec(specPath).split(/\r?\n/);
  let taskCount = 0;
  let first: UncheckedTaskSummary | undefined;

  for (const line of lines) {
    if (taskPattern.test(line)) {
      taskCount += 1;
    }
    const match = line.match(uncheckedTaskCapturePattern);
    if (match !== null && first === undefined) {
      first = {
        line: match[1] ?? "",
        ordinal: taskCount,
        total: 0,
      };
    }
  }

  if (taskCount === 0) {
    throw new MalformedSpecError(specPath);
  }
  if (first === undefined) {
    throw new Error(`Spec is complete at ${specPath}: no unchecked tasks`);
  }
  first.total = taskCount;
  return first;
}

export function getActiveLinkedSubspecPath(
  indexPath: string,
): string | undefined {
  const lines = readSpec(indexPath).split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(uncheckedLinkPattern);
    if (match?.[1]) {
      return resolve(dirname(indexPath), match[1]);
    }
  }
  return undefined;
}

function readSpec(specPath: string): string {
  try {
    return readFileSync(specPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read spec file at ${specPath}: ${message}`);
  }
}
