import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { applyLogMigrations } from "./log-repository-migrations.ts";

/** Severity for a structured log record. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** One append-only structured log record for a run. */
export type LogRecord = {
  id: string;
  runId: string;
  seq: number;
  ts: number;
  level: LogLevel;
  event: string;
  data: unknown;
};

/** Arguments for appending a structured record. */
export type AppendLogArgs = {
  runId: string;
  level: LogLevel;
  event: string;
  data?: unknown;
};

/** Live tail subscription; `close` drops the subscriber without affecting others. */
export type LogFollowHandle = {
  close(): void;
};

/** Append, replay, and live-follow API for per-run structured logs. */
export interface LogRepository {
  /** Append one record; assigns the next per-run sequence number. */
  append(args: AppendLogArgs): LogRecord;

  /**
   * Return records for `runId` with `seq` strictly greater than `fromSeq`
   * (or all records when `fromSeq` is omitted), ordered by sequence.
   */
  listRecords(runId: string, fromSeq?: number): LogRecord[];

  /**
   * Follow live appends for `runId` after optional replay cursor `fromSeq`.
   * Returns a handle whose `close` removes this subscriber.
   */
  follow(
    runId: string,
    onRecord: (record: LogRecord) => void,
    options?: { fromSeq?: number; maxBuffered?: number; onDropped?: () => void },
  ): LogFollowHandle;

  close(): void;
}

const RECORD_COLUMNS = `id, run_id AS runId, seq, ts, level, event, data_json AS dataJson`;

/** Run ID used for daemon lifecycle records (not orchestration runs). */
export const DAEMON_LOG_RUN_ID = "_daemon";

/** Default per-subscriber buffer before slow consumers are dropped. */
export const DEFAULT_LOG_FOLLOW_BUFFER = 64;

type Follower = {
  runId: string;
  minSeq: number;
  onRecord: (record: LogRecord) => void;
  maxBuffered: number;
  pending: LogRecord[];
  onDropped?: () => void;
  closed: boolean;
  pumping: boolean;
};

class LogRepositoryImpl implements LogRepository {
  private db: Database;
  private followers = new Set<Follower>();

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    applyLogMigrations(this.db);
  }

  append(args: AppendLogArgs): LogRecord {
    const record = this.db.transaction(() => {
      const row = this.db
        .prepare("SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM log_records WHERE run_id = ?")
        .get(args.runId) as { maxSeq: number };
      const seq = row.maxSeq + 1;
      const id = crypto.randomUUID();
      const ts = Date.now();
      const dataJson = args.data === undefined ? null : JSON.stringify(args.data);
      this.db
        .prepare("INSERT INTO log_records (id, run_id, seq, ts, level, event, data_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(id, args.runId, seq, ts, args.level, args.event, dataJson);
      return rowToRecord({
        id,
        runId: args.runId,
        seq,
        ts,
        level: args.level,
        event: args.event,
        dataJson,
      });
    })();

    this.notifyFollowers(record);
    return record;
  }

  listRecords(runId: string, fromSeq?: number): LogRecord[] {
    const minExclusive = fromSeq ?? 0;
    const rows = this.db
      .prepare(`SELECT ${RECORD_COLUMNS} FROM log_records WHERE run_id = ? AND seq > ? ORDER BY seq ASC`)
      .all(runId, minExclusive) as Row[];
    return rows.map(rowToRecord);
  }

  follow(
    runId: string,
    onRecord: (record: LogRecord) => void,
    options?: { fromSeq?: number; maxBuffered?: number; onDropped?: () => void },
  ): LogFollowHandle {
    const follower: Follower = {
      runId,
      minSeq: options?.fromSeq ?? 0,
      onRecord,
      maxBuffered: options?.maxBuffered ?? DEFAULT_LOG_FOLLOW_BUFFER,
      pending: [],
      closed: false,
      pumping: false,
      ...(options?.onDropped ? { onDropped: options.onDropped } : {}),
    };
    this.followers.add(follower);

    return {
      close: () => {
        this.dropFollower(follower);
      },
    };
  }

  close(): void {
    for (const follower of [...this.followers]) {
      this.dropFollower(follower);
    }
    this.db.close();
  }

  private notifyFollowers(record: LogRecord): void {
    for (const follower of [...this.followers]) {
      if (follower.closed || follower.runId !== record.runId || record.seq <= follower.minSeq) {
        continue;
      }
      this.enqueueFollower(follower, record);
    }
  }

  private enqueueFollower(follower: Follower, record: LogRecord): void {
    if (follower.closed) return;
    follower.pending.push(record);
    if (follower.pending.length > follower.maxBuffered) {
      this.dropFollower(follower, "slow_consumer");
      return;
    }
    this.pumpFollower(follower);
  }

  private pumpFollower(follower: Follower): void {
    if (follower.pumping || follower.closed) return;
    follower.pumping = true;
    try {
      while (follower.pending.length > 0 && !follower.closed) {
        const next = follower.pending.shift();
        if (!next) return;
        follower.minSeq = next.seq;
        follower.onRecord(next);
      }
    } finally {
      follower.pumping = false;
    }
  }

  private dropFollower(follower: Follower, reason?: "slow_consumer"): void {
    if (follower.closed) return;
    follower.closed = true;
    follower.pending.length = 0;
    this.followers.delete(follower);
    if (reason === "slow_consumer") {
      follower.onDropped?.();
    }
  }
}

function rowToRecord(row: Row): LogRecord {
  return {
    id: row.id,
    runId: row.runId,
    seq: row.seq,
    ts: row.ts,
    level: row.level as LogLevel,
    event: row.event,
    data: row.dataJson === null ? null : JSON.parse(row.dataJson),
  };
}

type Row = {
  id: string;
  runId: string;
  seq: number;
  ts: number;
  level: string;
  event: string;
  dataJson: string | null;
};

/** Open or create the log repository; default path `~/.jarvis/state/logs.sqlite`. */
export function openLogRepository(repositoryPath?: string): LogRepository {
  return new LogRepositoryImpl(repositoryPath ?? join(homedir(), ".jarvis", "state", "logs.sqlite"));
}

/** Default log DB path under a Jarvis data root. */
export function defaultLogRepositoryPath(jarvisRoot: string): string {
  return join(jarvisRoot, "state", "logs.sqlite");
}
