import type { CliDeps } from "../cli/deps.ts";
import type { Io } from "../cli/io.ts";
import { TUI_LOG_USAGE, TUI_USAGE } from "../cli/usage.ts";
import { discoverLiveDaemonSockets } from "../daemon/live-daemon-socket-discovery.ts";

export function runTuiCommand(argv: readonly string[], io: Io, deps: CliDeps): Promise<number> {
  if (argv.length === 0) {
    return deps.runTuiEntry({
      socketPath: deps.socketPath,
      socketDiscovery: discoverLiveDaemonSockets,
    });
  }
  if (argv[0] === "log") {
    const runId = argv[1];
    if (argv.length !== 2 || runId === undefined) {
      io.stderr(TUI_LOG_USAGE);
      return Promise.resolve(1);
    }
    return deps.runTuiLogFollow(runId, { socketPath: deps.socketPath });
  }
  io.stderr(TUI_USAGE);
  return Promise.resolve(1);
}
