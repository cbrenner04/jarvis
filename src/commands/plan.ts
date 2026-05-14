import { resolveTargetRepo } from "../repo.ts";
import { describePlanInvocation, parsePlanArgs } from "./plan-args.ts";

export type PlanIo = {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
};

export type PlanCommandOptions = {
  io: PlanIo;
  args?: readonly string[];
  cwd?: string;
  /**
   * Optional config dir override (for tests).
   */
  config?: Parameters<typeof resolveTargetRepo>[0]["config"];
};

export const PLAN_USAGE = `Usage: jarvis plan [--interview-turns <n>] [--review-passes <n>] [--repo <name|path|url>] [--cwd <dir>] [--resume] [<intent-file-or-text>]
                            Generate a spec tree from an intent. (planning behavior arrives in later specs)
`;

export const PLAN_STUB_MESSAGE =
  "jarvis plan: not yet implemented (skeleton landed; behavior arrives in subsequent specs)\n";

export function planCommand(opts: PlanCommandOptions): number {
  const args = opts.args ?? [];
  if (args.includes("--help") || args.includes("-h")) {
    opts.io.stdout(PLAN_USAGE);
    return 0;
  }
  const processCwd = opts.cwd ?? process.cwd();
  const result = parsePlanArgs(args, processCwd);
  if (!result.ok) {
    opts.io.stderr(`${result.message}\n`);
    return result.exitCode;
  }
  opts.io.stderr(`${describePlanInvocation(result.invocation)}\n`);

  const inv = result.invocation;
  const candidatePath = inv.mode === "file" ? inv.intentPath : inv.cwd;
  const resolveOpts: Parameters<typeof resolveTargetRepo>[0] = {
    candidatePath,
  };
  if (inv.repo !== undefined) {
    resolveOpts.repoFlag = inv.repo;
  }
  if (opts.config !== undefined) {
    resolveOpts.config = opts.config;
  }
  const resolution = resolveTargetRepo(resolveOpts);

  if (resolution.kind === "error") {
    opts.io.stderr(`${resolution.message}\n`);
    return 1;
  }
  if (resolution.kind === "ambiguous") {
    const names = resolution.candidates.map((c) => `  - ${c.key}`).join("\n");
    opts.io.stderr(
      `${resolution.reason}\nMatching projects:\n${names}\nPass --repo <name> to disambiguate.\n`,
    );
    return 1;
  }
  if (resolution.kind === "needs-prompt") {
    opts.io.stderr(
      "could not determine a target project for this intent and no projects are registered. Run `jarvis init` in a target repo, or pass --repo <name|url>.\n",
    );
    return 1;
  }

  const project = resolution.resolved.project;
  opts.io.stderr(
    `plan mode: target project=${project.key} root=${project.root}\n`,
  );

  opts.io.stderr(PLAN_STUB_MESSAGE);
  return 2;
}
