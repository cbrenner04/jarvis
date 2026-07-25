import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ScopedTests } from "./ci-test-scope.ts";

export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
export const GRACE_PERIOD_MS = 5000; // 5 seconds for SIGTERM before SIGKILL
export const TIMEOUT_EXIT_CODE = 124; // Matches GNU timeout(1)
export const HEARTBEAT_MS = 15000; // Liveness ping for silent long-running steps
export const INSTALL_DIGEST_FILENAME = "jarvis-ready-install-digest";
export const DEADLINE_KILL_MARKER = "ready: deadline exceeded after";

export type ReadyTier = "fast" | "full";
export type ReadyCommand = { name: string; args: string[] };

const SIGNAL_EXIT_CODES: Partial<Record<NodeJS.Signals, number>> = {
  SIGINT: 130,
  SIGTERM: 143,
};

/** Parse `JARVIS_READY_TIER`; default `full` when unset or invalid. */
export function parseReadyTier(envValue = process.env.JARVIS_READY_TIER): ReadyTier {
  if (envValue === "fast" || envValue === "full") {
    return envValue;
  }

  if (envValue !== undefined && envValue !== "") {
    process.stderr.write(`warning: invalid JARVIS_READY_TIER="${envValue}"; using default (full)\n`);
  }

  return "full";
}

/**
 * Parse `JARVIS_READY_TEST_SCOPE`. Unset means "no scoping requested" (`undefined`, distinct from
 * an explicit empty scope `[]`), `"full"` and `""` are passed through, anything else is
 * whitespace-split script names.
 */
export function parseReadyTestScope(envValue = process.env.JARVIS_READY_TEST_SCOPE): ScopedTests | undefined {
  if (envValue === undefined) {
    return undefined;
  }
  if (envValue === "") {
    return [];
  }
  if (envValue === "full") {
    return "full";
  }
  return envValue.trim().split(/\s+/).filter(Boolean);
}

export function parseTimeout(): number {
  const envValue = process.env.JARVIS_READY_TIMEOUT_MS;
  if (!envValue) {
    return DEFAULT_TIMEOUT_MS;
  }

  const parsed = parseInt(envValue, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    process.stderr.write(
      `warning: invalid JARVIS_READY_TIMEOUT_MS="${envValue}"; using default (${DEFAULT_TIMEOUT_MS}ms)\n`,
    );
    return DEFAULT_TIMEOUT_MS;
  }

  return parsed;
}

/** SHA-256 hex digest of the given bytes or UTF-8 string. */
export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function readPackageIdentity(pkgJsonPath: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as {
      name?: unknown;
      version?: unknown;
    };
    if (typeof parsed.name !== "string" || typeof parsed.version !== "string") {
      return undefined;
    }
    return `${parsed.name}@${parsed.version}`;
  } catch {
    return undefined;
  }
}

function collectTopLevelPackageJsonPaths(nodeModulesDir: string): string[] {
  const paths: string[] = [];
  if (!existsSync(nodeModulesDir)) {
    return paths;
  }

  for (const entry of readdirSync(nodeModulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }

    if (entry.name.startsWith("@")) {
      const scopeDir = join(nodeModulesDir, entry.name);
      for (const scoped of readdirSync(scopeDir, { withFileTypes: true })) {
        if (!scoped.isDirectory()) {
          continue;
        }
        const pkgJson = join(scopeDir, scoped.name, "package.json");
        if (existsSync(pkgJson)) {
          paths.push(pkgJson);
        }
      }
      continue;
    }

    const pkgJson = join(nodeModulesDir, entry.name, "package.json");
    if (existsSync(pkgJson)) {
      paths.push(pkgJson);
    }
  }

  return paths;
}

/** SHA-256 of sorted `name@version` strings from top-level installed packages. */
export function computeNodeModulesIdentityDigest(repoRoot: string): string | undefined {
  const nodeModulesDir = join(repoRoot, "node_modules");
  if (!existsSync(nodeModulesDir)) {
    return undefined;
  }

  const identities = collectTopLevelPackageJsonPaths(nodeModulesDir)
    .map(readPackageIdentity)
    .filter((identity): identity is string => identity !== undefined)
    .sort();

  return sha256Hex(identities.join("\n"));
}

