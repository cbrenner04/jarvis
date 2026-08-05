import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { type AcceptanceCriterion, type LinkedSubspec, parseSpec } from "./spec-parser.ts";

/** Extract required integration test scope from acceptance criteria.
 * Looks for criteria containing `bun run test:integration:v2`.
 */
export function extractRequiredIntegrationScope(acceptanceCriteria: AcceptanceCriterion[]): string | undefined {
  for (const criterion of acceptanceCriteria) {
    if (criterion.text.includes("bun run test:integration:v2")) {
      return "test:integration:v2";
    }
  }
  return undefined;
}

/** Whether `body` has any non-human-only acceptance criterion left unchecked.
 * A body with no acceptance criteria at all counts as complete.
 */
export function hasUncheckedNonHumanOnlyCriteria(body: string): boolean {
  return parseSpec(body).acceptanceCriteria.some((criterion) => !criterion.humanOnly && !criterion.checked);
}

export type ActiveLinkedSubspec = {
  index: number;
  subspec: LinkedSubspec;
  path: string;
  body: string;
  requiredIntegrationScope?: string;
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

type ResolvedLinkBody =
  | { ok: true; path: string; body: string }
  | { ok: false; error: string; errorKind: LinkedIndexErrorKind };

/** Resolve one link's absolute path and body, classifying malformed/out-of-tree/unreadable links. */
function resolveLinkBody(indexPath: string, projectRoot: string, link: LinkedSubspec): ResolvedLinkBody {
  if (!link.path.trim()) {
    return { ok: false, error: `Malformed link path: "${link.path}"`, errorKind: "malformed_link" };
  }
  const resolvedPath = isAbsolute(link.path) ? link.path : resolve(resolve(indexPath, ".."), link.path);
  const relativePath = relative(resolve(projectRoot), resolvedPath);
  if (relativePath.startsWith("..")) {
    return { ok: false, error: `Linked path is outside project: ${link.path}`, errorKind: "link_out_of_tree" };
  }
  try {
    return { ok: true, path: resolvedPath, body: readFileSync(resolvedPath, "utf8") };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: `Failed to read linked subspec: ${message}`, errorKind: "link_unreadable" };
  }
}

function readLinkedIndex(specPath: string): { ok: true; path: string; content: string } | { ok: false; error: string } {
  const indexPath = resolve(specPath);
  try {
    return { ok: true, path: indexPath, content: readFileSync(indexPath, "utf8") };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: `Failed to read index: ${message}` };
  }
}

/**
 * Select the first linked subspec with unticked non-human-only acceptance criteria, ignoring
 * index checkboxes entirely. `isTerminal` is true when every later link is also
 * criteria-complete (computed during this same scan).
 */
export function resolveActiveLinkedSubspec(specPath: string, projectRoot: string): LinkedIndexRoutingResult {
  const index = readLinkedIndex(specPath);
  if (!index.ok) return { ok: false, error: index.error, errorKind: "link_unreadable" };

  const linkedSubspecs = parseSpec(index.content).linkedSubspecs;
  if (linkedSubspecs.length === 0) {
    return parseSpec(index.content).tasks.length > 0
      ? { ok: false, error: "Subspec input requires an index", errorKind: "requires_index" }
      : { ok: false, error: "Index has no linked subspecs", errorKind: "empty_index" };
  }

  let selected: { index: number; subspec: LinkedSubspec; path: string; body: string } | undefined;
  let hasIncompleteAfterSelected = false;

  for (let i = 0; i < linkedSubspecs.length; i += 1) {
    const link = linkedSubspecs[i];
    if (link === undefined) continue;
    const resolved = resolveLinkBody(index.path, projectRoot, link);
    if (!resolved.ok) return resolved;

    const incomplete = hasUncheckedNonHumanOnlyCriteria(resolved.body);
    if (selected === undefined && !incomplete) {
      selected = { index: i, subspec: link, path: resolved.path, body: resolved.body };
    } else if (selected !== undefined && incomplete) {
      hasIncompleteAfterSelected = true;
    }
  }

  if (selected === undefined) {
    return { ok: false, error: "All linked subspecs are complete", errorKind: "already_complete" };
  }

  const requiredIntegrationScope = extractRequiredIntegrationScope(parseSpec(selected.body).acceptanceCriteria);
  return {
    ok: true,
    active: {
      index: selected.index,
      subspec: selected.subspec,
      path: selected.path,
      body: selected.body,
      ...(requiredIntegrationScope ? { requiredIntegrationScope } : {}),
    },
    isTerminal: !hasIncompleteAfterSelected,
  };
}

/**
 * Re-resolve one previously-selected link by index after its write loop completes, instead of
 * re-scanning for the first incomplete link — keeps the same subspec pinned across a
 * resolve/edit/re-resolve cycle. `isTerminal` is a fresh scan of every other link's current body.
 */
export function resolvePinnedLinkedSubspec(
  specPath: string,
  projectRoot: string,
  linkIndex: number,
): LinkedIndexRoutingResult {
  const index = readLinkedIndex(specPath);
  if (!index.ok) return { ok: false, error: index.error, errorKind: "link_unreadable" };

  const linkedSubspecs = parseSpec(index.content).linkedSubspecs;
  const pinnedLink = linkedSubspecs[linkIndex];
  if (pinnedLink === undefined) {
    return { ok: false, error: "Pinned linked subspec no longer present in index", errorKind: "malformed_link" };
  }
  const resolved = resolveLinkBody(index.path, projectRoot, pinnedLink);
  if (!resolved.ok) return resolved;

  let hasIncompleteElsewhere = false;
  for (let i = 0; i < linkedSubspecs.length; i += 1) {
    if (i === linkIndex) continue;
    const link = linkedSubspecs[i];
    if (link === undefined) continue;
    const otherResolved = resolveLinkBody(index.path, projectRoot, link);
    if (otherResolved.ok && hasUncheckedNonHumanOnlyCriteria(otherResolved.body)) {
      hasIncompleteElsewhere = true;
      break;
    }
  }

  const requiredIntegrationScope = extractRequiredIntegrationScope(parseSpec(resolved.body).acceptanceCriteria);
  return {
    ok: true,
    active: {
      index: linkIndex,
      subspec: pinnedLink,
      path: resolved.path,
      body: resolved.body,
      ...(requiredIntegrationScope ? { requiredIntegrationScope } : {}),
    },
    isTerminal: !hasIncompleteElsewhere,
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
  if (hasUncheckedNonHumanOnlyCriteria(subspecContent)) return { ok: false, errorKind: "link_incomplete" };
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
