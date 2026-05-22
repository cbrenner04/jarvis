import type { ProjectMatch } from "./config.ts";

export type PromptIo = {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
};

export type DisambiguationOptions = {
  candidates: ProjectMatch[];
  io: PromptIo;
  /** Reason for the prompt, included in the printed header. */
  reason: string;
  /** Read one line of input from the user. Should resolve to the line
   *  without its trailing newline, or `undefined` on EOF. */
  readLine: () => Promise<string | undefined>;
  /** True when stdin is interactive. When false, no prompt is issued and
   *  the function returns a non-interactive result. */
  isTty: boolean;
};

export type DisambiguationResult =
  | { kind: "selected"; project: ProjectMatch }
  | { kind: "cancelled" }
  | { kind: "non-tty" };

/**
 * Render a numbered picker for registered projects and read one line from
 * the user. Returns the matched project, or signals cancellation / non-TTY.
 *
 * See spec/2026-05-12-portable-repo-resolution/02-disambiguation-prompt.md.
 */
export async function promptForProject(
  opts: DisambiguationOptions,
): Promise<DisambiguationResult> {
  if (!opts.isTty) {
    const list = formatCandidateList(opts.candidates);
    opts.io.stderr(
      `${opts.reason}\nCandidates:\n${list}\nRerun with --repo <name>.\n`,
    );
    return { kind: "non-tty" };
  }

  opts.io.stdout(`${opts.reason}\nRegistered projects:\n`);
  opts.io.stdout(`${formatCandidateList(opts.candidates)}\n`);
  opts.io.stdout("Select a project by number or name, or 'q' to quit: ");

  const raw = await opts.readLine();
  if (raw === undefined) {
    return { kind: "cancelled" };
  }
  const input = raw.trim();
  if (input === "" || input === "q" || input === "Q") {
    return { kind: "cancelled" };
  }

  // Try numeric index (1-based).
  if (/^\d+$/.test(input)) {
    const idx = Number(input) - 1;
    if (idx >= 0 && idx < opts.candidates.length) {
      const project = opts.candidates[idx] as ProjectMatch;
      return { kind: "selected", project };
    }
    opts.io.stderr(`jarvis: ${JSON.stringify(input)} is not a valid choice\n`);
    return { kind: "cancelled" };
  }

  // Match by project name (exact).
  const byName = opts.candidates.find((p) => p.key === input);
  if (byName !== undefined) {
    return { kind: "selected", project: byName };
  }

  opts.io.stderr(`jarvis: ${JSON.stringify(input)} is not a valid choice\n`);
  return { kind: "cancelled" };
}

function formatCandidateList(candidates: ProjectMatch[]): string {
  return candidates
    .map((p, i) => {
      const origin = p.origin ?? "(no origin)";
      return `  ${i + 1}. ${p.key}  ${p.root}  ${origin}`;
    })
    .join("\n");
}
