import type { Agent, AgentRunOptions } from "./agents/types.ts";
import { extractGeneratedNarrativeContent, markGeneratedNarrative } from "./pr.ts";

export const PR_DESCRIPTION_BEGIN = "<<<PR_DESCRIPTION_BEGIN>>>";
export const PR_DESCRIPTION_END = "<<<PR_DESCRIPTION_END>>>";
export const PR_DESCRIPTION_CONTEXT_MAX_CHARS = 40_000;

/**
 * Extract PR description from agent output between sentinels.
 * Validates that the extracted content contains "Decisions:".
 * Returns null if generation fails, sentinels are malformed/absent, or validation fails.
 */
export function extractPrDescription(stdout: string): string | null {
  const trimmed = stdout.trim();

  const beginIndex = trimmed.indexOf(PR_DESCRIPTION_BEGIN);
  if (beginIndex === -1) {
    return null;
  }

  const endIndex = trimmed.indexOf(PR_DESCRIPTION_END, beginIndex + PR_DESCRIPTION_BEGIN.length);
  if (endIndex === -1) {
    return null;
  }

  const description = trimmed.slice(beginIndex + PR_DESCRIPTION_BEGIN.length, endIndex).trim();

  if (description.length === 0) {
    return null;
  }

  if (!description.includes("Decisions:")) {
    return null;
  }

  return description;
}

/**
 * Generate narrative via agent call (mode-specific).
 * Caller provides the prompt and agent to invoke.
 * Returns the extracted Description + Decisions section, marked as generated.
 * Returns null if generation fails or validation fails.
 */
export async function generateNarrativeViaAgent(opts: {
  buildPrompt: () => string;
  agent: Agent;
  cwd: string;
  runOptions?: Partial<Omit<AgentRunOptions, "cwd">>;
}): Promise<string | null> {
  try {
    const prompt = opts.buildPrompt();

    const runOpts: Parameters<typeof opts.agent.run>[1] = { cwd: opts.cwd };
    if (opts.runOptions !== undefined) {
      Object.assign(runOpts, opts.runOptions);
    }

    const result = await opts.agent.run(prompt, runOpts);

    if (result.kind !== "ok") {
      return null;
    }

    const description = extractPrDescription(result.stdout);
    if (description === null) {
      return null;
    }

    return markGeneratedNarrative(description);
  } catch {
    return null;
  }
}

export type DiffStat = {
  added: number;
  removed: number;
  path: string;
};

type AreaStats = {
  added: number;
  removed: number;
  files: number;
};

/**
 * Classify a file path as source, test, docs, or config.
 * Source = code files (not test, docs, or config).
 * Test = *.test.ts or contains /test/ in path.
 * Docs = *.md or v1/docs/** or v2/docs/**.
 * Config = *.json.
 */
function classifyFile(path: string): "source" | "test" | "docs" | "config" {
  if (path.endsWith(".test.ts") || path.includes("/test/")) {
    return "test";
  }
  if (path.endsWith(".md") || path.startsWith("v1/docs/") || path.startsWith("v2/docs/")) {
    return "docs";
  }
  if (path.endsWith(".json")) {
    return "config";
  }
  return "source";
}

/**
 * Derive risk cues from diff stats.
 * Returns "no test changes" when the diff touches non-test source files but no test files.
 * Returns null otherwise (no risk cue).
 */
function deriveRiskCue(diffs: DiffStat[]): string | null {
  let hasSource = false;
  let hasTest = false;

  for (const diff of diffs) {
    const classification = classifyFile(diff.path);
    if (classification === "source") {
      hasSource = true;
    } else if (classification === "test") {
      hasTest = true;
    }
  }

  // Emit risk cue when source changed but test did not
  if (hasSource && !hasTest) {
    return "no test changes";
  }

  return null;
}

/**
 * Extract the first prose line from subspec body text.
 * Skips H1, headings (## etc), list items, and blank lines.
 * Returns the first paragraph line (up to a character bound), or null if none found.
 * Truncates with trailing `…` when longer than the bound.
 */
function extractWhyLine(body: string, charBound: number = 80): string | null {
  const lines = body.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines
    if (trimmed.length === 0) continue;

    // Skip H1 (starts with single #)
    if (trimmed.startsWith("# ")) continue;

    // Skip headings (##, ###, etc)
    if (trimmed.startsWith("#")) continue;

    // Skip list items (-, *, +)
    if (trimmed.match(/^[-*+]\s/)) continue;

    // Found prose line
    if (trimmed.length > charBound) {
      return `${trimmed.slice(0, charBound)}…`;
    }
    return trimmed;
  }

  return null;
}

/**
 * Group diff stats by area (containing directory capped at 2 segments).
 * Root-level files (no directory) bucket under `(root)`.
 */
function groupDiffsByArea(diffs: DiffStat[]): Map<string, AreaStats> {
  const areas = new Map<string, AreaStats>();

  for (const diff of diffs) {
    const area = extractArea(diff.path);
    const current = areas.get(area) ?? { added: 0, removed: 0, files: 0 };
    current.added += diff.added;
    current.removed += diff.removed;
    current.files += 1;
    areas.set(area, current);
  }

  return areas;
}

