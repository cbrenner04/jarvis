import { existsSync, readFileSync } from "node:fs";
import { resolveSpecIndexPath } from "./spec-creation-title.ts";

type ParsedSpecIndex = {
  title: string;
  checklistLines: string[];
};

/** Parse an index H1 and subspec checklist lines (verbatim), mirroring v1 `parseIndex`. */
export function parseSpecIndex(indexPath: string): ParsedSpecIndex {
  if (!existsSync(indexPath)) {
    return { title: "", checklistLines: [] };
  }
  const content = readFileSync(indexPath, "utf8");
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  let title = "";
  const checklistLines: string[] = [];
  for (const rawLine of lines) {
    if (title === "") {
      const h1 = rawLine.match(/^#\s+(.+?)\s*$/);
      if (h1?.[1] !== undefined) {
        title = h1[1].trim();
        continue;
      }
    }
    if (/^\s*-\s+\[( |x|X)\]\s+\[.+?\]\(.+?\)/.test(rawLine)) {
      checklistLines.push(rawLine);
    }
  }
  return { title, checklistLines };
}

/** Pre-rendered spec-authoring PR body summary: H1 plus verbatim index checklist lines. */
export function deriveSpecRunBodySummary(input: { worktreePath: string; specPath: string }): string | undefined {
  const parsed = parseSpecIndex(resolveSpecIndexPath(input.worktreePath, input.specPath));
  if (parsed.title === "") {
    return undefined;
  }
  const lines = [`# ${parsed.title}`];
  if (parsed.checklistLines.length > 0) {
    lines.push("", ...parsed.checklistLines);
  }
  return lines.join("\n");
}
