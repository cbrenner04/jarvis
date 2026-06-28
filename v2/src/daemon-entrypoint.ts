import { startDaemon } from "./daemon";

const socketPath = process.env.DAEMON_SOCKET_PATH;
if (!socketPath) {
  console.error("DAEMON_SOCKET_PATH environment variable required");
  process.exit(1);
}

startDaemon(socketPath).catch((err) => {
  console.error("Fatal daemon error:", err);
  process.exit(1);
});
