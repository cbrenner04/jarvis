import type { CliDeps } from "../cli/deps.ts";
import type { Io } from "../cli/io.ts";
import { formatConnectionError } from "../cli/ipc.ts";
import { TUI_LOG_USAGE, TUI_USAGE } from "../cli/usage.ts";
import { resolveMachineProfile } from "../config/machine-config-loader.ts";
import { discoverLiveDaemonSockets } from "../daemon/live-daemon-socket-discovery.ts";

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
