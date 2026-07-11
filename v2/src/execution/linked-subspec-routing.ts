import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { type LinkedSubspec, parseSpec } from "../../../shared/spec-parser.ts";

export type ActiveLinkedSubspec = {
  index: number;
  subspec: LinkedSubspec;
  path: string;
  body: string;
};

export type LinkedIndexRoutingResult =
  | { ok: true; active: ActiveLinkedSubspec; isTerminal: boolean }
  | { ok: false; error: string; errorKind: LinkedIndexErrorKind };

export type LinkedIndexErrorKind =
  | "requires_index"
  | "empty_index"
  | "already_complete"
  | "malformed_link"
  | "link_missing"
  | "link_unreadable"
  | "link_out_of_tree";

/** Resolve the active linked subspec for an index.md file.
 *
 * Validates that the spec is an index with linked subspecs, finds the first unchecked link,
 * reads its content, and returns the active subspec plus its path and body.
 */
export function resolveActiveLinkedSubspec(specPath: string, projectRoot: string): LinkedIndexRoutingResult {
  const indexPath = resolve(specPath);

  // Read index file
  let indexContent: string;
  try {
    indexContent = readFileSync(indexPath, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: `Failed to read index: ${message}`, errorKind: "link_unreadable" };
  }

  // Parse index
  const parsed = parseSpec(indexContent);
  const linkedSubspecs = parsed.linkedSubspecs;

  // Check if this is actually an index (has linked subspecs)
  if (linkedSubspecs.length === 0) {
    const hasTasks = parsed.tasks.length > 0;
    if (hasTasks) {
      // This is a direct subspec, not an index
      return { ok: false, error: "Subspec input requires an index", errorKind: "requires_index" };
    }
    return { ok: false, error: "Index has no linked subspecs", errorKind: "empty_index" };
  }

  // Find first unchecked link
  const uncheckedIndex = linkedSubspecs.findIndex((link) => !link.checked);
  if (uncheckedIndex === -1) {
    return { ok: false, error: "All linked subspecs are complete", errorKind: "already_complete" };
  }

  const activeLink = linkedSubspecs[uncheckedIndex];
  if (!activeLink) {
    return { ok: false, error: "Failed to find active linked subspec", errorKind: "malformed_link" };
  }

  // Validate and resolve the linked path
  const linkedPath = activeLink.path;
  if (!linkedPath || linkedPath.trim() === "") {
    return { ok: false, error: `Malformed link path: "${linkedPath}"`, errorKind: "malformed_link" };
  }

  const indexDir = resolve(indexPath, "..");
  const resolvedLinkedPath = isAbsolute(linkedPath) ? linkedPath : resolve(indexDir, linkedPath);

  // Check if resolved path is within project
  const projectResolvedRoot = resolve(projectRoot);
  const relativePath = relative(projectResolvedRoot, resolvedLinkedPath);
  if (relativePath.startsWith("..")) {
    return { ok: false, error: `Linked path is outside project: ${linkedPath}`, errorKind: "link_out_of_tree" };
  }

  // Read linked subspec file
  let subspecBody: string;
  try {
    subspecBody = readFileSync(resolvedLinkedPath, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: `Failed to read linked subspec: ${message}`, errorKind: "link_unreadable" };
  }

  const isTerminal = uncheckedIndex === linkedSubspecs.length - 1;

  return {
    ok: true,
    active: {
      index: uncheckedIndex,
      subspec: activeLink,
      path: resolvedLinkedPath,
      body: subspecBody,
    },
    isTerminal,
  };
}

/** Check if an index's routing checklist has been modified by the agent.
 *
 * Returns the first modified linked item's index, or undefined if none were modified.
 */
export function findModifiedLinkedCheckbox(
  beforeContent: string,
  afterContent: string,
): { modifiedIndex: number; modifiedSubspec: LinkedSubspec } | undefined {
  const before = parseSpec(beforeContent);
  const after = parseSpec(afterContent);

  for (let i = 0; i < before.linkedSubspecs.length; i++) {
    const beforeLink = before.linkedSubspecs[i];
    const afterLink = after.linkedSubspecs[i];
    if (!beforeLink || !afterLink) continue;
    if (beforeLink.checked !== afterLink.checked) {
      return { modifiedIndex: i, modifiedSubspec: beforeLink };
    }
  }

  return undefined;
}

/** Advance the index checkbox for a linked subspec by reading, parsing, updating, and writing.
 *
 * Returns the updated index content if successful.
 */
export function advanceLinkedSubspecCheckbox(indexContent: string, linkIndex: number): string | undefined {
  const parsed = parseSpec(indexContent);
  const linkedSubspecs = parsed.linkedSubspecs;

  if (!linkedSubspecs[linkIndex]) {
    return undefined;
  }

  // Find the line with the checkbox
  const lines = indexContent.replace(/\r\n/g, "\n").split("\n");
  let foundCheckboxes = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    const match = line.match(/^\s*-\s\[(.)\]\s+\[([^\]]+)\]\(([^)]+)\)$/);
    if (!match) continue;

    if (foundCheckboxes === linkIndex) {
      // Found the target checkbox
      const isChecked = match[1]?.toLowerCase() === "x";
      if (isChecked) {
        return indexContent; // Already checked
      }
      lines[i] = line.replace(/^\s*-\s\[\s\]/, "- [x]");
      return lines.join("\n");
    }

    foundCheckboxes++;
  }

  return undefined;
}
