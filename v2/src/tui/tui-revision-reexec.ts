import { spawn } from "node:child_process";

/** Env var carrying the daemon revision this process already re-exec'd for. */
export const TUI_REEXEC_REVISION_ENV = "JARVIS_TUI_REEXEC_REVISION";
/** Env var carrying the child's initial `selectedNodeId`, when the parent had one selected. */
export const TUI_REEXEC_SELECTED_NODE_ID_ENV = "JARVIS_TUI_REEXEC_SELECTED_NODE_ID";
/** Env var carrying the child's initial `expandedPipelineNodeIds`, comma-joined. */
export const TUI_REEXEC_EXPANDED_PIPELINE_NODE_IDS_ENV = "JARVIS_TUI_REEXEC_EXPANDED_PIPELINE_NODE_IDS";

/** Selection/expansion state carried over from a re-exec'd parent, restored as the child's initial state. */
export type TuiReexecCarriedState = {
  selectedNodeId: string | null;
  expandedPipelineNodeIds: readonly string[];
};

/** Teardown callbacks invoked, in order, before this process re-execs onto current code. */
type TuiReexecTeardown = {
  /** Unmount the ink monitor and restore the terminal. */
  closeMonitor(): void;
  /** Stop the refresh and display-tick schedulers. */
  closeRefreshScheduler(): void;
  /** Close the daemon client socket. */
  closeDaemonClient(): void;
};

export type PerformTuiRevisionReexecParams = {
  /** The stable daemon revision to record as the re-exec marker. */
  daemonRevision: string;
  /** This process's current selection/expansion state, carried over to the child. */
  carriedState: TuiReexecCarriedState;
  teardown: TuiReexecTeardown;
};

/** Reads the daemon revision this process already re-exec'd for, if any, from its environment. */
export function readTuiReexecedForRevision(env: NodeJS.ProcessEnv): string | undefined {
  return env[TUI_REEXEC_REVISION_ENV];
}

/** Reads carried-over selection/expansion state from a re-exec'd child's environment. */
export function readTuiReexecCarriedState(env: NodeJS.ProcessEnv): TuiReexecCarriedState {
  const expandedRaw = env[TUI_REEXEC_EXPANDED_PIPELINE_NODE_IDS_ENV];
  return {
    selectedNodeId: env[TUI_REEXEC_SELECTED_NODE_ID_ENV] ?? null,
    // Mutation checkpoint: negating this guard must turn "absent env var yields no expanded ids" RED.
    expandedPipelineNodeIds: expandedRaw !== undefined ? expandedRaw.split(",") : [],
  };
}

/** Builds the child process's environment, carrying the re-exec marker and selection/expansion state. */
export function buildTuiReexecEnv(
  baseEnv: NodeJS.ProcessEnv,
  daemonRevision: string,
  carriedState: TuiReexecCarriedState,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv, [TUI_REEXEC_REVISION_ENV]: daemonRevision };
  // Mutation checkpoint: negating this guard must turn "no selection carries no env var" RED.
  if (carriedState.selectedNodeId !== null) {
    env[TUI_REEXEC_SELECTED_NODE_ID_ENV] = carriedState.selectedNodeId;
  }
  // Mutation checkpoint: negating this guard must turn "no expanded ids carries no env var" RED.
  if (carriedState.expandedPipelineNodeIds.length > 0) {
    env[TUI_REEXEC_EXPANDED_PIPELINE_NODE_IDS_ENV] = carriedState.expandedPipelineNodeIds.join(",");
  }
  return env;
}

/** Resolves a spawned child's exit code, defaulting a signal-terminated (`null`) code to `0`. */
export function tuiReexecChildExitCode(code: number | null): number {
  return code ?? 0;
}

/**
 * Unmounts the monitor, stops scheduling, closes the daemon client, then re-execs this process
 * onto current code: spawns `process.argv` with inherited stdio and the revision marker plus
 * carried-over selection/expansion state in env, and exits with the child's code.
 */
export async function performTuiRevisionReexec(params: PerformTuiRevisionReexecParams): Promise<void> {
  params.teardown.closeMonitor();
  params.teardown.closeRefreshScheduler();
  params.teardown.closeDaemonClient();

  const [executable, ...args] = process.argv;
  if (executable === undefined) throw new Error("cannot re-exec: process.argv is empty");
  const env = buildTuiReexecEnv(process.env, params.daemonRevision, params.carriedState);
  // guard-unbounded-subprocess: re-exec spawns a long-lived replacement TUI process; this process exits when it does
  const child = spawn(executable, args, { stdio: "inherit", env });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  process.exit(tuiReexecChildExitCode(code));
}
