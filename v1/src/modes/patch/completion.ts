import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseSpec } from "../../../../shared/spec-parser.ts";

export class MalformedSpecError extends Error {
  constructor(specPath: string) {
    super(`Malformed spec at ${specPath}: no GitHub-style task list checkboxes found`);
    this.name = "MalformedSpecError";
  }
}

export function countUnchecked(specPath: string): number {
  const parsed = parseSpec(readSpec(specPath));

  if (parsed.tasks.length === 0) {
    throw new MalformedSpecError(specPath);
  }

  return parsed.tasks.filter((task) => !task.checked).length;
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
  const parsed = parseSpec(readSpec(specPath));

  if (parsed.tasks.length === 0) {
    throw new MalformedSpecError(specPath);
  }

  const firstUncheckedIndex = parsed.tasks.findIndex((task) => !task.checked);
  if (firstUncheckedIndex === -1) {
    throw new Error(`Spec is complete at ${specPath}: no unchecked tasks`);
  }

  const first = parsed.tasks[firstUncheckedIndex];
  return {
    line: first?.body ?? "",
    ordinal: firstUncheckedIndex + 1,
    total: parsed.tasks.length,
  };
}

export function getActiveLinkedSubspecPath(indexPath: string): string | undefined {
  const parsed = parseSpec(readSpec(indexPath));
  const firstUncheckedLinked = parsed.linkedSubspecs.find((item) => !item.checked);
  if (firstUncheckedLinked === undefined) {
    return undefined;
  }
  return resolve(dirname(indexPath), firstUncheckedLinked.path);
}

/** Returns the first linked subspec blocker, if any. */
export function findBlockerInLinkedSubspecs(indexPath: string): { path: string; body: string } | undefined {
  const parsed = parseSpec(readSpec(indexPath));
  const baseDir = dirname(indexPath);

  for (const linked of parsed.linkedSubspecs) {
    const linkedPath = resolve(baseDir, linked.path);
    try {
      const linkedContent = readSpec(linkedPath);
      const linkedParsed = parseSpec(linkedContent);
      if (linkedParsed.blocker !== undefined) {
        return {
          path: linkedPath,
          body: linkedParsed.blocker,
        };
      }
    } catch {}
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
