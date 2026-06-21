// This test requires real subprocess deadline/exit semantics for `runCommand` and cannot run in sandbox mode.
import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computeInstallDigest,
  computeNodeModulesIdentityDigest,
  DEFAULT_TIMEOUT_MS,
  getReadyCommands,
  parseReadyTier,
  parseTimeout,
  readRecordedInstallDigest,
  runCommand,
  runReady,
  sha256Hex,
  shouldRunInstall,
  TIMEOUT_EXIT_CODE,
  writeRecordedInstallDigest,
} from "../../scripts/ready.ts";

function withEnv(key: string, value: string | undefined, fn: () => void): void {
  const prev = process.env[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
  try {
    fn();
  } finally {
    if (prev === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = prev;
    }
  }
}

async function withEnvAsync(key: string, value: string | undefined, fn: () => Promise<void>): Promise<void> {
  const prev = process.env[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
  try {
    await fn();
  } finally {
    if (prev === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = prev;
    }
  }
}

function writePackage(repoRoot: string, pkgPath: string, name: string, version: string): void {
  const segments = pkgPath.startsWith("@") ? pkgPath.split("/") : [pkgPath];
  const fullPath = join(repoRoot, "node_modules", ...segments, "package.json");
  mkdirSync(join(fullPath, ".."), { recursive: true });
  writeFileSync(fullPath, JSON.stringify({ name, version }), "utf8");
}

describe("ready script deadline enforcement", () => {
  test("timeout validation: parsing valid JARVIS_READY_TIMEOUT_MS", () => {
    withEnv("JARVIS_READY_TIMEOUT_MS", "5000", () => {
      expect(parseTimeout()).toBe(5000);
    });
  });

  test("timeout validation: invalid JARVIS_READY_TIMEOUT_MS produces warning", () => {
    const writes: string[] = [];
    const origWrite = process.stderr.write;
    process.stderr.write = function (this: typeof process.stderr, chunk, ...args) {
      writes.push(String(chunk));
      return origWrite.apply(this, [chunk, ...args] as Parameters<typeof origWrite>);
    };

    try {
      withEnv("JARVIS_READY_TIMEOUT_MS", "not-a-number", () => {
        expect(parseTimeout()).toBe(DEFAULT_TIMEOUT_MS);
      });
      const stderr = writes.join("");
      expect(stderr).toContain("warning");
      expect(stderr).toContain("not-a-number");
    } finally {
      process.stderr.write = origWrite;
    }
  });

  test("timeout validation: missing JARVIS_READY_TIMEOUT_MS uses default", () => {
    withEnv("JARVIS_READY_TIMEOUT_MS", undefined, () => {
      expect(parseTimeout()).toBe(DEFAULT_TIMEOUT_MS);
    });
  });

  test("runCommand exits with 124 when the deadline is exceeded", async () => {
    const code = await runCommand("sleep", ["2"], 50, 0);
    expect(code).toBe(TIMEOUT_EXIT_CODE);
  });

  test("runCommand exits normally when commands complete", async () => {
    expect(await runCommand("true", [], 5000, 0)).toBe(0);
  });

  test("when a command exits non-zero, runCommand returns its exit code", async () => {
    expect(await runCommand("false", [], 5000, 0)).toBe(1);
  });
});

describe("ready tier parsing and step lists", () => {
  test("parseReadyTier defaults to full when unset", () => {
    withEnv("JARVIS_READY_TIER", undefined, () => {
      expect(parseReadyTier()).toBe("full");
    });
  });

  test("parseReadyTier accepts fast and full", () => {
    expect(parseReadyTier("fast")).toBe("fast");
    expect(parseReadyTier("full")).toBe("full");
  });

  test("parseReadyTier warns and defaults to full for invalid values", () => {
    const writes: string[] = [];
    const origWrite = process.stderr.write;
    process.stderr.write = function (this: typeof process.stderr, chunk, ...args) {
      writes.push(String(chunk));
      return origWrite.apply(this, [chunk, ...args] as Parameters<typeof origWrite>);
    };

    try {
      expect(parseReadyTier("turbo")).toBe("full");
      expect(writes.join("")).toContain('invalid JARVIS_READY_TIER="turbo"');
    } finally {
      process.stderr.write = origWrite;
    }
  });

  test("fast tier runs only typecheck then test", () => {
    expect(getReadyCommands("fast", { runInstall: false })).toEqual([
      { name: "bun", args: ["run", "typecheck"] },
      { name: "bun", args: ["run", "test"] },
    ]);
  });

  test("full tier runs check:fix:unsafe, typecheck, test, and check after install", () => {
    expect(getReadyCommands("full", { runInstall: true })).toEqual([
      { name: "bun", args: ["install", "--frozen-lockfile"] },
      { name: "bun", args: ["run", "check:fix:unsafe"] },
      { name: "bun", args: ["run", "typecheck"] },
      { name: "bun", args: ["run", "test"] },
      { name: "bun", args: ["run", "check"] },
    ]);
  });

  test("full tier skips install in the command list when runInstall is false", () => {
    const commands = getReadyCommands("full", { runInstall: false });
    const checkFixIndex = commands.findIndex(
      (command) => command.args[0] === "run" && command.args[1] === "check:fix:unsafe",
    );
    const installIndex = commands.findIndex((command) => command.args[0] === "install");

    expect(checkFixIndex).toBe(0);
    expect(installIndex).toBe(-1);
    expect(commands.map((command) => command.args[1])).toEqual(["check:fix:unsafe", "typecheck", "test", "check"]);
  });

  test("full tier keeps install before check:fix:unsafe when install runs", () => {
    const readySource = readFileSync("./scripts/ready.ts", "utf8");
    const checkFixIndex = readySource.indexOf('{ name: "bun", args: ["run", "check:fix:unsafe"]');
    const installIndex = readySource.indexOf('{ name: "bun", args: ["install",');

    expect(checkFixIndex).toBeGreaterThan(0);
    expect(installIndex).toBeGreaterThan(0);
    expect(installIndex).toBeLessThan(checkFixIndex);
  });

  test("JARVIS_READY_TIER is set by the harness and parsed only in scripts/ready.ts", () => {
    const readySource = readFileSync("./scripts/ready.ts", "utf8");
    const readyGateSource = readFileSync("./v1/src/ready-gate.ts", "utf8");

    expect(readySource).toContain("JARVIS_READY_TIER");
    expect(readyGateSource).toContain("JARVIS_READY_TIER");
    expect(readyGateSource).not.toContain("parseReadyTier");
  });

  test("runReady honors JARVIS_READY_TIER=fast without invoking install or check steps", async () => {
    const executed: string[] = [];
    const repoRoot = mkdtempSync(join(tmpdir(), "jarvis-ready-fast-"));

    try {
      await withEnvAsync("JARVIS_READY_TIER", "fast", async () => {
        await runReady({
          repoRoot,
          runCommandFn: async (_name, args) => {
            executed.push(args.join(" "));
            return 0;
          },
        });
      });

      expect(executed).toEqual(["run typecheck", "run test"]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test("runReady defaults to full tier when JARVIS_READY_TIER is unset", async () => {
    const executed: string[] = [];
    const repoRoot = mkdtempSync(join(tmpdir(), "jarvis-ready-full-"));
    writeFileSync(join(repoRoot, "bun.lock"), "lock-v1", "utf8");
    writePackage(repoRoot, "left-pad", "left-pad", "1.0.0");

    try {
      await withEnvAsync("JARVIS_READY_TIER", undefined, async () => {
        await runReady({
          repoRoot,
          runCommandFn: async (_name, args) => {
            executed.push(args.join(" "));
            return 0;
          },
        });
      });

      expect(executed[0]).toBe("install --frozen-lockfile");
      expect(executed.slice(1).map((step) => step.replace(/^run /, ""))).toEqual([
        "check:fix:unsafe",
        "typecheck",
        "test",
        "check",
      ]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

describe("ready install digest", () => {
  let repoRoot = "";

  afterEach(() => {
    if (repoRoot !== "") {
      rmSync(repoRoot, { recursive: true, force: true });
      repoRoot = "";
    }
  });

  test("computeNodeModulesIdentityDigest hashes sorted top-level package identities", () => {
    repoRoot = mkdtempSync(join(tmpdir(), "jarvis-ready-digest-"));
    writePackage(repoRoot, "zebra", "zebra", "1.0.0");
    writePackage(repoRoot, "alpha", "alpha", "2.0.0");
    writePackage(repoRoot, "@scope/pkg", "@scope/pkg", "3.0.0");

    expect(computeNodeModulesIdentityDigest(repoRoot)).toBe(sha256Hex("@scope/pkg@3.0.0\nalpha@2.0.0\nzebra@1.0.0"));
  });

  test("computeInstallDigest combines lockfile bytes with node_modules identity", () => {
    repoRoot = mkdtempSync(join(tmpdir(), "jarvis-ready-digest-"));
    writeFileSync(join(repoRoot, "bun.lock"), "lock-bytes", "utf8");
    writePackage(repoRoot, "alpha", "alpha", "1.0.0");

    const lockfileHash = sha256Hex("lock-bytes");
    const nodeModulesHash = sha256Hex("alpha@1.0.0");
    expect(computeInstallDigest(repoRoot)).toBe(`${lockfileHash}:${nodeModulesHash}`);
  });

  test("shouldRunInstall is true when node_modules is absent", () => {
    repoRoot = mkdtempSync(join(tmpdir(), "jarvis-ready-digest-"));
    writeFileSync(join(repoRoot, "bun.lock"), "lock-bytes", "utf8");

    expect(shouldRunInstall(repoRoot)).toBe(true);
  });

  test("shouldRunInstall is false when recomputed digest matches recorded digest", () => {
    repoRoot = mkdtempSync(join(tmpdir(), "jarvis-ready-digest-"));
    writeFileSync(join(repoRoot, "bun.lock"), "lock-bytes", "utf8");
    writePackage(repoRoot, "alpha", "alpha", "1.0.0");

    const digest = computeInstallDigest(repoRoot);
    expect(digest).toBeDefined();
    writeRecordedInstallDigest(repoRoot, digest as string);

    expect(shouldRunInstall(repoRoot)).toBe(false);
    expect(getReadyCommands("full", { runInstall: false }).some((command) => command.args[0] === "install")).toBe(
      false,
    );
  });

  test("shouldRunInstall is true when bun.lock changed since the recorded digest", () => {
    repoRoot = mkdtempSync(join(tmpdir(), "jarvis-ready-digest-"));
    writeFileSync(join(repoRoot, "bun.lock"), "lock-v1", "utf8");
    writePackage(repoRoot, "alpha", "alpha", "1.0.0");

    const digest = computeInstallDigest(repoRoot);
    expect(digest).toBeDefined();
    writeRecordedInstallDigest(repoRoot, digest as string);

    writeFileSync(join(repoRoot, "bun.lock"), "lock-v2", "utf8");
    expect(shouldRunInstall(repoRoot)).toBe(true);
  });

  test("shouldRunInstall is true when lockfile is unchanged but node_modules identity mismatches", () => {
    repoRoot = mkdtempSync(join(tmpdir(), "jarvis-ready-digest-"));
    writeFileSync(join(repoRoot, "bun.lock"), "lock-bytes", "utf8");
    writePackage(repoRoot, "alpha", "alpha", "1.0.0");

    const digest = computeInstallDigest(repoRoot);
    expect(digest).toBeDefined();
    writeRecordedInstallDigest(repoRoot, digest as string);

    writePackage(repoRoot, "beta", "beta", "9.9.9");
    expect(shouldRunInstall(repoRoot)).toBe(true);
  });

  test("runReady skips install when digest matches and records digest after install", async () => {
    repoRoot = mkdtempSync(join(tmpdir(), "jarvis-ready-digest-"));
    writeFileSync(join(repoRoot, "bun.lock"), "lock-bytes", "utf8");
    writePackage(repoRoot, "alpha", "alpha", "1.0.0");

    const digest = computeInstallDigest(repoRoot);
    expect(digest).toBeDefined();
    writeRecordedInstallDigest(repoRoot, digest as string);

    const executed: string[] = [];
    await withEnvAsync("JARVIS_READY_TIER", "full", async () => {
      await runReady({
        repoRoot,
        runCommandFn: async (_name, args) => {
          executed.push(args.join(" "));
          return 0;
        },
      });
    });

    expect(executed.map((step) => step.replace(/^run /, ""))).toEqual([
      "check:fix:unsafe",
      "typecheck",
      "test",
      "check",
    ]);
    expect(readRecordedInstallDigest(repoRoot)).toBe(digest);
  });

  test("runReady records digest after a successful install command", async () => {
    repoRoot = mkdtempSync(join(tmpdir(), "jarvis-ready-digest-"));
    writeFileSync(join(repoRoot, "bun.lock"), "lock-bytes", "utf8");
    writePackage(repoRoot, "alpha", "alpha", "1.0.0");

    await withEnvAsync("JARVIS_READY_TIER", "full", async () => {
      await runReady({
        repoRoot,
        runCommandFn: async (_name, args) => {
          if (args[0] === "install") {
            writePackage(repoRoot, "alpha", "alpha", "1.0.0");
          }
          return 0;
        },
      });
    });

    expect(readRecordedInstallDigest(repoRoot)).toBe(computeInstallDigest(repoRoot));
  });

  // Regression: the harness runs `bun run ready` inside a git worktree, where
  // `.git` is a *file*, not a directory. The digest must round-trip there
  // instead of crashing on `mkdir '.git'`.
  test("digest round-trips in a worktree where .git is a file", () => {
    repoRoot = mkdtempSync(join(tmpdir(), "jarvis-ready-wt-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repoRoot, stdio: "pipe" });
    git("init", "-q");
    git("config", "user.email", "t@t.t");
    git("config", "user.name", "t");
    git("commit", "-q", "--allow-empty", "-m", "init");
    const worktree = join(repoRoot, "wt");
    git("worktree", "add", "-q", worktree, "HEAD");

    // Sanity: the worktree's `.git` is a file, the case that used to crash.
    expect(readFileSync(join(worktree, ".git"), "utf8")).toContain("gitdir:");

    expect(() => writeRecordedInstallDigest(worktree, "wt-digest")).not.toThrow();
    expect(readRecordedInstallDigest(worktree)).toBe("wt-digest");
  });
});

function withSignalOrTimeoutTest(testName: string, exitCode: number, expectedCommands: string[]): void {
  test(testName, async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "jarvis-ready-signal-timeout-"));
    const executed: string[] = [];

    try {
      const origExit = process.exit;
      process.exit = ((code: number) => {
        throw new Error(`process.exit(${code})`);
      }) as never;

      try {
        await withEnvAsync("JARVIS_READY_TIER", "fast", async () => {
          try {
            await runReady({
              repoRoot,
              runCommandFn: async (_name, args) => {
                const step = args.join(" ");
                executed.push(step);
                if (step === "run test") {
                  return exitCode;
                }
                return 0;
              },
            });
          } catch (err) {
            if (String(err).includes("process.exit")) {
              // Expected
            } else {
              throw err;
            }
          }
        });
      } finally {
        process.exit = origExit;
      }
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }

    expect(executed).toEqual(expectedCommands);
  });
}

describe("ready serial-retry on test failure", () => {
  test("serial-green recovers: parallel test fails, serial test passes, remaining commands run", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "jarvis-ready-serial-green-"));
    const executed: string[] = [];
    const stderrLines: string[] = [];

    try {
      // Set up so install is skipped (mocks a cached install)
      writeFileSync(join(repoRoot, "bun.lock"), "lock-content", "utf8");
      writePackage(repoRoot, "pkg", "pkg", "1.0.0");
      const digest = computeInstallDigest(repoRoot);
      if (digest) {
        writeRecordedInstallDigest(repoRoot, digest);
      }

      const origWrite = process.stderr.write;
      process.stderr.write = function (this: typeof process.stderr, chunk, ...args) {
        stderrLines.push(String(chunk));
        return origWrite.apply(this, [chunk, ...args] as Parameters<typeof origWrite>);
      };

      try {
        await withEnvAsync("JARVIS_READY_TIER", "full", async () => {
          await runReady({
            repoRoot,
            runCommandFn: async (_name, args) => {
              const step = args.join(" ");
              executed.push(step);
              // Parallel test fails with genuine failure code
              if (step === "run test") {
                return 1; // First (parallel) test fails
              }
              // Serial test passes
              if (step === "test" && executed.filter((s) => s === "test").length === 1) {
                return 0; // Serial test passes
              }
              // All other commands succeed
              return 0;
            },
          });
        });
      } finally {
        process.stderr.write = origWrite;
      }

      // Verify execution order: check:fix:unsafe, typecheck, parallel test (fails), serial test (passes), check
      expect(executed).toEqual(["run check:fix:unsafe", "run typecheck", "run test", "test", "run check"]);

      // Verify the recovery signal is logged
      const stderr = stderrLines.join("");
      expect(stderr).toContain("parallel test failed");
      expect(stderr).toContain("retrying serially");
      expect(stderr).toContain("parallel-load flake recovered");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test("serial-red still fails: parallel test fails, serial test fails, gate exits non-zero", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "jarvis-ready-serial-red-"));
    const executed: string[] = [];
    let capturedExitCode: number | undefined;

    try {
      // Set up so install is skipped
      writeFileSync(join(repoRoot, "bun.lock"), "lock-content", "utf8");
      writePackage(repoRoot, "pkg", "pkg", "1.0.0");
      const digest = computeInstallDigest(repoRoot);
      if (digest) {
        writeRecordedInstallDigest(repoRoot, digest);
      }

      const origExit = process.exit;
      process.exit = ((code: number) => {
        capturedExitCode = code;
        throw new Error(`process.exit(${code})`);
      }) as never;

      try {
        await withEnvAsync("JARVIS_READY_TIER", "full", async () => {
          try {
            await runReady({
              repoRoot,
              runCommandFn: async (_name, args) => {
                const step = args.join(" ");
                executed.push(step);
                // Both parallel and serial tests fail
                if (step === "run test" || step === "test") {
                  return 2; // Genuine failure, not timeout/signal
                }
                return 0;
              },
            });
          } catch (err) {
            // Catch the exit error
            if (String(err).includes("process.exit")) {
              // Expected
            } else {
              throw err;
            }
          }
        });
      } finally {
        process.exit = origExit;
      }
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }

    // Verify both parallel and serial tests ran before failing
    expect(executed).toContain("run test");
    expect(executed).toContain("test");
    expect(capturedExitCode).toBe(2);
  });

  test("non-test steps exit immediately without serial retry", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "jarvis-ready-no-retry-"));
    const executed: string[] = [];

    try {
      // Set up so install runs (fresh node_modules)
      writeFileSync(join(repoRoot, "bun.lock"), "lock-content", "utf8");

      const origExit = process.exit;
      process.exit = ((code: number) => {
        throw new Error(`process.exit(${code})`);
      }) as never;

      try {
        await withEnvAsync("JARVIS_READY_TIER", "full", async () => {
          try {
            await runReady({
              repoRoot,
              runCommandFn: async (_name, args) => {
                const step = args.join(" ");
                executed.push(step);
                // check:fix:unsafe fails; no serial retry should happen
                if (step === "run check:fix:unsafe") {
                  return 1;
                }
                return 0;
              },
            });
          } catch (err) {
            if (String(err).includes("process.exit")) {
              // Expected
            } else {
              throw err;
            }
          }
        });
      } finally {
        process.exit = origExit;
      }
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }

    // Verify check:fix:unsafe ran and failed without any retry
    expect(executed).toEqual(["install --frozen-lockfile", "run check:fix:unsafe"]);
  });

  withSignalOrTimeoutTest("test timeout (exit code 124) does not trigger serial retry", 124, [
    "run typecheck",
    "run test",
  ]);

  withSignalOrTimeoutTest("test SIGINT exit (exit code 130) does not trigger serial retry", 130, [
    "run typecheck",
    "run test",
  ]);

  withSignalOrTimeoutTest("test SIGTERM exit (exit code 143) does not trigger serial retry", 143, [
    "run typecheck",
    "run test",
  ]);
});
