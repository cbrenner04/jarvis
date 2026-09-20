import type { ChildProcess } from "node:child_process";

const STDERR_TAIL_LENGTH = 16_384;

/**
 * Resolve once `marker` appears on the child's stdout. There is deliberately no private wall
 * clock: the suite runs files concurrently, so a startup deadline here would measure machine load,
 * not the behavior under test. The file's own test timeout is the only bound. Rejects on child
 * close without the marker, after stderr has drained.
 */
export function waitForStdoutMarker(child: ChildProcess, marker: string): Promise<void> {
  const stdout = child.stdout;
  if (stdout === null) return Promise.reject(new Error(`child process has no stdout to report ${marker}`));
  const stderr = child.stderr;
  return new Promise<void>((resolve, reject) => {
    let buffered = "";
    let stderrTail = "";
    const onData = (chunk: Buffer | string): void => {
      buffered += chunk.toString();
      if (buffered.includes(marker)) {
        cleanup();
        resolve();
      }
    };
    const onStderrData = (chunk: Buffer | string): void => {
      stderrTail = `${stderrTail}${chunk.toString()}`;
      if (stderrTail.length > STDERR_TAIL_LENGTH) stderrTail = stderrTail.slice(-STDERR_TAIL_LENGTH);
    };
    const onClose = (code: number | null, signal: NodeJS.Signals | null): void => {
      cleanup();
      const stderrDetails = stderrTail.length > 0 ? `\nstderr tail:\n${stderrTail}` : "";
      reject(
        new Error(
          `child closed (code ${String(code)}, signal ${String(signal)}) without reporting ${marker}${stderrDetails}`,
        ),
      );
    };
    const cleanup = (): void => {
      stdout.off("data", onData);
      stderr?.off("data", onStderrData);
      child.off("close", onClose);
    };
    stdout.on("data", onData);
    stderr?.on("data", onStderrData);
    child.on("close", onClose);
  });
}
