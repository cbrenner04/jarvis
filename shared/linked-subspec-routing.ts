import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { type AcceptanceCriterion, type LinkedSubspec, parseSpec } from "./spec-parser.ts";

export type ActiveLinkedSubspec = {
  index: number;
  subspec: LinkedSubspec;
  path: string;
  body: string;
};

export type LinkedIndexErrorKind =
  | "requires_index"
  | "empty_index"
  | "already_complete"
  | "malformed_link"
  | "link_missing"
  | "link_unreadable"
  | "link_out_of_tree";

export type LinkedIndexRoutingResult =
  | { ok: true; active: ActiveLinkedSubspec; isTerminal: boolean }
  | { ok: false; error: string; errorKind: LinkedIndexErrorKind };

export type LinkedSubspecCompletionResult =
  | { ok: true; indexContent: string; isTerminal: boolean }
  | { ok: false; errorKind: "link_incomplete" | "index_routing_mutated" };

/** Select the first unchecked linked subspec and classify routing failures. */
export function resolveActiveLinkedSubspec(specPath: string, projectRoot: string): LinkedIndexRoutingResult {
  const indexPath = resolve(specPath);
  let indexContent: string;
  try {
    indexContent = readFileSync(indexPath, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: `Failed to read index: ${message}`, errorKind: "link_unreadable" };
  }

  const linkedSubspecs = parseSpec(indexContent).linkedSubspecs;
  if (linkedSubspecs.length === 0) {
    return parseSpec(indexContent).tasks.length > 0
      ? { ok: false, error: "Subspec input requires an index", errorKind: "requires_index" }
      : { ok: false, error: "Index has no linked subspecs", errorKind: "empty_index" };
  }

  const uncheckedIndex = linkedSubspecs.findIndex((link) => !link.checked);
  if (uncheckedIndex === -1) {
    return { ok: false, error: "All linked subspecs are complete", errorKind: "already_complete" };
  }
  const activeLink = linkedSubspecs[uncheckedIndex];
  if (!activeLink || !activeLink.path.trim()) {
    return { ok: false, error: `Malformed link path: "${activeLink?.path ?? ""}"`, errorKind: "malformed_link" };
  }

  const resolvedLinkedPath = isAbsolute(activeLink.path)
    ? activeLink.path
    : resolve(resolve(indexPath, ".."), activeLink.path);
  const relativePath = relative(resolve(projectRoot), resolvedLinkedPath);
  if (relativePath.startsWith("..")) {
    return { ok: false, error: `Linked path is outside project: ${activeLink.path}`, errorKind: "link_out_of_tree" };
  }

  let body: string;
  try {
    body = readFileSync(resolvedLinkedPath, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: `Failed to read linked subspec: ${message}`, errorKind: "link_unreadable" };
  }
  return {
    ok: true,
    active: { index: uncheckedIndex, subspec: activeLink, path: resolvedLinkedPath, body },
    isTerminal: uncheckedIndex === linkedSubspecs.length - 1,
  };
}

/** Return the first linked checkbox changed between two index versions. */
export function findModifiedLinkedCheckbox(
  beforeContent: string,
  afterContent: string,
): { modifiedIndex: number; modifiedSubspec: LinkedSubspec } | undefined {
  const before = parseSpec(beforeContent).linkedSubspecs;
  const after = parseSpec(afterContent).linkedSubspecs;
  for (let i = 0; i < before.length; i += 1) {
    const beforeLink = before[i];
    const afterLink = after[i];
    if (beforeLink && afterLink && beforeLink.checked !== afterLink.checked) {
      return { modifiedIndex: i, modifiedSubspec: beforeLink };
    }
  }
  return undefined;
}

/** Advance one linked checkbox after validating the completed subspec and index. */
export function completeLinkedSubspec(
  beforeIndexContent: string,
  afterIndexContent: string,
  active: { index: number; isTerminal: boolean },
  subspecContent: string,
): LinkedSubspecCompletionResult {
  const incomplete = parseSpec(subspecContent).acceptanceCriteria.some(
    (criterion: AcceptanceCriterion) => !criterion.humanOnly && !criterion.checked,
  );
  if (incomplete) return { ok: false, errorKind: "link_incomplete" };
  if (findModifiedLinkedCheckbox(beforeIndexContent, afterIndexContent) !== undefined) {
    return { ok: false, errorKind: "index_routing_mutated" };
  }
  const indexContent = advanceLinkedSubspecCheckbox(beforeIndexContent, active.index);
  if (indexContent === undefined) return { ok: false, errorKind: "index_routing_mutated" };
  return { ok: true, indexContent, isTerminal: active.isTerminal };
}

/** Advance one linked checkbox while preserving all other index content. */
export function advanceLinkedSubspecCheckbox(indexContent: string, linkIndex: number): string | undefined {
  if (!parseSpec(indexContent).linkedSubspecs[linkIndex]) return undefined;
  const lines = indexContent.replace(/\r\n/g, "\n").split("\n");
  let found = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const match = line.match(/^\s*-\s\[(.)\]\s+\[([^\]]+)\]\(([^)]+)\)$/);
    if (!match) continue;
    if (found === linkIndex) {
      if (match[1]?.toLowerCase() === "x") return indexContent;
      lines[i] = line.replace(/^\s*-\s\[\s\]/, "- [x]");
      return lines.join("\n");
    }
    found += 1;
  }
  return undefined;
}
