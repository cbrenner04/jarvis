// Real launcher coverage for the test-only detached-daemon ownership contract.
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDaemonLifecycle } from "../testing/test-daemon-lifecycle.ts";
import { canUseUnixSockets } from "../testing/unix-socket.ts";
import { isProcessAlive } from "./daemon-lifecycle.ts";

const socketTest = test.skipIf(!canUseUnixSockets());
const testDaemons = createTestDaemonLifecycle();
const entrypoint = join(import.meta.dir, "..", "daemon-entrypoint.ts");

// Guaranteed teardown for EVERY process this file spawns -- daemon pids (owned
// and production) plus every launcher/child subprocess. Captured at spawn time
// so an abrupt per-test timeout (which still runs afterEach) or a skipped
// in-body finally cannot leak a reparented daemon.
const spawnedPids = new Set<number>();
function track(pid: number): number {
  if (Number.isInteger(pid) && pid > 0) spawnedPids.add(pid);
  return pid;
}
afterEach(() => {
  for (const pid of spawnedPids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone (ESRCH) or unkillable -- best-effort reap.
    }
  }
  spawnedPids.clear();
});

function paths(name: string) {
  const base = `${name}-${process.pid}-${Date.now()}-${Math.random()}`;
  return { socketPath: join(tmpdir(), `${base}.sock`), pidPath: join(tmpdir(), `${base}.pid`) };
}

async function waitFor(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  expect(check()).toBe(true);
}

async function launchDaemonLauncher(
  owner: boolean,
  socketPath: string,
): Promise<{ launcher: ReturnType<typeof Bun.spawn>; pid: number }> {
  const script = `import { startDaemon } from ${JSON.stringify(join(import.meta.dir, "daemon-lifecycle.ts"))}; const daemon = await startDaemon(process.env.SOCKET_PATH, { daemonScript: process.env.DAEMON_SCRIPT, ${owner ? "testOwnerPid: process.pid" : ""} }); console.log(daemon.pid); setInterval(() => {}, 1000);`;
  const launcher = Bun.spawn([process.execPath, "-e", script], {
    env: { ...process.env, SOCKET_PATH: socketPath, DAEMON_SCRIPT: entrypoint },
    stdout: "pipe",
    stderr: "pipe",
  });
  track(launcher.pid);
  const reader = launcher.stdout.getReader();
  const first = await reader.read();
  reader.releaseLock();
  const pid = Number(new TextDecoder().decode(first.value).trim().split("\n")[0]);
  expect(pid).toBeGreaterThan(0);
  track(pid);
  return { launcher, pid };
}

