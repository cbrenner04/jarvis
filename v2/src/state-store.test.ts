import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { bootstrapStateStore } from "./state-store.ts";

describe("bootstrapStateStore", () => {
  test("uses explicit dbPath and applies migrations idempotently", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "jarvis-v2-state-store-"));
    const dbPath = join(tempDir, "state.sqlite");

    const first = bootstrapStateStore({ dbPath });
    first.close();

    const dbAfterFirst = new Database(dbPath, { readonly: true, strict: true });
    const firstRows = dbAfterFirst
      .query<{ version: number; applied_at: string }, []>(
        "SELECT version, applied_at FROM state_store_migrations ORDER BY version ASC",
      )
      .all();
    dbAfterFirst.close(false);

    const second = bootstrapStateStore({ dbPath });
    second.close();

    const dbAfterSecond = new Database(dbPath, { readonly: true, strict: true });
    const secondRows = dbAfterSecond
      .query<{ version: number; applied_at: string }, []>(
        "SELECT version, applied_at FROM state_store_migrations ORDER BY version ASC",
      )
      .all();
    dbAfterSecond.close(false);

    expect(firstRows.length).toBeGreaterThan(0);
    expect(secondRows).toEqual(firstRows);

    rmSync(tempDir, { recursive: true, force: true });
  });
});
