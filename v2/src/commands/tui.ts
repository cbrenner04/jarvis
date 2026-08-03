import type { CliDeps } from "../cli/deps.ts";
import type { Io } from "../cli/io.ts";
import { formatConnectionError, request } from "../cli/ipc.ts";
import { connectWithAutoStart } from "../cli/stale-dispatch.ts";
import { TUI_LOG_USAGE, TUI_USAGE } from "../cli/usage.ts";
import { loadMachineConfig, readProjectConfigRecord, resolveMachineProfile } from "../config/machine-config-loader.ts";
import { discoverLiveDaemonSockets } from "../daemon/live-daemon-socket-discovery.ts";
import { getPipelineDefinition } from "../execution/pipeline-registry.ts";
import { resolveProjectPipeline } from "../execution/project-pipeline-resolution.ts";
import type { IpcClient } from "../ipc/client.ts";
import type { DetachedPipelineStartAdmission } from "../tui/tui-monitor-types.ts";
import { admitPipelineStart } from "./pipeline-start-admission.ts";

function detachedPipelineStartAdmission(deps: CliDeps): DetachedPipelineStartAdmission {
  return (input) =>
    admitPipelineStart(input, {
      cwd: deps.cwd(),
      configPath: deps.machineConfigPath,
      readProjectRegistry: deps.readProjectRegistry,
      readProjectConfigRecord,
      loadMachineConfig,
      loadAgentModelConfig: deps.loadAgentModelConfig,
      resolveProjectPipeline,
      getPipelineDefinition,
      connect: () => connectWithAutoStart(deps, deps.socketPath),
      request: (connection, method, params) => request(connection as IpcClient, method, params),
    });
}

export function runTuiCommand(argv: readonly string[], io: Io, deps: CliDeps): Promise<number> {
  if (argv.length === 0) {
    let machineProfile: string | undefined;
    try {
      machineProfile = resolveMachineProfile(deps.machineConfigPath);
    } catch (error) {
      io.stderr(formatConnectionError(error));
    }
    if (machineProfile === undefined) return Promise.resolve(1);

    const entryDeps = {
      socketPath: deps.socketPath,
      socketDiscovery: discoverLiveDaemonSockets,
      machineProfile,
      admitDetachedPipelineStart: detachedPipelineStartAdmission(deps),
    };
    return deps.runTuiEntry(entryDeps);
  }
  if (argv[0] === "log") {
    const runId = argv[1];
    if (argv.length !== 2 || runId === undefined) {
      io.stderr(TUI_LOG_USAGE);
      return Promise.resolve(1);
    }
    return deps.runTuiLogFollow(runId, {
      socketPath: deps.socketPath,
      socketDiscovery: discoverLiveDaemonSockets,
    });
  }
  io.stderr(TUI_USAGE);
  return Promise.resolve(1);
}
