import type { Rule, RuleOnError, RuleParams } from "markdownlint";

type MarkdownItToken = {
  type: string;
  map?: number[] | null;
  children?: MarkdownItToken[];
  lineNumber?: number;
};

type WalkContext = {
  inTable: boolean;
  listMarkerIndent: number | null;
};

export function leadingIndent(line: string): number {
  const match = /^(\s*)/.exec(line);
  return match?.[1]?.length ?? 0;
}

export function collectSoftBreakLineNumbers(lines: readonly string[], tokens: MarkdownItToken[]): number[] {
  const violations: number[] = [];
  walkTokens(tokens, lines, (lineNumber) => {
    violations.push(lineNumber);
  });
  return violations;
}

function walkTokens(
  tokens: MarkdownItToken[],
  lines: readonly string[],
  onViolation: (lineNumber: number) => void,
): void {
  const stack: WalkContext[] = [{ inTable: false, listMarkerIndent: null }];
  for (const token of tokens) {
    if (token.type === "table_open") {
      const current = stack[stack.length - 1];
      if (current !== undefined) {
        stack.push({ ...current, inTable: true });
      }
      continue;
    }
    if (token.type === "table_close") {
      stack.pop();
      continue;
    }
    if (token.type === "list_item_open") {
      const current = stack[stack.length - 1];
      if (current === undefined) {
        continue;
      }
      const markerIndex = token.map?.[0];
      const markerLine = markerIndex === undefined ? undefined : lines[markerIndex];
      const listMarkerIndent = markerLine === undefined ? current.listMarkerIndent : leadingIndent(markerLine);
      stack.push({ ...current, listMarkerIndent });
      continue;
    }
    if (token.type === "list_item_close") {
      stack.pop();
      continue;
    }
    if (token.type === "inline" && token.children) {
      const current = stack[stack.length - 1];
      if (current !== undefined && !current.inTable) {
        inspectInline(token.children, current, lines, onViolation);
      }
    }
  }
}

function inspectInline(
  children: MarkdownItToken[],
  context: WalkContext,
  lines: readonly string[],
  onViolation: (lineNumber: number) => void,
): void {
  for (const child of children) {
    if (child.type !== "softbreak" || child.lineNumber === undefined) {
      continue;
    }
    const continuationIndex = child.lineNumber;
    const continuationLine = lines[continuationIndex];
    if (continuationLine === undefined) {
      continue;
    }
    if (context.listMarkerIndent !== null) {
      if (leadingIndent(continuationLine) > context.listMarkerIndent) {
        continue;
      }
    }
    onViolation(child.lineNumber);
  }
}

const rule: Rule = {
  names: ["no-hard-wrap"],
  description: "Authored markdown must not soft-wrap paragraph or list-item prose",
  tags: ["line", "wrap"],
  parser: "markdownit",
  function: (params: RuleParams, onError: RuleOnError) => {
    const tokens = params.parsers.markdownit.tokens;
    for (const lineNumber of collectSoftBreakLineNumbers(
      params.lines,
      tokens as unknown as Parameters<typeof collectSoftBreakLineNumbers>[1],
    )) {
      const context = params.lines[lineNumber - 1];
      onError({
        lineNumber,
        detail: "Soft line break inside paragraph or list-item prose",
        ...(context === undefined ? {} : { context }),
      });
    }
  },
};

export default rule;
