import { appendFileSync, existsSync, type FSWatcher, mkdirSync, readFileSync, watch } from "node:fs";
import { basename, dirname } from "node:path";
import type { WriteLoopOutcomeKind } from "../execution/write-loop.ts";
import type { OutcomeKind, RunStatus } from "./state-store.ts";

/**
 * Event emitted when an iteration begins.
 */
type IterationStartedEvent = {
  kind: "iteration_started";
  attemptId: string;
};

/**
 * Event emitted when a transactional boundary completes.
 */
type BoundaryCommittedEvent = {
  kind: "boundary_committed";
  attemptId: string;
  outcomeKind: OutcomeKind;
  runStatus: RunStatus;
};

/**
 * Event emitted when the write loop finishes.
 */
export type LoopFinishedEvent = {
  kind: "loop_finished";
  loopOutcomeKind: WriteLoopOutcomeKind;
  iterationsConsumed: number;
  resumable: boolean;
};

/**
 * Event emitted when the daemon spawn boundary catches an unexpected executor rejection.
 */
export type RunExecutionFailedEvent = {
  kind: "run_execution_failed";
};

export type LogEvent = IterationStartedEvent | BoundaryCommittedEvent | LoopFinishedEvent | RunExecutionFailedEvent;

/**
 * Persisted record of an event with metadata.
 */
export type PersistedRecord = {
  runId: string;
  seq: number;
  ts: string;
  event: LogEvent;
};

/**
 * Log sink for appending events.
 */
export interface LogSink {
  /**
   * Append an event for a run. Per-run sequence number and timestamp are assigned.
   */
  append(runId: string, event: LogEvent): void;

  /**
   * Close the sink, flushing resources. Idempotent.
   */
  close(): void;
}

/**
 * Log reader for querying persisted events.
 */
export interface LogReader {
  /**
   * Get a snapshot of all persisted events for a run.
   */
  tail(runId: string): PersistedRecord[];

  /**
   * Subscribe to events for a run. Yields existing events from seq 1, then blocks for new appends.
   * Honour AbortSignal for clean shutdown.
   */
  follow(runId: string, signal?: AbortSignal): AsyncIterableIterator<PersistedRecord>;
}

/**
 * Wake primitive that resolves when the shared storage artifact may have been appended to.
 * Used by `follow` to block for new records without fixed-interval polling.
 * `wait` must establish OS-level watching synchronously before blocking so appends
 * during the caller's scan are not missed.
 */
export interface AppendWake {
  /** Resolve on the next storage-artifact change or when signal aborts. */
  wait(signal?: AbortSignal): Promise<void>;
  /** Release OS resources. Idempotent. */
  close(): void;
}

/**
 * Factory creating an `AppendWake` for a storage path. Injected by tests;
 * production defaults to `fs.watch`-backed notification.
 */
type AppendWakeFactory = (storagePath: string) => AppendWake;

class FileLogStream implements LogSink, LogReader {
  private storagePath: string;
  private sequences: Map<string, number> = new Map();
  private closed = false;
  private readonly wakeFactory: AppendWakeFactory;

  constructor(storagePath: string, wakeFactory?: AppendWakeFactory) {
    this.storagePath = storagePath;
    this.wakeFactory = wakeFactory ?? defaultAppendWakeFactory;
    this.loadSequences();
  }

  private loadSequences(): void {
    if (!existsSync(this.storagePath)) {
      return;
    }

    const content = readFileSync(this.storagePath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim());
    for (const line of lines) {
      const record: PersistedRecord = JSON.parse(line);
      const current = this.sequences.get(record.runId) ?? 0;
      if (record.seq > current) {
        this.sequences.set(record.runId, record.seq);
      }
    }
  }

  append(runId: string, event: LogEvent): void {
    if (this.closed) {
      throw new Error("Cannot append to closed log sink");
    }

    const seq = (this.sequences.get(runId) ?? 0) + 1;
    const ts = new Date().toISOString();
    const record: PersistedRecord = { runId, seq, ts, event };

    mkdirSync(dirname(this.storagePath), { recursive: true });
    appendFileSync(this.storagePath, `${JSON.stringify(record)}\n`, "utf-8");
    this.sequences.set(runId, seq);
  }

  tail(runId: string): PersistedRecord[] {
    if (!existsSync(this.storagePath)) {
      return [];
    }

    const content = readFileSync(this.storagePath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim());
    const records: PersistedRecord[] = [];

    for (const line of lines) {
      const record: PersistedRecord = JSON.parse(line);
      if (record.runId === runId) {
        records.push(record);
      }
    }

    records.sort((a, b) => a.seq - b.seq);
    return records;
  }

