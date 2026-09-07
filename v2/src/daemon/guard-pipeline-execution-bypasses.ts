import { readFileSync } from "node:fs";
import { join } from "node:path";

const PIPELINE_EXECUTION_PATH = join(import.meta.dir, "pipeline-execution.ts");
const COMMENT_RE = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;

export type BypassViolation = { line: number };

/** Fails when a `bypass` token in `pipeline-execution.ts` comments lacks `@pinned-bypass:` in the same block. */
export function scanPipelineExecutionBypasses(source: string): BypassViolation[] {
  const violations: BypassViolation[] = [];
  for (const match of source.matchAll(COMMENT_RE)) {
    const text = match[0];
    if (/\bbypass/i.test(text) && !text.includes("@pinned-bypass:")) {
      violations.push({ line: source.slice(0, match.index).split("\n").length });
    }
  }
  return violations;
}

export function loadPipelineExecutionSource(): string {
  return readFileSync(PIPELINE_EXECUTION_PATH, "utf8");
}
