import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A single subspec entry parsed from `index.md`.
 */
export type IndexSubspec = {
  /** Raw checklist line as it appears in `index.md` (e.g. `- [ ] [01 — Foo](./01-foo.md)`). */
  line: string;
  /** True iff the checkbox is checked (`[x]` or `[X]`). */
  checked: boolean;
};

/**
 * Parse the H1 title and subspec checklist out of an `index.md`.
 *
 * The shape mirrors what `jarvis plan` and `jarvis run` author: a single H1,
 * followed (eventually) by a checklist whose items each contain a Markdown
 * link to a subspec file. We only read the title and the checklist itself —
 * everything else in the file is ignored. Missing or malformed input
 * degrades gracefully: a missing file yields an empty title and zero
 * subspecs; non-checklist content is preserved verbatim only inasmuch as the
 * matched checklist lines are returned untouched.
 */
export function parseIndex(indexPath: string): {
  title: string;
  subspecs: IndexSubspec[];
} {
  if (!existsSync(indexPath)) {
    return { title: "", subspecs: [] };
  }
  const content = readFileSync(indexPath, "utf8");
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  let title = "";
  const subspecs: IndexSubspec[] = [];
  for (const rawLine of lines) {
    if (title === "") {
      const h1 = rawLine.match(/^#\s+(.+?)\s*$/);
      if (h1?.[1] !== undefined) {
        title = h1[1].trim();
        continue;
      }
    }
    // Match GitHub-style task list items whose text contains a Markdown link.
    const checklist = rawLine.match(/^\s*-\s+\[( |x|X)\]\s+\[.+?\]\(.+?\)/);
    if (checklist) {
      const checked = checklist[1] !== " ";
      subspecs.push({ line: rawLine, checked });
    }
  }
  return { title, subspecs };
}

/**
 * Build the deterministic header for a plan-mode PR body.
 *
 * The header has three parts (matching the global PR-body contract documented
 * in `AGENTS.md` § "PR attribution"): the spec H1 title, a `## Progress` line
 * counting checked vs total subspecs, and a verbatim mirror of the index
 * subspec checklist. When `index.md` does not yet exist (e.g., before the
 * first `plan: draft` commit), the header falls back to a minimal
 * description that does not block PR creation.
 */
export function buildPlanPrHeader(opts: {
  name: string;
  /** Worktree root; used to locate `spec/<name>/index.md`. Required to render the live header. */
  worktreePath?: string;
}): string {
  const indexPath =
    opts.worktreePath !== undefined
      ? join(opts.worktreePath, "spec", opts.name, "index.md")
      : null;
  const parsed =
    indexPath !== null ? parseIndex(indexPath) : { title: "", subspecs: [] };

  const titleLine =
    parsed.title !== "" ? `# ${parsed.title}` : `# plan: ${opts.name}`;
  const total = parsed.subspecs.length;
  const checked = parsed.subspecs.filter((s) => s.checked).length;
  const progressLine = `## Progress: ${checked}/${total}`;

  const lines: string[] = [titleLine, ""];
  lines.push(progressLine, "");
  if (parsed.subspecs.length > 0) {
    for (const sub of parsed.subspecs) {
      lines.push(sub.line);
    }
    lines.push("");
  }
  lines.push(
    "This PR was authored by `jarvis plan`. It contains a generated",
    `spec tree under \`spec/${opts.name}/\` for human review.`,
    "",
    `- Intent: \`spec/${opts.name}/intent.md\``,
    `- Index: \`spec/${opts.name}/index.md\``,
    "",
    "Plan mode never marks this PR ready for review. Once you have",
    "reviewed (and edited) the spec, mark it ready and merge to `main`.",
    "Implementation work begins in a separate run with `jarvis run",
    `spec/${opts.name}/index.md\` after the merge.`,
  );
  return lines.join("\n");
}
