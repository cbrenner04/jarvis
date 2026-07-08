import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync, execSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCurrentBranch } from "../../shared/git.ts";
import { appendAgentTrailer } from "../src/commit-trailer.ts";
import {
  FixCommandError,
  PostVerificationCommitError,
  PostVerificationPushError,
  PreReadyFixCommitError,
  parsePackageManagerRunScript,
  postVerificationStillDirtyErrorMessage,
  ReadyCommandError,
  ReadyVerificationDirtyError,
  runReadyAndCommit,
  runReadyGateWithTier,
  selectReadyTier,
} from "../src/ready-gate.ts";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jarvis-ready-gate-"));
  execSync("git init -b main", { cwd: dir });
  execSync('git config user.email "test@example.com"', { cwd: dir });
  execSync('git config user.name "test"', { cwd: dir });
  writeFileSync(join(dir, "seed.txt"), "seed\n");
  execSync("git add seed.txt && git commit -m seed", { cwd: dir });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("selectReadyTier", () => {
  test("returns full when no recorded green", () => {
    expect(selectReadyTier({ cwd: dir })).toBe("full");
  });

  test("returns fast when HEAD and porcelain match recorded green", () => {
    const headSha = execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf8" }).trim();
    expect(selectReadyTier({ cwd: dir, recordedGreenResult: { headSha } })).toBe("fast");
  });

  test("returns full when HEAD moved", () => {
    const headSha = execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf8" }).trim();
    writeFileSync(join(dir, "dirty.txt"), "x\n");
    execSync("git add dirty.txt && git commit -m move", { cwd: dir });
    expect(selectReadyTier({ cwd: dir, recordedGreenResult: { headSha } })).toBe("full");
  });

  test("returns full when worktree is dirty", () => {
    const headSha = execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf8" }).trim();
    writeFileSync(join(dir, "dirty.txt"), "x\n");
    expect(selectReadyTier({ cwd: dir, recordedGreenResult: { headSha } })).toBe("full");
  });
});

