import { join } from "node:path";
import { loadConfig } from "../config.ts";
import type { LogClient } from "../logging.ts";
import { enterMode } from "../mode-entry.ts";
import type { resolveTargetRepo } from "../repo.ts";
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
  /** Override the log client (for tests). */
  logClient?: LogClient;
};

export const PLAN_USAGE = `Usage: jarvis plan [--interview-turns <n>] [--review-passes <n>] [--repo <name|path|url>] [--cwd <dir>] [--resume] [<intent-file-or-text>]
                            Generate a spec tree from an intent. (planning behavior arrives in later specs)
`;

export const PLAN_STUB_MESSAGE =
  "jarvis plan: not yet implemented (skeleton landed; behavior arrives in subsequent specs)\n";

export async function planCommand(opts: PlanCommandOptions): Promise<number> {
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
  // Resolve from a file-like path (matching run mode, which passes a spec
  // file). For inline/interactive plan modes there's no real intent file, so
  // synthesize one inside cwd: resolveProject's `dirname()` then yields cwd
  // as the walk start, mirroring "as if there were a spec here".
  const candidatePath =
    inv.mode === "file" ? inv.intentPath : join(inv.cwd, "intent");
  const cfg = loadConfig(opts.config);
  const entryOpts: Parameters<typeof enterMode>[0] = {
    candidatePath,
    io: { stderr: opts.io.stderr },
    logServerUrl: cfg.logServerUrl,
  };
  if (inv.repo !== undefined) {
    entryOpts.repoFlag = inv.repo;
  }
  if (opts.config !== undefined) {
    entryOpts.config = opts.config;
  }
  if (opts.logClient !== undefined) {
    entryOpts.logClient = opts.logClient;
  }
  const entry = await enterMode(entryOpts);
  if (entry.kind === "error") {
    opts.io.stderr(`${entry.message}\n`);
    return 1;
  }
  if (entry.kind === "ambiguous") {
    const names = entry.candidates.map((c) => `  - ${c.key}`).join("\n");
    opts.io.stderr(
      `${entry.reason}\nMatching projects:\n${names}\nPass --repo <name> to disambiguate.\n`,
    );
    return 1;
  }
  if (entry.kind === "needs-prompt") {
    opts.io.stderr(
      "could not determine a target project for this intent and no projects are registered. Run `jarvis init` in a target repo, or pass --repo <name|url>.\n",
    );
    return 1;
  }
  if (entry.kind === "log-error") {
    return entry.exitCode;
  }

  const project = entry.resolution.resolved.project;
  opts.io.stderr(
    `plan mode: target project=${project.key} root=${project.root}\n`,
  );
  opts.io.stderr(PLAN_STUB_MESSAGE);
  return 2;
}
