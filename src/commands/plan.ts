import { describePlanInvocation, parsePlanArgs } from "./plan-args.ts";

export type PlanIo = {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
};

export type PlanCommandOptions = {
  io: PlanIo;
  args?: readonly string[];
  cwd?: string;
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
  opts.io.stderr(PLAN_STUB_MESSAGE);
  return 2;
}