describe("runReadyAndCommit", () => {
  test("fast tier skips fix and pre-ready commit when tree is dirty", () => {
    const calls: string[] = [];
    let commitCalled = false;

    runReadyAndCommit({
      cwd: dir,
      timeoutMs: 30_000,
      tier: "fast",
      runFix: () => {
        calls.push("fix");
      },
      runReady: (_cwd, tier) => {
        calls.push(`ready:${tier}`);
        writeFileSync(join(dir, "dirty.txt"), "x\n");
      },
      commitPreReadyFix: () => {
        commitCalled = true;
      },
    });

    expect(calls).toEqual(["ready:fast"]);
    expect(commitCalled).toBe(false);
  });

  test("full tier runs fix before ready and commits when fix dirties tree", () => {
    const calls: string[] = [];
    let commitCalled = false;

    runReadyAndCommit({
      cwd: dir,
      timeoutMs: 30_000,
      tier: "full",
      runFix: () => {
        calls.push("fix");
        writeFileSync(join(dir, "dirty.txt"), "x\n");
      },
      runReady: (_cwd, tier) => {
        calls.push(`ready:${tier}`);
      },
      commitPreReadyFix: () => {
        commitCalled = true;
        execSync("git add -A && git commit -q -m fix", { cwd: dir });
      },
    });

    expect(calls).toEqual(["fix", "ready:full"]);
    expect(commitCalled).toBe(true);
  });

  test("full tier always runs fix even on a clean tree", () => {
    const calls: string[] = [];

    runReadyAndCommit({
      cwd: dir,
      timeoutMs: 30_000,
      tier: "full",
      runFix: () => {
        calls.push("fix");
      },
      runReady: (_cwd, tier) => {
        calls.push(`ready:${tier}`);
      },
    });

    expect(calls).toEqual(["fix", "ready:full"]);
  });

  test("fix command failure aborts before ready", () => {
    let readyCalled = false;

    expect(() =>
      runReadyAndCommit({
        cwd: dir,
        timeoutMs: 30_000,
        tier: "full",
        runFix: () => {
          throw new FixCommandError("bun run fix failed");
        },
        runReady: () => {
          readyCalled = true;
        },
      }),
    ).toThrow(FixCommandError);

    expect(readyCalled).toBe(false);
  });

  test("full tier commits post-verification churn when verification is green but tree is dirty", () => {
    const calls: string[] = [];
    let commitCalled = false;

    runReadyAndCommit({
      cwd: dir,
      timeoutMs: 30_000,
      tier: "full",
      agentLabel: "test-agent",
      runFix: () => {
        calls.push("fix");
      },
      runReady: () => {
        calls.push("ready");
        writeFileSync(join(dir, "post-ready.txt"), "x\n");
      },
      commitPostVerification: (cwd, agentLabel) => {
        commitCalled = true;
        expect(cwd).toBe(dir);
        expect(agentLabel).toBe("test-agent");
        execSync("git add -A && git commit -q -m post", { cwd: dir });
      },
    });

    expect(calls).toEqual(["fix", "ready"]);
    expect(commitCalled).toBe(true);
    expect(execSync("git status --porcelain", { cwd: dir, encoding: "utf8" }).trim()).toBe("");
  });

  test("full tier skips post-verification commit when verification leaves clean tree", () => {
    let commitCalled = false;

    runReadyAndCommit({
      cwd: dir,
      timeoutMs: 30_000,
      tier: "full",
      runFix: () => {},
      runReady: () => {},
      commitPostVerification: () => {
        commitCalled = true;
      },
    });

    expect(commitCalled).toBe(false);
  });

  test("full tier aborts when post-verification commit leaves tree dirty", () => {
    let err: ReadyVerificationDirtyError | undefined;
    try {
      runReadyAndCommit({
        cwd: dir,
        timeoutMs: 30_000,
        tier: "full",
        runFix: () => {},
        runReady: () => {
          writeFileSync(join(dir, "override-dirt.txt"), "x\n");
        },
        commitPostVerification: (cwd, agentLabel) => {
          execFileSync("git", ["add", "-A"], { cwd, stdio: "pipe" });
          const commitMessage = appendAgentTrailer("chore: apply post-ready verification output", agentLabel);
          execFileSync("git", ["commit", "-F", "-"], {
            cwd,
            env: process.env,
            stdio: ["pipe", "pipe", "pipe"],
            input: commitMessage,
          });
          writeFileSync(join(cwd, "still-dirty.txt"), "y\n");
          const porcelain = execFileSync("git", ["status", "--porcelain"], {
            cwd,
            encoding: "utf8",
            stdio: "pipe",
          }).trim();
          const dirtyBranch = getCurrentBranch(cwd);
          throw new ReadyVerificationDirtyError(postVerificationStillDirtyErrorMessage(dirtyBranch, porcelain));
        },
      });
    } catch (e) {
      err = e as ReadyVerificationDirtyError;
    }

    expect(err).toBeInstanceOf(ReadyVerificationDirtyError);
    expect(err?.message).toBe(
      postVerificationStillDirtyErrorMessage(
        "main",
        execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8", stdio: "pipe" }).trim(),
      ),
    );
  });

  test("post-verification commit failure aborts after green verification", () => {
    expect(() =>
      runReadyAndCommit({
        cwd: dir,
        timeoutMs: 30_000,
        tier: "full",
        runFix: () => {},
        runReady: () => {
          writeFileSync(join(dir, "dirty.txt"), "x\n");
        },
        commitPostVerification: () => {
          throw new PostVerificationCommitError("commit failed");
        },
      }),
    ).toThrow(PostVerificationCommitError);
  });

  test("post-verification push failure aborts after green verification", () => {
    expect(() =>
      runReadyAndCommit({
        cwd: dir,
        timeoutMs: 30_000,
        tier: "full",
        runFix: () => {},
        runReady: () => {
          writeFileSync(join(dir, "dirty.txt"), "x\n");
        },
        commitPostVerification: () => {
          throw new PostVerificationPushError("push failed");
        },
      }),
    ).toThrow(PostVerificationPushError);
  });

  test("ready command failure is ReadyCommandError after fix", () => {
    expect(() =>
      runReadyAndCommit({
        cwd: dir,
        timeoutMs: 30_000,
        tier: "full",
        runFix: () => {},
        runReady: () => {
          throw new ReadyCommandError("bun run ready failed");
        },
      }),
    ).toThrow(ReadyCommandError);
  });

  test("pre-ready fix commit failure aborts before ready", () => {
    let readyCalled = false;

    expect(() =>
      runReadyAndCommit({
        cwd: dir,
        timeoutMs: 30_000,
        tier: "full",
        runFix: () => {
          writeFileSync(join(dir, "dirty.txt"), "x\n");
        },
        commitPreReadyFix: () => {
          throw new PreReadyFixCommitError("commit failed");
        },
        runReady: () => {
          readyCalled = true;
        },
      }),
    ).toThrow(PreReadyFixCommitError);

    expect(readyCalled).toBe(false);
  });
});

