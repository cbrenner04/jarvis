import { existsSync, readFileSync, rmSync } from "node:fs";
import { startDaemonRuntime } from "./daemon/daemon";

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
process.on("exit", () => {
  if (!pidPath || !existsSync(pidPath)) return;
  if (readFileSync(pidPath, "utf-8").trim() === String(process.pid)) rmSync(pidPath, { force: true });
});

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
