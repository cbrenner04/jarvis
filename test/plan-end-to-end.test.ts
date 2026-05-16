import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planCommand } from "../src/commands/plan.ts";
import { registerProject } from "../src/config.ts";
import type { LogClient } from "../src/logging.ts";

interface TestSetup {
  projectRoot: string;
  cfgDir: string;
  origin: string;
  cleanup: () => void;
}

function setupTestProject(): TestSetup {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-e2e-"));
  const cfgDir = join(dir, "cfg");
  const projectRoot = join(dir, "project");

  mkdirSync(projectRoot);
  registerProject("project", projectRoot, { dir: cfgDir });

  // Initialize git repo in project
  execSync("git init -b main", { cwd: projectRoot });
  execSync("git config user.email 'test@example.com'", { cwd: projectRoot });
  execSync("git config user.name 'Test User'", { cwd: projectRoot });

  // Create initial commit
  writeFileSync(join(projectRoot, "README.md"), "test");
  execSync("git add README.md", { cwd: projectRoot });
  execSync("git commit -m 'initial'", { cwd: projectRoot });

  // Set up fake remote
  const remoteDir = mkdtempSync(join(tmpdir(), "jarvis-remote-e2e-"));
  execSync("git init --bare -b main", { cwd: remoteDir });
  execSync(`git remote add origin ${remoteDir}`, { cwd: projectRoot });
  execSync("git push -u origin main", { cwd: projectRoot });

  return {
    projectRoot,
    cfgDir,
    origin: remoteDir,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
      rmSync(remoteDir, { recursive: true, force: true });
    },
  };
}

function captureIO(): {
  io: { stdout: (s: string) => void; stderr: (s: string) => void };
  getOut: () => string;
  getErr: () => string;
} {
  let out = "";
  let err = "";
  return {
    io: {
      stdout: (s: string) => {
        out += s;
      },
      stderr: (s: string) => {
        err += s;
      },
    },
    getOut: () => out,
    getErr: () => err,
  };
}

const okLogClient: LogClient = {
  assertReachable: async () => {},
  send: async () => {},
};

describe("plan mode end-to-end", () => {
  test("plan command runs with inline intent", async () => {
    const setup = setupTestProject();
    try {
      const cap = captureIO();

      const code = await planCommand({
        args: ["my-test-plan", "test intent"],
        io: cap.io,
        cwd: setup.projectRoot,
        config: { dir: setup.cfgDir },
        logClient: okLogClient,
        skipGhCheck: true,
      });

      expect(typeof code).toBe("number");
    } finally {
      setup.cleanup();
    }
  });
});
