import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { PublicationFailure } from "../execution/publication-retry.ts";
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

type ReadyGateRepairEvent = {
  kind: "ready_gate_repair";
  attempt: number;
  gateExitCode: number | undefined;
};

export type LoopFinishedEvent = {
  kind: "loop_finished";
  loopOutcomeKind: WriteLoopOutcomeKind;
  iterationsConsumed: number;
  resumable: boolean;
  publicationFailure?: PublicationFailure;
  prNumber?: number;
  prUrl?: string;
  survivingMutation?: string;
  survivingMutationSourceFile?: string;
  survivingMutationSourceLine?: number;
};

export type RuntimeSmokeOutcomeEvent =
  | {
      kind: "runtime_smoke_outcome";
      outcome: "observed-clean";
    }
  | {
      kind: "runtime_smoke_outcome";
      outcome: "not-runnable";
      inspectedPaths: string[];
      discoveryReason: string;
    };

export type RunExecutionFailedEvent = {
  kind: "run_execution_failed";
  message?: string;
};

export type RunReconciledEvent = {
  kind: "run_reconciled";
  runStatus: "killed" | "interrupted";
  reason: "daemon_restart";
};

export type RunRecoveryEvent = {
  kind: "run_recovery";
  outcome: "resumed" | "failed";
  message?: string;
};

/** Agent stdout excerpt when token parsing fails; truncated at append time. */
export type InvalidTokenDetailEvent = {
  kind: "invalid_token_detail";
  attemptId: string;
  tokenText: string;
};

/** Emitted when a token-less step response triggers the runner's one token-only re-prompt. */
export type TokenRepromptEvent = {
  kind: "token_reprompt";
  attemptId: string;
  responseText: string;
};

/** Emitted when a `blocked` token misses the blocker-text contract and triggers `write.blocker-reprompt`. */
export type BlockerRepromptEvent = {
  kind: "blocker_reprompt";
  attemptId: string;
  responseText: string;
};

/** Emitted when implement completion delivers an uncovered-changed-line advisory re-prompt. */
export type CoverageAdvisoryRepromptEvent = {
  kind: "coverage_advisory_reprompt";
  attemptId: string;
  responseText: string;
};

/** Agent stdout excerpt when a rejected `blocked` token still has no blocker text; truncated at append time. */
export type MissingBlockerDetailEvent = {
  kind: "missing_blocker_detail";
  attemptId: string;
  responseText: string;
};

/** Agent's `## Blocker` body text persisted when a `blocked` outcome satisfies the blocker-text contract; truncated at append time. */
export type BlockerTextDetailEvent = {
  kind: "blocker_text_detail";
  attemptId: string;
  blockerText: string;
};

export type LogEvent =
  | IterationStartedEvent
  | BoundaryCommittedEvent
  | ReadyGateRepairEvent
  | LoopFinishedEvent
  | RuntimeSmokeOutcomeEvent
  | RunExecutionFailedEvent
  | RunReconciledEvent
  | RunRecoveryEvent
  | InvalidTokenDetailEvent
  | TokenRepromptEvent
  | BlockerRepromptEvent
  | CoverageAdvisoryRepromptEvent
  | MissingBlockerDetailEvent
  | BlockerTextDetailEvent;

/** Max chars persisted for operator-facing response excerpts in run logs. */
export const INVALID_TOKEN_LOG_MAX_CHARS = 500;

export function truncateLogText(text: string, maxChars = INVALID_TOKEN_LOG_MAX_CHARS): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
}

export type PersistedRecord = {
  runId: string;
  seq: number;
  ts: string;
  event: LogEvent;
};

export interface LogSink {
  /**
   * Assigns per-run `seq` (unique and monotonic across concurrent writers on the same log)
   * and timestamp; allocation reads the durable log at append time.
   */
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
  private closed = false;
  private readonly pollMs: number;

  constructor(storagePath: string, pollMs?: number) {
    this.storagePath = storagePath;
    this.pollMs = pollMs ?? FOLLOW_POLL_MS;
  }

  /** Reads all durable-log records; unparseable lines (e.g. a truncated trailing write) are skipped. */
  private readAllRecords(): PersistedRecord[] {
    if (!existsSync(this.storagePath)) {
      return [];
    }

    const content = readFileSync(this.storagePath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim());
    const records: PersistedRecord[] = [];
    for (const line of lines) {
      try {
        records.push(JSON.parse(line));
      } catch {
        // Truncated or partial trailing lines are transient; skip.
      }
    }

    return records;
  }

  private nextSeqForRun(runId: string): number {
    let maxSeq = 0;
    for (const record of this.readAllRecords()) {
      if (record.runId === runId && record.seq > maxSeq) {
        maxSeq = record.seq;
      }
    }

    return maxSeq + 1;
  }

  append(runId: string, event: LogEvent): void {
    if (this.closed) {
      throw new Error("Cannot append to closed log sink");
    }

    const seq = this.nextSeqForRun(runId);
    const ts = new Date().toISOString();
    const record: PersistedRecord = { runId, seq, ts, event };

    mkdirSync(dirname(this.storagePath), { recursive: true });
    appendFileSync(this.storagePath, `${JSON.stringify(record)}\n`, "utf-8");
  }

  tail(runId: string): PersistedRecord[] {
    const records = this.readAllRecords().filter((record) => record.runId === runId);
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
