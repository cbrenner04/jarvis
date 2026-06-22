// Requires real OS process spawning to verify child PWD normalization, OLDPWD stripping, and process group reaping behavior.
// These assertions are about the actual subprocess lifecycle and cannot be reproduced with an injected spawn mock.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgent } from "../../src/agents/spawn.ts";

let dir: string;
let cwd: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jarvis-spawn-"));
  cwd = mkdtempSync(join(tmpdir(), "jarvis-spawn-cwd-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

function fakeBinary(opts: { exit: number; stdout?: string; stderr?: string }): string {
  const path = join(dir, "agent");
  const out = opts.stdout ?? "";
  const err = opts.stderr ?? "";
  const script = `#!/usr/bin/env bash
# Record PWD so the test can inspect it.
printf '%s' "$PWD" > "${dir}/pwd"
printf '%s' ${JSON.stringify(out)}
printf '%s' ${JSON.stringify(err)} 1>&2
exit ${opts.exit}
`;
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return path;
}

describe("runAgent PWD normalization", () => {
  test("spawned child's PWD equals configured cwd, not parent's PWD", async () => {
    const bin = fakeBinary({ exit: 0 });

    const result = await runAgent(
      {
        name: "claude",
        binary: bin,
        cwd: realpathSync(cwd),
        buildArgv: () => [],
        stdio: ["ignore", "pipe", "pipe"],
        streamErrorPrefix: "test:",
      },
      "test",
      { cwd },
    );

    expect(result.kind).toBe("ok");
    const childPwd = readFileSync(join(dir, "pwd"), "utf8");
    expect(childPwd).toBe(realpathSync(cwd));
  });

  test("spawned child does not receive OLDPWD", async () => {
    const bin = join(dir, "agent");
    const script = `#!/usr/bin/env bash
# Check if OLDPWD is set
if [ -z "$OLDPWD" ]; then
  echo "ok"
  exit 0
else
  echo "OLDPWD is set: $OLDPWD"
  exit 1
fi
`;
    writeFileSync(bin, script);
    chmodSync(bin, 0o755);

    const result = await runAgent(
      {
        name: "claude",
        binary: bin,
        cwd: realpathSync(cwd),
        buildArgv: () => [],
        stdio: ["ignore", "pipe", "pipe"],
        streamErrorPrefix: "test:",
      },
      "test",
      { cwd },
    );

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.stdout.trim()).toBe("ok");
    }
  });
});

describe("runAgent process group reaping", () => {
  test(
    "normal close with in-group descendant reaped",
    async () => {
      const bin = join(dir, "agent");
      const pidFile = join(dir, "descendant.pid");
      const script = `#!/usr/bin/env bash
# Spawn a background sleep in the same process group
sleep 120 &
# Record the PID before exiting
echo $! > "${pidFile}"
exit 0
`;
      writeFileSync(bin, script);
      chmodSync(bin, 0o755);

      const result = await runAgent(
        {
          name: "claude",
          binary: bin,
          cwd: realpathSync(cwd),
          buildArgv: () => [],
          stdio: ["ignore", "pipe", "pipe"],
          streamErrorPrefix: "test:",
        },
        "test",
        { cwd },
      );

      expect(result.kind).toBe("ok");

      // Poll for descendant death with bounded retries.
      const pidStr = readFileSync(pidFile, "utf8").trim();
      const pid = parseInt(pidStr, 10);
      expect(pid).toBeGreaterThan(0);

      let descendantDead = false;
      for (let i = 0; i < 20; i++) {
        try {
          // Sending signal 0 checks if process exists without killing it.
          process.kill(pid, 0);
          // Process still exists; wait and retry.
          await new Promise((r) => setTimeout(r, 100));
        } catch (err: unknown) {
          // Process does not exist; reap succeeded.
          if (err instanceof Error && err.message.includes("ESRCH")) {
            descendantDead = true;
            break;
          }
          throw err;
        }
      }
      expect(descendantDead).toBe(true);
    },
    { timeout: 10000 },
  );

  test("kill failure during reap leaves result unchanged", async () => {
    const bin = join(dir, "agent");
    const script = `#!/usr/bin/env bash
exit 0
`;
    writeFileSync(bin, script);
    chmodSync(bin, 0o755);

    // Stub process.kill to throw on group-kill attempts; track invocations.
    const originalKill = process.kill.bind(process);
    let killAttempted = false;
    const killStub = (pid: number, signal?: string | number): true => {
      if (pid < 0 && signal === "SIGKILL") {
        killAttempted = true;
        throw new Error("kill stub failure");
      }
      return originalKill(pid, signal);
    };
    (process.kill as (pid: number, signal?: string | number) => true) = killStub;

    try {
      const result = await runAgent(
        {
          name: "claude",
          binary: bin,
          cwd: realpathSync(cwd),
          buildArgv: () => [],
          stdio: ["ignore", "pipe", "pipe"],
          streamErrorPrefix: "test:",
        },
        "test",
        { cwd },
      );

      // Verify the reap was attempted (kill stub was invoked on group SIGKILL).
      expect(killAttempted).toBe(true);
      // Verify result kind and exit code are unchanged despite kill failure.
      expect(result.kind).toBe("ok");
    } finally {
      process.kill = originalKill;
    }
  });
});

