import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";

export function orchestrationStorePaths(dbPath: string): readonly string[] {
  return [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
}

function isMemoryStorePath(storePath: string): boolean {
  return storePath === ":memory:" || storePath.startsWith(":memory:");
}

export function copyOrchestrationStore(fromDbPath: string, toDbPath: string): void {
  if (isMemoryStorePath(fromDbPath) || isMemoryStorePath(toDbPath)) return;
  mkdirSync(dirname(toDbPath), { recursive: true });
  for (const path of orchestrationStorePaths(fromDbPath)) {
    if (existsSync(path)) copyFileSync(path, `${toDbPath}${path.slice(fromDbPath.length)}`);
  }
}

export function removeOrchestrationStore(dbPath: string): void {
  if (isMemoryStorePath(dbPath)) return;
  for (const path of orchestrationStorePaths(dbPath)) {
    rmSync(path, { force: true });
  }
}
