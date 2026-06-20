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

// Re-exports from orchestration module
export {
  deleteReadyIntentFromWorktree,
  injectRepoLineIntoIndex,
  isPathInside,
  PLAN_USAGE,
  parseIntentFrontmatter,
  planCommand,
  renderPlanNextSteps,
  resolveResumeSpecPath,
  validateReadyIntent,
} from "../modes/plan/run.ts";