/** Combined install digest: lockfile bytes hash plus node_modules identity hash. */
export function computeInstallDigest(repoRoot: string): string | undefined {
  const lockfilePath = join(repoRoot, "bun.lock");
  if (!existsSync(lockfilePath)) {
    return undefined;
  }

  const lockfileHash = sha256Hex(readFileSync(lockfilePath));
  const nodeModulesHash = computeNodeModulesIdentityDigest(repoRoot);
  if (nodeModulesHash === undefined) {
    return undefined;
  }

  return `${lockfileHash}:${nodeModulesHash}`;
}

/**
 * Resolve the git dir for `repoRoot`. In a worktree `.git` is a *file* pointing
 * at `…/.git/worktrees/<name>`, so we ask git for the real per-worktree dir
 * instead of assuming `<repoRoot>/.git` is a directory. Falls back to the
 * literal `.git` path for non-git checkouts (e.g. test temp dirs).
 */
function gitDir(repoRoot: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--absolute-git-dir"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return join(repoRoot, ".git");
  }
}

function installDigestPath(repoRoot: string): string {
  return join(gitDir(repoRoot), INSTALL_DIGEST_FILENAME);
}

/** Last recorded successful install digest for this checkout, if any. */
export function readRecordedInstallDigest(repoRoot: string): string | undefined {
  const digestPath = installDigestPath(repoRoot);
  if (!existsSync(digestPath)) {
    return undefined;
  }

  const recorded = readFileSync(digestPath, "utf8").trim();
  return recorded === "" ? undefined : recorded;
}

/** Persist the digest after a successful `bun install --frozen-lockfile`. */
export function writeRecordedInstallDigest(repoRoot: string, digest: string): void {
  const digestPath = installDigestPath(repoRoot);
  mkdirSync(dirname(digestPath), { recursive: true });
  writeFileSync(digestPath, `${digest}\n`, "utf8");
}

/** Whether the `full` tier should run install before the remaining steps. */
export function shouldRunInstall(repoRoot: string): boolean {
  const nodeModulesDir = join(repoRoot, "node_modules");
  if (!existsSync(nodeModulesDir)) {
    return true;
  }

  const currentDigest = computeInstallDigest(repoRoot);
  const recordedDigest = readRecordedInstallDigest(repoRoot);
  if (currentDigest === undefined || recordedDigest === undefined) {
    return true;
  }

  return currentDigest !== recordedDigest;
}

/** Ordered subprocess steps for the requested ready tier. */
export function getReadyCommands(
  tier: ReadyTier,
  opts: { runInstall: boolean; testScope?: ScopedTests },
): ReadyCommand[] {
  const testSteps: ReadyCommand[] =
    opts.testScope === undefined || opts.testScope === "full"
      ? [{ name: "bun", args: ["run", "test"] }]
      : opts.testScope.map((script) => ({ name: "bun", args: ["run", script] }));

  if (tier === "fast") {
    return [{ name: "bun", args: ["run", "typecheck"] }, ...testSteps];
  }

  const commands: ReadyCommand[] = [];
  if (opts.runInstall) {
    commands.push({ name: "bun", args: ["install", "--frozen-lockfile"] });
  }

  commands.push({ name: "bun", args: ["run", "check"] }, { name: "bun", args: ["run", "typecheck"] }, ...testSteps, {
    name: "bun",
    args: ["run", "lint:md"],
  });

  return commands;
}