async function runFixtureTest(fails: boolean): Promise<number> {
  const { socketPath, pidPath } = paths(fails ? "failed-test" : "completed-test");
  const scratch = join(process.cwd(), ".scratch");
  const scriptPath = join(scratch, `daemon-lifecycle-${Date.now()}-${Math.random()}.test.ts`);
  mkdirSync(scratch, { recursive: true });
  writeFileSync(
    scriptPath,
    `import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { createTestDaemonLifecycle } from ${JSON.stringify(join(import.meta.dir, "..", "testing", "test-daemon-lifecycle.ts"))};
const lifecycle = createTestDaemonLifecycle();
test("${fails ? "fails" : "completes"}", async () => {
  await lifecycle.start(${JSON.stringify(socketPath)}, { daemonScript: ${JSON.stringify(entrypoint)}, onSpawn: (pid) => writeFileSync(${JSON.stringify(pidPath)}, String(pid)) });
  expect(true).toBe(${!fails});
});`,
  );
  // Capture the grandchild daemon pid as soon as the nested run writes it, so
  // teardown reaps it even if this parent test times out mid-flight.
  let capturing = true;
  const captured = (async () => {
    while (capturing) {
      try {
        const pid = Number(readFileSync(pidPath, "utf-8"));
        if (pid > 0) {
          track(pid);
          return;
        }
      } catch {
        // Not written yet.
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  })();
  try {
    const child = Bun.spawn([process.execPath, "test", scriptPath], { stdout: "ignore", stderr: "ignore" });
    track(child.pid);
    await child.exited;
    const pid = track(Number(readFileSync(pidPath, "utf-8")));
    await waitFor(() => !isProcessAlive(pid));
    return child.exitCode ?? -1;
  } finally {
    capturing = false;
    await captured;
    rmSync(scriptPath, { force: true });
    rmSync(socketPath, { force: true });
    rmSync(pidPath, { force: true });
  }
}

socketTest("fixture registers before failed readiness and force-reaps its daemon", async () => {
  const { socketPath, pidPath } = paths("fixture");
  let pid = 0;
  try {
    await expect(
      testDaemons.start(socketPath, {
        daemonScript: entrypoint,
        pidPath,
        readinessTimeoutMs: 1,
        onSpawn: (spawnedPid) => {
          pid = spawnedPid;
        },
      }),
    ).rejects.toThrow();
    expect(pid).toBeGreaterThan(0);
    testDaemons.reap();
    await waitFor(() => !isProcessAlive(pid));
  } finally {
    rmSync(socketPath, { force: true });
    rmSync(pidPath, { force: true });
  }
});

socketTest("fixture reaps daemons after completed and assertion-failed test launchers", async () => {
  expect(await runFixtureTest(false)).toBe(0);
  expect(await runFixtureTest(true)).not.toBe(0);
});

socketTest("daemon exit clears only its own existing PID lease", async () => {
  const owned = paths("owned-pid-lease");
  const replaced = paths("replaced-pid-lease");
  try {
    const ownedDaemon = await testDaemons.start(owned.socketPath, { daemonScript: entrypoint, pidPath: owned.pidPath });
    expect(readFileSync(owned.pidPath, "utf-8")).toBe(String(ownedDaemon.pid));
    process.kill(ownedDaemon.pid, "SIGTERM");
    await waitFor(() => !isProcessAlive(ownedDaemon.pid));
    expect(existsSync(owned.pidPath)).toBe(false);

    const replacedDaemon = await testDaemons.start(replaced.socketPath, {
      daemonScript: entrypoint,
      pidPath: replaced.pidPath,
    });
    writeFileSync(replaced.pidPath, "unrelated-daemon");
    process.kill(replacedDaemon.pid, "SIGTERM");
    await waitFor(() => !isProcessAlive(replacedDaemon.pid));
    expect(readFileSync(replaced.pidPath, "utf-8")).toBe("unrelated-daemon");
  } finally {
    rmSync(owned.socketPath, { force: true });
    rmSync(owned.pidPath, { force: true });
    rmSync(replaced.socketPath, { force: true });
    rmSync(replaced.pidPath, { force: true });
  }
});

socketTest("owner death reaps opted-in daemon while production daemon stays detached", async () => {
  const owned = paths("owned");
  const production = paths("production");
  let ownedLauncher: ReturnType<typeof Bun.spawn> | undefined;
  let productionLauncher: ReturnType<typeof Bun.spawn> | undefined;
  let productionPid = 0;
  try {
    const startedOwned = await launchDaemonLauncher(true, owned.socketPath);
    ownedLauncher = startedOwned.launcher;
    ownedLauncher.kill("SIGKILL");
    await ownedLauncher.exited;
    await waitFor(() => !isProcessAlive(startedOwned.pid));

    const startedProduction = await launchDaemonLauncher(false, production.socketPath);
    productionLauncher = startedProduction.launcher;
    productionPid = startedProduction.pid;
    productionLauncher.kill("SIGKILL");
    await productionLauncher.exited;
    await waitFor(() => isProcessAlive(productionPid));
  } finally {
    ownedLauncher?.kill("SIGKILL");
    productionLauncher?.kill("SIGKILL");
    if (productionPid && isProcessAlive(productionPid)) process.kill(productionPid, "SIGKILL");
    rmSync(owned.socketPath, { force: true });
    rmSync(production.socketPath, { force: true });
  }
});
