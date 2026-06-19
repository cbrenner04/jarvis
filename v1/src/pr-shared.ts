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

/**
 * Generate narrative deterministically from index subspecs and commit subjects.
 * Caller provides injectable seams to fetch subspecs and commits.
 * Returns the template narrative, marked as generated.
 */
export function generateTemplateNarrative(opts: {
  /** Get subspec titles from index. */
  getSubspecTitles: () => string[];
  /** Get commit subjects from base..HEAD. Should return newest first. */
  getCommitSubjects: () => string[];
}): string {
  const subspecTitles = opts.getSubspecTitles();
  const commitSubjects = opts.getCommitSubjects();

  const lines: string[] = [];

  if (subspecTitles.length > 0) {
    lines.push("## Subspecs");
    for (const title of subspecTitles) {
      lines.push(`- ${title}`);
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
