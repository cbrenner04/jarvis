import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";

/** stdout/stderr sink for `jarvis daemon log`. */
export type DaemonLogIo = {
  writeOut: (chunk: string) => void;
  writeErr: (chunk: string) => void;
};

/** Injectable fs seam for tests. */
export type DaemonLogFs = {
  existsSync: typeof existsSync;
  statSync: typeof statSync;
  openSync: typeof openSync;
  readSync: typeof readSync;
  closeSync: typeof closeSync;
};

const defaultFs: DaemonLogFs = { existsSync, statSync, openSync, readSync, closeSync };

/** Interval `followDaemonProcessLog` polls for appends. */
export const FOLLOW_POLL_MS = 200;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";
}

function readRange(path: string, start: number, end: number, fs: DaemonLogFs): string {
  const length = end - start;
  if (length <= 0) return "";
  const fd = fs.openSync(path, "r");
  try {
    const buf = Buffer.alloc(length);
    let readTotal = 0;
    while (readTotal < length) {
      const n = fs.readSync(fd, buf, readTotal, length - readTotal, start + readTotal);
      if (n === 0) break;
      readTotal += n;
    }
    return buf.subarray(0, readTotal).toString("utf-8");
  } finally {
    fs.closeSync(fd);
  }
}

/** Write the retained daemon process log to stdout. Returns the process exit code. */
export function readDaemonProcessLog(path: string, io: DaemonLogIo, fs: DaemonLogFs = defaultFs): number {
  if (!fs.existsSync(path)) {
    io.writeErr(`daemon process log not found: ${path}\n`);
    return 1;
  }
  try {
    const stat = fs.statSync(path);
    io.writeOut(readRange(path, 0, stat.size, fs));
    return 0;
  } catch (error) {
    io.writeErr(`daemon process log read failed: ${errorMessage(error)}\n`);
    return 1;
  }
}

/** Resolve after `ms`, or immediately if `signal` is already aborted. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    timer.unref?.();
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Replay retained content, then poll for appends until `signal` aborts.
 * Resumes from the current file on truncation/replacement (inode change or
 * shrink); reports removal on stderr and stops. SIGINT-driven abort exits `130`.
 */
export async function followDaemonProcessLog(
  path: string,
  io: DaemonLogIo,
  signal: AbortSignal,
  fs: DaemonLogFs = defaultFs,
  pollMs: number = FOLLOW_POLL_MS,
): Promise<number> {
  if (!fs.existsSync(path)) {
    io.writeErr(`daemon process log not found: ${path}\n`);
    return 1;
  }

  let offset = 0;
  let ino: number | undefined;

  const catchUp = (): "ok" | "missing" | "error" => {
    try {
      const stat = fs.statSync(path);
      if (ino === undefined) {
        ino = stat.ino;
      } else if (stat.ino !== ino) {
        ino = stat.ino;
        offset = 0;
      } else if (stat.size < offset) {
        offset = 0;
      }
      if (stat.size > offset) {
        io.writeOut(readRange(path, offset, stat.size, fs));
        offset = stat.size;
      }
      return "ok";
    } catch (error) {
      if (isEnoent(error)) return "missing";
      io.writeErr(`daemon process log error: ${errorMessage(error)}\n`);
      return "error";
    }
  };

  const initial = catchUp();
  if (initial === "missing") {
    io.writeErr(`daemon process log not found: ${path}\n`);
    return 1;
  }
  if (initial === "error") return 1;

  while (!signal.aborted) {
    await sleep(pollMs, signal);
    if (signal.aborted) break;
    const result = catchUp();
    if (result === "missing") {
      io.writeErr(`daemon process log removed: ${path}\n`);
      return 1;
    }
    if (result === "error") return 1;
  }

  return 130;
}
