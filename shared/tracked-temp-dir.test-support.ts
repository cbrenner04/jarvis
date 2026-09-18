import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";

/**
 * Test temp dirs: drop-in `mkdtemp`/`mkdtempSync` replacements that register the created dir for
 * recursive removal: by the test preload's `afterAll` under `bun test` (which never emits process
 * "exit"), else on process exit. Test code must allocate temp dirs through these
 * (enforced by `scripts/guard-test-temp-dir-cleanup.ts`); leaked dirs once grew the operator tmpdir
 * past a million entries and slowed every bun startup there.
 */
const trackedDirs = new Set<string>();
let exitHookInstalled = false;

export function removeTrackedTempDirs(): void {
  for (const dir of trackedDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  trackedDirs.clear();
}

function track(dir: string): string {
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    process.on("exit", removeTrackedTempDirs);
    // A signal listener replaces the default kill, so when ours is the only one, clean up and exit. When a
    // test installs its own (in-process daemon signal tests), stay out of its way. SIGKILL (the test
    // runners' timeout kill) is uncatchable: that file's dirs leak.
    for (const [signal, code] of [
      ["SIGTERM", 143],
      ["SIGINT", 130],
    ] as const) {
      process.on(signal, () => {
        if (process.listenerCount(signal) > 1) return;
        removeTrackedTempDirs();
        process.exit(code);
      });
    }
  }
  trackedDirs.add(dir);
  return dir;
}

export function trackedMkdtempSync(prefix: string): string {
  return track(mkdtempSync(prefix));
}

export async function trackedMkdtemp(prefix: string): Promise<string> {
  return track(await mkdtemp(prefix));
}
