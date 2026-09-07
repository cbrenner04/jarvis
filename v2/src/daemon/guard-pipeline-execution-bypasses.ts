import { readFileSync } from "node:fs";
import { join } from "node:path";

const PIPELINE_EXECUTION_PATH = join(import.meta.dir, "pipeline-execution.ts");
const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT_RE = /\/\/[^\n]*/g;

export type BypassViolation = {
  line: number;
  commentBlock: string;
};

function lineNumberAtIndex(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function scanCommentPattern(source: string, pattern: RegExp): BypassViolation[] {
  const violations: BypassViolation[] = [];
  let match: RegExpExecArray | null = pattern.exec(source);
  while (match !== null) {
    const text = match[0];
    if (/\bbypass/i.test(text) && !text.includes("@pinned-bypass:")) {
      violations.push({ line: lineNumberAtIndex(source, match.index), commentBlock: text });
    }
    match = pattern.exec(source);
  }
  return violations;
}

/** Fails when a `bypass` token in `pipeline-execution.ts` comments lacks `@pinned-bypass:` in the same block. */
export function scanPipelineExecutionBypasses(source: string): BypassViolation[] {
  return [
    ...scanCommentPattern(source, new RegExp(BLOCK_COMMENT_RE.source, "g")),
    ...scanCommentPattern(source, new RegExp(LINE_COMMENT_RE.source, "g")),
  ];
}

export function loadPipelineExecutionSource(): string {
  return readFileSync(PIPELINE_EXECUTION_PATH, "utf8");
}