export function runCommand(name: string, args: string[], deadlineMs: number, elapsedMs: number): Promise<number> {
  return new Promise((resolve) => {
    // Heartbeat so a silent long step (e.g. `bun test` runs ~80s with no output
    // under bunfig `onlyFailures`) doesn't look like a hang.
    const stepStart = Date.now();
    process.stderr.write(`ready: running ${name} ${args.join(" ")}\n`);
    const heartbeat = setInterval(() => {
      const secs = Math.round((Date.now() - stepStart) / 1000);
      process.stderr.write(`ready: …still running ${name} ${args.join(" ")} (${secs}s)\n`);
    }, HEARTBEAT_MS);
    heartbeat.unref();

    const child = spawn(name, args, {
      detached: true,
      stdio: "inherit",
    });

    let settled = false;
    let requestedExitCode: number | undefined;
    const settle = (code: number) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(code);
    };

    const remainingMs = Math.max(0, deadlineMs - elapsedMs);
    let forceKillHandle: NodeJS.Timeout | undefined;

    const killChildTree = (signal: NodeJS.Signals) => {
      if (!child.pid) return;

      try {
        process.kill(-child.pid, signal);
      } catch (_err) {
        // Process may have already exited
      }

      if (forceKillHandle) return;
      forceKillHandle = setTimeout(() => {
        if (child.pid) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch (_err) {
            // Process may have already exited
          }
        }
      }, GRACE_PERIOD_MS);
    };

    const onSignal = (signal: NodeJS.Signals) => {
      requestedExitCode = SIGNAL_EXIT_CODES[signal] ?? 1;
      killChildTree(signal);
    };

    const onSigint = () => onSignal("SIGINT");
    const onSigterm = () => onSignal("SIGTERM");

    const cleanup = () => {
      clearInterval(heartbeat);
      clearTimeout(timeoutHandle);
      if (forceKillHandle) {
        clearTimeout(forceKillHandle);
      }
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
    };

    const timeoutHandle = setTimeout(() => {
      if (!settled) {
        process.stderr.write(`${DEADLINE_KILL_MARKER} ${deadlineMs}ms; killing child tree\n`);
        requestedExitCode = TIMEOUT_EXIT_CODE;
        killChildTree("SIGTERM");
      }
    }, remainingMs);

    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);

    child.on("close", (code) => {
      const signalExitCode = child.signalCode ? SIGNAL_EXIT_CODES[child.signalCode] : undefined;
      settle(requestedExitCode ?? signalExitCode ?? code ?? -1);
    });

    child.on("error", (err) => {
      process.stderr.write(`error spawning ${name}: ${String(err)}\n`);
      settle(-1);
    });
  });
}

function isGenuineTestFailure(code: number): boolean {
  // Exclude signal exits and timeout kills; only genuine test-process failures trigger serial retry
  return code !== TIMEOUT_EXIT_CODE && !Object.values(SIGNAL_EXIT_CODES).includes(code);
}

function isTestStep(args: string[]): boolean {
  return args[0] === "run" && args[1]?.startsWith("test") === true && args.length === 2;
}

export async function runReady(opts?: { repoRoot?: string; runCommandFn?: typeof runCommand }): Promise<void> {
  const repoRoot = opts?.repoRoot ?? process.cwd();
  const runCommandFn = opts?.runCommandFn ?? runCommand;
  const tier = parseReadyTier();
  const runInstall = tier === "full" && shouldRunInstall(repoRoot);
  const testScope = parseReadyTestScope();
  const commands = getReadyCommands(tier, { runInstall, ...(testScope !== undefined ? { testScope } : {}) });
  const timeoutMs = parseTimeout();
  const startTime = Date.now();

  for (const { name, args } of commands) {
    const elapsed = Date.now() - startTime;
    let code = await runCommandFn(name, args, timeoutMs, elapsed);

    // Retry only the identical failed test step; a narrower command cannot clear it.
    if (code !== 0 && isTestStep(args) && isGenuineTestFailure(code)) {
      process.stderr.write(`ready: test step failed (code ${code}); retrying\n`);
      const serialElapsed = Date.now() - startTime;
      code = await runCommandFn(name, args, timeoutMs, serialElapsed);
      if (code === 0) {
        process.stderr.write(`ready: test flake recovered (retry passed); continuing\n`);
      } else {
        process.stderr.write(`ready: retry failed (code ${code})\n`);
      }
    }

    if (code !== 0) {
      process.exit(code);
    }

    if (tier === "full" && args[0] === "install") {
      const digest = computeInstallDigest(repoRoot);
      if (digest !== undefined) {
        writeRecordedInstallDigest(repoRoot, digest);
      }
    }
  }
}

if (import.meta.main) {
  runReady().catch((err) => {
    process.stderr.write(`fatal error: ${String(err)}\n`);
    process.exit(-1);
  });
}
