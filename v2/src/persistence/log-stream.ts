import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { WriteLoopOutcomeKind } from "../execution/write-loop.ts";
import type { OutcomeKind, RunStatus } from "./state-store.ts";

type IterationStartedEvent = {
  kind: "iteration_started";
  attemptId: string;
};

type BoundaryCommittedEvent = {
  kind: "boundary_committed";
  attemptId: string;
  outcomeKind: OutcomeKind;
  runStatus: RunStatus;
};

export type LoopFinishedEvent = {
  kind: "loop_finished";
  loopOutcomeKind: WriteLoopOutcomeKind;
  iterationsConsumed: number;
  resumable: boolean;
};

export type RunExecutionFailedEvent = {
  kind: "run_execution_failed";
};

export type LogEvent = IterationStartedEvent | BoundaryCommittedEvent | LoopFinishedEvent | RunExecutionFailedEvent;

export type PersistedRecord = {
  runId: string;
  seq: number;
  ts: string;
  event: LogEvent;
};

export interface LogSink {
  /** Per-run sequence number and timestamp are assigned. */
  append(runId: string, event: LogEvent): void;

  /** Idempotent. */
  close(): void;
}

export interface LogReader {
  tail(runId: string): PersistedRecord[];

  /**
   * Yields existing events from seq 1, then blocks for new appends.
   * Honour AbortSignal for clean shutdown.
   */
  follow(runId: string, signal?: AbortSignal): AsyncIterableIterator<PersistedRecord>;
}

/** Interval `follow()` polls `tail()` for new records. */
export const FOLLOW_POLL_MS = 250;

class FileLogStream implements LogSink, LogReader {
  private storagePath: string;
  private sequences: Map<string, number> = new Map();
  private closed = false;
  private readonly pollMs: number;

  constructor(storagePath: string, pollMs?: number) {
    this.storagePath = storagePath;
    this.pollMs = pollMs ?? FOLLOW_POLL_MS;
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

    while (!signal?.aborted) {
      const all = this.tail(runId);
      for (const record of all) {
        if (record.seq > lastSeq) {
          if (signal?.aborted) return;
          lastSeq = record.seq;
          yield record;
        }
      }
      await sleep(this.pollMs, signal);
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

/** Open a log reader for querying events. Optionally override `follow`'s poll interval for testing. */
export function openLogReader(storagePath: string, pollMs?: number): LogReader {
  return new FileLogStream(storagePath, pollMs);
}

/** Resolve after `ms`, or immediately if `signal` is already aborted. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}
