import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HEADING_LINE_PATTERN = /^##\s/u;

/** The index of the next `##` heading after `headingIndex`, or `lines.length` when the section runs to the end. */
function sectionEnd(lines: readonly string[], headingIndex: number): number {
  const nextHeading = lines.findIndex((line, index) => index > headingIndex && HEADING_LINE_PATTERN.test(line ?? ""));
  return nextHeading === -1 ? lines.length : nextHeading;
}

function assertIndexLinks(indexBody: string, sourceFiles: readonly string[]): void {
  const linked = new Set<string>();
  const lines = indexBody.replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    // The link may carry a trailing annotation (`— why`, `(after 00)`), so the pattern must not
    // anchor at the closing paren: the publication-side check (`publication-landing.ts`) reads the
    // same lines, and a well-formed annotated link read as absent blocks a complete draft.
    const match = line.match(/^\s*-\s\[[ xX]\]\s+\[[^\]]+\]\((?:\.\/)?([^)]+)\)/u);
    const file = match?.[1];
    if (file === undefined || !/^\d{2}-.*\.md$/u.test(file)) continue;
    if (!sourceFiles.includes(file)) throw new Error(`Plan index links unknown subspec ${file}`);
    if (linked.has(file)) throw new Error(`Plan index links ${file} more than once`);
    linked.add(file);
  }
  for (const file of sourceFiles) {
    if (!linked.has(file)) throw new Error(`Plan index does not link ${file}`);
  }
}

const DECISIONS_HEADING = "## Decisions";
const BULLET_MARKER_PATTERN = /^\s*-\s/u;
const FENCE_DELIMITER_PATTERN = /^\s*```/u;

/**
 * Turns a bare (unmarked) line under `## Decisions` into its own `- ` bullet, one bullet per line.
 * A bare line already joined as a continuation of a preceding authored bullet — anything after the
 * first `- `-marked line and before the next one, per `sectionBulletTexts`' own grouping — is left
 * untouched, so a hard-wrapped multi-line bullet is not split. Lines inside a fenced block are never
 * touched. Returns the body unchanged (same string) when there is nothing to bulletize.
 */
/**
 * Lines that are structure, not prose. Bulletizing any of these destroys it — a `###` subheading
 * becomes `- ### Sub`, a table row becomes its own bullet, an ordered or `*`/`+` list item gets a
 * second marker. The bulletizer only ever repairs a bare *prose* line, so everything else is left
 * exactly as authored.
 */
const NON_PROSE_LINE_PATTERN = /^(?:#{1,6}\s|\s*[|>]|\s*\d+[.)]\s|\s*[*+]\s|\s{4,}|\s*<)/u;

/**
 * Every unfenced `## Decisions` heading in the body. Fence state is tracked from line 0, not from
 * the heading — a fenced `## Decisions` inside a markdown example (which plan drafts about spec
 * format routinely carry) would otherwise be found first, rewriting lines inside that fence and
 * skipping the real section entirely. All occurrences are returned, matching `sectionBulletTexts`.
 */
function unfencedDecisionsHeadingIndexes(lines: string[]): number[] {
  const indexes: number[] = [];
  let inFence = false;
  for (const [index, line] of lines.entries()) {
    if (FENCE_DELIMITER_PATTERN.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && line === DECISIONS_HEADING) indexes.push(index);
  }
  return indexes;
}

function bulletizeDecisionsSection(body: string): string {
  const hasCRLF = body.includes("\r\n");
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  let changed = false;
  for (const headingIndex of unfencedDecisionsHeadingIndexes(lines)) {
    const end = sectionEnd(lines, headingIndex);
    let inFence = false;
    let seenBulletMarker = false;
    for (let index = headingIndex + 1; index < end; index += 1) {
      const line = lines[index] ?? "";
      if (FENCE_DELIMITER_PATTERN.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence || line.trim() === "") continue;
      if (BULLET_MARKER_PATTERN.test(line)) {
        seenBulletMarker = true;
        continue;
      }
      // A bare line after an authored bullet is left alone: it reads as that bullet's continuation,
      // and splitting it would invent an entry the drafter did not write.
      if (seenBulletMarker || NON_PROSE_LINE_PATTERN.test(line)) continue;
      lines[index] = `- ${line}`;
      changed = true;
    }
  }
  return changed ? lines.join(hasCRLF ? "\r\n" : "\n") : body;
}

export type PlanDraftNormalizationMode = "rewrite-allowed" | "validate-only";

/**
 * Validates that the authored plan index links every authored subspec exactly once and every
 * subspec carries `## Acceptance criteria`; bullet contents are the reviewers' call, not a contract.
 * In `rewrite-allowed` mode (the staging call), bare `## Decisions` lines are bulletized in memory
 * and, only when a rewrite actually occurs, written back to the subspec file before validation runs
 * against the rewritten bytes. In `validate-only` mode (the durable-dir fallback), the tree is never
 * written to and bare lines are validated exactly as authored.
 */
export function normalizePlanDraftSpecDir(specDir: string, mode: PlanDraftNormalizationMode = "validate-only"): void {
  const sourceFiles = readdirSync(specDir)
    .filter((file) => /^\d{2}-.*\.md$/u.test(file))
    .sort();
  const indexBody = readFileSync(join(specDir, "index.md"), "utf8");
  assertIndexLinks(indexBody, sourceFiles);
  for (const file of sourceFiles) {
    const original = readFileSync(join(specDir, file), "utf8");
    const body = mode === "rewrite-allowed" ? bulletizeDecisionsSection(original) : original;
    if (body !== original) writeFileSync(join(specDir, file), body);
    if (!body.replace(/\r\n/g, "\n").split("\n").includes("## Acceptance criteria")) {
      throw new Error(`Plan subspec ${file} is missing ## Acceptance criteria`);
    }
  }
}
