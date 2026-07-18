import type { AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { AgentModelConfig, LoadError } from "../config/agent-model-config.ts";
import { readProjectRegistry, resolveMachineProfile } from "../config/machine-config-loader.ts";
import { loadMachineProfileModels } from "../config/machine-profile-loader.ts";
import { getDaemonStatus, startDaemon, stopDaemon } from "../daemon/daemon-lifecycle.ts";
import { followDaemonProcessLog, readDaemonProcessLog } from "../daemon/daemon-process-log.ts";
import type { WorkflowPresetBuilder } from "../execution/workflow-presets.ts";
import { WORKFLOW_PRESET_BUILDERS } from "../execution/workflow-presets.ts";
import { executeWriteLoop, type WriteLoopInput } from "../execution/write-loop.ts";
import { connectIpcClient, type IpcClient } from "../ipc/client.ts";
import { DAEMON_LOG_PATH, DAEMON_PID_PATH, DAEMON_SOCKET_PATH, MACHINE_CONFIG_PATH } from "../paths.ts";
import { runTuiEntry } from "../tui/tui-entry.tsx";
import { runTuiLogFollow } from "../tui/tui-log-follow-entry.tsx";
import type { RunTuiLogFollowDeps } from "../tui/tui-log-follow-types.ts";
import type { RunTuiEntryDeps } from "../tui/tui-monitor-types.ts";
import { type GetCurrentRevision, getInvokingRevision } from "./dispatch-revision.ts";

export type CliDeps = {
  executeWriteLoop: (input: WriteLoopInput) => Promise<Awaited<ReturnType<typeof executeWriteLoop>>>;
  loadAgentModelConfig: (agents: readonly string[]) => AgentModelConfig | LoadError;
  connectIpcClient: (socketPath: string) => Promise<IpcClient>;
  startDaemon: typeof startDaemon;
  stopDaemon: typeof stopDaemon;
  getDaemonStatus: typeof getDaemonStatus;
  readDaemonProcessLog: typeof readDaemonProcessLog;
  followDaemonProcessLog: typeof followDaemonProcessLog;
  onSigint: (handler: () => void) => () => void;
  runTuiEntry: (deps?: RunTuiEntryDeps) => Promise<number>;
  runTuiLogFollow: (runId: string, deps?: RunTuiLogFollowDeps) => Promise<number>;
  workflowPresetBuilders: Readonly<Record<string, WorkflowPresetBuilder>>;
  readProjectRegistry: () => Record<string, { root: string; origin?: string }>;
  cwd: () => string;
  getCurrentRevision: GetCurrentRevision;
  promptConfirm?: (message: string) => Promise<boolean>;
  /** Worktrees home for `cleanup` discovery; defaults to `jarvisHome()`. Injectable for tests. */
  jarvisRoot?: string;
  /** Subprocess runner for `cleanup` (gh/git); defaults to `realAsyncSubprocessRunner`. Injectable for tests. */
  subprocessRunner?: AsyncSubprocessRunner;
  socketPath: string;
  pidPath: string;
  logPath: string;
  machineConfigPath: string;
};

export function createRuntimeDeps(deps?: Partial<CliDeps>): CliDeps {
  return {
    executeWriteLoop,
    loadAgentModelConfig: (agents) => loadMachineProfileModels(resolveMachineProfile(), agents),
    connectIpcClient,
    startDaemon,
    stopDaemon,
    getDaemonStatus,
    readDaemonProcessLog,
    followDaemonProcessLog,
    onSigint: (handler) => {
      process.on("SIGINT", handler);
      return () => process.off("SIGINT", handler);
    },
    runTuiEntry,
    runTuiLogFollow,
    readProjectRegistry,
    cwd: () => process.cwd(),
    getCurrentRevision: getInvokingRevision,
    socketPath: DAEMON_SOCKET_PATH,
    pidPath: DAEMON_PID_PATH,
    logPath: DAEMON_LOG_PATH,
    machineConfigPath: MACHINE_CONFIG_PATH,
    ...deps,
    workflowPresetBuilders: deps?.workflowPresetBuilders ?? WORKFLOW_PRESET_BUILDERS,
  };
}
