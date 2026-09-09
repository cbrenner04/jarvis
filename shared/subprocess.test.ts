import { describe, expect, spyOn, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import {
  branchExistsLocal,
  branchExistsLocalAsync,
  branchExistsOnOrigin,
  branchExistsOnOriginAsync,
  isGitRepoAsync,
  isWorktreeDirty,
  isWorktreeDirtyAsync,
} from "./git.ts";
import {
  AsyncSubprocessError,
  type AsyncSubprocessRunner,
  realAsyncSubprocessRunner,
  realSubprocessRunner,
  type SubprocessRunner,
} from "./subprocess.ts";

const cwd = process.cwd();
const utf8Payload = "café 🎉";

/** Reads a pid written by a fixture shell command; returns `undefined` until the file has content. */
function readPidFile(pidFile: string): number | undefined {
  try {
    const contents = readFileSync(pidFile, "utf8").trim();
    return contents === "" ? undefined : Number(contents);
  } catch {
    return undefined;
  }
}

/** Fresh path under `.scratch/` for a fixture's readiness marker or pid file. */
function scratchPath(name: string): string {
  mkdirSync(`${cwd}/.scratch`, { recursive: true });
  return `${cwd}/.scratch/${name}-${Date.now()}-${Math.random()}`;
}

/** Polls until `path` exists, for readiness handshakes with a fixture process. */
async function waitForFile(path: string, attempts = 100): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (existsSync(path)) return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

function fakeRunner(
  results: Record<string, string | Error>,
): SubprocessRunner & { calls: Array<{ args: string[]; cwd: string }> } {
  const calls: Array<{ args: string[]; cwd: string }> = [];
  return {
    calls,
    run(cmd, args, runCwd) {
      calls.push({ args: [cmd, ...args], cwd: runCwd });
      const key = [cmd, ...args].join(" ");
      const result = results[key];
      if (result === undefined) throw new Error(`fakeRunner: no canned result for "${key}"`);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

function fakeAsyncRunner(
  results: Record<string, string | Error>,
): AsyncSubprocessRunner & { calls: Array<{ args: string[]; cwd: string }> } {
  const calls: Array<{ args: string[]; cwd: string }> = [];
  return {
    calls,
    async runAsync(cmd, args, runCwd) {
      calls.push({ args: [cmd, ...args], cwd: runCwd });
      const key = [cmd, ...args].join(" ");
      const result = results[key];
      if (result === undefined) throw new Error(`fakeAsyncRunner: no canned result for "${key}"`);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

describe("realSubprocessRunner", () => {
  test("returns UTF-8 stdout", () => {
    const stdout = realSubprocessRunner.run(
      "node",
      ["-e", `process.stdout.write(${JSON.stringify(utf8Payload)})`],
      cwd,
    );
    expect(stdout).toBe(utf8Payload);
  });

  test("throws on non-zero exit", () => {
    expect(() => realSubprocessRunner.run("node", ["-e", "process.exit(2)"], cwd)).toThrow();
  });
});

describe("realAsyncSubprocessRunner", () => {
  test("returns UTF-8 stdout", async () => {
    const stdout = await realAsyncSubprocessRunner.runAsync(
      "node",
      ["-e", `process.stdout.write(${JSON.stringify(utf8Payload)})`],
      cwd,
    );
    expect(stdout).toBe(utf8Payload);
  });

  test("rejects with exit status and captured output on non-zero exit", async () => {
    const result = realAsyncSubprocessRunner.runAsync(
      "node",
      ["-e", "process.stdout.write('out'); process.stderr.write('err'); process.exit(2)"],
      cwd,
    );

    await expect(result).rejects.toBeInstanceOf(AsyncSubprocessError);
    await expect(result).rejects.toMatchObject({ status: 2, stdout: "out", stderr: "err" });
  });

  test("accepts output beyond Node's default maxBuffer when configured", async () => {
    const stdout = await realAsyncSubprocessRunner.runAsync(
      "node",
      ["-e", "process.stdout.write('x'.repeat(2 * 1024 * 1024))"],
      cwd,
      { maxBuffer: 3 * 1024 * 1024 },
    );

    expect(stdout).toHaveLength(2 * 1024 * 1024);
  });

  test("stdio ignore resolves to empty string", async () => {
    const stdout = await realAsyncSubprocessRunner.runAsync(
      "node",
      ["-e", `process.stdout.write(${JSON.stringify(utf8Payload)})`],
      cwd,
      { stdio: "ignore" },
    );
    expect(stdout).toBe("");
  });

  test("env option overrides child process environment", async () => {
    const stdout = await realAsyncSubprocessRunner.runAsync("sh", ["-c", "echo $TEST_VAR"], cwd, {
      env: { TEST_VAR: "override" },
    });
    expect(stdout.trim()).toBe("override");
  });

  test("omitting env preserves inherited environment", async () => {
    process.env.TEST_INHERITED = "present";
    const stdout = await realAsyncSubprocessRunner.runAsync("sh", ["-c", "echo $TEST_INHERITED"], cwd);
    expect(stdout.trim()).toBe("present");
    delete process.env.TEST_INHERITED;
  });

  test("escalates to SIGKILL when the child ignores SIGTERM after abort", async () => {
    // Ignores SIGTERM and never exits on its own, so only the SIGKILL escalation
    // can settle the promise. Pins the `if (!settled) child.kill("SIGKILL")` guard.
    const controller = new AbortController();
    const promise = realAsyncSubprocessRunner.runAsync(
      "node",
      ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"],
      cwd,
      { signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 100);
    await expect(promise).rejects.toBeInstanceOf(AsyncSubprocessError);
  }, 5000);

  test("aborting a running child kills it via SIGTERM", async () => {
    // Default SIGTERM handling terminates the child, so a reject only happens when
    // the abort wiring (`signal !== undefined` / addEventListener) and the
    // non-settled `killChild` guard both fire.
    const controller = new AbortController();
    const promise = realAsyncSubprocessRunner.runAsync("node", ["-e", "setInterval(() => {}, 1000);"], cwd, {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 100);
    await expect(promise).rejects.toBeInstanceOf(AsyncSubprocessError);
  }, 5000);

  test("an already-aborted signal kills the child before it can run", async () => {
    // signal.aborted is true at start, exercising the pre-run `killChild` branch
    // rather than addEventListener. Pins the `if (options.signal.aborted)` guard.
    const controller = new AbortController();
    controller.abort();
    const promise = realAsyncSubprocessRunner.runAsync("node", ["-e", "setInterval(() => {}, 1000);"], cwd, {
      signal: controller.signal,
    });
    await expect(promise).rejects.toBeInstanceOf(AsyncSubprocessError);
  }, 5000);

  test("a non-group call leaves its grandchild running", async () => {
    const controller = new AbortController();
    const scratchDir = `${cwd}/.scratch`;
    mkdirSync(scratchDir, { recursive: true });
    const pidFile = `${scratchDir}/subprocess-test-non-group-${Date.now()}-${Math.random()}.pid`;
    const promise = realAsyncSubprocessRunner.runAsync(
      "sh",
      ["-c", `sleep 100 >/dev/null 2>&1 & echo $! > "${pidFile}"; wait`],
      cwd,
      { signal: controller.signal },
    );

    let grandchildPid: number | undefined;
    try {
      for (let i = 0; i < 50; i++) {
        const contents = readPidFile(pidFile);
        if (contents !== undefined) {
          grandchildPid = contents;
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(grandchildPid).toBeDefined();

      controller.abort();
      await expect(promise).rejects.toBeInstanceOf(AsyncSubprocessError);

      // Grandchild survives: non-group abort only kills the direct child.
      if (grandchildPid !== undefined) {
        expect(() => process.kill(grandchildPid as number, 0)).not.toThrow();
      }
    } finally {
      if (grandchildPid !== undefined) {
        try {
          process.kill(grandchildPid, "SIGKILL");
        } catch {
          // already gone
        }
      }
      rmSync(pidFile, { force: true });
    }
  }, 5000);

  test("a group-mode call reports its group id via onGroupId", async () => {
    let reportedPgid: number | undefined;
    const stdout = await realAsyncSubprocessRunner.runAsync("node", ["-e", "process.stdout.write('ok')"], cwd, {
      processGroup: {
        onGroupId: (pgid) => {
          reportedPgid = pgid;
        },
      },
    });
    expect(stdout).toBe("ok");
    expect(reportedPgid).toBeDefined();
  }, 5000);

  test("aborting a group-mode call kills the group", async () => {
    const controller = new AbortController();
    let reportedPgid: number | undefined;
    const promise = realAsyncSubprocessRunner.runAsync("node", ["-e", "setInterval(() => {}, 1000);"], cwd, {
      signal: controller.signal,
      processGroup: {
        onGroupId: (pgid) => {
          reportedPgid = pgid;
        },
      },
    });
    setTimeout(() => controller.abort(), 100);
    await expect(promise).rejects.toBeInstanceOf(AsyncSubprocessError);
    expect(reportedPgid).toBeDefined();
    if (reportedPgid !== undefined) {
      await new Promise((r) => setTimeout(r, 100));
      expect(() => process.kill(reportedPgid as number, 0)).toThrow();
    }
  }, 5000);

  test("a group-mode call that exceeds timeoutMs rejects with ETIMEDOUT and is killed via the group path", async () => {
    let reportedPgid: number | undefined;
    const promise = realAsyncSubprocessRunner.runAsync("node", ["-e", "setInterval(() => {}, 1000);"], cwd, {
      timeoutMs: 100,
      processGroup: {
        onGroupId: (pgid) => {
          reportedPgid = pgid;
        },
      },
    });
    await expect(promise).rejects.toBeInstanceOf(AsyncSubprocessError);
    await expect(promise).rejects.toMatchObject({ code: "ETIMEDOUT" });
    expect(reportedPgid).toBeDefined();
    if (reportedPgid !== undefined) {
      await new Promise((r) => setTimeout(r, 100));
      expect(() => process.kill(reportedPgid as number, 0)).toThrow();
    }
  }, 5000);

  test("a grandchild of a group-mode call is dead after abort", async () => {
    const controller = new AbortController();
    const scratchDir = `${cwd}/.scratch`;
    mkdirSync(scratchDir, { recursive: true });
    const pidFile = `${scratchDir}/subprocess-test-group-${Date.now()}-${Math.random()}.pid`;
    const promise = realAsyncSubprocessRunner.runAsync(
      "sh",
      ["-c", `sleep 100 >/dev/null 2>&1 & echo $! > "${pidFile}"; wait`],
      cwd,
      { signal: controller.signal, processGroup: {} },
    );

    let grandchildPid: number | undefined;
    try {
      for (let i = 0; i < 50; i++) {
        const contents = readPidFile(pidFile);
        if (contents !== undefined) {
          grandchildPid = contents;
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(grandchildPid).toBeDefined();

      controller.abort();
      await expect(promise).rejects.toBeInstanceOf(AsyncSubprocessError);

      await new Promise((r) => setTimeout(r, 100));
      if (grandchildPid !== undefined) {
        expect(() => process.kill(grandchildPid as number, 0)).toThrow();
      }
    } finally {
      if (grandchildPid !== undefined) {
        try {
          process.kill(grandchildPid, "SIGKILL");
        } catch {
          // already gone
        }
      }
      rmSync(pidFile, { force: true });
    }
  }, 5000);
});

describe("group-mode termination lifecycle", () => {
  /** Node fixture that ignores SIGTERM, writes `readyFile` once armed, then spins forever. */
  function resistantScript(readyFile: string): string {
    return `process.on('SIGTERM', () => {}); require('fs').writeFileSync(${JSON.stringify(readyFile)}, 'ready'); setInterval(() => {}, 1000);`;
  }

  function errnoError(code: string): NodeJS.ErrnoException {
    const error = new Error(code) as NodeJS.ErrnoException;
    error.code = code;
    return error;
  }

  test("timeout rejects only after process.kill(-pgid, 0) confirms ESRCH", async () => {
    const readyFile = scratchPath("subprocess-test-timeout-esrch");
    let probeConfirmedAt: number | undefined;
    const realKill = process.kill.bind(process);
    const killSpy = spyOn(process, "kill").mockImplementation((pid: number, signal?: string | number) => {
      if (signal === 0) {
        try {
          return realKill(pid, signal);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ESRCH" && probeConfirmedAt === undefined) {
            probeConfirmedAt = Date.now();
          }
          throw error;
        }
      }
      return realKill(pid, signal);
    });

    try {
      const promise = realAsyncSubprocessRunner.runAsync("node", ["-e", resistantScript(readyFile)], cwd, {
        timeoutMs: 80,
        processGroup: {},
      });

      await waitForFile(readyFile);
      expect(existsSync(readyFile)).toBe(true);

      await expect(promise).rejects.toMatchObject({ code: "ETIMEDOUT" });
      const settledAt = Date.now();
      // Pre-fix, the timeout rejected synchronously on signaling and never probed at all.
      expect(probeConfirmedAt).toBeDefined();
      expect(settledAt - (probeConfirmedAt as number)).toBeLessThan(50);
    } finally {
      killSpy.mockRestore();
      rmSync(readyFile, { force: true });
    }
  }, 5000);

  test("timeout keeps its promise pending through the 50ms SIGTERM grace", async () => {
    const readyFile = scratchPath("subprocess-test-timeout-grace");
    let sigtermAt: number | undefined;
    const realKill = process.kill.bind(process);
    const killSpy = spyOn(process, "kill").mockImplementation((pid: number, signal?: string | number) => {
      if (signal === "SIGTERM" && sigtermAt === undefined) sigtermAt = Date.now();
      return realKill(pid, signal);
    });

    try {
      const promise = realAsyncSubprocessRunner.runAsync("node", ["-e", resistantScript(readyFile)], cwd, {
        timeoutMs: 80,
        processGroup: {},
      });
      let settledFlag = false;
      promise.catch(() => {
        settledFlag = true;
      });

      await waitForFile(readyFile);
      expect(existsSync(readyFile)).toBe(true);

      for (let i = 0; i < 50 && sigtermAt === undefined; i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(sigtermAt).toBeDefined();

      // Still inside the 50ms grace: pre-fix code rejected immediately on signaling here.
      await new Promise((r) => setTimeout(r, 30));
      expect(settledFlag).toBe(false);

      await expect(promise).rejects.toMatchObject({ code: "ETIMEDOUT" });
      expect(settledFlag).toBe(true);
    } finally {
      killSpy.mockRestore();
      rmSync(readyFile, { force: true });
    }
  }, 5000);

  test("post-SIGKILL confirmation polls through EPERM and other non-ESRCH probe errors with no deadline", async () => {
    const EPERM_PROBES = 4;
    let probeCount = 0;
    let reportedPgid: number | undefined;
    const realKill = process.kill.bind(process);
    const killSpy = spyOn(process, "kill").mockImplementation((_pid: number, signal?: string | number) => {
      if (signal === 0) {
        probeCount++;
        throw errnoError(probeCount <= EPERM_PROBES ? "EPERM" : "ESRCH");
      }
      return true;
    });

    try {
      const promise = realAsyncSubprocessRunner.runAsync("node", ["-e", "setInterval(() => {}, 1000);"], cwd, {
        timeoutMs: 50,
        processGroup: {
          onGroupId: (pgid) => {
            reportedPgid = pgid;
          },
        },
      });

      await expect(promise).rejects.toMatchObject({ code: "ETIMEDOUT" });
      // Pre-fix polling doesn't exist at all, so this would never see a probe call.
      expect(probeCount).toBeGreaterThan(EPERM_PROBES);
    } finally {
      killSpy.mockRestore();
      if (reportedPgid !== undefined) {
        try {
          realKill(-reportedPgid, "SIGKILL");
        } catch {
          // already gone
        }
      }
    }
  }, 5000);

  test("abort settles only after confirmed group death, retaining the direct child's close status/output", async () => {
    const leaderReady = scratchPath("subprocess-test-abort-leader-ready");
    const memberReady = scratchPath("subprocess-test-abort-member-ready");
    const leaderCommand = [
      "printf 'leader-out'",
      "printf 'leader-err' 1>&2",
      `node -e ${JSON.stringify(resistantScript(memberReady))} &`,
      `touch "${leaderReady}"`,
      "sleep 100",
    ].join("\n");

    let probeConfirmedAt: number | undefined;
    const realKill = process.kill.bind(process);
    const killSpy = spyOn(process, "kill").mockImplementation((pid: number, signal?: string | number) => {
      if (signal === 0) {
        try {
          return realKill(pid, signal);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ESRCH" && probeConfirmedAt === undefined) {
            probeConfirmedAt = Date.now();
          }
          throw error;
        }
      }
      return realKill(pid, signal);
    });

    const controller = new AbortController();
    try {
      const promise = realAsyncSubprocessRunner.runAsync("sh", ["-c", leaderCommand], cwd, {
        signal: controller.signal,
        processGroup: {},
      });

      await waitForFile(leaderReady);
      await waitForFile(memberReady);
      expect(existsSync(leaderReady)).toBe(true);
      expect(existsSync(memberReady)).toBe(true);

      controller.abort();
      const outcome = await promise.catch((error: unknown) => error);
      const settledAt = Date.now();

      expect(outcome).toBeInstanceOf(AsyncSubprocessError);
      const error = outcome as AsyncSubprocessError;
      expect(error.stdout).toBe("leader-out");
      expect(error.stderr).toBe("leader-err");
      expect(error.code).toBe("SIGTERM");

      // Pre-fix, this settled straight off the direct child's close, before the spinning
      // member (still alive at that point) was ever confirmed dead.
      expect(probeConfirmedAt).toBeDefined();
      expect(settledAt).toBeGreaterThanOrEqual(probeConfirmedAt as number);
    } finally {
      killSpy.mockRestore();
      rmSync(leaderReady, { force: true });
      rmSync(memberReady, { force: true });
    }
  }, 5000);

  test("an owner that exits immediately after a group-mode timeout rejection leaves no group survivor", async () => {
    const ownerScript = scratchPath("subprocess-owner");
    const pgidFile = scratchPath("subprocess-owner-pgid");
    const subprocessModulePath = new URL("./subprocess.ts", import.meta.url).pathname;

    writeFileSync(
      `${ownerScript}.ts`,
      [
        `import { realAsyncSubprocessRunner } from ${JSON.stringify(subprocessModulePath)};`,
        `import { writeFileSync } from "node:fs";`,
        `realAsyncSubprocessRunner`,
        `  .runAsync("node", ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], process.cwd(), {`,
        `    timeoutMs: 80,`,
        `    processGroup: { onGroupId: (pgid) => writeFileSync(${JSON.stringify(pgidFile)}, String(pgid)) },`,
        `  })`,
        `  .catch(() => process.exit(0));`,
      ].join("\n"),
    );

    try {
      execFileSync("bun", ["run", `${ownerScript}.ts`], { cwd, stdio: "ignore" });

      const pgid = Number(readFileSync(pgidFile, "utf8").trim());
      expect(Number.isNaN(pgid)).toBe(false);
      expect(() => process.kill(-pgid, 0)).toThrow();
    } finally {
      rmSync(`${ownerScript}.ts`, { force: true });
      rmSync(pgidFile, { force: true });
    }
  }, 10000);

  async function assertNaturalCloseLeavesMemberAlive(exitCode: number): Promise<void> {
    const memberReady = scratchPath(`subprocess-test-natural-${exitCode}-ready`);
    const leaderCommand = [
      `node -e ${JSON.stringify(resistantScript(memberReady))} >/dev/null 2>&1 &`,
      "echo $!",
      `exit ${exitCode}`,
    ].join("\n");

    let probeCalls = 0;
    const realKill = process.kill.bind(process);
    const killSpy = spyOn(process, "kill").mockImplementation((pid: number, signal?: string | number) => {
      if (signal === 0) probeCalls++;
      return realKill(pid, signal);
    });

    let memberPid: number | undefined;
    try {
      const promise = realAsyncSubprocessRunner.runAsync("sh", ["-c", leaderCommand], cwd, { processGroup: {} });
      if (exitCode === 0) {
        memberPid = Number((await promise).trim());
      } else {
        const error = await promise.catch((e: unknown) => e as AsyncSubprocessError);
        expect(error).toBeInstanceOf(AsyncSubprocessError);
        memberPid = Number((error as AsyncSubprocessError).stdout.trim());
      }

      await waitForFile(memberReady);
      expect(existsSync(memberReady)).toBe(true);
      // Natural close never probes the group at all.
      expect(probeCalls).toBe(0);
      expect(Number.isNaN(memberPid)).toBe(false);
      expect(() => process.kill(memberPid as number, 0)).not.toThrow();
    } finally {
      killSpy.mockRestore();
      if (memberPid !== undefined) {
        try {
          process.kill(memberPid, "SIGKILL");
        } catch {
          // already gone
        }
      }
      rmSync(memberReady, { force: true });
    }
  }

  test("natural group-mode success leaves a surviving member alive without group probing", async () => {
    await assertNaturalCloseLeavesMemberAlive(0);
  }, 5000);

  test("natural group-mode non-zero close leaves a surviving member alive without group probing", async () => {
    await assertNaturalCloseLeavesMemberAlive(3);
  }, 5000);
});

describe("predicate parity", () => {
  test("branchExistsLocal and branchExistsLocalAsync agree on success and failure", async () => {
    const syncExists = fakeRunner({ "git rev-parse --verify feature": "abc123\n" });
    const syncMissing = fakeRunner({ "git rev-parse --verify nope": new Error("not a valid ref") });
    const asyncExists = fakeAsyncRunner({ "git rev-parse --verify feature": "abc123\n" });
    const asyncMissing = fakeAsyncRunner({ "git rev-parse --verify nope": new Error("not a valid ref") });

    expect(branchExistsLocal("/repo", "feature", syncExists)).toBe(true);
    expect(await branchExistsLocalAsync("/repo", "feature", asyncExists)).toBe(true);
    expect(branchExistsLocal("/repo", "nope", syncMissing)).toBe(false);
    expect(await branchExistsLocalAsync("/repo", "nope", asyncMissing)).toBe(false);
  });

  test("branchExistsOnOrigin and branchExistsOnOriginAsync agree on success and failure", async () => {
    const syncExists = fakeRunner({ "git ls-remote --heads origin main": "def456\trefs/heads/main\n" });
    const syncMissing = fakeRunner({ "git ls-remote --heads origin nope": "" });
    const asyncExists = fakeAsyncRunner({ "git ls-remote --heads origin main": "def456\trefs/heads/main\n" });
    const asyncMissing = fakeAsyncRunner({ "git ls-remote --heads origin nope": "" });

    expect(branchExistsOnOrigin("/repo", "main", syncExists)).toBe(true);
    expect(await branchExistsOnOriginAsync("/repo", "main", asyncExists)).toBe(true);
    expect(branchExistsOnOrigin("/repo", "nope", syncMissing)).toBe(false);
    expect(await branchExistsOnOriginAsync("/repo", "nope", asyncMissing)).toBe(false);
  });

  test("isWorktreeDirty and isWorktreeDirtyAsync agree on clean and dirty trees", async () => {
    const syncDirty = fakeRunner({ "git status --porcelain": " M src/file.ts\n" });
    const syncClean = fakeRunner({ "git status --porcelain": "" });
    const asyncDirty = fakeAsyncRunner({ "git status --porcelain": " M src/file.ts\n" });
    const asyncClean = fakeAsyncRunner({ "git status --porcelain": "" });

    expect(isWorktreeDirty("/repo", syncDirty)).toBe(true);
    expect(await isWorktreeDirtyAsync("/repo", asyncDirty)).toBe(true);
    expect(isWorktreeDirty("/repo", syncClean)).toBe(false);
    expect(await isWorktreeDirtyAsync("/repo", asyncClean)).toBe(false);
  });

  test("isGitRepoAsync treats rejection as false", async () => {
    const runner = fakeAsyncRunner({
      "git rev-parse --is-inside-work-tree": new Error("not a git repo"),
    });
    expect(await isGitRepoAsync("/plain-dir", runner)).toBe(false);
  });
});
