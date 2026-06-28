import { rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Whether Unix domain sockets can bind under the OS temp directory.
 *
 * Settled once at module load; does not change afterward. False when the
 * environment blocks socket creation (for example a restricted sandbox).
 */
export let canCreateSockets = false;

const probeSocketPath = join(tmpdir(), `.jarvis-socket-probe-${process.pid}-${Date.now()}`);
const probeServer = createServer();

await new Promise<void>((resolve) => {
  probeServer.once("listening", () => {
    canCreateSockets = true;
    probeServer.close();
    try {
      rmSync(probeSocketPath, { force: true });
    } catch {}
    resolve();
  });

  probeServer.once("error", () => {
    canCreateSockets = false;
    resolve();
  });

  probeServer.listen(probeSocketPath);
  setTimeout(() => resolve(), 100);
});

/**
 * Wrap an async test body so it no-ops when {@link canCreateSockets} is false.
 *
 * Preserves early-return skip semantics (not a hard failure). Callers own any
 * stderr skip messaging.
 */
export function skipIfNoSockets(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    if (!canCreateSockets) {
      return;
    }
    return fn();
  };
}
