import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FixCommandError,
  PreReadyFixCommitError,
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

  test("full tier aborts when verification is green but tree is dirty", () => {
    expect(() =>
      runReadyAndCommit({
        cwd: dir,
        tier: "full",
        runFix: () => {},
        runReady: () => {
          writeFileSync(join(dir, "override-dirt.txt"), "x\n");
        },
      }),
    ).toThrow(ReadyVerificationDirtyError);
  });

  test("ready command failure is ReadyCommandError after fix", () => {
    expect(() =>
      runReadyAndCommit({
        cwd: dir,
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
        readyCommand: script,
        runFix: () => {},
      }),
    ).toThrow(script);
  });

  test("custom readyCommand green with dirty porcelain aborts on full tier", () => {
    const script = join(sentinelDir, "dirty-green.sh");
    writeFileSync(
      script,
      `#!/bin/sh
touch dirty-from-override.txt
exit 0
`,
    );
    chmodSync(script, 0o755);

    expect(() =>
      runReadyAndCommit({
        cwd: dir,
        readyCommand: script,
        runFix: () => {},
      }),
    ).toThrow(ReadyVerificationDirtyError);
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
});