/**
 * Extract the containing directory (capped at 2 segments) from a file path.
 * Root-level files (no directory) return `(root)`.
 * Examples: `v1/src/modes/patch/x.ts` → `v1/src`, `scripts/foo.sh` → `scripts`, `prices.json` → `(root)`
 */
function extractArea(path: string): string {
  const parts = path.split("/");
  if (parts.length === 1) {
    return "(root)";
  }
  return parts.slice(0, 2).join("/");
}

/**
 * Generate narrative deterministically from index subspecs and commit subjects.
 * Caller provides injectable seams to fetch subspecs and commits.
 * Optional getDiffStats seam renders a `## Change summary` section (patch-mode only).
 * Optional getDiffStats + getSubspecBodies seams render why/risk cues (patch-mode only).
 * Returns the template narrative, marked as generated.
 */
export function generateTemplateNarrative(opts: {
  /** Get subspec titles from index. */
  getSubspecTitles: () => string[];
  /** Get commit subjects from base..HEAD. Should return newest first. */
  getCommitSubjects: () => string[];
  /** Optional: get diff stats from base...HEAD. When supplied, renders `## Change summary`. */
  getDiffStats?: () => DiffStat[];
  /** Optional: get subspec bodies (in same order as titles). Renders why lines (patch-mode only). */
  getSubspecBodies?: () => string[];
}): string {
  const subspecTitles = opts.getSubspecTitles();
  const commitSubjects = opts.getCommitSubjects();
  const diffStats = opts.getDiffStats?.();
  const subspecBodies = opts.getSubspecBodies?.();

  const lines: string[] = [];

  // Render Subspecs with why lines
  if (subspecTitles.length > 0) {
    lines.push("## Subspecs");

    // Extract why lines from bodies if available
    let whyLines: Map<string, string> | null = null;
    if (subspecBodies && subspecBodies.length > 0) {
      whyLines = new Map();
      const minLen = Math.min(subspecTitles.length, subspecBodies.length);
      for (let i = 0; i < minLen; i++) {
        const title = subspecTitles[i];
        const body = subspecBodies[i];
        if (title !== undefined && body !== undefined) {
          const whyLine = extractWhyLine(body);
          if (whyLine) {
            whyLines.set(title, whyLine);
          }
        }
      }
    }

    for (const title of subspecTitles) {
      const whyLine = whyLines?.get(title);
      if (whyLine) {
        lines.push(`- ${title} — ${whyLine}`);
      } else {
        lines.push(`- ${title}`);
      }
    }
  }

  if (commitSubjects.length > 0) {
    if (subspecTitles.length > 0) {
      lines.push("");
    }
    lines.push("## Commits");
    for (const subject of commitSubjects) {
      lines.push(`- ${subject}`);
    }
  }

  // Render risk cues and change summary if diff stats supplied and non-empty
  if (diffStats && diffStats.length > 0) {
    if (lines.length > 0) {
      lines.push("");
    }

    // Render risk cues section
    const riskCue = deriveRiskCue(diffStats);
    if (riskCue) {
      lines.push("## Risk cues");
      lines.push(`- ${riskCue}`);
      lines.push("");
    }

    lines.push("## Change summary");

    const totalAdded = diffStats.reduce((sum, d) => sum + d.added, 0);
    const totalRemoved = diffStats.reduce((sum, d) => sum + d.removed, 0);
    const totalFiles = diffStats.length;

    lines.push(`${totalFiles} file${totalFiles !== 1 ? "s" : ""} changed (+${totalAdded}/-${totalRemoved})`);
    lines.push("");

    // Group by area and sort
    const areas = groupDiffsByArea(diffStats);
    const sortedAreas = Array.from(areas.entries()).sort(([areaA, statsA], [areaB, statsB]) => {
      const changedLinesA = statsA.added + statsA.removed;
      const changedLinesB = statsB.added + statsB.removed;
      if (changedLinesB !== changedLinesA) {
        return changedLinesB - changedLinesA; // desc by changed lines
      }
      return areaA.localeCompare(areaB); // asc by path
    });

    for (const [area, stats] of sortedAreas) {
      const _changedLines = stats.added + stats.removed;
      lines.push(`- ${area}: ${stats.files} file${stats.files !== 1 ? "s" : ""} (+${stats.added}/-${stats.removed})`);
    }
  }

  const narrative = lines.length === 0 ? "(no content)" : lines.join("\n");
  return markGeneratedNarrative(narrative);
}

/**
 * Resolve whether the narrative should be regenerated.
 * Returns true if:
 * - narrative is null or empty, OR
 * - narrative is marked as generated (can be refreshed)
 */
export function shouldRegenerateNarrative(narrative: string | null): boolean {
  if (narrative === null || narrative.length === 0) {
    return true;
  }
  return extractGeneratedNarrativeContent(narrative) !== null;
}
