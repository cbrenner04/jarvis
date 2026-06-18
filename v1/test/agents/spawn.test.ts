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
