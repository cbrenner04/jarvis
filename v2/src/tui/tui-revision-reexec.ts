import { getCurrentHeadAsync } from "../../../shared/git.ts";
import { realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import {
  TUI_REVISION_REEXEC_EXIT_CODE,
  type TuiReexecCarriedState,
  type TuiRevisionReexecChannel,
  tuiRevisionReexecChannelFromEnv,
} from "./tui-reexec-channel.ts";

export { TUI_REVISION_REEXEC_EXIT_CODE, type TuiReexecCarriedState } from "./tui-reexec-channel.ts";

/** Env var carrying the daemon revision this process already re-exec'd for. */
export const TUI_REEXEC_REVISION_ENV = "JARVIS_TUI_REEXEC_REVISION";
/** Env var carrying the child's initial `selectedNodeId`, when the parent had one selected. */
export const TUI_REEXEC_SELECTED_NODE_ID_ENV = "JARVIS_TUI_REEXEC_SELECTED_NODE_ID";
/** Env var carrying the child's initial `expandedPipelineNodeIds`, comma-joined. */
export const TUI_REEXEC_EXPANDED_PIPELINE_NODE_IDS_ENV = "JARVIS_TUI_REEXEC_EXPANDED_PIPELINE_NODE_IDS";

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
  /** Explicit argv to re-exec with; defaults to unmodified `process.argv`. */
  argv?: readonly string[];
  /** Injectable re-exec channel; defaults to the supervisor channel from the worker environment. */
  channel?: TuiRevisionReexecChannel;
  /** Injectable process exit; defaults to `process.exit`. */
  exitProcess?: (code: number) => void;
};

/** This process's own loaded source revision, via the same resolver the daemon uses for `loadedRevision`. */
export async function defaultResolveTuiRevision(): Promise<string> {
  try {
    return await getCurrentHeadAsync(import.meta.dir, realAsyncSubprocessRunner);
  } catch {
    return "unknown";
  }
}

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

/**
 * Unmounts the monitor, stops scheduling, closes the daemon client, then publishes revision re-exec
 * state on the supervisor channel and exits with {@link TUI_REVISION_REEXEC_EXIT_CODE}.
 */
export async function performTuiRevisionReexec(params: PerformTuiRevisionReexecParams): Promise<void> {
  params.teardown.closeMonitor();
  params.teardown.closeRefreshScheduler();
  params.teardown.closeDaemonClient();

  const workerArgv = params.argv ?? process.argv;
  const [executable] = workerArgv;
  if (executable === undefined) throw new Error("cannot re-exec: process.argv is empty");

  const channel = params.channel ?? tuiRevisionReexecChannelFromEnv(process.env);
  channel.publish({
    daemonRevision: params.daemonRevision,
    carriedState: params.carriedState,
    workerArgv,
  });

  const exitProcess = params.exitProcess ?? ((code) => process.exit(code));
  exitProcess(TUI_REVISION_REEXEC_EXIT_CODE);
}