describe("runAgent transient retry", () => {
  let dir: string;
  let cwd: string;

  const setup = () => {
    dir = mkdtempSync(join(tmpdir(), "jarvis-spawn-"));
    cwd = mkdtempSync(join(tmpdir(), "jarvis-spawn-cwd-"));
  };

  const teardown = () => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  };

  test(
    "transient-then-success returns ok with no advancement",
    async () => {
      setup();
      try {
        const bin = join(dir, "agent");
        const script = `#!/usr/bin/env bash
if [ -f "${dir}/call-count" ]; then
  COUNT=$(cat "${dir}/call-count")
else
  COUNT=0
fi
COUNT=$((COUNT + 1))
echo $COUNT > "${dir}/call-count"
if [ $COUNT -eq 1 ]; then
  printf 'error: connection closed' 1>&2
  exit 1
fi
printf 'success'
exit 0
`;
        writeFileSync(bin, script);
        chmodSync(bin, 0o755);

        const result = await runAgent(
          {
            name: "claude",
            binary: bin,
            cwd: realpathSync(cwd),
            buildArgv: () => [],
            stdio: ["ignore", "pipe", "pipe"],
            streamErrorPrefix: "test:",
          },
          "test",
          {
            cwd: realpathSync(cwd),
            sleepMs: async () => {
              // no-op sleep for test
            },
          },
        );

        expect(result.kind).toBe("ok");
        if (result.kind === "ok") {
          expect(result.stdout).toBe("success");
        }
        const attempts = readFileSync(join(dir, "call-count"), "utf8").trim();
        expect(parseInt(attempts, 10)).toBe(2);
      } finally {
        teardown();
      }
    },
    { timeout: 10000 },
  );

  test(
    "persistent transient returns error at cap of 3 retries",
    async () => {
      setup();
      try {
        const bin = join(dir, "agent");
        const script = `#!/usr/bin/env bash
printf 'error: connection reset' 1>&2
exit 1
`;
        writeFileSync(bin, script);
        chmodSync(bin, 0o755);

        let spawnCount = 0;
        const recordedSleeps: number[] = [];
        const result = await runAgent(
          {
            name: "claude",
            binary: bin,
            cwd: realpathSync(cwd),
            buildArgv: () => {
              spawnCount++;
              return [];
            },
            stdio: ["ignore", "pipe", "pipe"],
            streamErrorPrefix: "test:",
          },
          "test",
          {
            cwd: realpathSync(cwd),
            sleepMs: async (delayMs) => {
              recordedSleeps.push(delayMs);
            },
          },
        );

        expect(result.kind).toBe("error");
        expect(spawnCount).toBe(4); // 1 initial + 3 retries
        expect(recordedSleeps).toEqual([1000, 2000, 4000]);
      } finally {
        teardown();
      }
    },
    { timeout: 10000 },
  );

  test(
    "aborted invocation is not retried",
    async () => {
      setup();
      try {
        const bin = join(dir, "agent");
        const script = `#!/usr/bin/env bash
printf 'error: connection closed' 1>&2
exit 1
`;
        writeFileSync(bin, script);
        chmodSync(bin, 0o755);

        let spawnCount = 0;
        const controller = new AbortController();
        const result = await runAgent(
          {
            name: "claude",
            binary: bin,
            cwd: realpathSync(cwd),
            buildArgv: () => {
              spawnCount++;
              if (spawnCount === 1) {
                // Abort immediately after first spawn
                controller.abort("test-abort");
              }
              return [];
            },
            stdio: ["ignore", "pipe", "pipe"],
            streamErrorPrefix: "test:",
          },
          "test",
          { cwd: realpathSync(cwd), signal: controller.signal },
        );

        expect(result.kind).toBe("error");
        expect(spawnCount).toBe(1); // Only 1 spawn, no retries
      } finally {
        teardown();
      }
    },
    { timeout: 10000 },
  );

  test(
    "onTransientRetry callback fires per attempt",
    async () => {
      setup();
      try {
        const bin = join(dir, "agent");
        const script = `#!/usr/bin/env bash
if [ -f "${dir}/call-count" ]; then
  COUNT=$(cat "${dir}/call-count")
else
  COUNT=0
fi
COUNT=$((COUNT + 1))
echo $COUNT > "${dir}/call-count"
if [ $COUNT -lt 3 ]; then
  printf 'error: socket hang up' 1>&2
  exit 42
fi
printf 'success'
exit 0
`;
        writeFileSync(bin, script);
        chmodSync(bin, 0o755);

        const retries: { attempt: number; cap: number; exitCode: number }[] = [];
        const result = await runAgent(
          {
            name: "claude",
            binary: bin,
            cwd: realpathSync(cwd),
            buildArgv: () => [],
            stdio: ["ignore", "pipe", "pipe"],
            streamErrorPrefix: "test:",
          },
          "test",
          {
            cwd: realpathSync(cwd),
            onTransientRetry: (info) => {
              retries.push({ attempt: info.attempt, cap: info.cap, exitCode: info.exitCode });
            },
            sleepMs: async () => {
              // no-op sleep for test
            },
          },
        );

        expect(result.kind).toBe("ok");
        expect(retries.length).toBe(2);
        expect(retries[0]).toEqual({ attempt: 1, cap: 3, exitCode: 42 });
        expect(retries[1]).toEqual({ attempt: 2, cap: 3, exitCode: 42 });
      } finally {
        teardown();
      }
    },
    { timeout: 10000 },
  );
});
