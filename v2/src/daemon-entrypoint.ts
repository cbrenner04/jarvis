import { startDaemonRuntime } from "./daemon/daemon";

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

startDaemonRuntime(socketPath).catch((err) => {
  console.error("Fatal daemon error:", err);
  process.exit(1);
});
