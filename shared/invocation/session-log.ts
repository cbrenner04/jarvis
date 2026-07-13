import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type SessionLogTag = "harness" | "outbound" | "inbound_stdout" | "inbound_stderr";

export type SessionLog = {
  append(tag: SessionLogTag, text: string): void;
  close(): void;
};

export type SessionLogOptions = {
  sessionsDir?: string;
  clock?: () => Date;
};

function defaultSessionsDir(): string {
  return join(homedir(), ".jarvis", "sessions");
}

function splitLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

/**
 * Opens a file-backed, unbuffered session log. Directory/open/append failures
 * degrade the writer to a no-op sink rather than throwing, so an unwritable
 * sessions dir never blocks the invocation it's observing.
 */
export function openSessionLog(namespace: string, timestamp: string, opts?: SessionLogOptions): SessionLog {
  const sessionsDir = opts?.sessionsDir ?? defaultSessionsDir();
  const clock = opts?.clock ?? (() => new Date());

  let fd: number | null = null;
  try {
    mkdirSync(sessionsDir, { recursive: true });
    fd = openSync(join(sessionsDir, `${namespace}-${timestamp}.log`), "a");
  } catch {
    fd = null;
  }

  let closed = false;

  return {
    append(tag, text) {
      if (closed || fd === null) {
        return;
      }
      for (const line of splitLines(text)) {
        try {
          writeSync(fd, `${clock().toISOString()} [${tag}] ${line}\n`, undefined, "utf8");
        } catch {
          // Degrade to no-op; observability must not fail the invocation.
        }
      }
    },
    close() {
      if (closed) {
        return;
      }
      closed = true;
      if (fd !== null) {
        try {
          closeSync(fd);
        } catch {
          // fd already invalid; nothing to clean up.
        }
      }
    },
  };
}
