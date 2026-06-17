import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planCommand } from "../src/commands/plan.ts";
import { loadConfig, registerProject, writeConfig } from "../src/config.ts";
import type { LogClient } from "../src/logging.ts";

function captureIo() {
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
    out: () => out,
    err: () => err,
  };
}

function setupProject() {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-no-commit-intent-"));
  const cfgDir = join(dir, "cfg");
  const projectRoot = join(dir, "project");
  mkdirSync(projectRoot);
  registerProject("test-project", projectRoot, { dir: cfgDir });
  return { dir, cfgDir, projectRoot };
}

function writeReadyIntent(projectRoot: string, name: string): string {
  const dir = join(projectRoot, "ready-intents");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${name}.md`);
  writeFileSync(path, `---\nname: ${name}\n---\n\n## Prerequisites\n\nnone\n`);
  return path;
}

const mockLogClient: LogClient = {
  assertReachable: async () => {},
  send: async () => {},
};

describe("plan mode: no-commit Intent: output", () => {
  test("AC#1: commit: false plan prints Intent: path to stdout after intent.md is written and before draft starts", async () => {
    const { dir, cfgDir, projectRoot } = setupProject();
    try {
      // Configure project for no-commit mode with a failing agent (to simulate draft failure)
      const cfg = loadConfig({ dir: cfgDir });
      const projectConfig = cfg.projects["test-project"];
      if (!projectConfig) throw new Error("expected registered project");
      projectConfig.plan = { commit: false };

      // Use a failing agent so we fail early (simulates draft failure)
      cfg.modes.plan.agentOrder = [{ agent: "aider", model: "nonexistent-for-test" }];
      writeConfig(cfg, { dir: cfgDir });

      const intentPath = writeReadyIntent(projectRoot, "test-intent");
      const cap = captureIo();

      // Plan will fail due to bad agent, but Intent: path should still be printed
      await planCommand({
        io: cap.io,
        args: [intentPath],
        cwd: projectRoot,
        config: { dir: cfgDir },
        logClient: mockLogClient,
        skipGhCheck: true,
      }).catch(() => {
        // Expected to fail
      });

      // Intent: path should be printed even though draft fails
      const output = cap.out();
      expect(output).toMatch(/^Intent: .*intent\.md\n/);

      // The path should contain specs/ and test-intent
      expect(output).toContain("/specs/");
      expect(output).toContain("test-intent");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("AC#3: no-commit Intent: path is absolute (resolvable from anywhere)", async () => {
    const { dir, cfgDir, projectRoot } = setupProject();
    try {
      const cfg = loadConfig({ dir: cfgDir });
      const projectConfig = cfg.projects["test-project"];
      if (!projectConfig) throw new Error("expected registered project");
      projectConfig.plan = { commit: false };
      cfg.modes.plan.agentOrder = [{ agent: "aider", model: "nonexistent-for-test" }];
      writeConfig(cfg, { dir: cfgDir });

      const intentPath = writeReadyIntent(projectRoot, "absolute-path-test");
      const cap = captureIo();

      await planCommand({
        io: cap.io,
        args: [intentPath],
        cwd: projectRoot,
        config: { dir: cfgDir },
        logClient: mockLogClient,
        skipGhCheck: true,
      }).catch(() => {
        // Expected to fail
      });

      const output = cap.out();
      const match = output.match(/^Intent: (.+\.md)\n/);
      expect(match).toBeTruthy();
      if (match) {
        const pathFromOutput = match[1];
        // Should be absolute, not relative
        expect(pathFromOutput).toMatch(/^\//);
        // Should end with intent.md
        expect(pathFromOutput).toMatch(/intent\.md$/);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
