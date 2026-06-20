import type { resolveTargetRepo } from "../repo.ts";

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
  logClient?: import("../logging.ts").LogClient;
  /** Skip git/gh checks and worktree creation (for tests). */
  skipGhCheck?: boolean;
  /** Override agent construction (for tests). */
  createAgent?: (
    agentName: import("../agents/types.ts").AgentName,
    model: string | undefined,
  ) => import("../agents/types.ts").Agent;
};

export const PLAN_USAGE = `Usage: jarvis1 plan [--review-passes <n>] [--repo <name|path|url>] [--cwd <dir>] [--target-dir <dir>] [--resume] <targetDir>/ready-intents/<name>.md
                            Run plan mode (draft specs under spec/…); see docs/plan-mode.md.
`;

// Re-exports from orchestration module
export {
  deleteReadyIntentFromWorktree,
  injectRepoLineIntoIndex,
  isPathInside,
  parseIntentFrontmatter,
  planCommand,
  renderPlanNextSteps,
  resolveResumeSpecPath,
  validateReadyIntent,
} from "../modes/plan/run.ts";
