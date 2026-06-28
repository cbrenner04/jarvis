import { rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Settled at module load; false when `tmpdir()` socket bind is blocked (e.g. sandbox). */
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

  probeServer.once("error", () => resolve());

  probeServer.listen(probeSocketPath);
  setTimeout(() => resolve(), 100);
});

/** Early-return skip when {@link canCreateSockets} is false; callers own stderr messaging. */
export function skipIfNoSockets(fn: () => Promise<void>): () => Promise<void> {
  return canCreateSockets ? fn : async () => {};
}
