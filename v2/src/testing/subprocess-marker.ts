import type { ChildProcess } from "node:child_process";

/**
 * Resolve once `marker` appears on the child's stdout. There is deliberately no private wall
 * clock: the suite runs files concurrently, so a startup deadline here would measure machine load,
 * not the behavior under test. The file's own test timeout is the only bound. Rejects only when the
 * child exits or closes stdout without ever printing the marker.
 */
export function waitForStdoutMarker(child: ChildProcess, marker: string): Promise<void> {
  const stdout = child.stdout;
  if (stdout === null) return Promise.reject(new Error(`child process has no stdout to report ${marker}`));
  return new Promise<void>((resolve, reject) => {
    let buffered = "";
    const onData = (chunk: Buffer | string): void => {
      buffered += chunk.toString();
      if (buffered.includes(marker)) {
        cleanup();
        resolve();
      }
    };
    const onEnd = (): void => {
      cleanup();
      reject(new Error(`child closed stdout without reporting ${marker} (startup or exit, not a deadline)`));
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      cleanup();
      reject(new Error(`child exited (code ${String(code)}, signal ${String(signal)}) without reporting ${marker}`));
    };
    const cleanup = (): void => {
      stdout.off("data", onData);
      stdout.off("end", onEnd);
      child.off("exit", onExit);
    };
    stdout.on("data", onData);
    stdout.on("end", onEnd);
    child.on("exit", onExit);
  });
}
