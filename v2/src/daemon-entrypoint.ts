import { startDaemonRuntime } from "./daemon/daemon";

// Pure: builds the `startDaemonRuntime` handoff options from the environment, omitting keys
// whose source env var is unset rather than passing them through as `undefined`.
//
// DAEMON_PRIVATE_SOCKET_PATH: the spawning CLI resolves this because its executable digest
// may differ from the daemon's.
//
// DAEMON_PREDECESSOR_SOCKET_PATH: set only after a successful `changeover`: the outgoing
// generation's own private endpoint, so this daemon can observe its drain (see
// `daemon-drain-observer.ts`).
export function resolveHandoffOptions(env: NodeJS.ProcessEnv): {
  privateSocketPath?: string;
  predecessorSocketPath?: string;
} {
  const privateSocketPath = env.DAEMON_PRIVATE_SOCKET_PATH || undefined;
  const predecessorSocketPath = env.DAEMON_PREDECESSOR_SOCKET_PATH || undefined;
  return {
    ...(privateSocketPath === undefined ? {} : { privateSocketPath }),
    ...(predecessorSocketPath === undefined ? {} : { predecessorSocketPath }),
  };
}

if (import.meta.main) {
  if (process.argv.slice(2).includes("--help")) {
    console.log("usage: daemon-entrypoint [--help]");
    process.exit(0);
  }

  const socketPath = process.env.DAEMON_SOCKET_PATH;
  if (!socketPath) {
    console.error("DAEMON_SOCKET_PATH environment variable required");
    process.exit(1);
  }

  const testOwnerPid = Number(process.env.TEST_DAEMON_OWNER_PID);
  if (Number.isInteger(testOwnerPid) && testOwnerPid > 0) {
    setInterval(() => {
      try {
        process.kill(testOwnerPid, 0);
      } catch {
        process.exit(0);
      }
    }, 100).unref();
  }

  startDaemonRuntime(socketPath, undefined, undefined, resolveHandoffOptions(process.env)).catch((err) => {
    console.error("Fatal daemon error:", err);
    process.exit(1);
  });
}
