import { rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Settled Unix-socket availability after the module-load probe completes.
 *
 * Use for hook guards; consumers must not run their own socket probe. May flip
 * from false to true if `listening` arrives after the 100ms settle timeout —
 * post-probe mutation is probe-internal only.
 */
export let canCreateSockets = false;

/**
 * Whether the module-load probe's listen attempt emitted `error`.
 *
 * Distinct from {@link canCreateSockets} staying false after timeout without
 * error. Callers that emit operator stderr on sandbox block gate on this only.
 */
export let socketProbeErrored = false;

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
    socketProbeErrored = true;
    resolve();
  });

  probeServer.listen(probeSocketPath);
  setTimeout(() => resolve(), 100);
});

/**
 * Wrap a test body so it runs only when {@link canCreateSockets} is true at
 * invocation time (not when the wrapper is created).
 *
 * @param fn - Async test body to run when sockets are available.
 * @returns Async function for Bun `test()` that no-ops when sockets are unavailable.
 */
export function skipIfNoSockets(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    if (!canCreateSockets) {
      return;
    }
    return fn();
  };
}
