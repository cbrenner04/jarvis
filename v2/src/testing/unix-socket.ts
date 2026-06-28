import { rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

let socketsAvailable = false;

/**
 * Whether the module-load probe's listen attempt emitted `error`.
 *
 * Distinct from {@link canUseUnixSockets} returning false after timeout without
 * error. Callers that emit operator stderr on sandbox block gate on this only.
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
 * Read settled Unix-socket availability at call time.
 *
 * @returns Whether Unix sockets under `tmpdir()` are available per the module-load probe.
 *
 * `test.skipIf(!canUseUnixSockets())` captures this value when the test is
 * registered; post-settle false→true does not un-skip already-registered tests.
 * Hook guards (`beforeEach`/`afterEach`) re-read at hook time and may observe a
 * later flip. Consumers must not run their own socket probe.
 */
export function canUseUnixSockets(): boolean {
  return socketsAvailable;
}
