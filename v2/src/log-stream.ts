import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { OutcomeKind, RunStatus } from "./state-store-types.ts";
import type { WriteLoopOutcomeKind } from "./write-loop.ts";

/**
 * Structured log event kinds.
 */
export type EventKind = "iteration_started" | "boundary_committed" | "loop_finished";

/**
 * Event emitted when an iteration begins.
 */
export type IterationStartedEvent = {
  kind: "iteration_started";
  attemptId: string;
};

/**
 * Event emitted when a transactional boundary completes.
 */
export type BoundaryCommittedEvent = {
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
 * Union of all event types.
 */
export type LogEvent = IterationStartedEvent | BoundaryCommittedEvent | LoopFinishedEvent;

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
 * File-based log stream implementation.
 */
class FileLogStream implements LogSink, LogReader {
  private storagePath: string;
  private sequences: Map<string, number> = new Map();
  private closed = false;

  constructor(storagePath: string) {
    this.storagePath = storagePath;
    this.loadSequences();
  }

  private loadSequences(): void {
    const dir = dirname(this.storagePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      return;
    }

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

    const dir = dirname(this.storagePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

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

    // Sort by seq to ensure order
    records.sort((a, b) => a.seq - b.seq);
    return records;
  }

  async *follow(runId: string, signal?: AbortSignal): AsyncIterableIterator<PersistedRecord> {
    // Yield all existing records
    const existing = this.tail(runId);
    for (const record of existing) {
      if (signal?.aborted) {
        return;
      }
      yield record;
    }

    // Track last seq for this run
    const lastRecord = existing[existing.length - 1];
    let lastSeq = lastRecord ? lastRecord.seq : 0;

    // Poll for new records
    while (!signal?.aborted) {
      const all = this.tail(runId);
      for (const record of all) {
        if (record.seq > lastSeq) {
          if (signal?.aborted) {
            return;
          }
          lastSeq = record.seq;
          yield record;
        }
      }

      // Small delay before polling again
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  close(): void {
    this.closed = true;
  }
}

/**
 * Open a log sink for appending events.
 * @param storagePath Path where log events are persisted.
 */
export function openLogSink(storagePath: string): LogSink {
  return new FileLogStream(storagePath);
}

/**
 * Open a log reader for querying events.
 * @param storagePath Path where log events are persisted.
 */
export function openLogReader(storagePath: string): LogReader {
  return new FileLogStream(storagePath);
}