  async *follow(runId: string, signal?: AbortSignal): AsyncIterableIterator<PersistedRecord> {
    const existing = this.tail(runId);
    for (const record of existing) {
      if (signal?.aborted) return;
      yield record;
    }

    const lastRecord = existing[existing.length - 1];
    let lastSeq = lastRecord ? lastRecord.seq : 0;

    const wake = this.wakeFactory(this.storagePath);
    try {
      while (!signal?.aborted) {
        // Start watching before scanning so appends during the scan are caught.
        const wakePromise = wake.wait(signal);
        const all = this.tail(runId);
        for (const record of all) {
          if (record.seq > lastSeq) {
            if (signal?.aborted) return;
            lastSeq = record.seq;
            yield record;
          }
        }
        await wakePromise;
      }
    } finally {
      wake.close();
    }
  }

  close(): void {
    this.closed = true;
  }
}

/** Open a log sink for appending events. */
export function openLogSink(storagePath: string): LogSink {
  return new FileLogStream(storagePath);
}

/** Open a log reader for querying events. Optionally inject a wake factory for testing. */
export function openLogReader(storagePath: string, wakeFactory?: AppendWakeFactory): LogReader {
  return new FileLogStream(storagePath, wakeFactory);
}

/**
 * Production `AppendWake` backed by `fs.watch` on the shared storage artifact.
 * Watches the file directly when it exists (kqueue/inotify — low latency); falls
 * back to watching the parent directory to catch file creation, then switches to
 * the file. A `dirty` flag captures change events that arrive while no caller is
 * waiting, so appends between scans are not missed.
 */
class FsAppendWake implements AppendWake {
  private readonly storagePath: string;
  private readonly dir: string;
  private readonly filename: string;
  private watcher: FSWatcher | null = null;
  private dirty = false;
  private pendingResolve: (() => void) | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(storagePath: string) {
    this.storagePath = storagePath;
    this.dir = dirname(storagePath);
    this.filename = basename(storagePath);
  }

  private ensureWatcher(): void {
    if (this.watcher || this.closed) return;
    if (existsSync(this.storagePath)) {
      this.watchFile();
    } else if (existsSync(this.dir)) {
      this.watchDir();
    }
  }

  private watchFile(): void {
    if (this.watcher || this.closed) return;
    try {
      this.watcher = watch(this.storagePath, () => this.fire());
      this.watcher.on("error", () => {
        this.watcher?.close();
        this.watcher = null;
        this.watchDir();
      });
    } catch {
      this.watchDir();
    }
  }

  private watchDir(): void {
    if (this.watcher || this.closed) return;
    if (!existsSync(this.dir)) return;
    try {
      this.watcher = watch(this.dir, (_eventType, filename) => {
        if (typeof filename === "string" && filename === this.filename) {
          this.watcher?.close();
          this.watcher = null;
          this.watchFile();
          this.fire();
        }
      });
      this.watcher.on("error", () => {
        this.watcher?.close();
        this.watcher = null;
      });
    } catch {
      this.watcher = null;
    }
  }

  private fire(): void {
    if (this.pendingResolve) {
      const resolve = this.pendingResolve;
      this.pendingResolve = null;
      resolve();
    } else {
      this.dirty = true;
    }
  }

  /**
   * Block until the watcher fires (append), the abort poll elapses, or close is called.
   * Append notification is event-driven via `fs.watch`; abort is polled at a short
   * interval since `AbortSignal.addEventListener` is unreliable in some IPC contexts.
   */
  async wait(signal?: AbortSignal): Promise<void> {
    if (this.closed || signal?.aborted) return;
    this.ensureWatcher();
    if (this.dirty) {
      this.dirty = false;
      return;
    }
    if (!this.watcher) {
      this.ensureWatcher();
    }
    if (this.dirty) {
      this.dirty = false;
      return;
    }
    if (!this.watcher) {
      // Cannot watch (storage directory missing); poll for abort only.
      while (!this.closed && !signal?.aborted) {
        await new Promise((resolve) => setTimeout(resolve, ABORT_POLL_MS));
      }
      return;
    }
    // Wait for watcher event (append), abort, poll fallback, or close.
    await new Promise<void>((resolve) => {
      const finish = () => {
        if (this.pendingResolve === finish) {
          this.pendingResolve = null;
        }
        if (this.pendingTimer) {
          clearTimeout(this.pendingTimer);
          this.pendingTimer = null;
        }
        signal?.removeEventListener("abort", finish);
        resolve();
      };
      this.pendingResolve = finish;
      this.pendingTimer = setTimeout(finish, ABORT_POLL_MS);
      unrefTimer(this.pendingTimer);
      signal?.addEventListener("abort", finish, { once: true });
    });
    this.dirty = false;
  }

  close(): void {
    this.closed = true;
    this.watcher?.close();
    this.watcher = null;
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    if (this.pendingResolve) {
      const resolve = this.pendingResolve;
      this.pendingResolve = null;
      resolve();
    }
  }
}

const ABORT_POLL_MS = 500;

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer !== "object" || timer === null || !("unref" in timer)) return;
  const unref = timer.unref;
  if (typeof unref === "function") {
    unref.call(timer);
  }
}

const defaultAppendWakeFactory: AppendWakeFactory = (storagePath: string) => new FsAppendWake(storagePath);
