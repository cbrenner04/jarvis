import { rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

let socketsAvailable = false;

/**
 * Whether the module-load probe's listen attempt emitted `error`.
 *
 * Distinct from {@link canUseUnixSockets} returning false after timeout
 * without error. Callers that emit operator stderr on sandbox block gate on
 * this only.
 */
export let socketProbeErrored = false;

const probeSocketPath = join(tmpdir(), `.jarvis-socket-probe-${process.pid}-${Date.now()}`);
const probeServer = createServer();

await new Promise<void>((resolve) => {
  probeServer.once("listening", () => {
    socketsAvailable = true;
    probeServer.close();
    try {
      rmSync(probeSocketPath, { force: true });
    } catch {}
    resolve();
  });

  probeServer.once("error", () => {
    socketProbeErrored = true;
    resolve();
  });

  probeServer.listen(probeSocketPath);
  setTimeout(() => resolve(), 100);
});

/**
 * Settled Unix-socket availability under `tmpdir()`; read at call time.
 *
 * @returns Whether the one-time module probe observed a successful listen.
 *
 * A late `listening` after settle can flip availability false→true. Timeout
 * without `error` leaves {@link socketProbeErrored} false.
 *
 * `test.skipIf(!canUseUnixSockets())` captures at registration; post-settle
 * false→true does not un-skip registered tests. Hook guards re-read at hook time
 * and may observe a later flip. Consumers must not run their own socket probe.
 */
export function canUseUnixSockets(): boolean {
  return socketsAvailable;
}