describe("runReadyAndCommit readyCommand", () => {
  let sentinelDir: string;

  beforeEach(() => {
    sentinelDir = mkdtempSync(join(tmpdir(), "jarvis-sentinel-"));
  });

  afterEach(() => {
    rmSync(sentinelDir, { recursive: true, force: true });
  });

  test("invokes readyCommand instead of bun run ready after fix", () => {
    const sentinel = join(sentinelDir, "invoked");
    const fixSentinel = join(sentinelDir, "fix");
    const script = join(sentinelDir, "ready.sh");
    writeFileSync(script, `#!/bin/sh\ntouch "${sentinel}"\n`);
    chmodSync(script, 0o755);

    runReadyAndCommit({
      cwd: dir,
      timeoutMs: 30_000,
      readyCommand: script,
      runFix: () => {
        writeFileSync(fixSentinel, "fix\n");
      },
    });

    expect(existsSync(sentinel)).toBe(true);
    expect(existsSync(fixSentinel)).toBe(true);
  });

  test("passes JARVIS_READY_TIER env var to readyCommand", () => {
    const tierFile = join(sentinelDir, "tier.txt");
    const script = join(sentinelDir, "ready.sh");
    writeFileSync(script, `#!/bin/sh\necho "$JARVIS_READY_TIER" > "${tierFile}"\n`);
    chmodSync(script, 0o755);

    runReadyAndCommit({
      cwd: dir,
      timeoutMs: 30_000,
      tier: "fast",
      readyCommand: script,
      runFix: () => {
        throw new Error("fix should not run on fast tier");
      },
    });

    expect(readFileSync(tierFile, "utf8").trim()).toBe("fast");
  });

  test("error message names the readyCommand on failure", () => {
    const script = join(sentinelDir, "failing.sh");
    writeFileSync(script, `#!/bin/sh\nexit 1\n`);
    chmodSync(script, 0o755);

    expect(() =>
      runReadyAndCommit({
        cwd: dir,
        timeoutMs: 30_000,
        readyCommand: script,
        runFix: () => {},
      }),
    ).toThrow(script);
  });

  test("readyCommand timeout names command and gate", () => {
    expect(() =>
      runReadyAndCommit({
        cwd: dir,
        timeoutMs: 10,
        agentLabel: "timeout-gate",
        readyCommand: "sleep 1",
        runFix: () => {},
      }),
    ).toThrow("sleep 1 exceeded 10ms budget (gate: timeout-gate)");
  });

  test("custom readyCommand green with dirty porcelain commits on full tier", () => {
    const script = join(sentinelDir, "dirty-green.sh");
    writeFileSync(
      script,
      `#!/bin/sh
touch dirty-from-override.txt
exit 0
`,
    );
    chmodSync(script, 0o755);

    runReadyAndCommit({
      cwd: dir,
      timeoutMs: 30_000,
      readyCommand: script,
      runFix: () => {},
      commitPostVerification: () => {
        execSync("git add -A && git commit -q -m post", { cwd: dir });
      },
    });

    expect(existsSync(join(dir, "dirty-from-override.txt"))).toBe(true);
    expect(execSync("git status --porcelain", { cwd: dir, encoding: "utf8" }).trim()).toBe("");
  });
});

