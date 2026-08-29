import { afterEach, expect, test } from "bun:test";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import type { WriteLoopInput } from "../execution/write-loop.ts";
import {
  resetWriteLoopBindingSourceDepsForTests,
  resolveWriteLoopBindings,
  setWriteLoopBindingSourceDepsForTests,
} from "./daemon.ts";

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid = 999_999;
  start() {
    queueMicrotask(() => {
      this.stdout.end("");
      this.stderr.end("stop");
      setImmediate(() => {
        this.emit("exit", 1);
        this.emit("close", 1);
      });
    });
  }
  kill() {
    return true;
  }
}

function fakeSpawn() {
  const calls: { binary: string; argv: readonly string[] }[] = [];
  const spawn = (binary: string, argv: readonly string[], _opts: SpawnOptions): ChildProcess => {
    calls.push({ binary, argv });
    const child = new FakeChild();
    child.start();
    return child as unknown as ChildProcess;
  };
  return { spawn, calls };
}

const CODEX_SNAPSHOT: AgentModelConfig = {
  codex: { implement: { rungs: [{ adapterModel: "gpt-5.4", priceKey: "gpt-5.4" }] } },
};

const codexContext: NonNullable<WriteLoopInput["bindingResolution"]> = {
  role: "implement",
  agents: ["codex"],
  agentModelConfig: CODEX_SNAPSHOT,
};

function writeInput(context: NonNullable<WriteLoopInput["bindingResolution"]>): WriteLoopInput {
  return {
    worktree: { projectRoot: "/tmp", projectName: "p", branchName: "b", baseRef: "main" },
    specPath: "spec.md",
    stepRules: "rules",
    expectedArtifactPath: "out",
    bindings: [],
    bindingResolution: context,
  };
}

function writeConfig(codexSandboxMode: string): string {
  const configPath = join(mkdtempSync(join(tmpdir(), "jarvis-sandbox-mode-")), "config.json");
  writeFileSync(configPath, JSON.stringify({ machineProfile: "p", agents: ["codex"], codexSandboxMode }));
  return configPath;
}

afterEach(() => {
  resetWriteLoopBindingSourceDepsForTests();
});

test("configured danger-full-access reaches the shared Codex binding on the fresh write/implement path", async () => {
  const fake = fakeSpawn();
  setWriteLoopBindingSourceDepsForTests({
    machineConfigPath: writeConfig("danger-full-access"),
    forceSnapshotAgentModelConfig: true,
    bindingSpawn: fake.spawn,
    codexSessionsDir: mkdtempSync(join(tmpdir(), "jarvis-sandbox-sessions-")),
  });

  const resolved = resolveWriteLoopBindings(writeInput(codexContext));
  expect(resolved.ok).toBe(true);
  if (!resolved.ok) return;
  await resolved.input.bindings[0]?.invoke({ prompt: "implement it", cwd: "/repo" });

  expect(fake.calls[0]?.binary).toBe("codex");
  expect(fake.calls[0]?.argv).toEqual([
    "exec",
    "--skip-git-repo-check",
    "--color",
    "never",
    "--sandbox",
    "danger-full-access",
    "--model",
    "gpt-5.4",
  ]);
});

test("configured Codex sandbox mode survives the daemon/JSON rehydration boundary", async () => {
  const fake = fakeSpawn();
  setWriteLoopBindingSourceDepsForTests({
    machineConfigPath: writeConfig("danger-full-access"),
    forceSnapshotAgentModelConfig: true,
    bindingSpawn: fake.spawn,
    codexSessionsDir: mkdtempSync(join(tmpdir(), "jarvis-sandbox-sessions-")),
  });

  // Round-trip the input through JSON as the daemon does across the IPC boundary, dropping any
  // live binding husks, then re-resolve.
  const rehydrated = JSON.parse(JSON.stringify(writeInput(codexContext))) as WriteLoopInput;
  const resolved = resolveWriteLoopBindings(rehydrated);
  expect(resolved.ok).toBe(true);
  if (!resolved.ok) return;
  await resolved.input.bindings[0]?.invoke({ prompt: "implement it", cwd: "/repo" });

  expect(fake.calls[0]?.argv).toEqual([
    "exec",
    "--skip-git-repo-check",
    "--color",
    "never",
    "--sandbox",
    "danger-full-access",
    "--model",
    "gpt-5.4",
  ]);
  // Not reverted to the default.
  expect(fake.calls[0]?.argv).not.toContain("workspace-write");
});
