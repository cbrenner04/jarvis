import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runReadyAndCommit, runReadyGateWithTier, selectReadyTier } from "../src/ready-gate.ts";

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
  test("fast tier skips check:fix commit path when tree is dirty", () => {
    const tiers: string[] = [];
    let commitCalled = false;

    runReadyAndCommit({
      cwd: dir,
      tier: "fast",
      runReady: (_cwd, tier) => {
        tiers.push(tier);
        writeFileSync(join(dir, "dirty.txt"), "x\n");
      },
      commitCheckFix: () => {
        commitCalled = true;
      },
    });

    expect(tiers).toEqual(["fast"]);
    expect(commitCalled).toBe(false);
  });

  test("full tier runs check:fix commit path when tree is dirty", () => {
    const tiers: string[] = [];
    let commitCalled = false;

    runReadyAndCommit({
      cwd: dir,
      tier: "full",
      runReady: (_cwd, tier) => {
        tiers.push(tier);
        writeFileSync(join(dir, "dirty.txt"), "x\n");
      },
      commitCheckFix: () => {
        commitCalled = true;
      },
    });

    expect(tiers).toEqual(["full"]);
    expect(commitCalled).toBe(true);
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

  test("invokes readyCommand instead of bun run ready", () => {
    const sentinel = join(sentinelDir, "invoked");
    const script = join(sentinelDir, "ready.sh");
    writeFileSync(script, `#!/bin/sh\ntouch "${sentinel}"\n`);
    chmodSync(script, 0o755);

    runReadyAndCommit({ cwd: dir, readyCommand: script });

    expect(existsSync(sentinel)).toBe(true);
  });

  test("passes JARVIS_READY_TIER env var to readyCommand", () => {
    const tierFile = join(sentinelDir, "tier.txt");
    const script = join(sentinelDir, "ready.sh");
    writeFileSync(script, `#!/bin/sh\necho "$JARVIS_READY_TIER" > "${tierFile}"\n`);
    chmodSync(script, 0o755);

    runReadyAndCommit({ cwd: dir, tier: "fast", readyCommand: script });

    expect(readFileSync(tierFile, "utf8").trim()).toBe("fast");
  });

  test("error message names the readyCommand on failure", () => {
    const script = join(sentinelDir, "failing.sh");
    writeFileSync(script, `#!/bin/sh\nexit 1\n`);
    chmodSync(script, 0o755);

    expect(() => runReadyAndCommit({ cwd: dir, readyCommand: script })).toThrow(script);
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

    runReadyGateWithTier({ cwd: dir, agentLabel: "test", readyCommand: script });

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

    const tier = runReadyGateWithTier({
      cwd: dir,
      agentLabel: "test",
      recordedGreenResult: { headSha },
      runReady: (_cwd, readyTier) => {
        tiers.push(readyTier);
      },
      refreshRecordedGreenResult: () => {
        refreshed = true;
      },
    });

    expect(tier).toBe("fast");
    expect(tiers).toEqual(["fast"]);
    expect(refreshed).toBe(false);
  });

  test("uses full when no carrier and refreshes on success", () => {
    const tiers: string[] = [];
    let refreshedSha = "";

    const tier = runReadyGateWithTier({
      cwd: dir,
      agentLabel: "test",
      runReady: (_cwd, readyTier) => {
        tiers.push(readyTier);
      },
      refreshRecordedGreenResult: (sha) => {
        refreshedSha = sha;
      },
    });

    expect(tier).toBe("full");
    expect(tiers).toEqual(["full"]);
    expect(refreshedSha).toBe(execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf8" }).trim());
  });
});
