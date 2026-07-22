import { startDaemonRuntime } from "./daemon/daemon";
import { existsSync, readFileSync, rmSync } from "node:fs";

if (process.argv.slice(2).includes("--help")) {
  console.log("usage: daemon-entrypoint [--help]");
  process.exit(0);
}

const socketPath = process.env.DAEMON_SOCKET_PATH;
if (!socketPath) {
  console.error("DAEMON_SOCKET_PATH environment variable required");
  process.exit(1);
}

const pidPath = process.env.DAEMON_PID_PATH;
const removeLease = (): void => {
  if (!pidPath || !existsSync(pidPath)) return;
  try {
    if (readFileSync(pidPath, "utf8").trim() === String(process.pid)) rmSync(pidPath, { force: true });
  } catch {}
};
process.on("exit", removeLease);

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

const startupDeps = {
  ...(process.env.DAEMON_STATE_PATH === undefined ? {} : { statePath: process.env.DAEMON_STATE_PATH }),
  ...(process.env.DAEMON_LOGS_PATH === undefined ? {} : { logsPath: process.env.DAEMON_LOGS_PATH }),
};

startDaemonRuntime(socketPath, undefined, undefined, startupDeps).catch((err) => {
  console.error("Fatal daemon error:", err);
  process.exit(1);
});