describe("runReadyAndCommit fixCommand", () => {
  let sentinelDir: string;

  beforeEach(() => {
    sentinelDir = mkdtempSync(join(tmpdir(), "jarvis-sentinel-fix-"));
  });

  afterEach(() => {
    rmSync(sentinelDir, { recursive: true, force: true });
  });

  test("invokes fixCommand instead of bun run fix on full tier", () => {
    const sentinel = join(sentinelDir, "fix-invoked");
    const script = join(sentinelDir, "fix.sh");
    writeFileSync(script, `#!/bin/sh\ntouch "${sentinel}"\n`);
    chmodSync(script, 0o755);

    runReadyAndCommit({
      cwd: dir,
      timeoutMs: 30_000,
      tier: "full",
      fixCommand: script,
      runReady: () => {},
    });

    expect(existsSync(sentinel)).toBe(true);
  });

  test("skips default bun run fix when fix script is absent from package.json", () => {
    const calls: string[] = [];
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { ready: "echo ready" } }, null, 2));
    execSync("git add package.json && git commit -m pkg", { cwd: dir });

    runReadyAndCommit({
      cwd: dir,
      timeoutMs: 30_000,
      tier: "full",
      runReady: () => {
        calls.push("ready");
      },
    });

    expect(calls).toEqual(["ready"]);
  });

  test("skips configured PM fixCommand when script is absent from package.json", () => {
    const calls: string[] = [];
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: {} }, null, 2));
    execSync("git add package.json && git commit -m pkg", { cwd: dir });

    runReadyAndCommit({
      cwd: dir,
      timeoutMs: 30_000,
      tier: "full",
      fixCommand: "npm run lint-fix",
      runReady: () => {
        calls.push("ready");
      },
    });

    expect(calls).toEqual(["ready"]);
  });

  test("skips PM-shaped fix when package.json is missing", () => {
    const calls: string[] = [];

    runReadyAndCommit({
      cwd: dir,
      timeoutMs: 30_000,
      tier: "full",
      runReady: () => {
        calls.push("ready");
      },
    });

    expect(calls).toEqual(["ready"]);
  });

  test("non-PM fixCommand runs without package.json script pre-check", () => {
    const sentinel = join(sentinelDir, "direct-fix");
    const script = join(sentinelDir, "direct.sh");
    writeFileSync(script, `#!/bin/sh\ntouch "${sentinel}"\n`);
    chmodSync(script, 0o755);

    runReadyAndCommit({
      cwd: dir,
      timeoutMs: 30_000,
      tier: "full",
      fixCommand: script,
      runReady: () => {},
    });

    expect(existsSync(sentinel)).toBe(true);
  });

  test("error message names the fixCommand on failure", () => {
    const script = join(sentinelDir, "failing-fix.sh");
    writeFileSync(script, `#!/bin/sh\nexit 1\n`);
    chmodSync(script, 0o755);

    expect(() =>
      runReadyAndCommit({
        cwd: dir,
        timeoutMs: 30_000,
        tier: "full",
        fixCommand: script,
        runReady: () => {},
      }),
    ).toThrow(script);
  });

  test("fixCommand timeout names command and gate", () => {
    expect(() =>
      runReadyAndCommit({
        cwd: dir,
        timeoutMs: 10,
        agentLabel: "timeout-gate",
        tier: "full",
        fixCommand: "sleep 1",
        runReady: () => {},
      }),
    ).toThrow("sleep 1 exceeded 10ms budget (gate: timeout-gate)");
  });

  test("absent-script skip still commits dirty output after skipped autofix", () => {
    let commitCalled = false;
    writeFileSync(join(dir, "dirty.txt"), "x\n");

    runReadyAndCommit({
      cwd: dir,
      timeoutMs: 30_000,
      tier: "full",
      runReady: () => {},
      commitPreReadyFix: () => {
        commitCalled = true;
        execSync("git add -A && git commit -q -m fix", { cwd: dir });
      },
    });

    expect(commitCalled).toBe(true);
  });
  test("runs default bun run fix when fix script exists and fixCommand is unset", () => {
    const sentinel = join(dir, "fix-ran");
    const script = join(dir, "fix-touch.sh");
    writeFileSync(script, `#!/bin/sh\ntouch "${sentinel}"\n`);
    chmodSync(script, 0o755);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { fix: "./fix-touch.sh" } }, null, 2));
    execSync("git add package.json fix-touch.sh && git commit -m pkg", { cwd: dir });

    runReadyAndCommit({
      cwd: dir,
      timeoutMs: 30_000,
      tier: "full",
      runReady: () => {},
      commitPreReadyFix: () => {
        execSync("git add -A && git commit -q -m fix", { cwd: dir });
      },
    });

    expect(existsSync(sentinel)).toBe(true);
  });
});

describe("parsePackageManagerRunScript", () => {
  test("parses bun/npm/pnpm/yarn run scripts", () => {
    expect(parsePackageManagerRunScript(["bun", "run", "fix"])).toBe("fix");
    expect(parsePackageManagerRunScript(["npm", "run", "--silent", "lint"])).toBe("lint");
    expect(parsePackageManagerRunScript(["pnpm", "run", "fmt"])).toBe("fmt");
    expect(parsePackageManagerRunScript(["yarn", "run", "test"])).toBe("test");
  });

  test("returns null for non-PM commands", () => {
    expect(parsePackageManagerRunScript(["/bin/sh", "fix.sh"])).toBe(null);
    expect(parsePackageManagerRunScript(["make", "fix"])).toBe(null);
  });
});

describe("runReadyGateWithTier fixCommand", () => {
  let sentinelDir: string;

  beforeEach(() => {
    sentinelDir = mkdtempSync(join(tmpdir(), "jarvis-sentinel-fix-tier-"));
  });

  afterEach(() => {
    rmSync(sentinelDir, { recursive: true, force: true });
  });

  test("threads fixCommand to runReadyAndCommit", () => {
    const sentinel = join(sentinelDir, "fix-invoked");
    const script = join(sentinelDir, "fix.sh");
    writeFileSync(script, `#!/bin/sh\ntouch "${sentinel}"\n`);
    chmodSync(script, 0o755);

    runReadyGateWithTier({
      cwd: dir,
      timeoutMs: 30_000,
      agentLabel: "test",
      fixCommand: script,
      runReady: () => {},
    });

    expect(existsSync(sentinel)).toBe(true);
  });
});

describe("runReadyGateWithTier readyCommand", () => {
  let sentinelDir: string;

  beforeEach(() => {
    sentinelDir = mkdtempSync(join(tmpdir(), "jarvis-sentinel-"));
  });

  afterEach(() => {
    rmSync(sentinelDir, { recursive: true, force: true });
  });

  test("threads readyCommand to runReadyAndCommit", () => {
    const sentinel = join(sentinelDir, "invoked");
    const script = join(sentinelDir, "ready.sh");
    writeFileSync(script, `#!/bin/sh\ntouch "${sentinel}"\n`);
    chmodSync(script, 0o755);

    runReadyGateWithTier({
      cwd: dir,
      timeoutMs: 30_000,
      agentLabel: "test",
      readyCommand: script,
      runFix: () => {},
    });

    expect(existsSync(sentinel)).toBe(true);
  });
});

describe("biome.json noNonNullAssertion override", () => {
  test("override exists with fix:none and warn level", () => {
    const biome = JSON.parse(readFileSync(join(__dirname, "../../biome.json"), "utf8"));
    const rule = biome?.linter?.rules?.style?.noNonNullAssertion;
    expect(rule).toBeDefined();
    expect(rule.fix).toBe("none");
    expect(rule.level).toBe("warn");
  });
});

describe("runReadyGateWithTier", () => {
  test("uses fast on unchanged tree and does not refresh carrier", () => {
    const headSha = execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf8" }).trim();
    const tiers: string[] = [];
    let refreshed = false;
    let fixCalled = false;

    const tier = runReadyGateWithTier({
      cwd: dir,
      timeoutMs: 30_000,
      agentLabel: "test",
      recordedGreenResult: { headSha },
      runFix: () => {
        fixCalled = true;
      },
      runReady: (_cwd, readyTier) => {
        tiers.push(readyTier);
      },
      refreshRecordedGreenResult: () => {
        refreshed = true;
      },
    });

    expect(tier).toBe("fast");
    expect(tiers).toEqual(["fast"]);
    expect(fixCalled).toBe(false);
    expect(refreshed).toBe(false);
  });

  test("uses full when no carrier and refreshes on success", () => {
    const tiers: string[] = [];
    const calls: string[] = [];
    let refreshedSha = "";

    const tier = runReadyGateWithTier({
      cwd: dir,
      timeoutMs: 30_000,
      agentLabel: "test",
      runFix: () => {
        calls.push("fix");
      },
      runReady: (_cwd, readyTier) => {
        tiers.push(readyTier);
        calls.push(`ready:${readyTier}`);
      },
      refreshRecordedGreenResult: (sha) => {
        refreshedSha = sha;
      },
    });

    expect(tier).toBe("full");
    expect(tiers).toEqual(["full"]);
    expect(calls).toEqual(["fix", "ready:full"]);
    expect(refreshedSha).toBe(execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf8" }).trim());
  });

  test("records HEAD after post-verification commit advances SHA", () => {
    const headBefore = execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf8" }).trim();
    let refreshedSha = "";

    runReadyGateWithTier({
      cwd: dir,
      timeoutMs: 30_000,
      agentLabel: "test",
      runFix: () => {},
      runReady: () => {
        writeFileSync(join(dir, "post-ready.txt"), "x\n");
      },
      commitPostVerification: () => {
        execSync("git add -A && git commit -q -m post", { cwd: dir });
      },
      refreshRecordedGreenResult: (sha) => {
        refreshedSha = sha;
      },
    });

    const headAfter = execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf8" }).trim();
    expect(headAfter).not.toBe(headBefore);
    expect(refreshedSha).toBe(headAfter);
  });
});
